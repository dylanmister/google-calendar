// End-to-end simulation of the Apps Script engine against an in-memory Google Calendar.
// Usage: node test/sim-engine.cjs <feed.json>
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const TZ = 'America/Los_Angeles';
const feedJson = fs.readFileSync(process.argv[2], 'utf8');
let feedOverride = null;

// ---------- time helpers ----------
function partsIn(date) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short', hourCycle: 'h23' });
  const o = {}; for (const p of f.formatToParts(date)) o[p.type] = p.value; return o;
}
function offsetFor(wallIso) { // '2026-11-23T07:00:00' in LA → '-08:00'
  const guess = new Date(wallIso + 'Z');
  for (const off of [-8, -7]) {
    const d = new Date(guess.getTime() - off * 3600000), p = partsIn(d);
    if (`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}` === wallIso) return (off < 0 ? '-' : '+') + String(Math.abs(off)).padStart(2, '0') + ':00';
  }
  return '-08:00';
}
function formatDate(date, tz, pat) {
  const p = partsIn(date), H = +p.hour, h12 = ((H + 11) % 12) + 1, MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+p.month - 1];
  const map = { "yyyy-MM-dd'T'HH:mm:ss": `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`, 'yyyy-MM-dd': `${p.year}-${p.month}-${p.day}`, H: String(H), m: String(+p.minute),
    'EEE MMM d': `${p.weekday} ${MON} ${+p.day}`, 'EEE MMM d, h:mm a': `${p.weekday} ${MON} ${+p.day}, ${h12}:${p.minute} ${H >= 12 ? 'PM' : 'AM'}` };
  if (!(pat in map)) throw new Error('formatDate pattern not mocked: ' + pat);
  return map[pat];
}
function instant(t) { return t.date ? new Date(t.date + 'T00:00:00' + offsetFor(t.date + 'T00:00:00')).getTime() : new Date(t.dateTime.length === 19 ? t.dateTime + offsetFor(t.dateTime) : t.dateTime).getTime(); }

// ---------- fake Google ----------
const store = { props: {}, cals: { 'me@example.com': { id: 'me@example.com', summary: 'Dylan Mister', accessRole: 'owner', selected: true, primary: true } }, events: {}, mails: [], files: {} };
let seq = 0;
const clone = o => JSON.parse(JSON.stringify(o));
function normalize(ev) { // the API returns dateTimes with an offset
  for (const k of ['start', 'end']) if (ev[k].dateTime && ev[k].dateTime.length === 19) ev[k].dateTime += offsetFor(ev[k].dateTime);
  return ev;
}
const Calendar = {
  CalendarList: {
    list: () => ({ items: Object.values(store.cals).map(clone) }),
    patch: (body, id) => { Object.assign(store.cals[id], body); return clone(store.cals[id]); },
  },
  Calendars: { insert: body => { const id = 'cal' + (++seq) + '@group.calendar.google.com'; store.cals[id] = { id, summary: body.summary, accessRole: 'owner', selected: true }; store.events[id] = {}; return { id }; } },
  Events: {
    list: (calId, o) => {
      const lo = new Date(o.timeMin).getTime(), hi = new Date(o.timeMax).getTime();
      const items = Object.values(store.events[calId] || {}).filter(e => {
        if (e.status === 'cancelled') return false;
        if (o.privateExtendedProperty) { const [k, v] = o.privateExtendedProperty.split('='); if (!e.extendedProperties || e.extendedProperties.private[k] !== v) return false; }
        return instant(e.end) > lo && instant(e.start) < hi;
      });
      return { items: items.map(clone) };
    },
    insert: (body, calId) => { const id = 'ev' + (++seq); store.events[calId][id] = normalize(Object.assign(clone(body), { id, status: 'confirmed' })); return { id }; },
    patch: (body, calId, id) => {
      const e = store.events[calId][id]; if (!e) throw new Error('Not Found');
      for (const [k, v] of Object.entries(clone(body))) {
        if (k === 'extendedProperties') e.extendedProperties.private = Object.assign(e.extendedProperties.private, v.private);
        else e[k] = v;
      }
      normalize(e); return clone(e);
    },
    remove: (calId, id) => { delete store.events[calId][id]; },
    move: (calId, id, dest) => { store.events[dest][id] = store.events[calId][id]; delete store.events[calId][id]; },
  },
};
const sandbox = {
  console, JSON, Math, Date, Object, String, Number, Array, RegExp, Error,
  Calendar,
  Drive: { Files: { create: (meta, blob) => { store.files.status = blob.text; return { id: 'file1' }; }, update: (meta, id, blob) => { store.files.status = blob.text; } } },
  Utilities: {
    formatDate, sleep: () => {}, DigestAlgorithm: { MD5: 'md5' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (alg, text) => [...crypto.createHash('md5').update(text, 'utf8').digest()],
    base64Encode: bytes => Buffer.from(bytes.map(b => b & 255)).toString('base64'),
    newBlob: (text) => ({ text }),
  },
  PropertiesService: { getScriptProperties: () => ({
    getProperty: k => (k in store.props ? store.props[k] : null), setProperty: (k, v) => { if (String(v).length > 9000) throw new Error('property too large: ' + k + ' ' + String(v).length); store.props[k] = String(v); },
    deleteProperty: k => { delete store.props[k]; }, getProperties: () => clone(store.props) }) },
  UrlFetchApp: { fetch: (url, opts) => {
    if (!/Bearer .{40,}/.test(opts.headers.Authorization)) return { getResponseCode: () => 401, getContentText: () => '{}' };
    return { getResponseCode: () => 200, getContentText: () => feedOverride || feedJson };
  } },
  Session: { getEffectiveUser: () => ({ getEmail: () => 'me@example.com' }) },
  MailApp: { sendEmail: m => store.mails.push(m) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  ScriptApp: { getProjectTriggers: () => store.triggers || [], newTrigger: fn => { const t = { timeBased: () => t, everyHours: () => t, forUserCalendar: () => t, onEventUpdated: () => t, create: () => { (store.triggers = store.triggers || []).push({ getHandlerFunction: () => fn, getEventType: () => 'X', getTriggerSourceId: () => '' }); } }; return t; } },
};
const ctx = vm.createContext(sandbox);
const dir = path.join(__dirname, '..', 'apps-script');
for (const f of ['Config.js', 'Secrets.js', 'Planner.js', 'Engine.js', 'Notify.js', 'Main.js']) vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });

function managed() {
  const out = [];
  for (const [calId, evs] of Object.entries(store.events)) for (const e of Object.values(evs)) if (e.extendedProperties && e.extendedProperties.private.lifeos === '1') out.push({ calId, e });
  return out;
}
const run = (label, fn) => { const r = vm.runInContext(fn, ctx); console.log(`\n== ${label}:`, JSON.stringify(r && r.stats), r && r.changes && r.changes.length ? '\n   changes: ' + r.changes.join(' | ') : '', r && r.errors && r.errors.length ? '\n   errors: ' + r.errors.join(' | ') : ''); return r; };

// 1) first run
run('setup (first run)', 'setup(); Engine.sync("check")');
const after1 = managed();
console.log('calendars:', Object.values(store.cals).filter(c => !c.primary).map(c => c.summary).join(', '));
console.log('managed events:', after1.length, '| mails:', store.mails.map(m => m.subject).join(' / '));
// 2) idempotent
run('second run (expect no writes)', 'Engine.sync("again")');
// 3) user moves tomorrow's guitar and deletes tomorrow's errands
const tomorrowKey = k => after1.find(x => x.e.extendedProperties.private.key.endsWith(k) && x.e.extendedProperties.private.key > vm.runInContext('Engine.localNow().today', ctx));
const g = tomorrowKey('|x:guitar'), er = tomorrowKey('|x:errands');
if (g) { const ev = store.events[g.calId][g.e.id]; ev.start.dateTime = ev.start.dateTime.replace(/T\d\d:/, 'T17:'); ev.end.dateTime = ev.end.dateTime.replace(/T\d\d:/, 'T18:'); console.log('\nmoved', g.e.extendedProperties.private.key, '→', ev.start.dateTime); }
if (er) { delete store.events[er.calId][er.e.id]; console.log('deleted', er.e.extendedProperties.private.key); }
run('after your edits (expect yours>=1, skippedDeleted>=1, no re-creation)', 'Engine.sync("edits")');
if (g) console.log('guitar still where you put it:', store.events[g.calId][g.e.id].start.dateTime);
if (er) console.log('errands recreated?', managed().some(x => x.e.extendedProperties.private.key === er.e.extendedProperties.private.key));
// 4) White Lotus push-back on the next workout
const feed = JSON.parse(feedJson);
const today = vm.runInContext('Engine.localNow().today', ctx);
const next = feed.days.find(d => d.date > today);
feed.shifts = feed.shifts.concat([next.day]).sort((a, b) => a - b);
const start = new Date(feed.program.start + 'T00:00:00Z').getTime();
for (const d of feed.days) d.date = new Date(start + ((d.day - 1) + feed.shifts.filter(s => s <= d.day).length) * 86400000).toISOString().slice(0, 10);
feed.restDates = [next.date];
feed.program.end = feed.days[feed.days.length - 1].date;
feedOverride = JSON.stringify(feed);
const before = managed().find(x => x.e.extendedProperties.private.key === 'wl:' + next.day);
run('after pushing Day ' + next.day + ' back in White Lotus', 'Engine.sync("pushback")');
const afterWl = managed().find(x => x.e.extendedProperties.private.key === 'wl:' + next.day);
console.log(`Day ${next.day}: ${before.e.start.dateTime} → ${afterWl.e.start.dateTime}`);
console.log('rest-day marker:', managed().some(x => x.e.extendedProperties.private.key === 'rest:' + next.date));
console.log('last mail:', store.mails[store.mails.length - 1].subject, '\n', store.mails[store.mails.length - 1].body.split('\n')[0]);
// 5) check no overlaps among timed managed events per day (excluding transparent ones)
const timed = managed().map(x => x.e).filter(e => e.start.dateTime && e.transparency !== 'transparent').map(e => ({ s: instant(e.start), en: instant(e.end), t: e.summary })).sort((a, b) => a.s - b.s);
let overlaps = 0; for (let i = 1; i < timed.length; i++) if (timed[i].s < timed[i - 1].en) { overlaps++; if (overlaps < 6) console.log('OVERLAP', timed[i - 1].t, '/', timed[i].t, new Date(timed[i].s).toISOString()); }
console.log('\noverlaps:', overlaps, '| largest property:', Math.max(...Object.values(store.props).map(v => v.length)), 'chars');
console.log('\n--- status file ---\n' + store.files.status);

// 6) dry run must not write anything
const snapBefore = JSON.stringify(store.events) + JSON.stringify(store.props);
const mailsBefore = store.mails.length;
const dr = vm.runInContext('Engine.sync("dry run", { simulatePush: true, dryRun: true })', ctx);
console.log('\n== dry run:', JSON.stringify({ simulated: dr.simulated, sample: dr.sample, wouldChange: dr.stats }));
console.log('dry run wrote nothing:', snapBefore === JSON.stringify(store.events) + JSON.stringify(store.props) && store.mails.length === mailsBefore);
