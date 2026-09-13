// 진도 계산기
// 체크 기록(log)과 계획(plan)을 비교해서 책갈피, 밀림/앞섬, 날짜별 상태를 계산합니다.
//
// log 모양: { 'YYYY-MM-DD': gid }  → 그날 "어디까지 읽었는지" (성경 전체 기준 장 번호)

var PROGRESS = (function () {

  // plan: PLANNER.computePlan()의 결과 (ok === true)
  // log:  체크 기록
  // today: 'YYYY-MM-DD'
  function compute(plan, log, today) {
    var chapters = plan.chapters;
    var n = chapters.length;
    var offset = chapters[0].gid;

    // 장 번호별 누적 절 수 (분량 비교용)
    var cum = [0];
    for (var i = 0; i < n; i++) cum.push(cum[i] + chapters[i].verses);

    // 이 계획 범위 안의 기록만, 날짜순으로
    var entries = Object.keys(log)
      .filter(function (date) {
        var local = log[date] - offset;
        return date >= plan.startDate && date <= today && local >= 0;
      })
      .sort()
      .map(function (date) {
        return { date: date, pos: Math.min(log[date] - offset, n - 1) };
      });

    var statusByDate = {};
    var pos = -1; // 지금까지 읽은 마지막 장 (-1 = 아직 없음)
    var p = 0;

    plan.days.forEach(function (day) {
      var prevPos = pos;
      var dayEntry = -1;
      while (p < entries.length && entries[p].date === day.date) {
        dayEntry = entries[p].pos;
        p++;
      }
      var endPos = Math.max(prevPos, dayEntry);
      var readVerses = endPos > prevPos ? cum[endPos + 1] - cum[prevPos + 1] : 0;

      var status;
      if (day.date > today) {
        status = day.rest ? 'rest' : 'future';
      } else if (day.rest) {
        status = readVerses > 0 ? 'rest-read' : 'rest';
      } else {
        var planned = cum[day.to + 1] - cum[day.from];
        if (endPos >= day.to || readVerses >= planned) status = 'done';
        else if (readVerses > 0) status = 'part';
        else status = day.date < today ? 'miss' : 'todo';
      }
      statusByDate[day.date] = status;
      pos = endPos;
    });

    // 마감일 이후에 따라잡으며 읽은 기록
    for (; p < entries.length; p++) pos = Math.max(pos, entries[p].pos);
    var bookmark = pos;

    // 오늘 이전까지의 책갈피 (오늘 체크할 동그라미는 여기 다음부터)
    var beforeToday = -1;
    var todayEntry = null;
    entries.forEach(function (e) {
      if (e.date < today) beforeToday = Math.max(beforeToday, e.pos);
      else todayEntry = e.pos;
    });

    // 계획을 다시 짰다면, 밀림/목표는 새 계획(segmentStart 이후)만 기준으로 셉니다.
    var segmentStart = plan.segmentStart || plan.startDate;
    var readingDays = plan.days.filter(function (d) { return !d.rest && d.date >= segmentStart; });
    var targetEnd = -1;   // 오늘까지 계획상 읽었어야 하는 마지막 장
    var behindDays = 0;
    var aheadDays = 0;
    readingDays.forEach(function (d) {
      if (d.date <= today) targetEnd = Math.max(targetEnd, d.to);
      if (d.date < today && d.to > bookmark) behindDays++;
      if (d.date > today && d.to <= bookmark) aheadDays++;
    });

    var phase = today < plan.startDate ? 'before' : today > plan.endDate ? 'after' : 'active';

    return {
      n: n,
      offset: offset,
      cum: cum,
      bookmark: bookmark,
      beforeToday: beforeToday,
      todayEntry: todayEntry,
      targetEnd: targetEnd,
      behindDays: behindDays,
      aheadDays: aheadDays,
      phase: phase,
      finished: bookmark >= n - 1,
      percent: cum[bookmark + 1] / cum[n] * 100,
      todayDay: plan.days.filter(function (d) { return d.date === today; })[0] || null,
      futureReadingDays: readingDays.filter(function (d) { return d.date > today; }),
      statusByDate: statusByDate
    };
  }

  // 특정 날짜의 체크 정보 (지난 날짜 수정용)
  // before: 그 전날까지 읽은 곳 / entry: 그날 체크 / targetEnd: 그날까지 목표 / chipEnd: 동그라미를 어디까지 보여줄지
  function forDate(plan, log, date) {
    var chapters = plan.chapters;
    var n = chapters.length;
    var offset = chapters[0].gid;
    var before = -1;
    var entry = null;
    Object.keys(log).forEach(function (d) {
      var local = log[d] - offset;
      if (d < plan.startDate || local < 0) return;
      local = Math.min(local, n - 1);
      if (d < date) before = Math.max(before, local);
      else if (d === date) entry = local;
    });

    var segmentStart = plan.segmentStart || plan.startDate;
    var targetEnd = -1;
    var nextTo = -1;
    plan.days.forEach(function (d) {
      if (d.rest) return;
      if (d.date <= date && (d.date >= segmentStart || date < segmentStart)) targetEnd = Math.max(targetEnd, d.to);
      if (d.date > date && nextTo < 0 && d.to > Math.max(before, targetEnd)) nextTo = d.to;
    });

    var chipEnd = targetEnd > before ? targetEnd : nextTo;
    if (entry !== null) chipEnd = Math.max(chipEnd, entry);
    return {
      day: plan.days.filter(function (d) { return d.date === date; })[0] || null,
      before: before,
      entry: entry,
      targetEnd: targetEnd,
      chipEnd: Math.min(chipEnd, n - 1)
    };
  }

  // "계획 다시 짜기" 두 가지 방법
  //  keep: 마감일 지키기 (남은 분량을 남은 날에 다시 나눔)
  //  push: 마감일 미루기 (지금 하루 분량 그대로, 마감일이 늦어짐)
  function replanOptions(saved, plan, g, today) {
    var current = JSON.parse(JSON.stringify(saved));
    delete current.segments;
    var startLocal = g.beforeToday + 1;
    if (startLocal > g.n - 1) return null;

    var base = Object.assign({}, current, {
      startDate: today,
      mode: 'deadline',
      startGid: plan.chapters[startLocal].gid
    });

    var remainingVerses = g.cum[g.n] - g.cum[startLocal];
    var versesPerDay = plan.minutesPerDay * plan.speed;
    var needDays = Math.max(1, Math.ceil(remainingVerses / versesPerDay - 1e-9));

    var keepSettings = Object.assign({}, base, { deadline: plan.endDate });
    var pushSettings = Object.assign({}, base, {
      deadline: PLANNER.endDateForReadingDays(today, needDays, current.weekdays)
    });

    function build(settings) {
      var r = plan.endDate < today && settings === keepSettings ?
        { ok: false, error: '마감일이 이미 지났어요.' } : PLANNER.computePlan(settings);
      var segments = (saved.segments || []).slice();
      // 오늘 시작한 계획을 오늘 또 다시 짜면, 예전 기록을 쌓지 않고 바꿔치기합니다.
      if (saved.startDate < today) segments.push({ settings: current, until: today });
      return { result: r, saved: Object.assign({}, settings, { segments: segments }) };
    }

    return { keep: build(keepSettings), push: build(pushSettings) };
  }

  return { compute: compute, forDate: forDate, replanOptions: replanOptions };
})();

if (typeof module !== 'undefined') module.exports = PROGRESS;
