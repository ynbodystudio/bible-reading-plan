// 화면을 그리고, 버튼 누름·입력을 처리하는 파일입니다.

(function () {
  var STORAGE_KEY = 'brp.plan.v1';
  var WD = PLANNER.WEEKDAY_NAMES;

  var $ = function (id) { return document.getElementById(id); };

  var today = PLANNER.formatDate(new Date());
  var saved = loadSettings();

  // 입력 중인 설정 (저장된 계획이 있으면 그걸로 시작)
  var settings = saved ? clone(saved) : {
    scope: 'all',
    startDate: today,
    mode: 'period',
    periodValue: 1,
    periodUnit: 'year',
    deadline: PLANNER.addDays(PLANNER.addMonths(today, 12), -1),
    dailyMinutes: 15,
    speed: 'normal',
    weekdays: [true, true, true, true, true, true, true]
  };

  var lastResult = null;

  // ---------- 저장 ----------

  function loadSettings() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveSettings(s) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch (e) {
      alert('계획을 저장하지 못했어요. 개인정보 보호 모드인지 확인해주세요.');
    }
  }

  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

  // ---------- 글자 모양 도우미 ----------

  function prettyDate(str) {
    var d = PLANNER.parseDate(str);
    return d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + WD[d.getDay()] + ')';
  }

  function prettyMinutes(m) {
    m = Math.round(m);
    if (m < 60) return m + '분';
    var h = Math.floor(m / 60);
    return h + '시간' + (m % 60 ? ' ' + (m % 60) + '분' : '');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // ---------- 화면 전환 ----------

  function show(view) {
    $('view-setup').hidden = view !== 'setup';
    $('view-table').hidden = view !== 'table';
    window.scrollTo(0, 0);
  }

  // ---------- 계획 만들기 화면 ----------

  function initSetup() {
    document.querySelectorAll('.seg').forEach(function (seg) {
      seg.addEventListener('click', function (e) {
        var btn = e.target.closest('button');
        if (!btn) return;
        var name = seg.dataset.name;
        if (name === 'mode' && btn.dataset.value !== settings.mode) carryOverValues(btn.dataset.value);
        settings[name] = btn.dataset.value;
        renderSetup();
      });
    });

    var wd = $('weekdays');
    WD.forEach(function (name, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = name;
      b.dataset.day = i;
      wd.appendChild(b);
    });
    wd.addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      settings.weekdays[btn.dataset.day] = !settings.weekdays[btn.dataset.day];
      renderSetup();
    });

    ['startDate', 'periodValue', 'periodUnit', 'deadline', 'dailyMinutes'].forEach(function (id) {
      $(id).addEventListener('input', function () {
        settings[id] = $(id).value;
        renderSetup();
      });
    });

    $('btn-create').addEventListener('click', function () {
      if (!lastResult || !lastResult.ok) return;
      saved = clone(settings);
      saveSettings(saved);
      renderTable();
      show('table');
    });

    $('btn-cancel').addEventListener('click', function () {
      settings = clone(saved);
      renderTable();
      show('table');
    });

    $('btn-edit').addEventListener('click', function () {
      settings = clone(saved);
      renderSetup();
      show('setup');
    });
  }

  // 기준(기간/마감일/하루 시간)을 바꿀 때, 지금 계산된 값을 새 칸에 미리 채워줍니다.
  function carryOverValues(newMode) {
    if (!lastResult || !lastResult.ok) return;
    if (newMode === 'deadline') settings.deadline = lastResult.endDate;
    if (newMode === 'daily') settings.dailyMinutes = Math.max(1, Math.round(lastResult.minutesPerDay));
    if (newMode === 'period') {
      settings.periodValue = lastResult.calendarDays;
      settings.periodUnit = 'day';
    }
  }

  function renderSetup() {
    document.querySelectorAll('.seg').forEach(function (seg) {
      var value = settings[seg.dataset.name];
      seg.querySelectorAll('button').forEach(function (b) {
        b.classList.toggle('on', b.dataset.value === value);
      });
    });

    document.querySelectorAll('#weekdays button').forEach(function (b) {
      b.classList.toggle('on', settings.weekdays[b.dataset.day]);
    });

    document.querySelectorAll('.mode-panel').forEach(function (p) {
      p.hidden = p.dataset.mode !== settings.mode;
    });

    ['startDate', 'periodValue', 'periodUnit', 'deadline', 'dailyMinutes'].forEach(function (id) {
      if (document.activeElement !== $(id)) $(id).value = settings[id];
    });

    var chapters = PLANNER.getChapters(settings.scope);
    $('scope-hint').textContent = PLANNER.SCOPE_NAMES[settings.scope] + ' ' +
      chapters.length.toLocaleString() + '장';

    $('btn-cancel').hidden = !saved;

    lastResult = PLANNER.computePlan(settings);
    renderPreview(lastResult);
    $('btn-create').disabled = !lastResult.ok;
  }

  function renderPreview(r) {
    var box = $('preview');
    if (!r.ok) {
      box.innerHTML = '<div class="notice error">' + escapeHtml(r.error) + '</div>';
      return;
    }
    var auto = '<span class="auto">자동 계산</span>';
    var restDays = r.calendarDays - r.readingDays;
    var html =
      '<h2>미리보기</h2>' +
      '<dl class="stats">' +
        '<dt>기간</dt><dd>' + r.calendarDays + '일' +
          (restDays ? ' <small>(읽는 날 ' + r.readingDays + '일)</small>' : '') +
          (settings.mode !== 'period' ? auto : '') + '</dd>' +
        '<dt>마감일</dt><dd>' + prettyDate(r.endDate) + (settings.mode !== 'deadline' ? auto : '') + '</dd>' +
        '<dt>하루</dt><dd>약 ' + r.chaptersPerDay.toFixed(1) + '장 · ' + prettyMinutes(r.minutesPerDay) +
          (settings.mode !== 'daily' ? auto : '') + '</dd>' +
      '</dl>';
    if (settings.mode === 'daily' && r.readingDays === r.totalChapters) {
      html += '<div class="notice warn">하루 최소 1장씩은 읽도록 계획했어요.</div>';
    }
    if (r.warning) html += '<div class="notice warn">' + escapeHtml(r.warning) + '</div>';
    box.innerHTML = html;
  }

  // ---------- 전체표 화면 ----------

  function renderTable() {
    var r = PLANNER.computePlan(saved);
    if (!r.ok) {
      settings = clone(saved);
      renderSetup();
      show('setup');
      return;
    }

    var restDays = r.calendarDays - r.readingDays;
    $('summary').innerHTML =
      '<h2>' + PLANNER.SCOPE_NAMES[r.scope] + ' 통독</h2>' +
      '<p class="period">' + prettyDate(r.startDate) + ' ~ ' + prettyDate(r.endDate) + '</p>' +
      '<dl class="stats">' +
        '<dt>기간</dt><dd>' + r.calendarDays + '일' + (restDays ? ' <small>(읽는 날 ' + r.readingDays + '일)</small>' : '') + '</dd>' +
        '<dt>하루</dt><dd>약 ' + r.chaptersPerDay.toFixed(1) + '장 · ' + prettyMinutes(r.minutesPerDay) + '</dd>' +
      '</dl>';

    var html = '';
    var currentMonth = '';
    r.days.forEach(function (day) {
      var d = PLANNER.parseDate(day.date);
      var month = d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월';
      if (month !== currentMonth) {
        html += '<div class="month">' + month + '</div>';
        currentMonth = month;
      }
      var wd = d.getDay();
      var dateHtml = '<div class="date">' + d.getDate() +
        '<small class="' + (wd === 0 ? 'sun' : '') + '">(' + WD[wd] + ')</small></div>';
      var cls = 'day' + (day.rest ? ' rest' : '') + (day.date === today ? ' today' : '');
      if (day.rest) {
        html += '<div class="' + cls + '">' + dateHtml + '<div class="range">쉬는 날</div><div></div></div>';
      } else {
        html += '<div class="' + cls + '" title="' + escapeHtml(day.longLabel) + '">' + dateHtml +
          '<div class="range">' + escapeHtml(day.label) + '</div>' +
          '<div class="mins">' + prettyMinutes(day.minutes) + '</div></div>';
      }
    });
    $('plan-table').innerHTML = html;
  }

  // ---------- 시작 ----------

  initSetup();
  if (saved) {
    renderTable();
    show('table');
  } else {
    renderSetup();
    show('setup');
  }
})();
