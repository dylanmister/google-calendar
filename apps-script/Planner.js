// Planner: turns shifts, White Lotus workouts and LIFEOS settings into the day-by-day plan.
// Pure logic with no Google services, so test/run-planner.cjs can run it in Node.
// Times are minutes after midnight on the event's date; sleep runs past 1440 (into the next day).

var Planner = (function () {
  var C = LIFEOS;
  var ELEMENT = { earth: '⛰️', water: '💧', fire: '🔥', air: '🌀' };

  function toMin(hm) { var p = String(hm).split(':'); return (+p[0]) * 60 + (+p[1]); }
  function fmt(m) {
    m = ((m % 1440) + 1440) % 1440;
    var h = Math.floor(m / 60), mm = m % 60;
    return (((h + 11) % 12) + 1) + ':' + (mm < 10 ? '0' : '') + mm + (h >= 12 ? ' PM' : ' AM');
  }
  function dateParts(iso) { return [+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)]; }
  function addDays(iso, n) { var p = dateParts(iso); return new Date(Date.UTC(p[0], p[1], p[2]) + n * 86400000).toISOString().slice(0, 10); }
  function weekday(iso) { var p = dateParts(iso); return new Date(Date.UTC(p[0], p[1], p[2])).getUTCDay(); }
  function roundUp(m, step) { return Math.ceil(m / step) * step; }
  function hoursLabel(min) {
    var q = Math.round(min / 15), h = Math.floor(q / 4), r = q % 4;
    return h + ['', '¼', '½', '¾'][r] + ' h';
  }
  function dayName(iso) { return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][weekday(iso)]; }

  // Overlapping or back-to-back shifts on one date become one work block (a double).
  function merged(ctx, date) {
    var list = (ctx.shiftsByDate[date] || []).slice().sort(function (a, b) { return a.start - b.start; });
    var out = [];
    list.forEach(function (s) {
      var last = out[out.length - 1];
      if (last && s.start <= last.end) { last.end = Math.max(last.end, s.end); last.parts.push(s); }
      else out.push({ start: s.start, end: s.end, parts: [s] });
    });
    return out;
  }

  // The night that begins on `date`: when you fall asleep and when you get up the next morning.
  function night(ctx, date) {
    var S = C.sleep, W = C.work;
    var shifts = ctx.isKnown(date) ? merged(ctx, date) : [];
    var next = ctx.isKnown(addDays(date, 1)) ? merged(ctx, addDays(date, 1)) : [];
    var lastEnd = shifts.length ? shifts[shifts.length - 1].end : null;
    var asleep = toMin(S.bedtime), afterShift = false;
    if (lastEnd !== null && lastEnd + S.afterShiftMin >= toMin(S.straightToBedAfter)) {
      asleep = lastEnd + S.afterShiftMin; afterShift = true;
    }
    var wakeNext = Math.max(toMin(S.wake), asleep + S.hours * 60 - 1440), early = false;
    if (next.length) {
      var mustWake = next[0].start - W.readyMin - W.driveMin;
      if (mustWake < wakeNext) {
        wakeNext = mustWake; early = true;
        var ideal = wakeNext + 1440 - S.hours * 60;
        if (!afterShift || ideal >= asleep) asleep = Math.min(asleep, ideal);
      }
    }
    var ovNext = (C.dayOverrides || {})[addDays(date, 1)];
    if (ovNext && ovNext.wake) { // a one-off day sets its own wake-up; full sleep before it unless work runs later
      wakeNext = toMin(ovNext.wake); early = false;
      var target = wakeNext + 1440 - S.hours * 60;
      afterShift = lastEnd !== null && lastEnd + S.afterShiftMin > target;
      asleep = afterShift ? lastEnd + S.afterShiftMin : target;
    }
    return { asleep: asleep, wakeNext: wakeNext, afterShift: afterShift, early: early, minutes: wakeNext + 1440 - asleep };
  }

  // Which day of each Mon–Sun week gets chores and the longer outdoor block.
  function weekPlan(ctx, date) {
    var dow = weekday(date), monday = addDays(date, -((dow + 6) % 7)), days = [];
    for (var i = 0; i < 7; i++) days.push(addDays(monday, i));
    var sunday = days[6];
    var off = days.filter(function (d) { return ctx.isKnown(d) && merged(ctx, d).length === 0; });
    var sundayOff = off.indexOf(sunday) >= 0;
    return {
      key: monday,
      choreDay: sundayOff ? sunday : (off.length ? off[off.length - 1] : (ctx.isKnown(sunday) ? sunday : null)),
      playDay: sundayOff ? sunday : (off.length ? off[0] : null),
    };
  }

  function workoutTitle(w) {
    return (w.done ? '✅ ' : '') + (ELEMENT[w.element] || '🏋️') + ' White Lotus Day ' + w.day + ' · ' + w.title;
  }
  function travelFor(w) { return w.location === 'Sand' ? C.travel.sand : C.travel.gym; }
  function workoutLocation(w) {
    if (w.location === 'Sand') return 'Sand court (about ' + C.travel.sand + ' min away)';
    if (w.location === 'Gym + Sand') return 'Gym (about ' + C.travel.gym + ' min away) + sand block';
    return 'Gym (about ' + C.travel.gym + ' min away)';
  }
  function workoutDesc(w, start, note) {
    var lines = [];
    lines.push(w.focus + ' · ' + w.formatName);
    lines.push(w.location + ' · about ' + w.minutes + ' min · Phase ' + w.phaseNumeral + ' · ' + w.phaseName);
    if (start !== null) lines.push('Leave by ' + fmt(start - travelFor(w)) + ' (' + travelFor(w) + ' min drive).');
    if (note) lines.push('', note);
    lines.push('', w.summary);
    (w.blocks || []).forEach(function (b) {
      lines.push('', b.title.toUpperCase() + ' · ' + b.minutes + ' min · ' + b.where);
      b.items.forEach(function (it) { lines.push((it.tag ? it.tag + '  ' : '• ') + it.name + ' — ' + it.dose); });
    });
    if (w.location === 'Gym + Sand') lines.push('', 'No court today? Do the sand block on turf or a gym floor, like the app says.');
    lines.push('', 'Open Day ' + w.day + ' in White Lotus: ' + C.whiteLotus.appUrl + '#/day/' + w.day);
    lines.push('', '— Life OS · synced from White Lotus. If you push a day back in the app, this moves with it.');
    return lines.join('\n');
  }

  function defaultWorkoutStart(w, date) {
    if (weekday(date) === C.church.weekday) return toMin(C.workout.sundayAfterChurch) + (w.location === 'Sand' ? 15 : 0);
    return toMin(w.location === 'Sand' ? C.workout.sandStart : C.workout.gymStart);
  }

  function workoutEvent(w, start, end, note) {
    return {
      key: 'wl:' + w.day, cal: 'fit', date: w.date, start: start, end: end,
      title: workoutTitle(w), desc: workoutDesc(w, start, note), location: workoutLocation(w),
      reminders: [travelFor(w) + 25],
    };
  }

  function conflictEvent(w, why) {
    return {
      key: 'wl:' + w.day, cal: 'fit', date: w.date, allDay: true,
      title: '⚠️ White Lotus Day ' + w.day + ' · no room today',
      desc: why + '\n\nIf you can\'t train, tap "Can\'t train today? Push it back a day" in White Lotus and every later workout moves with it.\n\n' + workoutDesc(w, null, ''),
      location: workoutLocation(w), reminders: [],
    };
  }

  function planDay(ctx, date) {
    var ev = [], occ = [];
    var W = C.work, T = C.travel, S = C.sleep;
    var dow = weekday(date), isToday = date === ctx.today;
    var floor = isToday ? roundUp(ctx.nowMin + 15, 5) : 0;
    var wake = night(ctx, addDays(date, -1)).wakeNext, tonight = night(ctx, date), asleep = tonight.asleep;
    var shifts = merged(ctx, date), off = shifts.length === 0;
    var workMin = shifts.reduce(function (a, s) { return a + s.end - s.start; }, 0);
    var firstPrep = shifts.length ? shifts[0].start - W.readyMin - W.driveMin : null;
    var lastHome = shifts.length ? shifts[shifts.length - 1].end + W.driveMin : null;
    var early = shifts.length && shifts[0].start < toMin('11:00');
    var light = early || workMin >= 7 * 60;
    var wk = weekPlan(ctx, date), placed = ctx.weekPlaced[wk.key] = ctx.weekPlaced[wk.key] || {};
    // One-off changes for this date (LIFEOS.dayOverrides): fixed blocks, exact times, skips, shorter business.
    var ov = (C.dayOverrides || {})[date] || null;
    function skipped(key) { return !!(ov && ov.skip && ov.skip.indexOf(key) >= 0); }
    function at(key) { return ov && ov.at && ov.at[key] ? toMin(ov.at[key]) : null; }

    function block(s, e) { occ.push([s, e]); }
    function free(s, e) { for (var i = 0; i < occ.length; i++) if (s < occ[i][1] && e > occ[i][0]) return false; return true; }
    function find(dur, from, to, pre, post) {
      for (var t = roundUp(Math.max(from, floor, wake), 5); t + dur <= to; t += 5) {
        if (free(t - (pre || 0), t + dur + (post || 0))) return t;
      }
      return null;
    }
    // Lunch stays free (no event): some 45-minute gap around midday must survive every placement.
    var lunchWin = early ? null : [Math.min(toMin('11:30'), firstPrep !== null ? firstPrep - 45 : 1440), Math.min(toMin('14:30'), firstPrep !== null ? firstPrep : 1440)];
    function lunchOK() {
      if (!lunchWin) return true;
      for (var t = lunchWin[0]; t + 45 <= lunchWin[1]; t += 5) if (t >= floor && free(t, t + 45)) return true;
      return lunchWin[1] <= floor;
    }
    function kept(key) { return ctx.keep[date + '|' + key] || null; }
    function add(key, cal, s, e, title, desc, remind, extra) {
      var k = kept(key);
      if (k) { s = k.start; e = k.end; }
      var o = { key: date + '|' + key, cal: cal, date: date, start: s, end: e, title: title, desc: desc + '\n\n' + C.footer, reminders: remind === null || remind === undefined ? [] : [].concat(remind) };
      if (extra) for (var x in extra) o[x] = extra[x];
      ev.push(o);
      return o;
    }
    // Place a block, or reuse the time of a kept (already-started) event with the same key.
    function put(key, cal, dur, from, to, pre, post, title, desc, remind, extra) {
      if (skipped(key)) return null;
      var k = kept(key);
      if (k) { block(k.start, k.end); return add(key, cal, k.start, k.end, title, desc, remind, extra); }
      var a = at(key);
      if (a !== null && a >= floor && free(a - (pre || 0), a + dur + (post || 0))) {
        block(a - (pre || 0), a + dur + (post || 0));
        return add(key, cal, a, a + dur, title, desc, remind, extra);
      }
      var start = roundUp(Math.max(from, floor, wake), 5);
      while (true) {
        var s = find(dur, start, to, pre, post);
        if (s === null) return null;
        block(s - (pre || 0), s + dur + (post || 0));
        if (key === 'refuel' || lunchOK()) return add(key, cal, s, s + dur, title, desc, remind, extra);
        occ.pop();
        start = s + 5;
      }
    }

    block(-1440, wake);
    block(asleep, 2880);
    (ctx.busyByDate[date] || []).forEach(function (b) { block(b.start, b.end); });
    Object.keys(ctx.keep).forEach(function (k) {
      if (k.indexOf(date + '|') === 0) block(ctx.keep[k].start, ctx.keep[k].end);
    });

    // Work: one get-ready block and one shift block per (merged) shift.
    shifts.forEach(function (s, i) {
      var prep = s.start - W.readyMin - W.driveMin;
      var label = s.parts.length > 1
        ? W.role + ' (' + s.parts.map(function (p) { return fmt(p.start); }).join(' + ') + ' shifts)'
        : W.role + (s.parts[0].station ? ' (' + s.parts[0].station + ')' : '');
      add('prep' + i, 'work', prep, s.start, '🚗 Get ready + drive to ' + W.employer,
        'Eat something and get ready (' + W.readyMin + ' min), then leave by ' + fmt(s.start - W.driveMin) + ' for the ' + W.driveMin + '-minute drive.\nPut on a podcast or audiobook for the drive.', 0);
      add('shift' + i, 'work', s.start, s.end, '💼 ' + W.employer + ' · ' + label,
        'From HotSchedules: ' + s.parts.map(function (p) { return fmt(p.start) + (p.station ? ' · ' + p.station : ''); }).join(', ') + '.\n'
        + 'The end time is an estimate (' + W.shiftHours + ' h per shift); HotSchedules only lists start times.\n'
        + (i === shifts.length - 1 && tonight.afterShift ? 'Afterward: drive home and straight to bed, asleep by ' + fmt(asleep) + '.' : 'Afterward: ' + W.driveMin + '-minute drive home.'),
        null, { location: W.employer });
      block(prep, s.end + W.driveMin);
    });

    // Church on Sunday mornings.
    if (dow === C.church.weekday) {
      var cs = toMin(C.church.start), ce = toMin(C.church.end);
      if (kept('church') || (cs >= floor && free(cs - T.church, ce + T.church))) {
        put('church', 'faith', ce - cs, cs, ce, T.church, T.church, '⛪ ' + C.church.title,
          'Sunday service, ' + fmt(cs) + ' to ' + fmt(ce) + '. Leave by ' + fmt(cs - T.church) + '.', T.church + 15);
      }
    }

    // One-off fixed blocks for this date (for example a morning of beach volleyball), with their drive time.
    if (ov && ov.blocks) ov.blocks.forEach(function (b, i) {
      var s = toMin(b.start), e = toMin(b.end), tr = b.travel || 0;
      add('ov:' + (b.key || i), b.cal, s, e, b.title,
        (b.desc || '') + (tr ? '\nLeave by ' + fmt(s - tr) + ' (' + tr + '-minute drive each way).' : ''),
        b.remind || null, b.location ? { location: b.location } : null);
      block(s - tr, e + tr);
    });

    // White Lotus session: morning first, after work if the morning is taken, otherwise flag it.
    var wo = ctx.workoutByDate[date], woEnd = null, refuelEnd = null;
    if (wo) {
      var travel = travelFor(wo), dur = roundUp(wo.minutes, 5), k = ctx.keep['wl:' + wo.day];
      var start = null, note = '';
      var aw = at('workout');
      if (k && !k.allDay) { start = k.start; }
      else if (aw !== null && aw >= floor && free(aw - travel, aw + dur + travel + 15)) {
        start = aw; note = (ov && ov.workoutNote) || '';
      }
      else {
        var pref = Math.max(defaultWorkoutStart(wo, date), wake + 40 + travel);
        var morningEnd = Math.min(toMin(C.workout.morningLatestEnd), firstPrep === null ? 1440 : firstPrep);
        start = find(dur, pref, morningEnd, travel, travel + C.workout.refuelMin);
        if (start === null && firstPrep !== null) {
          start = find(dur, Math.min(pref, toMin('9:30')), firstPrep, travel, travel + 15);
          if (start !== null && start > toMin('10:00')) note = 'The morning slot was taken, so this is the first open window before work.';
        }
        if (start === null && lastHome !== null) {
          start = find(dur, lastHome + 10, asleep - 60, travel, travel + 15);
          if (start !== null) note = 'Moved after your shift because work takes the morning. Rather rest today? Push it back a day in White Lotus and everything after it moves.';
        }
      }
      if (start === null) {
        ev.push(conflictEvent(wo, 'Your schedule on ' + dayName(date) + ' leaves no ' + dur + '-minute window for this session.'));
      } else {
        var end = k && !k.allDay ? k.end : start + dur;
        block(start - travel, end + travel);
        ev.push(workoutEvent(wo, start, end, note));
        woEnd = end;
        var rs = end + travel, rmin = C.workout.refuelMin;
        while (rmin > 20 && !free(rs, rs + rmin)) rmin -= 5;
        if (kept('refuel') || free(rs, rs + rmin)) {
          var r = put('refuel', 'rest', rmin, rs, rs + rmin + 1, 0, 0,
            end < toMin('11:00') ? '🍳 Refuel: breakfast + shower' : '🍽️ Refuel: meal + shower',
            'Protein and carbs within an hour of training, plus water. Then shower and reset.', null);
          if (r) {
            refuelEnd = r.end;
            if (lunchWin && r.start < lunchWin[1] && r.end > toMin('11:00')) lunchWin = null; // the refuel is lunch today
          }
        }
      }
    }

    // Bible & prayer: first thing after waking; after work on early-shift days.
    var bibleDesc = 'Read a chapter, then pray. Your phone stays on the charger until you finish.\nNo plan yet? Start with the Gospel of John, one chapter a day.';
    if (!put('bible', 'faith', C.faith.bibleMin, wake + 5, wake + 5 + 90, 0, 0, '✝️ Bible & prayer', bibleDesc, 0)) {
      put('bible', 'faith', C.faith.bibleMin, lastHome || toMin('12:00'), asleep - 15, 0, 0, '✝️ Bible & prayer', bibleDesc, 0);
    }

    // Business block (not on Sundays or light days).
    var biz = C.business.byWeekday[dow];
    var bizEnd = null;
    if (biz && !light) {
      var want = off ? C.business.offDayMin : (dow === 6 ? C.business.saturdayMin : C.business.workDayMin);
      var normal = want;
      if (ov && ov.businessMin) want = ov.businessMin;
      var bFrom = Math.max(refuelEnd || wake + 30, toMin('9:00'));
      var bTo = firstPrep !== null ? firstPrep : toMin('18:00');
      var bDesc = 'Objective: ' + biz.objective + '\nDone when: ' + biz.done + '\nNext: ' + biz.next
        + '\n\nRevenue first: prospecting, outreach and client work before polishing.'
        + (want < normal ? '\nShorter today (' + want + ' min instead of ' + normal + '): do the most valuable half of the objective.' : '');
      var bTitle = '🚀 Business · ' + biz.name + (off ? ' (deep work)' : '');
      var b = null;
      for (var d = want; d >= C.business.shortestMin && !b; d -= 15) {
        b = put('biz', 'biz', d, bFrom, bTo, 0, 0, bTitle, bDesc, 10);
      }
      if (b) bizEnd = b.end;
    }

    // Read + journal.
    var rFrom = bizEnd || refuelEnd || wake + 30;
    var readDesc = 'Read for 20 minutes, then journal for 5: what went well, what didn\'t, what\'s next. Phone in another room.';
    if (!put('read', 'dev', C.readMin, rFrom, firstPrep !== null && firstPrep > rFrom ? firstPrep : asleep - 30, 0, 0, '📖 Read + journal', readDesc, null)) {
      if (lastHome !== null) put('read', 'dev', C.readMin, lastHome, asleep - 15, 0, 0, '📖 Read + journal', readDesc, null);
    }

    function extra(name, opts) {
      var x = C.extras[name], o = opts || {};
      var from = Math.max(toMin(o.from || x.from), floor), to = toMin(o.to || x.to);
      if (firstPrep !== null && !o.evening) to = Math.min(to, firstPrep);
      if (o.evening) from = Math.max(from, lastHome !== null ? lastHome + 30 : from);
      var desc = name === 'sundayReset' ? C.sundayResetDesc : x.desc;
      var pad = Math.max(x.travel, 10);
      return put('x:' + name, x.cal, x.min, from, to, pad, pad, x.title, desc, x.remind || null,
        x.travel ? { location: name === 'volleyball' ? 'Sand court (about ' + C.travel.sand + ' min away)' : '' } : null);
    }

    // Weekly items that need a free afternoon.
    var isChore = wk.choreDay === date, isPlay = wk.playDay === date;
    if (dow === C.church.weekday && !placed.sundayReset) {
      if (extra('sundayReset', off ? { from: '18:00', to: '19:30' } : {})) placed.sundayReset = true;
    }
    if (isPlay && !light) extra(dow === C.church.weekday ? 'volleyball' : 'outdoor');
    if (isChore && !light) extra('groceries');

    // Small things for the gap before a shift, or for a day off.
    if (!light && !(off && dow === C.church.weekday)) {
      var list = off ? ['guitar', 'beachWalk'] : (C.workDayExtras[dow] || []);
      if (off && dow === 1) list = list.concat(['errands']);
      list.forEach(function (name) {
        if (name === 'sundayReset') return;
        if (name === 'callFamily') { if (!placed.callFamily && extra('callFamily', { evening: true })) placed.callFamily = true; return; }
        if (name === 'surf' && isPlay) return;
        extra(name);
      });
    }
    if (dow === C.church.weekday && !placed.callFamily) {
      if (extra('callFamily', { from: '14:30', to: '21:00', evening: !off })) placed.callFamily = true;
    }

    // An open evening when work ends early or there is no work.
    var eveFrom = off ? toMin('18:30') : (lastHome !== null ? lastHome + 45 : null);
    if (eveFrom !== null && eveFrom <= toMin('20:00') && !tonight.afterShift) {
      var eStart = find(30, eveFrom, asleep - 30, 0, 0);
      if (eStart !== null) {
        var eEnd = eStart;
        while (eEnd + 5 <= asleep - 30 && free(eStart, eEnd + 5)) eEnd += 5;
        if (eEnd - eStart >= C.extras.openEvening.min) {
          block(eStart, eEnd);
          add('x:openEvening', 'soc', eStart, eEnd, C.extras.openEvening.title, C.extras.openEvening.desc, null, { transparent: true });
        }
      }
    }

    // Sleep.
    var sleepDesc = 'Asleep by ' + fmt(asleep) + ', up at ' + fmt(tonight.wakeNext) + ': ' + hoursLabel(tonight.minutes) + '.'
      + (tonight.afterShift ? ' Straight to bed after work.' : ' Phone on the charger, across the room.')
      + (tonight.early ? ' Early shift tomorrow.' : '')
      + (tonight.minutes < S.hours * 60 ? ' Short night: work runs too late for a full ' + S.hours + ' h.' : '');
    add('sleep', 'rest', asleep, tonight.wakeNext + 1440, '😴 Sleep · ' + hoursLabel(tonight.minutes), sleepDesc,
      tonight.afterShift ? null : 30, { transparent: true });

    return ev;
  }

  // ctx: { today, nowMin, knownThrough, routineThrough, shiftsByDate, busyByDate, workouts, restDates, keep }
  function plan(input) {
    var ctx = Object.create(input);
    ctx.keep = input.keep || {};
    ctx.busyByDate = input.busyByDate || {};
    ctx.weekPlaced = {};
    ctx.isKnown = function (d) { return !!input.knownThrough && d >= input.today && d <= input.knownThrough; };
    ctx.workoutByDate = {};
    (input.workouts || []).forEach(function (w) { if (w.date >= input.today) ctx.workoutByDate[w.date] = w; });

    var events = [];
    for (var d = input.today; input.routineThrough && d <= input.routineThrough; d = addDays(d, 1)) {
      events = events.concat(planDay(ctx, d));
    }
    // Workouts past the posted work schedule keep their default times until the schedule is known.
    (input.workouts || []).forEach(function (w) {
      if (w.date < input.today || (input.routineThrough && w.date <= input.routineThrough)) return;
      var s = defaultWorkoutStart(w, w.date);
      events.push(workoutEvent(w, s, s + roundUp(w.minutes, 5), ''));
    });
    (C.notes || []).forEach(function (n) {
      if (!n.date || !n.title || n.date < input.today) return;
      var slug = String(n.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
      events.push({ key: 'note:' + n.date + ':' + slug, cal: n.cal || 'err', date: n.date, allDay: true,
        title: '📝 ' + n.title, desc: (n.desc ? n.desc + '\n\n' : '') + C.footer,
        reminders: n.remind === undefined ? [900] : [].concat(n.remind) });
    });
    (input.restDates || []).forEach(function (d) {
      if (d < input.today) return;
      events.push({ key: 'rest:' + d, cal: 'rest', date: d, allDay: true, title: '😴 Rest day (pushed back in White Lotus)',
        desc: 'You pushed a workout back, so today is a rest day. Walk, stretch, hydrate.\n\n' + C.footer, reminders: [] });
    });
    return events;
  }

  return { plan: plan, night: night, toMin: toMin, fmt: fmt, addDays: addDays, weekday: weekday, hoursLabel: hoursLabel };
})();
