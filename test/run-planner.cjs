// Runs the Life OS planner in Node against seed shifts and a saved White Lotus feed, and prints the plan.
// Usage: node test/run-planner.cjs <feed.json> [today=YYYY-MM-DD] [now=HH:MM]
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', 'apps-script');
const ctx = vm.createContext({ console });
for (const f of ['Config.js', 'Planner.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const { LIFEOS: C, Planner: P } = vm.runInContext('({ LIFEOS, Planner })', ctx);

const feed = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const today = process.argv[3] || '2026-11-22';
const nowMin = P.toMin(process.argv[4] || '12:30');

const shiftsByDate = {};
for (const [date, start, station] of C.shifts.seed) {
  const s = P.toMin(start);
  (shiftsByDate[date] = shiftsByDate[date] || []).push({ start: s, end: s + C.work.shiftHours * 60, station });
}
const knownThrough = C.shifts.seedKnownThrough;
let routineThrough = P.addDays(today, C.routineHorizonDays - 1);
if (knownThrough < routineThrough) routineThrough = knownThrough;

const events = P.plan({ today, nowMin, knownThrough, routineThrough, shiftsByDate, busyByDate: {}, workouts: feed.days, restDates: feed.restDates, keep: {} });

const keys = new Set();
for (const e of events) { if (keys.has(e.key)) throw new Error('duplicate key ' + e.key); keys.add(e.key); }

const byDate = {};
for (const e of events) (byDate[e.date] = byDate[e.date] || []).push(e);
const t = m => P.fmt(m).replace(' AM', 'a').replace(' PM', 'p');
for (let d = today; d <= routineThrough; d = P.addDays(d, 1)) {
  const list = (byDate[d] || []).sort((a, b) => (a.allDay ? -1 : a.start) - (b.allDay ? -1 : b.start));
  console.log(`\n${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][P.weekday(d)]} ${d}`);
  for (const e of list) {
    const when = e.allDay ? 'all day      ' : `${t(e.start).padStart(6)}–${t(e.end).padEnd(6)}`;
    console.log(`  ${when} [${e.cal.padEnd(5)}] ${e.title}${e.reminders.length ? '  ⏰' + e.reminders.join(',') : ''}`);
  }
  // overlap check (ignore all-day, sleep spans, transparent open evening)
  const timed = list.filter(e => !e.allDay).sort((a, b) => a.start - b.start);
  for (let i = 1; i < timed.length; i++) if (timed[i].start < timed[i - 1].end) console.log(`  !! OVERLAP: ${timed[i - 1].title} / ${timed[i].title}`);
}
const later = events.filter(e => e.key.startsWith('wl:') && e.date > routineThrough);
console.log(`\nWorkouts after ${routineThrough} at default times: ${later.length} (last ${later[later.length - 1].date})`);
console.log('Sample later workout:', later[0].date, t(later[0].start), later[0].title, '|', later[0].location);

// Week totals for Mon–Sun after today
const weekStart = P.addDays(today, (8 - P.weekday(today)) % 7 || 7);
const tot = {};
for (const e of events) {
  if (e.allDay || e.date < weekStart || e.date > P.addDays(weekStart, 6) || e.key.endsWith('|sleep')) continue;
  tot[e.cal] = (tot[e.cal] || 0) + (e.end - e.start);
}
console.log(`\nWeek of ${weekStart} (hours):`, Object.entries(tot).map(([k, v]) => `${k} ${(v / 60).toFixed(2)}`).join(' | '));
if (process.argv[5] === '--desc') { const w = events.find(e => e.key === 'wl:26'); console.log('\n--- Day 26 description ---\n' + w.desc); const b = events.find(e => e.key.endsWith('|biz')); console.log('\n--- ' + b.title + ' ---\n' + b.desc); }
