// 화면을 그리고, 버튼 누름·입력을 처리하는 파일입니다.

(function () {
  var PLAN_KEY = 'brp.plan.v1';       // 계획 설정
  var LOG_KEY = 'brp.log.v1';         // 체크 기록 { 'YYYY-MM-DD': gid }
  var ARCHIVE_KEY = 'brp.archive.v1'; // 지난 통독 보관함
  var META_KEY = 'brp.meta.v1';       // 기타 정보 { lastBackup }
  var NOTIFY_KEY = 'brp.notify.v1';   // 알림 설정 (이 폰에만 해당, 백업하지 않음)
  var APP_ID = 'bible-reading-plan';  // 백업 파일 확인용 이름

  // 알림 서버 (push-server 폴더) 주소와 공개 열쇠
  var PUSH_SERVER = 'https://bible-push.bible-push.workers.dev';
  var VAPID_PUBLIC_KEY = 'BDMTs3ZoJLc6_8OaMk9DXWlZdOtBpGKpf4OPtrLhg8pPx8n1CxSDdLTDBHU_y1mGzRygahEdECksE-VhFJA3QC8';
  var NOTIFY_DATA_CACHE = 'brp-notify'; // sw.js의 NOTIFY_CACHE와 같은 이름
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
  var previousView = null; // 계획 만들기에서 "취소"를 누르면 돌아갈 화면
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
    if (view === 'setup' && currentView && currentView !== 'setup') previousView = currentView;
    currentView = view;
    ['setup', 'today', 'calendar', 'table', 'settings'].forEach(function (v) {
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
    if (view === 'settings') notifyMsg = null;
    renderCurrent();
    window.scrollTo(0, 0);
  }

  function renderCurrent() {
    if (currentView === 'today') renderToday();
    if (currentView === 'calendar') renderCalendar();
    if (currentView === 'table') renderTable();
    if (currentView === 'settings') renderSettings();
    if (currentView === 'setup') renderSetup();
    if (currentView !== 'setup') updateNotifyData();
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
      show(previousView || 'today');
    });

    $('btn-edit').addEventListener('click', function () {
      settings = PLANNER.baseSettings(saved);
      show('setup');
    });

    $('btn-replan').addEventListener('click', openReplanSheet);
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
    $('setup-import').hidden = !!saved;

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
      if (e.target.closest('[data-new-plan]')) startNewPlan();
    });

    $('today-progress').addEventListener('click', function (e) {
      if (e.target.closest('[data-vine]')) openSheet({ type: 'vine' });
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
      updateNotifyData();
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
        '<div class="celebrate">🍇</div>' +
        '<p class="today-range msg">' + PLANNER.SCOPE_NAMES[p.scope] + ' 통독을 마쳤어요</p>' +
        '<p class="today-meta">' + prettyDate(p.startDate) + '부터 함께 걸어온 길이에요.</p>' +
        '<div class="actions"><button type="button" class="btn primary" data-new-plan>새 통독 시작하기</button></div>';
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

    // --- 나의 포도나무 (전체 진도) ---
    var books = vineBooks(p, g.bookmark);
    var ripeCount = books.filter(function (b) { return b.read === b.count; }).length;
    var cur = currentBookIndex(books);
    var start = Math.max(0, Math.min(cur - 2, books.length - 6));
    var curBook = books[cur];
    var where = g.bookmark < 0 ? '아직 열린 포도알이 없어요. 첫 장을 읽으면 익기 시작해요.' :
      g.finished ? '모든 송이가 다 익었어요 🍇' :
      '📍 ' + escapeHtml(chapters[g.bookmark].name + ' ' + chapters[g.bookmark].ch + '장') + '까지 · ' +
        escapeHtml(curBook.name) + ' 송이 ' + Math.floor(curBook.read / curBook.count * 100) + '% 익었어요';
    $('today-progress').innerHTML =
      '<h2>나의 포도나무</h2>' +
      '<div class="vine-count"><strong><em>' + ripeCount + '</em>송이 열렸어요</strong>' +
        '<span class="today-meta">' + books.length + '송이 중 · 전체 ' + formatPercent(g.percent) + '</span></div>' +
      vineRowHtml(books, start, Math.min(start + 6, books.length), cur) +
      '<p class="today-meta" style="margin-top:14px">' + where + '</p>' +
      '<div class="actions"><button type="button" class="btn secondary" data-vine>포도나무 전체 보기</button></div>';
  }

  // ---------- 포도나무 그리기 ----------
  // 성경 한 권 = 포도송이 하나(포도알 10개). 읽은 장 비율만큼 포도알이 익어요.

  var GRAPES = [
    [12.5, 30], [24.5, 30], [36.5, 30], [48.5, 30],
    [18.5, 40.5], [30.5, 40.5], [42.5, 40.5],
    [24.5, 51], [36.5, 51],
    [30.5, 61.5]
  ];

  function vineBooks(p, bookmark) {
    var books = [];
    p.chapters.forEach(function (c, i) {
      var last = books[books.length - 1];
      if (!last || last.name !== c.name) {
        books.push({ name: c.name, abbr: c.abbr, start: i, count: 0, gid: c.gid });
        last = books[books.length - 1];
      }
      last.count++;
    });
    books.forEach(function (b) {
      b.read = Math.max(0, Math.min(b.count, bookmark - b.start + 1));
    });
    return books;
  }

  // 지금 읽고 있는(다음에 읽을) 책
  function currentBookIndex(books) {
    for (var i = 0; i < books.length; i++) if (books[i].read < books[i].count) return i;
    return books.length - 1;
  }

  function ripeGrapes(book) {
    if (book.read >= book.count) return GRAPES.length;
    if (book.read <= 0) return 0;
    return Math.min(GRAPES.length - 1, Math.max(1, Math.round(book.read / book.count * GRAPES.length)));
  }

  function clusterSvg(book, index) {
    var ripe = ripeGrapes(book);
    var svg = '<svg viewBox="0 0 60 70" aria-hidden="true">' +
      '<path class="vine-stem" d="M0 12 C15 7 45 17 60 12"/>' +
      '<path class="vine-stem" d="M30 13 L30 25" style="stroke-width:1.6"/>';
    if (index % 3 === 1) svg += '<path class="vine-leaf" d="M32 11 C36 2 48 1 55 5 C49 12 39 15 32 11Z"/>';
    GRAPES.forEach(function (pt, i) {
      svg += '<circle class="grape' + (i < ripe ? ' ripe' : '') + '" cx="' + pt[0] + '" cy="' + pt[1] + '" r="6.2"/>';
      if (i < ripe) svg += '<circle class="grape-shine" cx="' + (pt[0] - 2) + '" cy="' + (pt[1] - 2) + '" r="1.6"/>';
    });
    return svg + '</svg>';
  }

  function vineRowHtml(books, from, to, current) {
    var html = '<div class="vine">';
    for (var i = from; i < to; i++) {
      var b = books[i];
      var cls = 'vine-cell' + (b.read === b.count ? ' done' : '') + (i === current && b.read < b.count ? ' current' : '');
      html += '<div class="' + cls + '" title="' + escapeHtml(b.name + ' ' + b.read + ' / ' + b.count + '장') + '">' +
        clusterSvg(b, i) + '<span class="vine-name">' + escapeHtml(b.abbr) + '</span></div>';
    }
    return html + '</div>';
  }

  function vineSheetHtml() {
    var p = getPlan();
    var g = PROGRESS.compute(p, log, today);
    var books = vineBooks(p, g.bookmark);
    var cur = currentBookIndex(books);
    var ripeCount = books.filter(function (b) { return b.read === b.count; }).length;

    var groups = [];
    if (p.scope === 'all') {
      groups.push({ title: '구약', from: 0, to: 39 }, { title: '신약', from: 39, to: books.length });
    } else {
      groups.push({ title: PLANNER.SCOPE_NAMES[p.scope], from: 0, to: books.length });
    }

    var html = '<h3>나의 포도나무</h3>' +
      '<p class="sheet-sub">성경 한 권을 다 읽으면 포도송이 하나가 다 익어요. 지금 ' + ripeCount + '송이가 열렸어요.</p>';
    groups.forEach(function (grp) {
      var done = books.slice(grp.from, grp.to).filter(function (b) { return b.read === b.count; }).length;
      html += '<div class="vine-group"><h4>' + grp.title + '<small>' + done + ' / ' + (grp.to - grp.from) + '송이</small></h4>';
      for (var i = grp.from; i < grp.to; i += 6) html += vineRowHtml(books, i, Math.min(i + 6, grp.to), cur);
      html += '</div>';
    });
    return html;
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
      else if (sheetState.type === 'replan') onReplanSheetClick(btn);
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
    $('sheet-body').innerHTML =
      sheetState.type === 'day' ? daySheetHtml(sheetState.date) :
      sheetState.type === 'vine' ? vineSheetHtml() : replanSheetHtml();
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

  // ---------- 설정 화면 ----------

  function initSettings() {
    $('btn-export').addEventListener('click', exportBackup);
    $('btn-import').addEventListener('click', function () { $('import-file').click(); });
    $('btn-setup-import').addEventListener('click', function () { $('import-file').click(); });
    $('import-file').addEventListener('change', function () {
      var file = this.files && this.files[0];
      this.value = '';
      if (file) importBackup(file);
    });
  }

  // 완독 후 "새 통독 시작하기": 예전 설정을 가져오되 시작일은 오늘로
  function startNewPlan() {
    settings = PLANNER.baseSettings(saved);
    settings.startDate = today;
    if (settings.mode === 'deadline') {
      settings.mode = 'period';
      settings.periodValue = 1;
      settings.periodUnit = 'year';
    }
    show('setup');
  }

  function renderSettings() {
    var p = planOrSetup();
    if (!p) return;
    var g = PROGRESS.compute(p, log, today);

    $('set-plan').innerHTML =
      '<strong>' + PLANNER.SCOPE_NAMES[p.scope] + ' 통독 · ' + formatPercent(g.percent) + '</strong>' +
      '<span>~ ' + shortDate(p.endDate) + '</span>';
    $('btn-replan').hidden = g.finished || g.phase === 'before';

    // 백업 상태
    var meta = load(META_KEY, {});
    var status = $('backup-status');
    if (!meta.lastBackup) {
      status.textContent = Object.keys(log).length ? '아직 백업한 적이 없어요.' : '';
      status.className = 'backup-status' + (Object.keys(log).length ? ' warn' : '');
    } else {
      var days = PLANNER.daysBetween(meta.lastBackup, today);
      status.textContent = '마지막 백업: ' + prettyDate(meta.lastBackup) + (days > 0 ? ' (' + days + '일 전)' : ' (오늘)');
      status.className = 'backup-status' + (days >= 30 ? ' warn' : '');
    }

    renderNotify();
    renderArchive(g);
    renderInstallGuide();
  }

  function renderArchive(currentProgress) {
    var archive = load(ARCHIVE_KEY, []);
    var finishedCount = currentProgress.finished ? 1 : 0;
    var items = '';
    archive.slice().reverse().forEach(function (entry) {
      var p = PLANNER.computeSaved(entry.plan);
      if (!p.ok) return;
      var g = PROGRESS.compute(p, entry.log || {}, entry.archivedAt);
      if (g.finished) finishedCount++;
      items += '<div class="archive-item"><div>' +
        '<strong>' + PLANNER.SCOPE_NAMES[p.scope] + ' 통독</strong>' +
        '<small>' + shortYmd(p.startDate) + ' ~ ' + shortYmd(entry.archivedAt) + '</small></div>' +
        '<span class="pct' + (g.finished ? ' done' : '') + '">' + (g.finished ? '완독' : formatPercent(g.percent)) + '</span></div>';
    });

    $('archive-list').innerHTML =
      '<p class="archive-count"><b>' + finishedCount + '</b><span>번 완독했어요</span></p>' +
      (items || '<p class="hint" style="margin:0">아직 지난 통독이 없어요. 새 계획을 만들면 지금 기록이 여기에 보관돼요.</p>');
  }

  function shortYmd(str) {
    var d = PLANNER.parseDate(str);
    return d.getFullYear() + '.' + (d.getMonth() + 1) + '.' + d.getDate();
  }

  function isIOS() {
    return /iPhone|iPad|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function isStandalone() {
    return window.navigator.standalone === true ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  }

  function renderInstallGuide() {
    if (isStandalone()) {
      $('install-body').innerHTML = '<p class="installed-note">✅ 홈 화면 앱으로 쓰고 있어요.</p>';
      return;
    }
    var url = location.protocol.indexOf('http') === 0 ? location.href.split('#')[0].split('?')[0] : '';
    var shareIcon = '<svg class="share-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7.5 7.5L12 3l4.5 4.5M5 11v8a2 2 0 002 2h10a2 2 0 002-2v-8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    $('install-body').innerHTML =
      '<ol class="steps">' +
        '<li>아이폰 <b>사파리</b>로 이 앱 주소를 열어요.' + (url ? '<span class="url-box">' + escapeHtml(url) + '</span>' : '') + '</li>' +
        '<li>화면 아래의 <b>공유 버튼</b> ' + shareIcon + ' 을 눌러요.</li>' +
        '<li><b>"홈 화면에 추가"</b>를 누르고, 오른쪽 위 <b>"추가"</b>를 눌러요.</li>' +
      '</ol>' +
      '<p class="hint" style="margin-top:0">⚠️ 사파리 창과 홈 화면 앱은 기록이 <b>따로</b> 저장돼요. 추가한 뒤에는 홈 화면 아이콘으로만 열어주세요.</p>';
  }

  // --- 백업 ---

  function backupData() {
    return {
      app: APP_ID,
      version: 1,
      exportedAt: new Date().toISOString(),
      plan: saved,
      log: log,
      archive: load(ARCHIVE_KEY, [])
    };
  }

  function exportBackup() {
    var json = JSON.stringify(backupData(), null, 2);
    var name = 'bible-backup-' + today + '.json';

    // 아이폰: 공유 창으로 "파일에 저장" (가장 확실한 방법)
    if (isIOS() && typeof File === 'function' && navigator.canShare) {
      var file = new File([json], name, { type: 'application/json' });
      if (navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: '성경통독표 백업' })
          .then(markBackedUp)
          .catch(function (err) { if (err && err.name !== 'AbortError') downloadFile(json, name); });
        return;
      }
    }
    downloadFile(json, name);
  }

  function downloadFile(text, name) {
    var url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
    markBackedUp();
  }

  function markBackedUp() {
    var meta = load(META_KEY, {});
    meta.lastBackup = today;
    store(META_KEY, meta);
    if (currentView === 'settings') renderSettings();
  }

  function importBackup(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try { data = JSON.parse(reader.result); } catch (e) { data = null; }
      if (!data || data.app !== APP_ID || !data.plan || typeof data.log !== 'object' || !data.log) {
        alert('성경통독표 백업 파일이 아니에요. 파일을 다시 확인해주세요.');
        return;
      }
      if (!PLANNER.computeSaved(data.plan).ok) {
        alert('백업 파일의 계획을 읽을 수 없어요.');
        return;
      }
      var when = data.exportedAt ? prettyDate(PLANNER.formatDate(new Date(data.exportedAt))) : '알 수 없는 날짜';
      var ok = confirm(when + '에 저장한 백업을 불러올까요?\n\n지금 이 폰에 있는 계획과 체크 기록은 백업 파일 내용으로 바뀌어요.');
      if (!ok) return;

      saved = data.plan;
      log = data.log;
      plan = null;
      store(PLAN_KEY, saved);
      store(LOG_KEY, log);
      store(ARCHIVE_KEY, Array.isArray(data.archive) ? data.archive : []);
      // 불러온 백업 파일을 만든 날을 "마지막 백업"으로 기억
      if (data.exportedAt) {
        var meta = load(META_KEY, {});
        meta.lastBackup = PLANNER.formatDate(new Date(data.exportedAt));
        store(META_KEY, meta);
      }
      alert('백업을 불러왔어요.');
      show('today');
    };
    reader.onerror = function () { alert('파일을 읽지 못했어요.'); };
    reader.readAsText(file);
  }

  // ---------- 알림 ----------
  // 서버는 정한 시간에 "아침/저녁 알림"만 보내고, 알림 문구(오늘 읽을 곳)는
  // 앱이 앞으로 2주치를 미리 적어두면 서비스 워커(sw.js)가 꺼내 씁니다.

  var notify = load(NOTIFY_KEY, null) || {
    enabled: false,
    morning: { on: true, time: '07:00' },
    evening: { on: true, time: '21:00' },
    endpoint: null,
    tz: null
  };
  var notifyBusy = false;
  var notifyMsg = null;     // 방금 한 일의 결과 { text, warn }
  var notifySaveTimer = null;
  var KINDS = ['morning', 'evening'];

  function pushSupported() {
    return window.isSecureContext && 'serviceWorker' in navigator &&
      'PushManager' in window && 'Notification' in window;
  }

  function timeZone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul'; } catch (e) { return 'Asia/Seoul'; }
  }

  function initNotify() {
    KINDS.forEach(function (kind) {
      $('notify-' + kind + '-time').addEventListener('change', function () {
        if (this.value) notify[kind].time = this.value;
        onNotifyChange();
      });
      $('notify-' + kind + '-on').addEventListener('change', function () {
        notify[kind].on = this.checked;
        onNotifyChange();
      });
    });
    $('btn-notify-on').addEventListener('click', enableNotify);
    $('btn-notify-test').addEventListener('click', testNotify);
    $('btn-notify-off').addEventListener('click', disableNotify);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) updateNotifyData();
    });

    // 앱을 열 때: 알림 구독이 살아있는지, 주소가 바뀌지 않았는지 확인
    if (notify.enabled && pushSupported()) {
      currentSubscription().then(function (sub) {
        if (!sub) {
          notify.enabled = false;
          notify.endpoint = null;
          store(NOTIFY_KEY, notify);
          if (currentView === 'settings') renderNotify();
        } else if (sub.endpoint !== notify.endpoint || notify.tz !== timeZone()) {
          return saveSubscription(sub);
        }
      }).catch(function () {});
    }
  }

  function currentSubscription() {
    return navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); });
  }

  function postToServer(path, data) {
    return fetch(PUSH_SERVER + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(function (res) {
      if (!res.ok) throw new Error('server');
      return res.json();
    });
  }

  function saveSubscription(sub) {
    return postToServer('/subscribe', {
      subscription: sub.toJSON(),
      tz: timeZone(),
      morning: notify.morning,
      evening: notify.evening
    }).then(function () {
      notify.endpoint = sub.endpoint;
      notify.tz = timeZone();
      store(NOTIFY_KEY, notify);
    });
  }

  function base64UrlToBytes(str) {
    var b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function setNotifyMsg(text, warn) {
    notifyMsg = text ? { text: text, warn: !!warn } : null;
    renderNotify();
  }

  function notifyErrorText(err) {
    var m = err && err.message;
    if (m === 'denied') return '알림이 허용되지 않았어요. 아이폰 설정 → 알림 → 통독표에서 "알림 허용"을 켜주세요.';
    if (m === 'server') return '알림 서버에 저장하지 못했어요. 잠시 후 다시 해주세요.';
    if (err && err.name === 'TypeError') return '인터넷에 연결되지 않았어요. 연결을 확인하고 다시 해주세요.';
    return '알림을 켜지 못했어요. 잠시 후 다시 해주세요.';
  }

  function enableNotify() {
    if (notifyBusy || !pushSupported()) return;
    notifyBusy = true;
    setNotifyMsg('알림을 켜는 중이에요...');
    // 허락 묻기는 버튼을 누른 순간 바로 해야 아이폰이 창을 띄워줘요
    Promise.resolve(Notification.requestPermission()).then(function (perm) {
      if (perm !== 'granted') throw new Error('denied');
      return navigator.serviceWorker.ready;
    }).then(function (reg) {
      return reg.pushManager.getSubscription().then(function (sub) {
        return sub || reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToBytes(VAPID_PUBLIC_KEY)
        });
      });
    }).then(saveSubscription).then(function () {
      notify.enabled = true;
      store(NOTIFY_KEY, notify);
      updateNotifyData();
      notifyBusy = false;
      setNotifyMsg('✅ 알림을 켰어요. "테스트 알림 보내기"로 잘 오는지 확인해 보세요.');
    }).catch(function (err) {
      notifyBusy = false;
      setNotifyMsg(notifyErrorText(err), true);
    });
  }

  function testNotify() {
    if (notifyBusy) return;
    notifyBusy = true;
    setNotifyMsg('테스트 알림을 보내는 중이에요...');
    updateNotifyData().then(currentSubscription).then(function (sub) {
      if (!sub) throw new Error('lost');
      return postToServer('/test', { endpoint: sub.endpoint });
    }).then(function () {
      notifyBusy = false;
      setNotifyMsg('📨 테스트 알림을 보냈어요. 몇 초 안에 도착해요.');
    }).catch(function (err) {
      notifyBusy = false;
      if (err && err.message === 'lost') {
        notify.enabled = false;
        store(NOTIFY_KEY, notify);
        setNotifyMsg('알림 연결이 끊겼어요. "알림 켜기"를 다시 눌러주세요.', true);
      } else {
        setNotifyMsg(err && err.message === 'server' ? '테스트 알림을 보내지 못했어요. "알림 끄기" 후 다시 켜보세요.' : notifyErrorText(err), true);
      }
    });
  }

  function disableNotify() {
    if (notifyBusy) return;
    notifyBusy = true;
    setNotifyMsg('알림을 끄는 중이에요...');
    currentSubscription().then(function (sub) {
      if (!sub) return;
      // 서버에서 못 지워도 괜찮아요: 폰에서 구독을 끊으면 서버가 다음에 알아서 정리해요
      return postToServer('/unsubscribe', { endpoint: sub.endpoint }).catch(function () {})
        .then(function () { return sub.unsubscribe(); });
    }).catch(function () {}).then(function () {
      notify.enabled = false;
      notify.endpoint = null;
      store(NOTIFY_KEY, notify);
      notifyBusy = false;
      setNotifyMsg('알림을 껐어요.');
    });
  }

  // 시간·켜기/끄기를 바꾸면 잠깐 기다렸다가 서버에 저장
  function onNotifyChange() {
    store(NOTIFY_KEY, notify);
    renderNotify();
    if (!notify.enabled || !pushSupported()) return;
    clearTimeout(notifySaveTimer);
    notifySaveTimer = setTimeout(function () {
      currentSubscription().then(function (sub) {
        if (!sub) throw new Error('lost');
        return saveSubscription(sub);
      }).then(function () {
        setNotifyMsg('✅ 알림 시간을 저장했어요.');
      }).catch(function (err) {
        setNotifyMsg(err && err.message === 'lost' ? '알림 연결이 끊겼어요. "알림 끄기" 후 다시 켜주세요.' : notifyErrorText(err), true);
      });
    }, 600);
  }

  function renderNotify() {
    KINDS.forEach(function (kind) {
      var time = $('notify-' + kind + '-time');
      if (document.activeElement !== time) time.value = notify[kind].time;
      time.disabled = !notify[kind].on;
      $('notify-' + kind + '-on').checked = notify[kind].on;
    });

    var supported = pushSupported();
    var text = '';
    var warn = false;
    if (!supported) {
      text = isIOS() && !isStandalone() ?
        '알림은 홈 화면에 추가한 앱에서만 켤 수 있어요. 아래 "아이폰 홈 화면에 추가하기"를 먼저 해주세요.' :
        '이 화면에서는 알림을 쓸 수 없어요. 아이폰은 iOS 16.4 이상, 홈 화면에 추가한 앱에서 켤 수 있어요.';
      warn = true;
    } else if (notifyMsg) {
      text = notifyMsg.text;
      warn = notifyMsg.warn;
    } else if (notify.enabled) {
      text = '✅ 알림이 켜져 있어요.';
    } else if (Notification.permission === 'denied') {
      text = notifyErrorText(new Error('denied'));
      warn = true;
    }
    $('notify-status').textContent = text;
    $('notify-status').className = 'notify-status' + (warn ? ' warn' : '');

    $('btn-notify-on').hidden = !supported || notify.enabled;
    $('btn-notify-test').hidden = !supported || !notify.enabled;
    $('btn-notify-off').hidden = !supported || !notify.enabled;
    ['btn-notify-on', 'btn-notify-test', 'btn-notify-off'].forEach(function (id) { $(id).disabled = notifyBusy; });
  }

  // 앞으로 2주치 알림 문구를 폰 안(캐시 저장소)에 적어둡니다.
  function updateNotifyData() {
    if (!notify.enabled || !saved || !('caches' in window)) return Promise.resolve();
    var p = getPlan();
    if (!p.ok) return Promise.resolve();
    var g = PROGRESS.compute(p, log, today);
    var data = { updatedAt: new Date().toISOString(), days: {} };
    for (var i = 0; i < 14; i++) {
      var date = PLANNER.addDays(today, i);
      data.days[date] = notifyTextFor(p, g, date);
    }
    return caches.open(NOTIFY_DATA_CACHE).then(function (cache) {
      return cache.put(new URL('notify-data', location.href).href,
        new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }));
    }).catch(function () {});
  }

  function notifyTextFor(p, g, date) {
    var morning = '성경 묵상할 시간이에요 🍇';
    var evening = '오늘 하나님 말씀에 귀 기울였나요?';
    var text = function (mBody, eBody) {
      return { morning: { title: morning, body: mBody }, evening: { title: evening, body: eBody } };
    };

    if (g.finished) {
      return text('통독을 마쳤어요. 오늘도 좋아하는 말씀 한 구절을 묵상해 볼까요?', '오늘도 말씀과 함께한 하루였길 바라요.');
    }
    if (date < p.startDate) {
      var dday = PLANNER.daysBetween(date, p.startDate);
      return text('D-' + dday + ' · ' + shortDate(p.startDate) + '부터 통독을 시작해요.', '통독 시작까지 D-' + dday + '이에요.');
    }

    // 지금까지 읽은 곳(책갈피) 다음부터, 그날까지 계획상 읽어야 하는 곳까지
    var segmentStart = p.segmentStart || p.startDate;
    var goal = -1;
    var day = null;
    p.days.forEach(function (d) {
      if (d.date === date) day = d;
      if (!d.rest && d.date <= date && d.date >= segmentStart) goal = Math.max(goal, d.to);
    });
    var rest = !!(day && day.rest);
    var reached = g.bookmark;

    if (goal > reached) {
      var range = PLANNER.rangeLabel(p.chapters, reached + 1, goal, true);
      var mins = prettyMinutes(Math.max(1, (g.cum[goal + 1] - g.cum[reached + 1]) / p.speed));
      return text(
        rest ? '오늘은 쉬는 날이에요. 밀린 ' + range + '을 따라잡아 볼까요? (약 ' + mins + ')' :
          '오늘은 ' + range + '을 묵상하는 날이에요. (약 ' + mins + ')',
        '어디까지 읽었는지 체크해 주세요. 오늘 읽을 곳: ' + range
      );
    }
    return rest ?
      text('오늘은 쉬는 날이에요. 편히 쉬어요 ☕️', '오늘은 쉬는 날이에요. 평안한 밤 보내세요.') :
      text('오늘 분량은 이미 읽었어요. 말씀을 한 번 더 묵상해 볼까요?', '네, 오늘 분량을 다 읽었어요. 수고했어요 🍇');
  }

  // ---------- 시작 ----------

  initSetup();
  initToday();
  initCalendar();
  initSheet();
  initSettings();
  initTabs();

  // 인터넷 주소(https 또는 내 컴퓨터 테스트 서버)로 열었을 때만 서비스 워커 등록
  if ('serviceWorker' in navigator && window.isSecureContext && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  initNotify();
  show(saved ? 'today' : 'setup');
})();
