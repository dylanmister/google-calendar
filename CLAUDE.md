# Life OS — notes for Claude

Dylan's Google Calendar engine: a Google Apps Script (`apps-script/`) that plans his days around Five Crowns
shifts (HotSchedules) and his White Lotus Training Arc workouts, every hour and whenever his calendar changes.
Read `README.md` first. Dylan often asks for changes from his phone, so finish them end to end.

## How a change goes live

1. Edit the files (usually `apps-script/Config.js`).
2. Run the checks:
   ```
   for f in apps-script/*.js; do node --check "$f"; done
   node test/run-planner.cjs test/fixtures/feed-sample.json 2026-11-22 12:40
   ```
   `run-planner` prints the planned days; read the output and make sure the change did what was asked.
   `test/sim-engine.cjs` (same fixture argument) exercises the whole sync against a fake Google Calendar.
3. Commit and get it onto `main`. The `Deploy Life OS to Apps Script` GitHub Action checks it and runs
   `clasp push`. The next sync (within the hour, or sooner if his calendar changes) applies it.
   If Dylan asked for the change to go live, merge to `main`; otherwise open a PR he can merge from his phone.

## One-off days ("tomorrow I'm doing X")

Add an entry to `dayOverrides` in `apps-script/Config.js`, keyed by date. It can set that morning's wake-up
(the night before gets a full 8 h before it), add fixed blocks with drive time, pin exact start times (`at`),
shorten the business block, and skip items for that day only. Everything else is planned around it by the
normal rules. Never move a White Lotus workout to another day; pin it to a different time with `at.workout`
instead, and remind Dylan he can push it back in the app. Delete past entries when you add new ones.

## Rules

- Never commit `apps-script/Secrets.js` (it is git-ignored; CI writes it from the `FEED_TOKEN` secret).
- The engine must only write to its own 9 calendars and must never edit or delete Dylan's other events.
- White Lotus is the source of truth for workouts. Never change which workout is on which day, swap exercises,
  or add lifting sessions. Push-backs happen in the White Lotus app; the calendar follows.
- HotSchedules is the source of truth for shifts. With `shifts.source: 'auto'`, shifts come from the
  "Hotschedules: …" events HotSchedules writes into his main calendar (start time only; 5.5 h assumed).
  The `seed` list in `Config.js` is only a fallback if that link ever breaks.
- Keep `Planner.js` free of Google services so it stays testable in Node.
- Times in `Config.js` are 24-hour "H:MM", Pacific.

## His settings (from Nov 22, 2026)

- 8 hours of sleep; regular wake 6:15; asleep 30 min after a late shift ends.
- Drives: work 25 min, gym 5 min, sand court 25 min. Church Sundays 8:30–9:30.
- Business (HyperWebDesign) 8–12 h/week, revenue work first; objectives by weekday in `Config.js`.
- Preferred workout window 7:00–9:30 AM.
