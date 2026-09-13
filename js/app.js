// 화면을 그리고, 버튼 누름·입력을 처리하는 파일입니다.

(function () {
  var PLAN_KEY = 'brp.plan.v1';       // 계획 설정
  var LOG_KEY = 'brp.log.v1';         // 체크 기록 { 'YYYY-MM-DD': gid }
  var ARCHIVE_KEY = 'brp.archive.v1'; // 지난 통독 보관함
  var WD = PLANNER.WEEKDAY_NAMES;

  var $ = function (id) { return document.getElementById(id); };

  var today = PLANNER.formatDate(new Date());
  var saved = load(PLAN_KEY, null);
  var log = load(LOG_KEY, {});

  // 입력 중인 설정 (저장된 계획이 있으면 그걸로 시작)
  var settings = saved ? PLANNER.baseSettings(saved) : defaultSettings();

  var lastResult = null; // 계획 만들기 화면의 미리보기 결과
  var plan = null;       // 저장된 계획의 계산 결과
  var currentView = null;
  var extraDays = 0;     // 오늘 화면에서 "다음 분량 미리 읽기"를 누른 횟수
  var calMonth = null;   // 캘린더에 보이는 달 'YYYY-MM'
  var sheetState = null; // 열려 있는 창 { type: 'day', date } 또는 { type: 'replan', choice }

  function defaultSettings() {
    return {
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
  }

  // ---------- 저장 ----------

  function load(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function store(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      alert('저장하지 못했어요. 개인정보 보호 모드인지 확인해주세요.');
    }
  }

  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

  // ---------- 글자 모양 도우미 ----------

  function prettyDate(str) {
    var d = PLANNER.parseDate(str);
    return d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + WD[d.getDay()] + ')';
  }

  function shortDate(str) {
    var d = PLANNER.parseDate(str);
    return (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + WD[d.getDay()] + ')';
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
    currentView = view;
    ['setup', 'today', 'calendar', 'table'].forEach(function (v) {
      $('view-' + v).hidden = v !== view;
    });
    var tabs = view !== 'setup';
    $('tabbar').hidden = !tabs;
    document.body.classList.toggle('has-tabbar', tabs);
    document.querySelectorAll('.tabbar button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.tab === view);
    });
    if (view === 'today') extraDays = 0;
    if (view === 'calendar') calMonth = null;
    renderCurrent();
    window.scrollTo(0, 0);
  }

  function renderCurrent() {
    if (currentView === 'today') renderToday();
    if (currentView === 'calendar') renderCalendar();
    if (currentView === 'table') renderTable();
    if (currentView === 'setup') renderSetup();
  }

  function initTabs() {
    $('tabbar').addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (btn) show(btn.dataset.tab);
    });

    // 앱을 켜둔 채 날짜가 바뀌어도 "오늘"이 맞게
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) return;
      var now = PLANNER.formatDate(new Date());
      if (now !== today) {
        today = now;
        if (currentView !== 'setup') show(currentView);
      }
    });
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
      var changed = !saved || JSON.stringify(PLANNER.baseSettings(saved)) !== JSON.stringify(settings);
      if (!changed) { show('today'); return; }
      if (saved && Object.keys(log).length) {
        var ok = confirm('새 계획으로 바꾸면 지금까지의 체크 기록은 "지난 통독"으로 보관되고, 새 계획은 처음부터 시작해요.\n\n계속할까요?');
        if (!ok) return;
        var archive = load(ARCHIVE_KEY, []);
        archive.push({ plan: saved, log: log, archivedAt: today });
        store(ARCHIVE_KEY, archive);
        log = {};
        store(LOG_KEY, log);
      }
      saved = clone(settings);
      store(PLAN_KEY, saved);
      plan = null;
      show('today');
    });

    $('btn-cancel').addEventListener('click', function () {
      show('table');
    });

    $('btn-edit').addEventListener('click', function () {
      settings = PLANNER.baseSettings(saved);
      show('setup');
    });

    $('btn-replan-table').addEventListener('click', openReplanSheet);
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
    var auto = '<span class="badge">자동 계산</span>';
    var html =
      '<p class="eyebrow">미리보기 · 하루 평균' + (settings.mode !== 'daily' ? auto : '') + '</p>' +
      heroStat(r) +
      '<dl class="stats">' +
        '<dt>기간</dt><dd>' + periodText(r) + (settings.mode !== 'period' ? auto : '') + '</dd>' +
        '<dt>마감일</dt><dd>' + prettyDate(r.endDate) + (settings.mode !== 'deadline' ? auto : '') + '</dd>' +
      '</dl>';
    if (settings.mode === 'daily' && r.readingDays === r.totalChapters) {
      html += '<div class="notice">하루 최소 1장씩은 읽도록 계획했어요.</div>';
    }
    if (r.warning) html += '<div class="notice">' + escapeHtml(r.warning) + '</div>';
    box.innerHTML = html;
  }

  // "13분"처럼 하루 평균 시간을 크게 보여주는 부분
  function heroStat(r) {
    var m = Math.round(r.minutesPerDay);
    var num, unit;
    if (m < 60) { num = m; unit = '분'; }
    else { num = prettyMinutes(m); unit = ''; }
    return '<div class="hero-stat"><span class="hero-num' + (m < 60 ? '' : ' small') + '">' + num + '</span>' +
      (unit ? '<span class="hero-unit">' + unit + '</span>' : '') + '</div>' +
      '<p class="hero-caption">약 ' + r.chaptersPerDay.toFixed(1) + '장씩 읽어요</p>';
  }

  function periodText(r) {
    var restDays = r.calendarDays - r.readingDays;
    return r.calendarDays + '일' + (restDays ? ' <small>(읽는 날 ' + r.readingDays + '일)</small>' : '');
  }

  // ---------- 저장된 계획 ----------

  function getPlan() {
    if (!plan) plan = PLANNER.computeSaved(saved);
    return plan;
  }

  // 계획이 망가졌을 때(저장값 오류 등) 계획 만들기 화면으로
  function planOrSetup() {
    var p = getPlan();
    if (p.ok) return p;
    settings = PLANNER.baseSettings(saved);
    show('setup');
    return null;
  }

  // ---------- 오늘 화면 ----------

  function initToday() {
    $('today-card').addEventListener('click', function (e) {
      if (e.target.closest('[data-replan]')) openReplanSheet();
    });

    $('today-check').addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      var p = getPlan();
      var action = btn.dataset.action;

      if (action === 'chip') {
        var local = Number(btn.dataset.local);
        var g = PROGRESS.compute(p, log, today);
        if (g.todayEntry === local) delete log[today]; // 같은 동그라미를 다시 누르면 취소
        else log[today] = p.chapters[local].gid;
      } else if (action === 'all') {
        log[today] = p.chapters[Number(btn.dataset.local)].gid;
      } else if (action === 'clear') {
        delete log[today];
      } else if (action === 'more') {
        extraDays = Number(btn.dataset.next);
        renderToday();
        return;
      } else {
        return;
      }
      store(LOG_KEY, log);
      renderToday();
    });
  }

  function renderToday() {
    var p = planOrSetup();
    if (!p) return;
    var g = PROGRESS.compute(p, log, today);
    var chapters = p.chapters;

    $('today-title').textContent = shortDate(today);

    // --- 상태 한 줄 ---
    var status = '';
    if (g.finished) status = '<span class="dot good"></span>완독했어요';
    else if (g.phase === 'before') status = '';
    else if (g.behindDays > 0) status = '<span class="dot behind"></span>' + g.behindDays + '일 밀렸어요 · 천천히 따라잡아요';
    else if (g.aheadDays > 0) status = '<span class="dot good"></span>' + g.aheadDays + '일 앞서가는 중이에요';
    else status = '<span class="dot good"></span>계획대로 가고 있어요';
    $('today-status').innerHTML = status;

    // --- 오늘 읽을 곳 카드 ---
    var base = g.beforeToday;                 // 어제까지 읽은 곳
    var goal = g.targetEnd;                   // 오늘까지 읽어야 하는 곳
    var reached = g.todayEntry !== null ? Math.max(base, g.todayEntry) : base;
    var card = '';

    if (g.finished) {
      card =
        '<div class="celebrate">🎉</div>' +
        '<p class="today-range msg">' + PLANNER.SCOPE_NAMES[p.scope] + ' 통독을 마쳤어요</p>' +
        '<p class="today-meta">' + prettyDate(p.startDate) + '부터 함께 걸어온 길이에요.</p>';
    } else if (g.phase === 'before') {
      var first = p.days.filter(function (d) { return !d.rest; })[0];
      var dday = Math.round((PLANNER.parseDate(p.startDate) - PLANNER.parseDate(today)) / 86400000);
      card =
        '<p class="eyebrow">D-' + dday + ' · ' + shortDate(p.startDate) + ' 시작</p>' +
        '<p class="today-range">' + escapeHtml(first.longLabel) + '</p>' +
        '<p class="today-meta">첫날 읽을 곳이에요 · 약 ' + prettyMinutes(first.minutes) + '</p>';
    } else if (goal > reached) {
      var isRest = g.todayDay && g.todayDay.rest;
      var eyebrow = isRest ? '오늘은 쉬는 날 · 밀린 분량 따라잡기' :
        (g.behindDays > 0 ? '오늘 읽을 곳 · 밀린 분량 포함' : '오늘 읽을 곳');
      card =
        '<p class="eyebrow">' + eyebrow + '</p>' +
        '<p class="today-range">' + escapeHtml(PLANNER.rangeLabel(chapters, reached + 1, goal, true)) + '</p>' +
        '<p class="today-meta">' + rangeMeta(g, p, reached + 1, goal) + '</p>' +
        (g.behindDays > 0 ?
          '<p class="replan-link">분량이 부담되나요? <button type="button" data-replan>계획 다시 짜기</button></p>' : '');
    } else {
      var restToday = g.todayDay && g.todayDay.rest;
      card =
        '<div class="celebrate">' + (restToday ? '☕️' : '✅') + '</div>' +
        '<p class="today-range msg">' + (restToday ? '오늘은 쉬는 날이에요' : '오늘 분량을 다 읽었어요') + '</p>' +
        '<p class="today-meta">' + (restToday ? '밀린 분량도 없어요. 편히 쉬세요.' : '수고했어요. 내일 또 만나요.') + '</p>';
    }
    $('today-card').innerHTML = card;

    // --- 어디까지 읽었나요? ---
    var check = '';
    if (!g.finished && g.phase !== 'before') {
      // 동그라미는 "오늘 목표"까지, 미리 읽기를 누르면 앞으로의 읽는 날을 하나씩 더 보여줍니다.
      var future = g.futureReadingDays.filter(function (d) { return d.to > goal; });
      var shownEnd = goal;
      if (extraDays > 0 && future.length) shownEnd = future[Math.min(extraDays, future.length) - 1].to;
      var chipEnd = Math.min(Math.max(shownEnd, reached), g.n - 1);
      var nextIndex = future.findIndex(function (d) { return d.to > chipEnd; });
      var canMore = goal <= reached && nextIndex >= 0;

      if (chipEnd > base) {
        check += '<h2>어디까지 읽으셨나요?</h2>';
        check += '<p class="hint">마지막으로 읽은 장을 눌러주세요. 다시 누르면 취소돼요.</p>';
        check += chipsHtml(chapters, base + 1, chipEnd, reached, g.todayEntry, goal > base ? goal : -1);
        check += '<div class="actions">';
        if (goal > reached) {
          check += '<button type="button" class="btn primary" data-action="all" data-local="' + goal + '">다 읽었어요</button>';
        }
        if (canMore) {
          check += '<button type="button" class="btn secondary" data-action="more" data-next="' + (nextIndex + 1) + '">다음 분량 미리 읽기</button>';
        }
        if (g.todayEntry !== null) {
          check += '<button type="button" class="btn ghost" data-action="clear">오늘 체크 지우기</button>';
        }
        check += '</div>';
      } else if (canMore) {
        check += '<h2>더 읽고 싶다면</h2>' +
          '<div class="actions" style="margin-top:0"><button type="button" class="btn secondary" data-action="more" data-next="' + (nextIndex + 1) + '">다음 분량 미리 읽기</button></div>';
      }
    }
    $('today-check').innerHTML = check;
    $('today-check').hidden = !check;

    // --- 전체 진도 ---
    var where = g.bookmark >= 0 ?
      '📍 ' + escapeHtml(chapters[g.bookmark].name + ' ' + chapters[g.bookmark].ch + '장') + '까지 읽었어요' :
      '아직 체크한 곳이 없어요';
    $('today-progress').innerHTML =
      '<h2>전체 진도</h2>' +
      '<div class="progress-row"><strong>' + formatPercent(g.percent) + '</strong>' +
        '<span class="today-meta">' + (g.bookmark + 1) + ' / ' + g.n + '장</span></div>' +
      '<div class="progress-bar"><div class="' + (g.percent > 0 ? '' : 'zero') + '" style="width:' + g.percent + '%"></div></div>' +
      '<p class="today-meta">' + where + '</p>';
  }

  function rangeMeta(g, p, from, to) {
    var verses = g.cum[to + 1] - g.cum[from];
    return (to - from + 1) + '장 · 약 ' + prettyMinutes(Math.max(1, verses / p.speed));
  }

  function formatPercent(v) {
    if (v >= 100) return '100%';
    if (v > 0 && v < 1) return v.toFixed(1) + '%';
    return Math.floor(v) + '%';
  }

  // 책별로 묶은 장 번호 동그라미
  function chipsHtml(chapters, from, to, reached, todayEntry, goal) {
    var html = '';
    var currentBook = null;
    for (var i = from; i <= to; i++) {
      var c = chapters[i];
      if (c.name !== currentBook) {
        if (currentBook !== null) html += '</div></div>';
        html += '<div class="book-group"><p class="book-name">' + escapeHtml(c.name) + '</p><div class="chips">';
        currentBook = c.name;
      }
      var cls = 'chip';
      if (todayEntry !== null && i === reached) cls += ' end';
      else if (i <= reached) cls += ' read';
      if (i === goal) cls += ' goal';
      html += '<button type="button" class="' + cls + '" data-action="chip" data-local="' + i + '"' +
        ' aria-label="' + escapeHtml(c.name + ' ' + c.ch + '장까지') + '">' + c.ch + '</button>';
    }
    if (currentBook !== null) html += '</div></div>';
    return html;
  }

  // ---------- 전체표 화면 ----------

  function renderTable() {
    var r = planOrSetup();
    if (!r) return;
    var g = PROGRESS.compute(r, log, today);
    $('btn-replan-table').hidden = g.finished || g.phase === 'before';

    $('summary-title').textContent = PLANNER.SCOPE_NAMES[r.scope] + ' 통독표';
    $('summary-period').textContent = prettyDate(r.startDate) + ' ~ ' + prettyDate(r.endDate);
    $('summary').innerHTML =
      '<p class="eyebrow">하루 평균</p>' +
      heroStat(r) +
      '<dl class="stats">' +
        '<dt>기간</dt><dd>' + periodText(r) + '</dd>' +
        '<dt>진도</dt><dd>' + formatPercent(g.percent) + ' <small>(' + (g.bookmark + 1) + ' / ' + g.n + '장)</small></dd>' +
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
      var st = g.statusByDate[day.date];
      var stHtml = (st === 'done' || st === 'part' || st === 'miss' || st === 'rest-read') ?
        '<i class="st ' + st + '"></i>' : '';
      var dateHtml = '<div class="date">' + d.getDate() +
        '<small class="' + (wd === 0 ? 'sun' : '') + '">(' + WD[wd] + ')</small></div>';
      var cls = 'day' + (day.rest ? ' rest' : '') + (day.date === today ? ' today' : '');
      if (day.rest) {
        html += '<div class="' + cls + '" data-date="' + day.date + '">' + dateHtml + '<div class="range">쉬는 날</div>' +
          '<div class="right">' + stHtml + '</div></div>';
      } else {
        html += '<div class="' + cls + '" data-date="' + day.date + '" title="' + escapeHtml(day.longLabel) + '">' + dateHtml +
          '<div class="range">' + escapeHtml(day.label) + '</div>' +
          '<div class="right"><span class="mins">' + prettyMinutes(day.minutes) + '</span>' + stHtml + '</div></div>';
      }
    });
    $('plan-table').innerHTML = html;
  }

  // ---------- 캘린더 화면 ----------

  function initCalendar() {
    $('cal-prev').addEventListener('click', function () { moveMonth(-1); });
    $('cal-next').addEventListener('click', function () { moveMonth(1); });
    $('cal-grid').addEventListener('click', function (e) {
      var cell = e.target.closest('.cal-cell');
      if (cell && !cell.disabled) openDaySheet(cell.dataset.date);
    });
    $('plan-table').addEventListener('click', function (e) {
      var row = e.target.closest('.day[data-date]');
      if (row) openDaySheet(row.dataset.date);
    });
  }

  function monthOf(date) { return date.slice(0, 7); }

  function moveMonth(step) {
    calMonth = monthOf(PLANNER.addMonths(calMonth + '-01', step));
    renderCalendar();
  }

  function renderCalendar() {
    var p = planOrSetup();
    if (!p) return;
    var g = PROGRESS.compute(p, log, today);
    var first = monthOf(p.startDate);
    var last = monthOf(p.endDate);
    if (!calMonth) calMonth = monthOf(today);
    if (calMonth < first) calMonth = first;
    if (calMonth > last) calMonth = last;

    var parts = calMonth.split('-');
    var year = Number(parts[0]);
    var month = Number(parts[1]);
    $('cal-title').textContent = year + '년 ' + month + '월';
    $('cal-prev').disabled = calMonth <= first;
    $('cal-next').disabled = calMonth >= last;

    var dayMap = {};
    p.days.forEach(function (d) { dayMap[d.date] = d; });

    var firstDate = calMonth + '-01';
    var lastDay = new Date(year, month, 0).getDate();
    var html = '';
    for (var i = 0; i < PLANNER.weekdayOf(firstDate); i++) html += '<span></span>';

    var counts = { done: 0, part: 0, miss: 0, passed: 0 };
    for (var dnum = 1; dnum <= lastDay; dnum++) {
      var date = calMonth + '-' + String(dnum).padStart(2, '0');
      var day = dayMap[date];
      var st = g.statusByDate[date];
      var cls = 'cal-cell';
      var label = '';
      if (!day) cls += ' out';
      else {
        cls += ' ' + (st === 'future' || st === 'todo' ? '' : st);
        if (day.rest) { cls += ' rest'; label = '쉼'; }
        else label = p.chapters[day.from].abbr + p.chapters[day.from].ch;
        if (!day.rest && date <= today) {
          if (date < today || st === 'done' || st === 'part') counts.passed++;
          if (counts[st] !== undefined) counts[st]++;
        }
      }
      if (date === today) { cls += ' today'; label = '오늘'; }
      html += '<button type="button" class="' + cls + '" data-date="' + date + '"' + (day ? '' : ' disabled') +
        ' aria-label="' + shortDate(date) + '">' +
        '<span class="cal-num">' + dnum + '</span><span class="cal-label">' + escapeHtml(label) + '</span></button>';
    }
    $('cal-grid').innerHTML = html;

    var summary = '<p class="eyebrow">' + month + '월 기록</p>';
    if (counts.passed) {
      summary +=
        '<div class="hero-stat"><span class="hero-num">' + counts.done + '</span>' +
        '<span class="hero-unit">/ ' + counts.passed + '일</span></div>' +
        '<p class="hero-caption">읽는 날 ' + counts.passed + '일 중 다 읽은 날이에요</p>' +
        '<dl class="stats"><dt>조금 읽은 날</dt><dd>' + counts.part + '일</dd>' +
        '<dt>안 읽은 날</dt><dd>' + counts.miss + '일</dd></dl>';
    } else {
      summary += '<p class="today-range msg">아직 기록이 없어요</p>' +
        '<p class="today-meta">이 달의 읽는 날이 오면 여기에 모여요.</p>';
    }
    $('cal-summary').innerHTML = summary;
  }

  // ---------- 아래에서 올라오는 창 ----------

  function initSheet() {
    $('sheet').addEventListener('click', function (e) {
      if (e.target.closest('[data-close]')) { closeSheet(); return; }
      var btn = e.target.closest('button');
      if (!btn || !sheetState) return;
      if (sheetState.type === 'day') onDaySheetClick(btn);
      else onReplanSheetClick(btn);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && sheetState) closeSheet();
    });
  }

  function openSheet(state) {
    sheetState = state;
    $('sheet').hidden = false;
    document.body.style.overflow = 'hidden';
    renderSheet();
    $('sheet').querySelector('.sheet-panel').scrollTop = 0;
  }

  function closeSheet() {
    sheetState = null;
    $('sheet').hidden = true;
    document.body.style.overflow = '';
  }

  function renderSheet() {
    if (!sheetState) return;
    $('sheet-body').innerHTML = sheetState.type === 'day' ? daySheetHtml(sheetState.date) : replanSheetHtml();
  }

  // --- 날짜 창: 그날 계획 + 어디까지 읽었나요? ---

  var STATUS_TEXT = {
    done: '다 읽은 날', part: '조금 읽은 날', miss: '안 읽은 날', todo: '아직 체크 전',
    rest: '쉬는 날', 'rest-read': '쉬는 날에 읽은 날', future: '아직 오지 않은 날'
  };

  function openDaySheet(date) { openSheet({ type: 'day', date: date }); }

  function daySheetHtml(date) {
    var p = getPlan();
    var g = PROGRESS.compute(p, log, today);
    var f = PROGRESS.forDate(p, log, date);
    var chapters = p.chapters;
    var st = g.statusByDate[date];

    var html = '<h3>' + shortDate(date) + '</h3>' +
      '<p class="sheet-sub">' + (date === today ? '오늘 · ' : '') + (STATUS_TEXT[st] || '') + '</p>';

    if (f.day && !f.day.rest) {
      html += '<div class="plan-line"><strong>' + escapeHtml(f.day.longLabel) + '</strong><span>약 ' + prettyMinutes(f.day.minutes) + '</span></div>';
    } else {
      html += '<div class="plan-line"><strong>쉬는 날</strong><span>계획된 분량 없음</span></div>';
    }

    if (date > today) {
      html += '<p class="check-note">아직 오지 않은 날이라 체크할 수 없어요.</p>';
      return html;
    }

    var reached = f.entry !== null ? Math.max(f.before, f.entry) : f.before;
    if (f.chipEnd > f.before) {
      html += '<section class="card"><h2>이 날 어디까지 읽었나요?</h2>' +
        '<p class="hint">마지막으로 읽은 장을 눌러주세요. 다시 누르면 취소돼요.</p>' +
        chipsHtml(chapters, f.before + 1, f.chipEnd, reached, f.entry, f.targetEnd > f.before ? f.targetEnd : -1) +
        '<div class="actions">';
      if (f.targetEnd > reached) {
        html += '<button type="button" class="btn primary" data-action="all" data-local="' + f.targetEnd + '">이 날까지 분량 다 읽었어요</button>';
      }
      if (f.entry !== null) {
        html += '<button type="button" class="btn ghost" data-action="clear">이 날 체크 지우기</button>';
      }
      html += '</div></section>';
    } else {
      html += '<p class="check-note">이 날 전까지 이미 다 읽었어요.</p>';
    }
    return html;
  }

  function onDaySheetClick(btn) {
    var date = sheetState.date;
    var p = getPlan();
    var action = btn.dataset.action;
    if (action === 'chip') {
      var local = Number(btn.dataset.local);
      var f = PROGRESS.forDate(p, log, date);
      if (f.entry === local) delete log[date];
      else log[date] = p.chapters[local].gid;
    } else if (action === 'all') {
      log[date] = p.chapters[Number(btn.dataset.local)].gid;
    } else if (action === 'clear') {
      delete log[date];
    } else {
      return;
    }
    store(LOG_KEY, log);
    renderSheet();
    renderCurrent();
  }

  // --- 계획 다시 짜기 창 ---

  function openReplanSheet() {
    var opts = currentReplanOptions();
    if (!opts) return;
    openSheet({ type: 'replan', choice: opts.keep.result.ok ? 'keep' : 'push' });
  }

  function currentReplanOptions() {
    var p = getPlan();
    var g = PROGRESS.compute(p, log, today);
    return PROGRESS.replanOptions(saved, p, g, today);
  }

  function replanSheetHtml() {
    var p = getPlan();
    var g = PROGRESS.compute(p, log, today);
    var opts = currentReplanOptions();
    var from = g.beforeToday + 1;
    var nowMin = Math.round(p.minutesPerDay);

    var html = '<h3>계획 다시 짜기</h3>' +
      '<p class="sheet-sub">지금까지 체크한 기록은 그대로 남고, 오늘부터 남은 분량을 새로 나눠요.</p>' +
      '<div class="plan-line"><strong>' + escapeHtml(PLANNER.rangeLabel(p.chapters, from, g.n - 1, true)) + '</strong>' +
      '<span>남은 ' + (g.n - from) + '장</span></div>';

    var keep = opts.keep.result;
    html += '<button type="button" class="option' + (sheetState.choice === 'keep' ? ' on' : '') + '" data-choice="keep"' + (keep.ok ? '' : ' disabled') + '>' +
      '<span class="opt-title">마감일 지키기</span>' +
      '<span class="opt-desc">' + prettyDate(p.endDate) + '까지 끝내요. 하루 분량이 늘어날 수 있어요.</span>' +
      '<span class="opt-change">' + (keep.ok ?
        '하루 <s>' + prettyMinutes(nowMin) + '</s> → <b>' + prettyMinutes(keep.minutesPerDay) + '</b>' :
        escapeHtml(keep.error)) + '</span>' +
      (keep.ok && keep.warning ? '<span class="notice" style="display:block;margin-top:8px">' + escapeHtml(keep.warning) + '</span>' : '') +
      '</button>';

    var push = opts.push.result;
    html += '<button type="button" class="option' + (sheetState.choice === 'push' ? ' on' : '') + '" data-choice="push"' + (push.ok ? '' : ' disabled') + '>' +
      '<span class="opt-title">마감일 미루기</span>' +
      '<span class="opt-desc">하루 분량(약 ' + prettyMinutes(nowMin) + ')은 그대로, 끝나는 날이 늦어져요.</span>' +
      '<span class="opt-change">' + (push.ok ?
        '마감 <s>' + shortDate(p.endDate) + '</s> → <b>' + (push.endDate.slice(0, 4) !== p.endDate.slice(0, 4) ? push.endDate.slice(0, 4) + '년 ' : '') + shortDate(push.endDate) + '</b>' :
        escapeHtml(push.error)) + '</span>' +
      '</button>';

    var chosen = opts[sheetState.choice];
    html += '<div class="actions"><button type="button" class="btn primary" data-action="apply"' +
      (chosen && chosen.result.ok ? '' : ' disabled') + '>이렇게 다시 짜기</button></div>';
    return html;
  }

  function onReplanSheetClick(btn) {
    if (btn.dataset.choice) {
      sheetState.choice = btn.dataset.choice;
      renderSheet();
      return;
    }
    if (btn.dataset.action !== 'apply') return;
    var chosen = currentReplanOptions()[sheetState.choice];
    if (!chosen || !chosen.result.ok) return;
    saved = chosen.saved;
    store(PLAN_KEY, saved);
    plan = null;
    closeSheet();
    show('today');
  }

  // ---------- 시작 ----------

  initSetup();
  initToday();
  initCalendar();
  initSheet();
  initTabs();
  show(saved ? 'today' : 'setup');
})();
