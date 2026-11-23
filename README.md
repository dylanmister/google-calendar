# Life OS

Dylan's Google Calendar, kept in step with HotSchedules (work), White Lotus (training) and a weekly routine
(faith, business, reading, guitar, surf, volleyball, people, chores, 8 hours of sleep).

It runs as a Google Apps Script in Dylan's Google account: every hour and whenever the main
Google Calendar changes. Nothing here needs a computer to be on.

## How it works

```
HotSchedules ──("Link to my Google Calendar" → "Hotschedules: …" events)──┐
White Lotus app ──(GET /api/calendar-feed, bearer token)───────────────────┼─► Planner ─► 9 Life OS calendars
Your own Google Calendar events (treated as busy) ──────────────────────────┘
```

- **White Lotus is the source of truth for training.** Day N lands on `start + (N - 1) + push-backs at or before N`,
  checked against the app's own calendar for all 164 days. Push a day back in the app and every later workout moves.
- **Shifts** come from HotSchedules' own Google Calendar link (linked Nov 22, 2026): it writes a 5-minute
  "Hotschedules: Host/Hostess Rest 505 Host Desk <station>" event at each shift start into the main calendar.
  `shifts.source: 'auto'` uses those, and falls back to the saved `seed` list only if none are found. A new,
  moved or canceled shift re-plans the day within minutes (calendar-change trigger) and emails you.
  HotSchedules only lists start times, so shifts are 5.5 hours; you're asleep 30 minutes after a late shift ends.
- **Routine blocks** are planned 14 days ahead, but never past the last posted work week. Workouts are on the
  calendar all the way to the end of the arc.
- **It only writes to its own calendars** (🏋️ Fitness, 💼 Work, 🚀 Business, 📚 Personal Development, ✝️ Faith,
  🎸 Hobbies, ❤️ Social, 🧺 Errands, 😴 Rest). Every event carries private properties so it updates in place.
- **Your changes win.** Move, edit or delete a Life OS event and the sync leaves it alone (it won't recreate a
  deleted one). A White Lotus push-back still moves the workout it belongs to.
- **Emails** go to you when a shift changes, a new HotSchedules week appears, White Lotus moves workouts, or a
  workout has no room. A "Life OS — Sync Status" text file in Google Drive shows the last successful sync.

## Files

| File | What it does |
|---|---|
| `apps-script/Config.js` | Every setting: wake time, sleep hours, drive times, business rotation, extras, calendar colors |
| `apps-script/Planner.js` | Pure planning logic (no Google calls), testable in Node |
| `apps-script/Engine.js` | Reads sources, reconciles events, never touches non-Life OS calendars |
| `apps-script/Notify.js` | Change emails, failure alert after 6 h, Drive status file |
| `apps-script/Main.js` | `setup()`, `syncNow()`, triggers, `pauseLifeOS()`, `enableCategory(key)` |
| `apps-script/Secrets.js` | White Lotus feed token. **Private; git-ignored.** Matches the `CALENDAR_FEED_TOKEN` Vercel secret |
| `test/run-planner.cjs` | Prints the planned days: `node test/run-planner.cjs test/fixtures/feed-sample.json 2026-11-22 12:40` |
| `test/sim-engine.cjs` | Full sync against a fake Google Calendar (first run, re-run, your edits, a push-back, a dry run): `node test/sim-engine.cjs test/fixtures/feed-sample.json` |
| `test/fixtures/feed-sample.json` | A White Lotus feed snapshot from Nov 22, 2026 for the tests |
| `CLAUDE.md` | How Claude should make and ship changes (including from your phone) |
| `.github/workflows/deploy.yml` | Checks the code and runs `clasp push` on every push to `main` |

The workout feed lives in the White Lotus repo (`C:\Users\dylan\dev\claude calendar build\api\calendar-feed.js`).

## Deploying

Pushing to `main` runs the **Deploy Life OS to Apps Script** GitHub Action: it checks the code and runs
`clasp push`. The next hourly run (or any change to your calendar) applies it. From this computer,
`clasp push` does the same thing directly.

The Action needs two repository secrets (Settings → Secrets and variables → Actions), set once:

- `CLASPRC_JSON`: the contents of `~/.clasprc.json` (your clasp sign-in)
- `FEED_TOKEN`: the White Lotus feed token (same value as the `CALENDAR_FEED_TOKEN` Vercel secret)

Without them the Action still checks the code but skips the deploy, with a warning.

## Common changes

Edit `apps-script/Config.js` and push to `main`.

- **Different wake time / sleep target:** `sleep.wake`, `sleep.hours`, `sleep.bedtime`.
- **Business focus by weekday:** `business.byWeekday`.
- **Stop everything:** run `pauseLifeOS()`; your calendars stay as they are.
