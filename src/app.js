const api = window.timeTracker;
const { projectTotals } = window.timeTrackerTime;
const $ = (selector) => document.querySelector(selector);
const pageNames = { today: 'Track time', users: 'Users', projects: 'Projects', settings: 'Settings' };
let theme = 'light';
let info;
let workspace = { users: [], projects: [], entries: [] };
let selectedUserId = null;
let selectedProjectId = null;
let busy = false;
let ready = false;
let widgetWindow = { mini: false, alwaysOnTop: false };
let windowBusy = false;
let dialogAction;
let sessionEditor;
let toastTimeout;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function actionButton(label, operation, id, className = 'button secondary') {
  const button = element('button', className, label);
  button.type = 'button';
  button.dataset.op = operation;
  button.dataset.id = id;
  return button;
}
function duration(ms) {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((part) => String(part).padStart(2, '0')).join(':');
}
function dateTime(ms) {
  return new Date(ms).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
const activeEntry = () => workspace.entries.find((entry) => entry.clock_out === null);
const selectedProject = () => workspace.projects.find((project) => project.id === selectedProjectId);
const selectedUser = () => workspace.users.find((user) => user.id === selectedUserId);
const ownProjects = () => workspace.projects.filter((project) => project.user_id === selectedUserId);

function navigate(page) {
  if (!pageNames[page]) page = 'today';
  document.querySelectorAll('.page').forEach((section) => { section.hidden = section.id !== `page-${page}`; });
  document.querySelectorAll('[data-page]').forEach((button) => {
    const active = button.dataset.page === page;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  $('#breadcrumb-page').textContent = pageNames[page];
  $('main').scrollTop = 0;
}
function go(page) {
  window.location.hash = page;
  navigate(page);
}
window.addEventListener('hashchange', () => navigate(window.location.hash.slice(1)));
document.querySelectorAll('[data-page], [data-go]').forEach((button) => button.addEventListener('click', () => go(button.dataset.page || button.dataset.go)));
navigate(window.location.hash.slice(1));

function renderTheme(value) {
  theme = value;
  document.documentElement.dataset.theme = value;
  const toggle = $('#theme-toggle');
  toggle.setAttribute('aria-label', `Switch to ${value === 'light' ? 'dark' : 'light'} theme`);
  toggle.querySelector('use').setAttribute('href', value === 'light' ? '#i-moon' : '#i-sun');
  document.querySelectorAll('[data-theme-choice]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.themeChoice === value)));
}
let savingTheme = false;
async function saveTheme(value) {
  if (savingTheme || !info) return;
  savingTheme = true;
  try { renderTheme(await api.setTheme(value)); }
  catch { notify('Your appearance preference could not be saved. Please try again.'); }
  finally { savingTheme = false; }
}
$('#theme-toggle').addEventListener('click', () => saveTheme(theme === 'light' ? 'dark' : 'light'));
document.querySelectorAll('[data-theme-choice]').forEach((button) => button.addEventListener('click', () => saveTheme(button.dataset.themeChoice)));
function notify(message) {
  if (widgetWindow.mini) { $('#mini-notes-status').textContent = message; return; }
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { $('#toast').hidden = true; }, 6000);
}
function attempt(action, preventDefault = true) {
  return async (event) => {
    if (preventDefault) event?.preventDefault();
    try { await action(event); }
    catch (error) { notify(error.message || 'Unable to save. Please try again.'); }
  };
}
function applyWorkspace(next, recover = false) {
  workspace = next;
  let userId = next.selectedUserId;
  let projectId = next.selectedProjectId;
  const running = activeEntry();
  if (recover && running) {
    projectId = running.project_id;
    userId = next.projects.find((project) => project.id === projectId)?.user_id;
  }
  selectedUserId = next.users.some((user) => user.id === userId) ? userId : next.users[0]?.id ?? null;
  selectedProjectId = ownProjects().some((project) => project.id === projectId) ? projectId : ownProjects()[0]?.id ?? null;
  render();
}
async function run(operation, input) {
  if (!ready) throw new Error('Local storage is not ready. Close and reopen the app to try again.');
  if (busy) throw new Error('Please wait for the current change to finish.');
  busy = true;
  $('main').setAttribute('aria-busy', 'true');
  document.body.classList.add('busy');
  try {
    const response = await api.updateWorkspace(operation, input);
    if (!response.ok) throw new Error(response.error);
    applyWorkspace(response.workspace);
    return response.workspace.result;
  } finally {
    busy = false;
    $('main').setAttribute('aria-busy', 'false');
    document.body.classList.remove('busy');
  }
}
async function select(userId, projectId) {
  await run('selection:set', { userId, projectId });
}
function populateSelect(selectNode, records, selectedId, placeholder) {
  const options = [new Option(placeholder, '')];
  records.forEach((record) => options.push(new Option(record.name, record.id)));
  selectNode.replaceChildren(...options);
  selectNode.value = selectedId ?? '';
  selectNode.disabled = !ready || !records.length;
}
function empty(container, title, description) {
  const wrapper = element('div', 'empty-state');
  wrapper.append(element('h3', '', title), element('p', '', description));
  container.append(wrapper);
}
function render() {
  const user = selectedUser();
  const project = selectedProject();
  const active = activeEntry();
  const trackingSelected = !!active && active.project_id === selectedProjectId;
  populateSelect($('#user-select'), workspace.users, selectedUserId, 'Choose a user');
  populateSelect($('#manager-user-select'), workspace.users, selectedUserId, 'Choose a user');
  populateSelect($('#project-select'), ownProjects(), selectedProjectId, 'Choose a project');
  $('#sidebar-user').textContent = user?.name ?? 'Your workspace';
  $('#user-avatar').textContent = user ? [...user.name][0].toUpperCase() : 'T';
  $('#add-project-button').disabled = !ready || !user;
  $('#project-name').disabled = !ready || !user;
  $('#user-name').disabled = !ready;
  $('#add-user-form button').disabled = !ready;
  $('#enter-mini').disabled = !ready;

  $('#timer-state').textContent = trackingSelected ? 'Running' : 'Ready';
  $('#timer-state').classList.toggle('is-running', trackingSelected);
  $('#timer-caption').textContent = trackingSelected
    ? `Started ${dateTime(active.clock_in)}`
    : active ? 'Another timer is running. Use “Go to timer” above to stop it.'
      : project ? 'Ready when you are.' : user ? 'Add a project in Projects to get started.' : 'Add a user and a project to get started.';
  $('#timer-notes').value = trackingSelected ? active.notes : '';
  $('#timer-notes').disabled = !ready || !project || (!!active && !trackingSelected);
  $('#timer-button').textContent = trackingSelected ? 'Stop timer' : 'Start timer';
  $('#timer-button').classList.toggle('stop-button', trackingSelected);
  $('#timer-button').disabled = !ready || !project || (!!active && !trackingSelected);
  $('#save-running-notes').hidden = !trackingSelected;
  $('#notes-status').textContent = '';
  $('#summary-name').textContent = project?.name ?? 'A place for your work';
  $('#summary-user').textContent = user?.name ?? 'Choose a user and project.';
  $('#entry-count').textContent = project?.entry_count ?? 0;
  $('#running-banner').hidden = !active;
  if (active) {
    const activeProject = workspace.projects.find((item) => item.id === active.project_id);
    const activeUser = workspace.users.find((item) => item.id === activeProject.user_id);
    $('#running-description').textContent = `${activeUser.name} / ${activeProject.name}`;
  }
  renderUsers();
  renderProjects();
  renderEntries();
  renderMini();
  tick();
}

function renderMini() {
  const active = activeEntry();
  const project = active ? workspace.projects.find((item) => item.id === active.project_id) : selectedProject();
  const userId = project?.user_id ?? selectedUserId;
  populateSelect($('#mini-user-select'), workspace.users, userId, 'Choose a user');
  populateSelect($('#mini-project-select'), workspace.projects.filter((item) => item.user_id === userId), project?.id, 'Choose a project');
  if (active) {
    $('#mini-user-select').disabled = true;
    $('#mini-project-select').disabled = true;
  }
  $('#mini-notes').value = $('#timer-notes').value;
  $('#mini-notes').disabled = !ready || !project;
  $('#mini-timer-button').textContent = active ? 'Stop' : 'Start';
  $('#mini-timer-button').classList.toggle('stop-button', !!active);
  $('#mini-timer-button').disabled = !ready || !project;
  $('#mini-save-notes').disabled = !active;
  $('#mini-timer-status').textContent = active ? 'Running' : project ? 'Ready to start' : 'Choose a user and project';
  $('#mini-timer-status').title = active ? `Started ${dateTime(active.clock_in)}` : '';
  $('#mini-notes-status').textContent = 'Saved on your device';
}

function renderWindowState(state) {
  widgetWindow = state;
  document.body.classList.toggle('mini-mode', state.mini);
  $('#mini-widget').hidden = !state.mini;
  $('#mini-always-on-top').checked = state.alwaysOnTop;
  $('#toast').hidden = true;
}

async function changeMiniMode(enabled) {
  if (windowBusy) return;
  windowBusy = true;
  try {
    if (enabled) {
      const active = activeEntry();
      if (active && active.project_id !== selectedProjectId) {
        const project = workspace.projects.find((item) => item.id === active.project_id);
        await select(project.user_id, project.id);
      }
      renderMini();
    }
    renderWindowState(await api.setMiniMode(enabled));
    if (enabled) $('#mini-timer-button').focus();
    else { go('today'); $('#enter-mini').focus(); }
  } finally { windowBusy = false; }
}
$('#enter-mini').addEventListener('click', attempt(() => changeMiniMode(true)));
$('#exit-mini').addEventListener('click', attempt(() => changeMiniMode(false)));
$('#mini-always-on-top').addEventListener('change', attempt(async () => {
  try { renderWindowState(await api.setAlwaysOnTop($('#mini-always-on-top').checked)); }
  catch (error) { renderWindowState(widgetWindow); throw error; }
}));
function renderUsers() {
  const list = $('#users-list');
  list.replaceChildren();
  if (!workspace.users.length) return empty(list, 'Start with a user.', 'Add a name above, then create a project for them.');
  workspace.users.forEach((user) => {
    const projects = workspace.projects.filter((project) => project.user_id === user.id);
    const row = element('article', 'manager-row');
    const details = element('div', 'row-details');
    details.append(element('h2', '', user.name), element('p', '', `${projects.length} ${projects.length === 1 ? 'project' : 'projects'} · ${projects.reduce((total, project) => total + project.entry_count, 0)} time entries`));
    const actions = element('div', 'row-actions');
    if (user.id === selectedUserId) actions.append(element('span', 'selected-tag', 'Selected'));
    actions.append(actionButton('View projects', 'user:select', user.id), actionButton('Delete', 'user:delete', user.id, 'button danger-quiet'));
    row.append(details, actions);
    list.append(row);
  });
}
function renderProjects() {
  const list = $('#projects-list');
  list.replaceChildren();
  const projects = ownProjects();
  if (!selectedUser()) return empty(list, 'Choose a user first.', 'Each project belongs to one local user. Add a user in Users.');
  if (!projects.length) return empty(list, 'Make room for a project.', 'Add a project above, then start tracking time.');
  projects.forEach((project) => {
    const row = element('article', 'manager-row');
    const details = element('div', 'row-details');
    const total = element('p', 'tabular');
    total.dataset.projectTotal = project.id;
    details.append(element('h2', '', project.name), total);
    if (activeEntry()?.project_id === project.id) details.append(element('span', 'running-tag', 'Timer running'));
    const actions = element('div', 'row-actions');
    actions.append(actionButton('Track time', 'project:select', project.id), actionButton('Rename', 'project:rename', project.id), actionButton('Delete', 'project:delete', project.id, 'button danger-quiet'));
    row.append(details, actions);
    list.append(row);
  });
}
function renderEntries() {
  const list = $('#entries-list');
  list.replaceChildren();
  const entries = workspace.entries.filter((entry) => entry.project_id === selectedProjectId);
  if (!entries.length) return empty(list, selectedProject() ? 'Your first session starts here.' : 'Choose a project to see its time.', 'Clock in, focus on your work, and clock out when you are done.');
  entries.forEach((entry) => {
    const row = element('article', 'entry-row');
    row.dataset.entryId = entry.id;
    const fields = element('div', 'entry-fields');
    const clockIn = element('div');
    clockIn.append(element('span', 'field-caption', 'Clock in'), element('time', '', dateTime(entry.clock_in)));
    clockIn.querySelector('time').dateTime = new Date(entry.clock_in).toISOString();
    const clockOut = element('div');
    clockOut.append(element('span', 'field-caption', 'Clock out'), element('time', entry.clock_out === null ? 'running-tag' : '', entry.clock_out === null ? 'Still running' : dateTime(entry.clock_out)));
    if (entry.clock_out !== null) clockOut.querySelector('time').dateTime = new Date(entry.clock_out).toISOString();
    const elapsed = element('div');
    const elapsedValue = element('strong', 'entry-duration tabular', duration((entry.clock_out ?? Date.now()) - entry.clock_in));
    if (entry.clock_out === null) elapsedValue.dataset.liveStart = entry.clock_in;
    elapsed.append(element('span', 'field-caption', 'Duration'), elapsedValue);
    fields.append(clockIn, clockOut, elapsed);
    const notes = element('p', 'entry-notes', entry.notes || 'No notes');
    if (!entry.notes) notes.classList.add('no-notes');
    const footer = element('div', 'entry-footer');
    const code = element('details', 'session-code');
    code.append(element('summary', '', 'Session code'), element('code', '', entry.id));
    const actions = element('div', 'row-actions');
    actions.append(actionButton('Edit notes', 'entry:notes', entry.id));
    if (entry.clock_out !== null) {
      actions.append(actionButton('Edit session', 'entry:update', entry.id));
      const reopen = actionButton('Remove clock-out', 'entry:reopen', entry.id);
      reopen.disabled = !!activeEntry();
      if (reopen.disabled) reopen.title = 'Stop the running timer before reopening an entry.';
      actions.append(reopen);
    }
    actions.append(actionButton('Delete entry', 'entry:delete', entry.id, 'button danger-quiet'));
    footer.append(code, actions);
    row.append(fields, notes, footer);
    list.append(row);
  });
}
function tick() {
  const now = Date.now();
  const active = activeEntry();
  const elapsed = active ? duration(now - active.clock_in) : '00:00:00';
  $('#running-elapsed').textContent = elapsed;
  $('#mini-timer-display').textContent = elapsed;
  $('#timer-display').textContent = active?.project_id === selectedProjectId ? elapsed : '00:00:00';
  const totals = projectTotals(workspace.entries, selectedProjectId, now);
  $('#project-total').textContent = duration(totals.totalMs);
  $('#project-week-total').textContent = duration(totals.weekMs);
  const miniTotals = active && active.project_id !== selectedProjectId ? projectTotals(workspace.entries, active.project_id, now) : totals;
  $('#mini-week-total').textContent = duration(miniTotals.weekMs);
  const weekDateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  $('#project-week-range').textContent = weekDateFormat.formatRange(new Date(totals.week.start), new Date(totals.week.end - 1));
  document.querySelectorAll('[data-project-total]').forEach((node) => {
    const project = workspace.projects.find((item) => item.id === node.dataset.projectTotal);
    const total = projectTotals(workspace.entries, project.id, now);
    node.textContent = `${duration(total.totalMs)} total · ${project.entry_count} time entries`;
  });
  document.querySelectorAll('[data-live-start]').forEach((node) => { node.textContent = duration(now - Number(node.dataset.liveStart)); });
  $('#today-date').textContent = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()).toUpperCase();
}
setInterval(tick, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });

$('#user-select').addEventListener('change', attempt(async (event) => {
  const userId = event.target.value || null;
  const projectId = workspace.projects.find((project) => project.user_id === userId)?.id ?? null;
  await select(userId, projectId);
}));
$('#manager-user-select').addEventListener('change', attempt(async (event) => {
  const userId = event.target.value || null;
  await select(userId, workspace.projects.find((project) => project.user_id === userId)?.id ?? null);
}));
$('#project-select').addEventListener('change', attempt(async (event) => { await select(selectedUserId, event.target.value || null); }));
$('#add-user-form').addEventListener('submit', attempt(async () => {
  await run('user:add', { name: $('#user-name').value });
  $('#add-user-form').reset();
  notify('User added. Open their projects to add a project.');
}));
$('#add-project-form').addEventListener('submit', attempt(async () => {
  await run('project:add', { userId: selectedUserId, name: $('#project-name').value });
  $('#add-project-form').reset();
  notify('Project added. Choose Track time when you are ready.');
}));
async function submitTimer(notes) {
  const active = activeEntry();
  if (active && active.project_id === selectedProjectId) {
    await run('timer:stop', { id: active.id, notes });
    notify('Timer stopped. Your time is saved.');
  } else {
    await run('timer:start', { userId: selectedUserId, projectId: selectedProjectId, notes });
    notify('Timer started and saved. It keeps running if you close the app.');
  }
}
$('#timer-form').addEventListener('submit', attempt(() => submitTimer($('#timer-notes').value)));
$('#mini-timer-form').addEventListener('submit', attempt(() => submitTimer($('#mini-notes').value)));
$('#mini-user-select').addEventListener('change', attempt(async (event) => {
  const userId = event.target.value || null;
  await select(userId, workspace.projects.find((project) => project.user_id === userId)?.id ?? null);
}));
$('#mini-project-select').addEventListener('change', attempt((event) => select(selectedUserId, event.target.value || null)));
$('#mini-save-notes').addEventListener('click', attempt(async () => {
  const active = activeEntry();
  if (active) await run('entry:notes', { id: active.id, notes: $('#mini-notes').value });
  $('#mini-notes-status').textContent = 'Notes saved';
}));
$('#save-running-notes').addEventListener('click', attempt(async () => {
  const active = activeEntry();
  if (active) await run('entry:notes', { id: active.id, notes: $('#timer-notes').value });
  $('#notes-status').textContent = 'Notes saved';
}));
$('#timer-notes').addEventListener('input', () => {
  $('#mini-notes').value = $('#timer-notes').value;
  if (activeEntry()?.project_id === selectedProjectId) $('#notes-status').textContent = 'Save notes or stop the timer to keep changes.';
});
$('#mini-notes').addEventListener('input', () => {
  $('#timer-notes').value = $('#mini-notes').value;
  $('#mini-notes-status').textContent = activeEntry() ? 'Save notes or Stop to keep changes' : 'Notes save when you Start';
});
$('#show-running').addEventListener('click', attempt(async () => {
  const active = activeEntry();
  if (!active) return;
  const project = workspace.projects.find((item) => item.id === active.project_id);
  await select(project.user_id, project.id);
  go('today');
}));

function showDialog({ title, description, confirm = 'Save', danger = false, field, value = '', maxLength = 255, action }) {
  if (busy || !ready) return;
  dialogAction = action;
  $('#dialog-title').textContent = title;
  $('#dialog-description').textContent = description;
  $('#dialog-confirm').textContent = confirm;
  $('#dialog-confirm').className = danger ? 'button danger' : 'button primary';
  $('#dialog-label').hidden = !field;
  $('#dialog-field-name').textContent = field ?? '';
  $('#dialog-value').value = value;
  $('#dialog-value').maxLength = maxLength;
  $('#dialog-value').required = field === 'Project name';
  $('#dialog-error').hidden = true;
  $('#action-dialog').showModal();
  if (field) $('#dialog-value').focus();
  else $('#dialog-cancel').focus();
}
$('#dialog-cancel').addEventListener('click', () => $('#action-dialog').close());
$('#dialog-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;
  $('#dialog-confirm').disabled = true;
  try {
    await dialogAction($('#dialog-value').value);
    $('#action-dialog').close();
  } catch (error) {
    $('#dialog-error').textContent = error.message;
    $('#dialog-error').hidden = false;
  } finally { $('#dialog-confirm').disabled = false; }
});

function localDateTime(ms) {
  const date = new Date(ms);
  if (!Number.isFinite(date.getTime())) return '';
  const pad = (value, width = 2) => String(value).padStart(width, '0');
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}
function readSessionTime(selector, original) {
  const value = $(selector).value;
  const parts = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
  if (!parts) return NaN;
  const normalized = `${parts[1]}:${parts[2] ?? '00'}.${(parts[3] ?? '').padEnd(3, '0')}`;
  // Preserve the exact timestamp, including the later occurrence of a repeated DST hour.
  if (normalized === localDateTime(original)) return original;
  const ms = new Date(value).getTime();
  // A nonexistent local time during a spring DST jump must not silently change.
  return normalized === localDateTime(ms) ? ms : NaN;
}
function editableDuration(ms) {
  return duration(ms) + (ms % 1000 ? `.${String(ms % 1000).padStart(3, '0')}` : '');
}
function readSessionDuration() {
  const parts = /^(\d+):([0-5]\d):([0-5]\d)(?:\.(\d{1,3}))?$/.exec($('#session-duration').value.trim());
  if (!parts) return NaN;
  const ms = (Number(parts[1]) * 3600 + Number(parts[2]) * 60 + Number(parts[3])) * 1000 + Number((parts[4] ?? '').padEnd(3, '0'));
  return Number.isSafeInteger(ms) ? ms : NaN;
}
function syncSessionTimes(useDuration) {
  if (!sessionEditor) return;
  sessionEditor.useDuration = useDuration;
  const clockIn = readSessionTime('#session-clock-in', sessionEditor.clockIn);
  if (Number.isFinite(clockIn)) sessionEditor.clockIn = clockIn;
  if (useDuration) {
    const ms = readSessionDuration();
    $('#session-clock-out').value = Number.isFinite(clockIn) && Number.isFinite(ms) ? localDateTime(clockIn + ms) : '';
    if ($('#session-clock-out').value) sessionEditor.clockOut = clockIn + ms;
  } else {
    const clockOut = readSessionTime('#session-clock-out', sessionEditor.clockOut);
    if (Number.isFinite(clockOut)) sessionEditor.clockOut = clockOut;
    $('#session-duration').value = Number.isFinite(clockIn) && Number.isFinite(clockOut) && clockOut >= clockIn ? editableDuration(clockOut - clockIn) : '';
  }
}
function showSessionEditor(entry) {
  if (entry.clock_out === null) return;
  sessionEditor = { entry, clockIn: entry.clock_in, clockOut: entry.clock_out, useDuration: false };
  const project = workspace.projects.find((item) => item.id === entry.project_id);
  populateSelect($('#session-project'), workspace.projects.filter((item) => item.user_id === project.user_id), entry.project_id, 'Choose a project');
  $('#session-clock-in').value = localDateTime(entry.clock_in);
  $('#session-clock-out').value = localDateTime(entry.clock_out);
  $('#session-duration').value = editableDuration(entry.clock_out - entry.clock_in);
  $('#session-error').hidden = true;
  $('#session-dialog').showModal();
  $('#session-project').focus();
}
$('#session-clock-in').addEventListener('input', () => syncSessionTimes(false));
$('#session-clock-out').addEventListener('input', () => syncSessionTimes(false));
$('#session-duration').addEventListener('input', () => syncSessionTimes(true));
$('#session-cancel').addEventListener('click', () => $('#session-dialog').close());
$('#session-dialog').addEventListener('close', () => { sessionEditor = null; });
$('#session-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy || !sessionEditor) return;
  $('#session-save').disabled = true;
  try {
    const { entry, useDuration } = sessionEditor;
    const clockIn = readSessionTime('#session-clock-in', sessionEditor.clockIn);
    if (!Number.isFinite(clockIn)) throw new Error('Enter a valid local clock-in date and time.');
    const input = { id: entry.id, projectId: $('#session-project').value, clockIn };
    if (!input.projectId) throw new Error('Choose a project for this session.');
    if (useDuration) {
      input.durationMs = readSessionDuration();
      if (!Number.isFinite(input.durationMs)) throw new Error('Enter duration as hours:minutes:seconds, for example 01:30:00.');
    } else {
      input.clockOut = readSessionTime('#session-clock-out', sessionEditor.clockOut);
      if (!Number.isFinite(input.clockOut)) throw new Error('Enter a valid local clock-out date and time.');
    }
    await run('entry:update', input);
    $('#session-dialog').close();
    const project = workspace.projects.find((item) => item.id === input.projectId);
    notify(`Session saved to ${project.name}. Totals updated.`);
  } catch (error) {
    $('#session-error').textContent = error.message;
    $('#session-error').hidden = false;
  } finally { $('#session-save').disabled = false; }
});
document.addEventListener('click', attempt(async (event) => {
  const button = event.target.closest('[data-op]');
  if (!button || button.disabled || busy || !ready) return;
  const { op, id } = button.dataset;
  if (op === 'user:select') {
    await select(id, workspace.projects.find((project) => project.user_id === id)?.id ?? null);
    go('projects');
  } else if (op === 'project:select') {
    const project = workspace.projects.find((item) => item.id === id);
    await select(project.user_id, id);
    go('today');
  } else if (op === 'user:delete') {
    const user = workspace.users.find((item) => item.id === id);
    const projects = workspace.projects.filter((project) => project.user_id === id);
    const count = projects.reduce((total, project) => total + project.entry_count, 0);
    showDialog({ title: `Delete ${user.name}?`, description: `This permanently deletes this user, all ${projects.length} of their projects, and ${count} time entries, including any running timer. This cannot be undone.`, confirm: 'Delete user', danger: true, action: () => run(op, { id }) });
  } else if (op === 'project:delete') {
    const project = workspace.projects.find((item) => item.id === id);
    showDialog({ title: `Delete ${project.name}?`, description: `This permanently deletes the project and all ${project.entry_count} of its time entries, including any running timer. This cannot be undone.`, confirm: 'Delete project', danger: true, action: () => run(op, { id }) });
  } else if (op === 'project:rename') {
    const project = workspace.projects.find((item) => item.id === id);
    showDialog({ title: 'Rename project', description: 'Time entries stay with this project.', field: 'Project name', value: project.name, maxLength: 100, action: (name) => run(op, { id, name }) });
  } else if (op === 'entry:update') {
    showSessionEditor(workspace.entries.find((item) => item.id === id));
  } else if (op === 'entry:notes') {
    const entry = workspace.entries.find((item) => item.id === id);
    showDialog({ title: 'Edit session notes', description: 'Up to 255 characters. Leave blank for no notes.', field: 'Notes', value: entry.notes, action: (notes) => run(op, { id, notes }) });
  } else if (op === 'entry:delete') {
    const entry = workspace.entries.find((item) => item.id === id);
    showDialog({ title: 'Delete time entry?', description: entry.clock_out === null ? 'This permanently deletes the running session and its clock-in time. The timer will disappear.' : 'This permanently deletes the clock-in and clock-out pair, its duration, and its notes. The project total will update.', confirm: 'Delete entry', danger: true, action: () => run(op, { id }) });
  } else if (op === 'entry:reopen') {
    const entry = workspace.entries.find((item) => item.id === id);
    showDialog({ title: 'Remove clock-out?', description: `This session will run again from ${dateTime(entry.clock_in)}, including all time since then. Project and weekly totals will include that running time. It may overlap other saved entries.`, confirm: 'Remove clock-out', action: () => run(op, { id }) });
  }
}, false));

async function initialize() {
  render();
  try {
    if (!api) throw new Error('Desktop bridge is unavailable');
    document.body.dataset.platform = api.platform;
    info = await api.getAppInfo();
    renderTheme(info.theme);
    const snapshot = await api.getWorkspace();
    ready = true;
    applyWorkspace(snapshot, true);
    renderWindowState(await api.getWindowState());
    if (activeEntry()) go('today');
    $('#storage-status').textContent = 'Saved on your device · SQLite connected';
    $('#database-path').textContent = info.storage.path;
    $('#database-badge').textContent = 'Connected';
    $('#app-version').textContent = `v${info.version}`;
  } catch {
    $('#storage-status').textContent = 'Local storage unavailable';
    $('#database-path').textContent = 'Unable to connect to the desktop application.';
    $('#database-badge').textContent = 'Unavailable';
    notify('Local storage could not be connected. Close and reopen Time Tracker to try again.');
  }
}
initialize();
