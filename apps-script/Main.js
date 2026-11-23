// Entry points. Run setup() once from the Apps Script editor; after that, triggers do the work.

function setup() {
  ensureTriggers_();
  var s = runSync_('setup');
  console.log(JSON.stringify(s && s.stats));
}

function syncNow() {
  var s = runSync_('manual');
  console.log(JSON.stringify(s && { stats: s.stats, changes: s.changes, conflicts: s.conflicts, errors: s.errors }));
}

// Private web page (only your Google account can open it): ?action=setup | sync | status
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'status';
  var head = '';
  if (action === 'setup') { setup(); head = 'Life OS setup ran.\n\n'; }
  else if (action === 'sync') { runSync_('web'); head = 'Life OS synced.\n\n'; }
  else if (action === 'dryrun-push') {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) return ContentService.createTextOutput('A sync is running; try again in a minute.');
    try {
      var r = Engine.sync('dry run', { simulatePush: true, dryRun: true });
      return ContentService.createTextOutput('DRY RUN (nothing was changed)\n\n' + JSON.stringify({ simulated: r.simulated, sample: r.sample, wouldChange: r.stats, errors: r.errors }, null, 2));
    } finally { lock.releaseLock(); }
  }
  var text = PropertiesService.getScriptProperties().getProperty('statusText') || 'Life OS has not synced yet.';
  return ContentService.createTextOutput(head + text);
}

function hourlySync() { runSync_('hourly'); }
function onCalendarChange() { runSync_('calendar change'); }

// Stops all automatic syncing. Your calendars and events stay as they are.
function pauseLifeOS() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
}

// Brings back a category calendar you deleted (for example 'hob'); the next sync recreates it.
function enableCategory(key) { PropertiesService.getScriptProperties().deleteProperty('cal:' + key); }

function ensureTriggers_() {
  var email = Session.getEffectiveUser().getEmail();
  var want = [{ fn: 'hourlySync', type: 'CLOCK', source: '' }, { fn: 'onCalendarChange', type: 'ON_EVENT_UPDATED', source: email }];
  var hs = LIFEOS.shifts;
  if (hs.source === 'calendar' && hs.calendarId && hs.calendarId !== email) want.push({ fn: 'onCalendarChange', type: 'ON_EVENT_UPDATED', source: hs.calendarId });
  var have = ScriptApp.getProjectTriggers();
  want.forEach(function (w) {
    var exists = have.some(function (t) {
      return t.getHandlerFunction() === w.fn && String(t.getEventType()) === w.type && (!w.source || t.getTriggerSourceId() === w.source);
    });
    if (exists) return;
    if (w.type === 'CLOCK') ScriptApp.newTrigger(w.fn).timeBased().everyHours(1).create();
    else ScriptApp.newTrigger(w.fn).forUserCalendar(w.source).onEventUpdated().create();
  });
}

function runSync_(reason) {
  var props = PropertiesService.getScriptProperties();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) { props.setProperty('rerun', '1'); return null; } // a sync is running; it will go again
  try {
    if (reason !== 'setup') ensureTriggers_();
    var result, n = 0;
    do {
      props.deleteProperty('rerun');
      result = Engine.sync(reason);
      n++;
    } while (props.getProperty('rerun') && n < 2);
    return result;
  } catch (e) {
    Notify.failure(reason, e);
    throw e;
  } finally {
    lock.releaseLock();
  }
}
