// Life OS settings. Times are "H:MM" in 24-hour Pacific time. Durations are minutes.
// Change a value here, run `clasp push`, and the next hourly sync re-plans the calendar.

var LIFEOS = {
  version: '1.0.0',
  timeZone: 'America/Los_Angeles',

  // How far ahead to plan. Routine blocks stop at the end of the posted work schedule.
  routineHorizonDays: 14,

  whiteLotus: {
    feedUrl: 'https://white-lotus-training-arc.vercel.app/api/calendar-feed',
    appUrl: 'https://white-lotus-training-arc.vercel.app/',
  },

  // Where shifts come from:
  //   'auto'     — events HotSchedules pushes into Google Calendar ("Link to my Google Calendar") when there are any,
  //                otherwise the saved list below (read from HotSchedules on Nov 22, 2026)
  //   'calendar' — HotSchedules events only;  'seed' — the saved list only
  shifts: {
    source: 'auto',
    calendarId: '',                     // for 'calendar': the calendar HotSchedules writes to ('' = search all of yours)
    match: 'Host/Hostess|HotSchedules|Five Crowns',
    weekEndsOn: 2,                      // HotSchedules weeks run Wed–Tue; 2 = Tuesday
    seedKnownThrough: '2026-12-01',
    seed: [
      // [date, start, station]
      ['2026-11-22', '15:30', 'Takeout'],
      ['2026-11-23', '16:15', 'Runner'],
      ['2026-11-24', '16:00', 'Takeout'],
      ['2026-11-25', '14:00', 'Takeout'],
      ['2026-11-26', '07:00', ''],
      ['2026-11-26', '10:30', ''],
      ['2026-11-27', '15:30', 'SD Host'],
      ['2026-11-28', '15:30', 'SD Host'],
      ['2026-11-30', '13:00', 'Desk'],
      ['2026-12-01', '16:00', 'SD Host'],  // modified Nov 22, 10:13 PM CST (was 4:15 PM)
    ],
  },

  work: {
    employer: 'Five Crowns',
    role: 'Host',
    shiftHours: 5.5,       // HotSchedules lists start times only; Dylan confirmed ~5.5 h
    readyMin: 35,          // get ready + eat before leaving
    driveMin: 25,
  },

  sleep: {
    hours: 8,
    wake: '6:15',          // regular wake-up; later only when a late night would cut sleep below 8 h
    bedtime: '22:15',      // lights out on nights you're not coming home from a late shift
    afterShiftMin: 30,     // from end of shift to asleep (drive home, straight to bed)
    straightToBedAfter: '21:00', // if you'd be asleep after this time anyway, you go straight to bed
  },

  travel: { gym: 5, sand: 25, beach: 25, church: 15 },

  workout: {
    gymStart: '7:00',
    sandStart: '7:30',
    sundayAfterChurch: '10:00',
    refuelMin: 40,
    morningLatestEnd: '13:00',
  },

  church: { weekday: 0, start: '8:30', end: '9:30', title: 'Church' },

  faith: { bibleMin: 20 },

  readMin: 25,

  business: {
    workDayMin: 120,
    saturdayMin: 90,
    offDayMin: 150,
    shortestMin: 60,
    // weekday: 1 = Monday … 6 = Saturday. Sunday has no business block.
    byWeekday: {
      1: { name: 'Prospecting', objective: 'List 15 Orange County businesses with an outdated or missing website.', done: 'Each one has the business, its current site, the owner or best contact, and one specific fix you would pitch.', next: "Feeds tomorrow's outreach session." },
      2: { name: 'Outreach', objective: "Send 8 personalized pitches from your prospect list, then follow up with every open lead and client.", done: '8 pitches sent and every open thread answered. Goal: book 1 call.', next: 'Log replies in your pipeline.' },
      3: { name: 'Client build', objective: 'Ship the next milestone on your top client project and send the client a short progress update.', done: 'The milestone is live or previewable and the update is sent.', next: 'Note the next milestone before you stop.' },
      4: { name: 'Follow-ups & admin', objective: 'Follow up on every proposal or pitch older than 3 days, send any invoices, and bring your pipeline up to date.', done: 'Pipeline current, invoices out, no thread waiting on you.', next: 'Flag anything stuck for Sunday Reset.' },
      5: { name: 'Marketing', objective: 'Turn one finished site into a before/after case study plus 3 social posts, and schedule them.', done: 'Case study published and 3 posts scheduled.', next: 'Share the case study in your next outreach.' },
      6: { name: 'Offer & systems', objective: 'Improve one thing that makes selling easier: your packages and pricing, a proposal template, or one reusable automation (lead capture → CRM → follow-up).', done: 'It is shipped and you would use it on your next lead.', next: 'Write down what to improve next week.' },
    },
  },

  // Small things for the gap before a shift, by weekday (0 = Sunday). Placed only if they fit.
  workDayExtras: {
    0: ['sundayReset'],
    1: ['guitar', 'errands'],
    2: ['beachWalk', 'guitar'],
    3: ['guitar', 'callFamily'],
    4: ['guitar', 'roomReset'],
    5: ['guitar', 'learn'],
    6: ['surf'],
  },

  extras: {
    guitar:      { cal: 'hob', title: '🎸 Guitar practice', min: 25, travel: 0, from: '11:30', to: '18:30', remind: 5, desc: 'Warm up 5 min, then work one song or technique. Short and daily beats long and rare.' },
    errands:     { cal: 'err', title: '🧺 Errands & admin', min: 45, travel: 0, from: '13:00', to: '17:00', remind: 10, desc: 'Bills, mail, appointments, returns, anything with a deadline this week.' },
    beachWalk:   { cal: 'hob', title: '🌴 Walk outside', min: 45, travel: 0, from: '13:00', to: '17:30', remind: 10, desc: 'Beach or neighborhood walk. A learning podcast, or no phone at all.' },
    learn:       { cal: 'dev', title: '📚 Learn something new', min: 45, travel: 0, from: '13:00', to: '17:00', remind: 10, desc: 'One lesson: a course module, a long article, or a skill you want for the business (automation, design, sales).' },
    surf:        { cal: 'hob', title: '🌊 Surf window', min: 90, travel: 25, from: '10:45', to: '14:30', remind: 30, desc: 'Check the forecast first. If it is flat or blown out, take a beach walk instead. Drive about 25 min each way.' },
    callFamily:  { cal: 'soc', title: '📞 Call family', min: 30, travel: 0, from: '18:30', to: '21:30', remind: 10, desc: 'A real catch-up call, not a text.' },
    sundayReset: { cal: 'dev', title: '🧭 Sunday Reset', min: 45, travel: 0, from: '11:00', to: '14:30', remind: 10, desc: '' },
    volleyball:  { cal: 'hob', title: '🏐 Beach volleyball', min: 90, travel: 25, from: '12:30', to: '17:30', remind: 35, desc: 'Play for fun and reps. Drive about 25 min each way.' },
    outdoor:     { cal: 'hob', title: '🌊 Surf, volleyball or somewhere new', min: 120, travel: 25, from: '12:30', to: '17:30', remind: 35, desc: 'Pick one: surf if the forecast is good, beach volleyball, or explore a trail, beach or town you have not been to.' },
    groceries:   { cal: 'err', title: '🛒 Groceries + meal prep', min: 120, travel: 0, from: '13:00', to: '19:00', remind: 15, desc: 'Shop from a list, then prep proteins, carbs and snacks for the work week.' },
    roomReset:   { cal: 'err', title: '🧹 Room reset', min: 30, travel: 0, from: '13:00', to: '20:00', remind: 0, desc: 'Laundry away, desk clear, floor clear. 30 minutes, then stop.' },
    openEvening: { cal: 'soc', title: '❤️ Open evening', min: 90, travel: 0, from: '18:30', to: '22:00', remind: 0, desc: 'Time for your girlfriend, friends or family. No plan required.' },
  },

  sundayResetDesc: [
    'Plan the week in 45 minutes:',
    '1. Check HotSchedules for new or changed shifts.',
    '2. Check White Lotus: are this week\'s workouts where they should be?',
    '3. Business scorecard: leads added, pitches sent, calls booked, $ invoiced.',
    '4. Pick the 3 things that matter most this week.',
    '5. Plan time with your girlfriend, friends and family.',
    '6. Look at what you skipped last week and why.',
  ].join('\n'),

  calendars: {
    fit:   { name: '🏋️ Fitness & Workouts',        color: '#F4511E' },
    work:  { name: '💼 Work Shifts',                color: '#616161' },
    biz:   { name: '🚀 Business Development',       color: '#3F51B5' },
    dev:   { name: '📚 Personal Development',       color: '#0B8043' },
    faith: { name: '✝️ Faith & Spirituality',       color: '#8E24AA' },
    hob:   { name: '🎸 Hobbies & Recreation',       color: '#039BE5' },
    soc:   { name: '❤️ Social & Relationships',     color: '#E67C73' },
    err:   { name: '🧺 Errands & Responsibilities', color: '#F6BF26' },
    rest:  { name: '😴 Rest & Recovery',            color: '#7986CB' },
  },

  footer: '— Life OS. Move or delete this and the sync leaves your change alone.',
};
