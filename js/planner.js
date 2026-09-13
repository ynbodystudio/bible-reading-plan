// 통독 계획 계산기
// 화면과 상관없는 "계산"만 모아둔 파일입니다. (그래서 따로 테스트하기 쉬워요)

var PLANNER = (function () {
  var BOOKS = typeof BIBLE_BOOKS !== 'undefined' ? BIBLE_BOOKS : require('./bible-data.js');

  // 1분에 읽는 절 수 (보통 = 1장 평균 약 4분)
  var SPEEDS = { slow: 4.5, normal: 6.5, fast: 9 };
  var SCOPE_NAMES = { all: '전체', OT: '구약', NT: '신약' };
  var WEEKDAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
  var MAX_MINUTES_WARNING = 60;

  // ---------- 날짜 도우미 ----------
  // 날짜는 항상 'YYYY-MM-DD' 글자로 주고받습니다. (시간대 문제를 피하려고)

  function parseDate(str) {
    var p = str.split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  function formatDate(d) {
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function addDays(str, n) {
    var d = parseDate(str);
    d.setDate(d.getDate() + n);
    return formatDate(d);
  }

  // 1월 31일 + 1개월 = 2월 28일(말일)처럼 달 끝을 넘지 않게 맞춥니다.
  function addMonths(str, n) {
    var d = parseDate(str);
    var target = new Date(d.getFullYear(), d.getMonth() + n, 1);
    var lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(d.getDate(), lastDay));
    return formatDate(target);
  }

  function daysBetween(a, b) {
    return Math.round((parseDate(b) - parseDate(a)) / 86400000);
  }

  function weekdayOf(str) {
    return parseDate(str).getDay();
  }

  // ---------- 성경 범위 ----------

  // gid = 성경 전체에서 몇 번째 장인지 (창세기 1장 = 0, 요한계시록 22장 = 1188)
  // 체크 기록은 gid로 저장해서, 범위(전체/구약/신약)가 달라도 같은 장을 가리키게 합니다.
  function getChapters(scope) {
    var list = [];
    var gid = 0;
    BOOKS.forEach(function (book) {
      book[3].forEach(function (verses, i) {
        if (scope === 'all' || book[2] === scope) {
          list.push({ gid: gid, name: book[0], abbr: book[1], ch: i + 1, verses: verses });
        }
        gid++;
      });
    });
    return list;
  }

  // ---------- 분량 나누기 ----------
  // 장을 자르지 않고, 매일 최소 1장씩, 날마다 절 수가 최대한 고르게 나눕니다.
  // bounds[d] = d일째가 시작하는 장 번호 (bounds[0] = 0, bounds[dayCount] = 장 개수)

  // 1차: 누적 절 수가 "전체의 d/D 지점"에 가장 가까운 곳을 경계로 잡습니다.
  function roughBounds(cum, n, dayCount) {
    var total = cum[n];
    var bounds = [0];
    for (var d = 1; d < dayCount; d++) {
      var target = (total * d) / dayCount;
      var lo = bounds[d - 1] + 1;
      var hi = n - (dayCount - d);
      var k = lo;
      while (k < hi && cum[k] < target) k++;
      if (k > lo && Math.abs(cum[k - 1] - target) <= Math.abs(cum[k] - target)) k--;
      bounds.push(k);
    }
    bounds.push(n);
    return bounds;
  }

  // 2차: 1차 경계 주변(앞뒤 WINDOW장)에서 "평균과의 차이의 제곱 합"이 가장 작은 조합을 찾습니다.
  // (시편 119편처럼 아주 긴 장 주변의 날들이 너무 짧아지는 것을 막아줍니다)
  var WINDOW = 25;

  function splitChapters(chapters, dayCount) {
    var n = chapters.length;
    var cum = [0];
    for (var i = 0; i < n; i++) cum.push(cum[i] + chapters[i].verses);
    var avg = cum[n] / dayCount;
    var rough = roughBounds(cum, n, dayCount);

    var lo = [], hi = [], cost = [], prev = [];
    for (var d = 0; d <= dayCount; d++) {
      lo[d] = Math.max(d, rough[d] - WINDOW);
      hi[d] = Math.min(n - (dayCount - d), rough[d] + WINDOW);
      cost[d] = {};
      prev[d] = {};
    }
    lo[0] = hi[0] = 0;
    lo[dayCount] = hi[dayCount] = n;
    cost[0][0] = 0;

    for (d = 1; d <= dayCount; d++) {
      for (var k = lo[d]; k <= hi[d]; k++) {
        var best = Infinity, bestJ = -1;
        var jMax = Math.min(hi[d - 1], k - 1);
        for (var j = lo[d - 1]; j <= jMax; j++) {
          if (cost[d - 1][j] === undefined) continue;
          var diff = cum[k] - cum[j] - avg;
          var c = cost[d - 1][j] + diff * diff;
          if (c < best) { best = c; bestJ = j; }
        }
        if (bestJ >= 0) { cost[d][k] = best; prev[d][k] = bestJ; }
      }
    }

    var bounds = [];
    bounds[dayCount] = n;
    for (d = dayCount; d > 0; d--) bounds[d - 1] = prev[d][bounds[d]];

    var groups = [];
    for (var g = 0; g < dayCount; g++) groups.push([bounds[g], bounds[g + 1] - 1]);
    return groups;
  }

  function rangeLabel(chapters, from, to, long) {
    var a = chapters[from];
    var b = chapters[to];
    if (long) {
      if (from === to) return a.name + ' ' + a.ch + '장';
      if (a.name === b.name) return a.name + ' ' + a.ch + '–' + b.ch + '장';
      return a.name + ' ' + a.ch + '장 – ' + b.name + ' ' + b.ch + '장';
    }
    if (from === to) return a.abbr + ' ' + a.ch;
    if (a.name === b.name) return a.abbr + ' ' + a.ch + '–' + b.ch;
    return a.abbr + ' ' + a.ch + ' – ' + b.abbr + ' ' + b.ch;
  }

  // ---------- 계획 계산 ----------

  function countReadingDays(start, end, weekdays) {
    var count = 0;
    for (var d = start; d <= end; d = addDays(d, 1)) {
      if (weekdays[weekdayOf(d)]) count++;
    }
    return count;
  }

  // 시작일부터 읽는 날을 count번 세었을 때 마지막 날짜
  function endDateForReadingDays(start, count, weekdays) {
    var d = start;
    var seen = 0;
    while (true) {
      if (weekdays[weekdayOf(d)]) seen++;
      if (seen >= count) return d;
      d = addDays(d, 1);
    }
  }

  // settings: { scope, startDate, mode, periodValue, periodUnit, deadline, dailyMinutes, speed, weekdays, startGid? }
  // startGid가 있으면 그 장부터 남은 분량만 나눕니다. ("계획 다시 짜기"에서 사용)
  // 결과의 from/to는 항상 범위 전체(chapters) 기준 번호입니다.
  function computePlan(s) {
    var chapters = getChapters(s.scope);
    var startLocal = 0;
    if (s.startGid !== undefined) {
      while (startLocal < chapters.length && chapters[startLocal].gid < s.startGid) startLocal++;
    }
    var work = chapters.slice(startLocal); // 이번 계획으로 읽을 장들
    var totalVerses = work.reduce(function (sum, c) { return sum + c.verses; }, 0);
    var speed = SPEEDS[s.speed];
    var result = { ok: false, error: null, warning: null };

    if (!s.startDate) return fail('시작일을 선택해주세요.');
    if (!s.weekdays.some(Boolean)) return fail('읽는 요일을 하루 이상 선택해주세요.');
    if (!work.length) return fail('남은 분량이 없어요.');

    var endDate;
    var readingDays;

    if (s.mode === 'period') {
      var v = Number(s.periodValue);
      if (!(v > 0) || Math.floor(v) !== v) return fail('기간은 1 이상의 정수로 입력해주세요.');
      if (s.periodUnit === 'day') endDate = addDays(s.startDate, v - 1);
      else if (s.periodUnit === 'month') endDate = addDays(addMonths(s.startDate, v), -1);
      else endDate = addDays(addMonths(s.startDate, v * 12), -1);
      readingDays = countReadingDays(s.startDate, endDate, s.weekdays);
    } else if (s.mode === 'deadline') {
      if (!s.deadline) return fail('마감일을 선택해주세요.');
      if (s.deadline < s.startDate) return fail('마감일이 시작일보다 빨라요.');
      endDate = s.deadline;
      readingDays = countReadingDays(s.startDate, endDate, s.weekdays);
    } else {
      var minutes = Number(s.dailyMinutes);
      if (!(minutes > 0)) return fail('하루 시간은 1분 이상으로 입력해주세요.');
      readingDays = Math.ceil(totalVerses / (minutes * speed));
      readingDays = Math.min(readingDays, work.length);
      endDate = endDateForReadingDays(s.startDate, readingDays, s.weekdays);
    }

    if (readingDays < 1) return fail('기간 안에 읽는 요일이 하루도 없어요.');
    if (readingDays > work.length) {
      return fail('하루 1장보다 적게는 나눌 수 없어요. 읽는 날이 ' + work.length +
        '일 이하가 되도록 기간을 줄여주세요. (지금 ' + readingDays + '일)');
    }

    var groups = splitChapters(work, readingDays);
    var days = [];
    var gi = 0;
    for (var d = s.startDate; d <= endDate; d = addDays(d, 1)) {
      if (!s.weekdays[weekdayOf(d)]) {
        days.push({ date: d, rest: true });
        continue;
      }
      var from = groups[gi][0] + startLocal;
      var to = groups[gi][1] + startLocal;
      var verses = 0;
      for (var c = from; c <= to; c++) verses += chapters[c].verses;
      days.push({
        date: d,
        rest: false,
        from: from,
        to: to,
        label: rangeLabel(chapters, from, to, false),
        longLabel: rangeLabel(chapters, from, to, true),
        chapterCount: to - from + 1,
        minutes: Math.max(1, Math.round(verses / speed))
      });
      gi++;
    }

    result.ok = true;
    result.chapters = chapters;
    result.speed = speed;
    result.scope = s.scope;
    result.startDate = s.startDate;
    result.endDate = endDate;
    result.calendarDays = daysBetween(s.startDate, endDate) + 1;
    result.readingDays = readingDays;
    result.totalChapters = work.length;
    result.totalVerses = totalVerses;
    result.chaptersPerDay = work.length / readingDays;
    result.minutesPerDay = totalVerses / readingDays / speed;
    result.days = days;
    result.segmentStart = s.startDate;
    if (result.minutesPerDay > MAX_MINUTES_WARNING * 3) {
      result.warning = '하루 3시간이 넘어요. 현실적으로 어려운 계획이에요.';
    } else if (result.minutesPerDay > MAX_MINUTES_WARNING) {
      result.warning = '하루 1시간이 넘어요. 조금 빡빡할 수 있어요.';
    }
    return result;

    function fail(msg) {
      result.error = msg;
      return result;
    }
  }

  // ---------- 다시 짠 계획 합치기 ----------
  // saved = 지금 계획 설정 + segments: [{ settings: 예전 설정, until: 'YYYY-MM-DD' }, ...]
  // 예전 계획은 until 전날까지만, 그 뒤로는 지금 계획을 보여줍니다.
  function computeSaved(saved) {
    var current = computePlan(saved);
    var segments = saved.segments || [];
    if (!current.ok || !segments.length) return current;

    var pastDays = [];
    segments.forEach(function (seg) {
      var r = computePlan(seg.settings);
      if (!r.ok) return;
      r.days.forEach(function (d) {
        if (d.date < seg.until) pastDays.push(d);
      });
    });

    var days = pastDays.concat(current.days);
    var combined = Object.assign({}, current);
    combined.days = days;
    combined.startDate = segments[0].settings.startDate;
    combined.calendarDays = daysBetween(combined.startDate, current.endDate) + 1;
    combined.readingDays = days.filter(function (d) { return !d.rest; }).length;
    combined.replanned = true;
    return combined;
  }

  // 원래 처음 만든 계획 설정 (계획 수정 화면에 보여줄 값)
  function baseSettings(saved) {
    var base = saved.segments && saved.segments.length ? saved.segments[0].settings : saved;
    base = JSON.parse(JSON.stringify(base));
    delete base.segments;
    delete base.startGid;
    return base;
  }

  return {
    SPEEDS: SPEEDS,
    SCOPE_NAMES: SCOPE_NAMES,
    WEEKDAY_NAMES: WEEKDAY_NAMES,
    parseDate: parseDate,
    formatDate: formatDate,
    addDays: addDays,
    addMonths: addMonths,
    weekdayOf: weekdayOf,
    getChapters: getChapters,
    splitChapters: splitChapters,
    rangeLabel: rangeLabel,
    daysBetween: daysBetween,
    endDateForReadingDays: endDateForReadingDays,
    computePlan: computePlan,
    computeSaved: computeSaved,
    baseSettings: baseSettings
  };
})();

if (typeof module !== 'undefined') module.exports = PLANNER;
