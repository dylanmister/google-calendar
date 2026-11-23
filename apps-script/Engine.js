// Engine: reads the sources (White Lotus feed, shifts, your own events), plans, and writes ONLY to the
// Life OS calendars. Every event it owns carries private properties { lifeos: '1', key, ws, we, wt, wd }
// so it can update in place, avoid duplicates, and notice when you moved, edited or deleted something.

var Engine = (function () {
  var C = LIFEOS, TZ = C.timeZone, P = Planner;
  var BUDGET_MS = 4.5 * 60 * 1000; // Apps Script stops a run at 6 minutes; leave room to save state.

  function props() { return PropertiesService.getScriptProperties(); }
  function getJSON(key, fallback) { var v = props().getProperty(key); if (!v) return fallback; try { return JSON.parse(v); } catch (e) { return fallback; } }
  function setJSON(key, value) { props().setProperty(key, JSON.stringify(value)); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function localNow() {
    var now = new Date();
    return { now: now, today: Utilities.formatDate(now, TZ, 'yyyy-MM-dd'), nowMin: +Utilities.formatDate(now, TZ, 'H') * 60 + +Utilities.formatDate(now, TZ, 'm') };
  }
  function wall(date, min) {
    var d = P.addDays(date, Math.floor(min / 1440)), m = ((min % 1440) + 1440) % 1440;
    return d + 'T' + pad(Math.floor(m / 60)) + ':' + pad(m % 60) + ':00';
  }
  function wallOf(t) { // API start/end → comparable string
    if (t.date) return 'D:' + t.date;
    return Utilities.formatDate(new Date(t.dateTime), TZ, "yyyy-MM-dd'T'HH:mm:ss");
  }
  function minutesOf(ev) { // → { date, start, end } in local minutes
    if (ev.start.date) return { date: ev.start.date, start: 0, end: 1440, allDay: true };
    var s = new Date(ev.start.dateTime), e = new Date(ev.end.dateTime);
    var date = Utilities.formatDate(s, TZ, 'yyyy-MM-dd');
    var sm = +Utilities.formatDate(s, TZ, 'H') * 60 + +Utilities.formatDate(s, TZ, 'm');
    return { date: date, start: sm, end: sm + Math.round((e - s) / 60000), allDay: false };
  }
  function hash(text) {
    var norm = String(text || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, norm, Utilities.Charset.UTF_8)).slice(0, 12);
  }
  function withRetry(fn) { return retry(fn); }
  function retry(fn) {
    for (var i = 0; ; i++) {
      try { return fn(); } catch (e) {
        var msg = String(e && e.message || e);
        if (i >= 4 || !/rate|quota|limit|backend|503|500|429|timed out/i.test(msg)) throw e;
        Utilities.sleep(1000 * Math.pow(2, i));
      }
    }
  }

  // ---------- calendars ----------
  function ensureCalendars(status) {
    var listed = {};
    var page;
    do {
      var lopts = { showHidden: true, maxResults: 250 };
      if (page) lopts.pageToken = page;
      var res = withRetry(function () { return Calendar.CalendarList.list(lopts); });
      (res.items || []).forEach(function (c) { listed[c.id] = c; });
      page = res.nextPageToken;
    } while (page);
    var ids = {};
    Object.keys(C.calendars).forEach(function (k) {
      var spec = C.calendars[k], id = props().getProperty('cal:' + k);
      if (id === 'disabled') return;
      if (id && listed[id]) { ids[k] = id; return; }
      if (id && !listed[id]) { // you deleted or unsubscribed it: respect that
        props().setProperty('cal:' + k, 'disabled');
        status.notes.push('The "' + spec.name + '" calendar is gone, so Life OS stopped filling it. Run enableCategory("' + k + '") to bring it back.');
        return;
      }
      var cal = withRetry(function () {
        return Calendar.Calendars.insert({ summary: spec.name, timeZone: TZ, description: 'Managed by Life OS (Google Apps Script). Synced from HotSchedules and White Lotus; see the "Life OS — Sync Status" file in Google Drive.' });
      });
      withRetry(function () {
        return Calendar.CalendarList.patch({ backgroundColor: spec.color, foregroundColor: spec.color === '#F6BF26' ? '#000000' : '#FFFFFF', selected: true }, cal.id, { colorRgbFormat: true });
      });
      props().setProperty('cal:' + k, cal.id);
      ids[k] = cal.id;
      status.notes.push('Created calendar ' + spec.name + '.');
    });
    return { ids: ids, listed: listed };
  }

  // ---------- sources ----------
  function fetchFeed(fromDate) {
    var token = (typeof LIFEOS_SECRETS !== 'undefined' && LIFEOS_SECRETS.feedToken) || props().getProperty('FEED_TOKEN');
    if (!token) throw new Error('No White Lotus feed token is set.');
    var res = UrlFetchApp.fetch(C.whiteLotus.feedUrl + '?from=' + fromDate, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error('White Lotus feed answered ' + res.getResponseCode());
    var feed = JSON.parse(res.getContentText());
    if (!feed.ok || !feed.days) throw new Error('White Lotus feed returned no days');
    return feed;
  }

  function listEvents(calId, timeMin, timeMax, extra) {
    var items = [], page;
    do {
      var opts = { timeMin: timeMin, timeMax: timeMax, singleEvents: true, maxResults: 2500 };
      if (page) opts.pageToken = page;
      for (var k in (extra || {})) opts[k] = extra[k];
      var res = withRetry(function () { return Calendar.Events.list(calId, opts); });
      items = items.concat(res.items || []);
      page = res.nextPageToken;
    } while (page);
    return items;
  }

  function shiftCalendars(cals) {
    var S = C.shifts;
    if (S.calendarId) return [S.calendarId];
    return Object.keys(cals.listed).filter(function (id) {
      var c = cals.listed[id];
      return (c.accessRole === 'owner' || c.accessRole === 'writer') && !isManaged(cals, id);
    });
  }
  function isManaged(cals, id) { return Object.keys(cals.ids).some(function (k) { return cals.ids[k] === id; }); }

  // Shifts: HotSchedules events in Google Calendar when there are any ('auto' or 'calendar'),
  // otherwise the saved copy in Config ('auto' or 'seed'), so the routine never vanishes while the link is missing.
  function readShifts(L, cals, status) {
    var S = C.shifts;
    if (S.source !== 'seed') {
      var live = readCalendarShifts(L, cals);
      if (live.count > 0 || S.source === 'calendar') return live;
      status.notes.push('No HotSchedules shifts found in Google Calendar yet, so shifts come from the copy saved on Nov 22.');
    }
    return readSeed(L);
  }

  function readSeed(L) {
    var S = C.shifts, byDate = {}, count = 0;
    S.seed.forEach(function (s) {
      if (s[0] < L.today) return;
      var st = P.toMin(s[1]);
      (byDate[s[0]] = byDate[s[0]] || []).push({ start: st, end: st + C.work.shiftHours * 60, station: s[2] });
      count++;
    });
    return { byDate: byDate, knownThrough: S.seedKnownThrough >= L.today ? S.seedKnownThrough : null, source: 'saved copy (read from HotSchedules Nov 22)', count: count };
  }

  // HotSchedules titles look like "Hotschedules: Host/Hostess Rest 505 Host Desk Runner": job, schedule, then station.
  function stationOf(summary) {
    var s = String(summary || '').replace(/^\s*hotschedules\s*:\s*/i, '');
    var m = s.match(/\bHost Desk\b\s*(.*)$/i);
    var rest = (m ? m[1] : '').trim();
    if (/^takeout$/i.test(rest)) return 'Takeout';
    return rest;
  }

  function readCalendarShifts(L, cals) {
    var S = C.shifts, byDate = {}, count = 0, seenStart = {};
    function push(date, start, end, station) {
      if (seenStart[date + ' ' + start]) return; // HotSchedules sent the same shift twice
      seenStart[date + ' ' + start] = true;
      (byDate[date] = byDate[date] || []).push({ start: start, end: end, station: station }); count++;
    }
    var re = new RegExp(S.match, 'i'), latest = null;
    var tMin = new Date(L.now.getTime() - 36 * 3600000).toISOString(), tMax = new Date(L.now.getTime() + 35 * 86400000).toISOString();
    shiftCalendars(cals).forEach(function (id) {
      listEvents(id, tMin, tMax).forEach(function (e) {
        if (e.status === 'cancelled' || !e.start || !e.start.dateTime) return;
        if (!re.test([e.summary, e.description, e.location].join(' '))) return;
        var m = minutesOf(e);
        if (m.date < L.today) return;
        var end = (m.end - m.start) >= 120 ? m.end : m.start + C.work.shiftHours * 60;
        push(m.date, m.start, end, stationOf(e.summary));
        if (!latest || m.date > latest) latest = m.date;
      });
    });
    var known = null;
    if (latest) { known = latest; while (P.weekday(known) !== S.weekEndsOn) known = P.addDays(known, 1); }
    return { byDate: byDate, knownThrough: known, source: 'HotSchedules → Google Calendar', count: count };
  }

  function readBusy(L, cals, through) {
    var busy = {};
    if (!through) return busy;
    var re = new RegExp(C.shifts.match, 'i');
    var tMin = new Date(L.now.getTime() - 12 * 3600000).toISOString(), tMax = new Date(L.now.getTime() + 16 * 86400000).toISOString();
    Object.keys(cals.listed).forEach(function (id) {
      var c = cals.listed[id];
      if (isManaged(cals, id) || c.selected === false || /holiday|#contacts|birthday/i.test(id)) return;
      listEvents(id, tMin, tMax).forEach(function (e) {
        if (e.status === 'cancelled' || !e.start || !e.start.dateTime || e.transparency === 'transparent') return;
        if (re.test([e.summary, e.description, e.location].join(' '))) return;
        var me = (e.attendees || []).filter(function (a) { return a.self; })[0];
        if (me && me.responseStatus === 'declined') return;
        var m = minutesOf(e);
        for (var d = m.date, off = 0; d <= through && off < m.end; d = P.addDays(d, 1), off += 1440) {
          if (d < L.today) continue;
          (busy[d] = busy[d] || []).push({ start: Math.max(0, m.start - off), end: Math.min(1440, m.end - off), title: e.summary || '' });
        }
      });
    });
    return busy;
  }

  // ---------- existing Life OS events ----------
  function listManaged(cals, L, lastDate) {
    var out = {}, dupes = [];
    var tMin = new Date(L.now.getTime() - 2 * 86400000).toISOString();
    var tMax = new Date(Date.UTC(+lastDate.slice(0, 4), +lastDate.slice(5, 7) - 1, +lastDate.slice(8, 10)) + 3 * 86400000).toISOString();
    Object.keys(cals.ids).forEach(function (k) {
      listEvents(cals.ids[k], tMin, tMax, { privateExtendedProperty: 'lifeos=1' }).forEach(function (e) {
        var p = (e.extendedProperties && e.extendedProperties.private) || {};
        if (!p.key || e.status === 'cancelled') return;
        var item = { ev: e, cal: k, calId: cals.ids[k], p: p, m: minutesOf(e) };
        if (out[p.key]) dupes.push(item); else out[p.key] = item;
      });
    });
    return { byKey: out, dupes: dupes };
  }

  function userChanged(x) {
    var p = x.p;
    if (p.locked === '1') return true;
    if (!p.ws) return false;
    return wallOf(x.ev.start) !== p.ws || wallOf(x.ev.end) !== p.we || hash(x.ev.summary) !== p.wt || hash(x.ev.description) !== p.wd;
  }

  // Events that must not move this run: anything already started or starting within the hour,
  // and (unless today's shifts changed) the rest of today's routine as it was planned.
  function buildKeep(existing, L, replanToday, feedByDay) {
    var keep = {};
    Object.keys(existing.byKey).forEach(function (key) {
      var x = existing.byKey[key], m = x.m;
      if (/\|(prep|shift)\d+$|\|sleep$|\|refuel$/.test(key)) return; // these follow your shifts and workouts
      if (key.indexOf('wl:') === 0) {
        var w = feedByDay[key.slice(3)];
        if (!w || w.date !== m.date || m.allDay) return;
        if (m.date === L.today && (m.start < L.nowMin + 60 || !replanToday)) keep[key] = { start: m.start, end: m.end };
        else if (userChanged(x)) keep[key] = { start: m.start, end: m.end };
        return;
      }
      if (key.indexOf('rest:') === 0) return;
      var date = key.slice(0, 10);
      if (date !== m.date || m.allDay) return; // you moved it to another day: it's yours now
      if (date === L.today && (m.start < L.nowMin + 60 || !replanToday)) keep[key] = { start: m.start, end: m.end };
      else if (userChanged(x)) keep[key] = { start: m.start, end: m.end }; // you moved it: plan around it
    });
    return keep;
  }

  function resource(d) {
    var body = {
      summary: d.title, description: d.desc, location: d.location || '',
      reminders: { useDefault: false, overrides: (d.reminders || []).map(function (m) { return { method: 'popup', minutes: m }; }) },
      transparency: d.transparent ? 'transparent' : 'opaque',
    };
    if (d.allDay) { body.start = { date: d.date }; body.end = { date: P.addDays(d.date, 1) }; }
    else { body.start = { dateTime: wall(d.date, d.start), timeZone: TZ }; body.end = { dateTime: wall(d.date, d.end), timeZone: TZ }; }
    body.extendedProperties = { private: {
      lifeos: '1', key: d.key,
      ws: d.allDay ? 'D:' + d.date : wall(d.date, d.start),
      we: d.allDay ? 'D:' + P.addDays(d.date, 1) : wall(d.date, d.end),
      wt: hash(d.title), wd: hash(d.desc),
    } };
    return body;
  }

  function differs(x, body) {
    var e = x.ev;
    if (wallOf(e.start) !== body.extendedProperties.private.ws || wallOf(e.end) !== body.extendedProperties.private.we) return true;
    if ((e.summary || '') !== body.summary || hash(e.description) !== body.extendedProperties.private.wd) return true;
    if ((e.location || '') !== body.location || (e.transparency || 'opaque') !== body.transparency) return true;
    var have = ((e.reminders && e.reminders.overrides) || []).map(function (r) { return r.minutes; }).sort().join(',');
    var want = body.reminders.overrides.map(function (r) { return r.minutes; }).sort().join(',');
    return have !== want || (e.reminders && e.reminders.useDefault);
  }

  // ---------- id store (to tell "you deleted it" from "never created") ----------
  function bucketOf(key) { return key.indexOf('wl:') === 0 ? 'st:wl' : key.indexOf('rest:') === 0 ? 'st:rest' : 'st:' + key.slice(0, 10); }
  function Store() { this.cache = {}; this.dirty = {}; }
  Store.prototype.get = function (key) { var b = bucketOf(key); if (!(b in this.cache)) this.cache[b] = getJSON(b, {}); return this.cache[b][key]; };
  Store.prototype.set = function (key, val) { var b = bucketOf(key); this.get(key); if (val === undefined) delete this.cache[b][key]; else this.cache[b][key] = val; this.dirty[b] = true; };
  Store.prototype.save = function () { var self = this; Object.keys(this.dirty).forEach(function (b) { setJSON(b, self.cache[b]); }); this.dirty = {}; };
  function pruneStore(today) {
    var all = props().getProperties();
    Object.keys(all).forEach(function (k) { if (/^st:\d{4}-\d{2}-\d{2}$/.test(k) && k.slice(3) < P.addDays(today, -3)) props().deleteProperty(k); });
  }

  function reconcile(cals, desired, existing, L, opts) {
    var t0 = opts.t0, stats = { created: 0, updated: 0, deleted: 0, untouched: 0, yours: 0, skippedDeleted: 0, deferred: 0 }, store = new Store();
    var seen = {}, writes = 0;
    // In a dry run nothing is written: API calls are skipped and the id store is never saved.
    function withRetry(fn) { return opts.dryRun ? { id: 'dry-run' } : retry(fn); }
    function out() { return Date.now() - t0 > BUDGET_MS; }
    function isFuture(d) { return d.allDay ? d.date >= L.today : (d.date > L.today || (d.date === L.today && d.end > L.nowMin)); }
    function started(x) { return x.m.date < L.today || (x.m.date === L.today && !x.m.allDay && x.m.start <= L.nowMin); }

    existing.dupes.forEach(function (x) {
      if (out() || userChanged(x) || started(x)) return;
      withRetry(function () { Calendar.Events.remove(x.calId, x.ev.id); }); stats.deleted++;
    });

    desired.forEach(function (d) {
      var calId = cals.ids[d.cal];
      if (!calId) return;
      seen[d.key] = true;
      var x = existing.byKey[d.key], body = resource(d);
      if (x) {
        var moved = d.key.indexOf('wl:') === 0 && x.m.date !== d.date; // White Lotus moved this workout to another day
        if (userChanged(x) && !moved) { stats.yours++; return; }
        // Tonight's sleep block can still change while it's "in progress" (you're not asleep yet).
        var sleepingNow = /\|sleep$/.test(d.key) && x.m.date === L.today && x.m.end > L.nowMin;
        if (started(x) && !moved && !sleepingNow) { stats.untouched++; return; }
        if (!differs(x, body) && x.cal === d.cal) { stats.untouched++; return; }
        if (out()) { stats.deferred++; return; }
        if (x.cal !== d.cal) {
          withRetry(function () { Calendar.Events.move(x.calId, x.ev.id, calId); });
        }
        if (moved && x.p.locked) body.extendedProperties.private.locked = '';
        withRetry(function () { return Calendar.Events.patch(body, calId, x.ev.id); });
        store.set(d.key, x.ev.id);
        stats.updated++; writes++;
      } else {
        if (store.get(d.key)) { stats.skippedDeleted++; return; } // you deleted it; don't bring it back
        if (!isFuture(d)) return;
        if (out()) { stats.deferred++; return; }
        var made = withRetry(function () { return Calendar.Events.insert(body, calId); });
        store.set(d.key, made.id);
        stats.created++; writes++;
      }
      if (writes % 40 === 0 && !opts.dryRun) store.save();
    });

    Object.keys(existing.byKey).forEach(function (key) {
      if (seen[key]) return;
      var x = existing.byKey[key];
      if (started(x)) { stats.untouched++; return; }
      if (userChanged(x)) { stats.yours++; return; }
      if (!opts.feedOK && (key.indexOf('wl:') === 0 || key.indexOf('rest:') === 0)) return;
      if (!opts.replanToday && key.slice(0, 10) === L.today && !/\|(prep|shift)\d+$|\|sleep$|\|refuel$/.test(key)) return;
      if (out()) { stats.deferred++; return; }
      withRetry(function () { Calendar.Events.remove(x.calId, x.ev.id); });
      store.set(key, undefined);
      stats.deleted++;
    });
    if (!opts.dryRun) { store.save(); pruneStore(L.today); }
    return stats;
  }

  // For a dry run: pretend the next unfinished workout was pushed back a day, exactly like the app does.
  function simulatePush(feed, today) {
    var next = feed.days.filter(function (w) { return w.date >= today && !w.done; })[0];
    if (!next) return null;
    var from = next.date, shifts = feed.shifts.concat([next.day]).sort(function (a, b) { return a - b; });
    feed.days.forEach(function (w) { w.date = P.addDays(feed.program.start, (w.day - 1) + shifts.filter(function (s) { return s <= w.day; }).length); });
    feed.shifts = shifts;
    feed.restDates = [from];
    feed.program.end = feed.days[feed.days.length - 1].date;
    return { day: next.day, title: next.title, from: from, to: next.date, end: feed.program.end };
  }

  function shiftSig(list) {
    return (list || []).map(function (s) { return P.fmt(s.start); }).sort().join(' + ');
  }

  // ---------- one full sync ----------
  function sync(reason, runOpts) {
    runOpts = runOpts || {};
    var t0 = Date.now(), L = localNow();
    var status = { reason: reason, ranAt: L.now, ok: false, notes: [], errors: [] };
    var cals = ensureCalendars(status);

    var feed = null;
    try { feed = fetchFeed(P.addDays(L.today, -1)); }
    catch (e) { status.errors.push('White Lotus: ' + e.message); }
    var shifts = readShifts(L, cals, status);
    var routineThrough = null;
    if (shifts.knownThrough) {
      routineThrough = P.addDays(L.today, C.routineHorizonDays - 1);
      if (shifts.knownThrough < routineThrough) routineThrough = shifts.knownThrough;
    }
    var busy = readBusy(L, cals, routineThrough);

    if (!feed) { // never plan without the workouts, or the routine would land on top of them
      status.summary = 'Skipped: White Lotus did not answer. Nothing changed.';
      Notify.finish(status, null, shifts, feed);
      return status;
    }
    if (runOpts.simulatePush) status.simulated = simulatePush(feed, L.today);
    var feedByDay = {};
    feed.days.forEach(function (w) { feedByDay[w.day] = w; });
    var lastDate = feed.program.end > (routineThrough || '') ? feed.program.end : routineThrough;
    var existing = listManaged(cals, L, lastDate);

    var snap = Notify.loadSnapshot();
    var todaySig = shiftSig(shifts.byDate[L.today]);
    var replanToday = !snap || !snap.shifts || snap.shifts[L.today] === undefined || snap.shifts[L.today] !== todaySig;

    var desired = P.plan({
      today: L.today, nowMin: L.nowMin, knownThrough: shifts.knownThrough, routineThrough: routineThrough,
      shiftsByDate: shifts.byDate, busyByDate: busy, workouts: feed.days, restDates: feed.restDates,
      keep: buildKeep(existing, L, replanToday, feedByDay),
    });

    status.stats = reconcile(cals, desired, existing, L, { t0: t0, replanToday: replanToday, feedOK: true, dryRun: !!runOpts.dryRun });
    status.ok = true;
    if (runOpts.dryRun) {
      var sim = status.simulated, x = sim && existing.byKey['wl:' + sim.day];
      var d = sim && desired.filter(function (e) { return e.key === 'wl:' + sim.day; })[0];
      status.sample = sim ? { now: x ? wallOf(x.ev.start) : 'missing', wouldBe: d ? (d.allDay ? 'all day ' + d.date : wall(d.date, d.start)) : 'missing' } : null;
      return status; // nothing written, no email, no status file, snapshot untouched
    }
    status.routineThrough = routineThrough;
    status.conflicts = desired.filter(function (d) { return d.key.indexOf('wl:') === 0 && d.allDay; })
      .map(function (d) { return d.date + ': ' + d.title; });
    status.durationSec = Math.round((Date.now() - t0) / 1000);
    Notify.finish(status, desired, shifts, feed);
    return status;
  }

  return { sync: sync, ensureCalendars: ensureCalendars, localNow: localNow, shiftSig: shiftSig, getJSON: getJSON, setJSON: setJSON };
})();
