// Notify: remembers what the last sync saw, emails you when shifts or workouts change,
// and keeps a "Life OS — Sync Status" text file in Google Drive with the last successful sync.

var Notify = (function () {
  var C = LIFEOS, TZ = C.timeZone, P = Planner;

  function props() { return PropertiesService.getScriptProperties(); }
  function loadSnapshot() { var v = props().getProperty('snapshot'); if (!v) return null; try { return JSON.parse(v); } catch (e) { return null; } }
  function nice(iso) { var p = iso.split('-'); return Utilities.formatDate(new Date(+p[0], +p[1] - 1, +p[2], 12), TZ, 'EEE MMM d'); }
  function stamp(d) { return Utilities.formatDate(d || new Date(), TZ, 'EEE MMM d, h:mm a'); }
  function sig(text) { return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text, Utilities.Charset.UTF_8)).slice(0, 12); }
  function me() { return Session.getEffectiveUser().getEmail(); }

  function current(L, status, shifts, feed) {
    var cur = { today: L.today, knownThrough: shifts.knownThrough, shifts: {}, conflicts: status.conflicts || [] };
    if (shifts.knownThrough) for (var d = L.today; d <= shifts.knownThrough; d = P.addDays(d, 1)) cur.shifts[d] = Engine.shiftSig(shifts.byDate[d]);
    var upcoming = {};
    feed.days.forEach(function (w) { if (w.date <= P.addDays(L.today, 28)) upcoming[w.day] = w.date; });
    cur.wl = { pushes: feed.shifts.length, end: feed.program.end, upcoming: upcoming,
      sig: sig(feed.days.map(function (w) { return w.day + w.title + w.location + w.minutes; }).join('|')) };
    return cur;
  }

  function diff(prev, cur) {
    var lines = [], newWeek = [];
    Object.keys(cur.shifts).sort().forEach(function (d) {
      var now = cur.shifts[d] || 'off', before = prev.shifts && prev.shifts[d];
      if (before === undefined) { if (!prev.knownThrough || d > prev.knownThrough) newWeek.push(nice(d) + ': ' + now); return; }
      before = before || 'off';
      if (before !== now) lines.push('Shift change on ' + nice(d) + ': ' + before + ' → ' + now + '.');
    });
    if (newWeek.length) lines.push('New HotSchedules schedule posted:\n  ' + newWeek.join('\n  '));
    if (prev.wl && prev.wl.pushes !== cur.wl.pushes) {
      var moved = Object.keys(cur.wl.upcoming).map(Number).sort(function (a, b) { return a - b; })
        .filter(function (day) { return prev.wl.upcoming[day] && prev.wl.upcoming[day] !== cur.wl.upcoming[day]; });
      if (moved.length) lines.push('White Lotus: Day ' + moved[0] + ' moved from ' + nice(prev.wl.upcoming[moved[0]]) + ' to ' + nice(cur.wl.upcoming[moved[0]]) + ', and every workout after it moved too. The arc now ends ' + nice(cur.wl.end) + '.');
      else lines.push('White Lotus: the push-back count changed (' + prev.wl.pushes + ' → ' + cur.wl.pushes + '). The arc now ends ' + nice(cur.wl.end) + '.');
    } else if (prev.wl && prev.wl.sig !== cur.wl.sig) {
      lines.push('White Lotus: the program itself changed (a title, location or length). Your calendar now matches it.');
    }
    cur.conflicts.forEach(function (c) { if ((prev.conflicts || []).indexOf(c) < 0) lines.push('No room for a workout on ' + c.replace(/^(\d{4}-\d{2}-\d{2}): /, function (m, d) { return nice(d) + ': '; }) + '. It is on your calendar as an all-day reminder.'); });
    return lines;
  }

  function send(subject, body) {
    try { MailApp.sendEmail({ to: me(), subject: 'Life OS · ' + subject, body: body + '\n\n— Life OS (your Google Apps Script). Calendar: https://calendar.google.com' , name: 'Life OS' }); }
    catch (e) { console.warn('Email failed: ' + e.message); }
  }

  function finish(status, desired, shifts, feed) {
    var L = Engine.localNow(), prev = loadSnapshot();
    if (status.ok) {
      var cur = current(L, status, shifts, feed);
      var lines = prev && prev.wl ? diff(prev, cur) : [];
      status.changes = lines;
      props().setProperty('snapshot', JSON.stringify(cur));
      props().setProperty('lastSuccess', new Date().toISOString());
      props().deleteProperty('failingSince'); props().deleteProperty('failMailed');
      // Running out of known shifts: say so once per cutoff, two days ahead.
      var known = shifts.knownThrough;
      if ((!known || known <= P.addDays(L.today, 2)) && props().getProperty('staleAlertFor') !== String(known)) {
        props().setProperty('staleAlertFor', String(known));
        send('shifts known only through ' + (known ? nice(known) : 'today'), [
          'Life OS only knows your Five Crowns shifts through ' + (known ? nice(known) : 'today') + ' (source: ' + shifts.source + ').',
          'After that, only White Lotus workouts are planned, because the rest of each day depends on when you work.',
          '',
          'Fix: make sure HotSchedules is linked to Google Calendar (HotSchedules → Settings → Personal → Link To My Google Calendar).',
          'Once your next week shows up in Google Calendar, the full routine fills in on the next sync.',
        ].join('\n'));
      }
      if (!prev) {
        send('set up and syncing', [
          'Life OS just filled your calendar.',
          '',
          'Created: ' + status.stats.created + ' events across ' + Object.keys(C.calendars).length + ' calendars.',
          'White Lotus: every session through ' + nice(feed.program.end) + '.',
          'Routine: planned through ' + (status.routineThrough ? nice(status.routineThrough) : 'the end of your posted schedule') + ' (shifts from the ' + shifts.source + ').',
          'It re-checks every hour and whenever your calendar changes, and emails you when a shift or workout changes.',
          'Move or delete any block and it leaves your change alone.',
        ].join('\n'));
      } else if (lines.length) {
        send(lines.length === 1 ? lines[0].split(':')[0] : lines.length + ' changes', lines.join('\n\n'));
      }
    } else {
      var since = props().getProperty('failingSince');
      if (!since) { since = new Date().toISOString(); props().setProperty('failingSince', since); }
      if (Date.now() - Date.parse(since) > 6 * 3600000 && !props().getProperty('failMailed')) {
        send('sync is failing', 'Life OS has not synced since ' + stamp(new Date(Date.parse(since))) + '.\n\n' + status.errors.join('\n') + '\n\nYour calendar has not been changed while this lasts.');
        props().setProperty('failMailed', '1');
      }
    }
    writeStatus(status, shifts, feed);
  }

  function failure(reason, err) {
    var status = { reason: reason, ok: false, errors: [String(err && err.stack || err)], notes: [] };
    try { finish(status, null, { source: '?', count: 0, knownThrough: null }, null); } catch (e) { console.error(e); }
  }

  function writeStatus(status, shifts, feed) {
    var last = props().getProperty('lastSuccess');
    var s = status.stats || {};
    var text = [
      'LIFE OS · SYNC STATUS',
      '',
      'Last run:              ' + stamp(status.ranAt) + ' (' + status.reason + ') · ' + (status.ok ? 'OK' + (status.durationSec !== undefined ? ' in ' + status.durationSec + ' s' : '') : 'FAILED'),
      'Last successful sync:  ' + (last ? stamp(new Date(last)) : 'never'),
      'White Lotus:           ' + (feed ? 'Day ' + feed.days[0].day + '–' + feed.days[feed.days.length - 1].day + ' · ' + feed.shifts.length + ' push-backs · arc ends ' + nice(feed.program.end) : 'not reached this run'),
      'Shifts from:           ' + shifts.source + ' · ' + shifts.count + ' upcoming shifts' + (shifts.knownThrough ? ' · schedule known through ' + nice(shifts.knownThrough) : ''),
      'Routine planned:       ' + (status.routineThrough ? 'through ' + nice(status.routineThrough) : 'not yet (no posted schedule)'),
      'This run:              created ' + (s.created || 0) + ' · updated ' + (s.updated || 0) + ' · deleted ' + (s.deleted || 0) + ' · unchanged ' + (s.untouched || 0) + ' · left alone because you changed them ' + (s.yours || 0) + ' · not recreated because you deleted them ' + (s.skippedDeleted || 0) + (s.deferred ? ' · deferred to next run ' + s.deferred : ''),
      'Needs attention:       ' + ((status.conflicts && status.conflicts.length) ? status.conflicts.join('; ') : 'nothing'),
      'Changes noticed:       ' + ((status.changes && status.changes.length) ? status.changes.join(' | ') : 'none'),
      'Notes:                 ' + (status.notes.length ? status.notes.join(' ') : 'none'),
      'Errors:                ' + (status.errors.length ? status.errors.join(' | ') : 'none'),
      '',
      'Runs every hour and whenever your Google Calendar changes. Settings live in Config.js.',
    ].join('\n');
    props().setProperty('statusText', text.slice(0, 8500));
    var blob = Utilities.newBlob(text, 'text/plain', 'Life OS — Sync Status');
    var id = props().getProperty('statusFileId');
    try {
      if (id) { Drive.Files.update({}, id, blob); return; }
    } catch (e) { id = null; }
    var f = Drive.Files.create({ name: 'Life OS — Sync Status', mimeType: 'text/plain' }, blob);
    props().setProperty('statusFileId', f.id);
  }

  return { loadSnapshot: loadSnapshot, finish: finish, failure: failure };
})();
