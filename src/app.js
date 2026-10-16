const api = window.timeTracker;
const $ = (selector) => document.querySelector(selector);
const pageNames = { today: 'Track time', users: 'Users', projects: 'Projects', settings: 'Settings' };
let theme = 'light';
let info;
let workspace = { users: [], projects: [], entries: [] };
let selectedUserId = null;
let selectedProjectId = null;
let busy = false;
let ready = false;
let dialogAction;
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
  $('#project-total').textContent = duration(project?.total_ms ?? 0);
  $('#entry-count').textContent = project?.entry_count ?? 0;
  $('#project-live-row').hidden = !trackingSelected;
  $('#running-banner').hidden = !active;
  if (active) {
    const activeProject = workspace.projects.find((item) => item.id === active.project_id);
    const activeUser = workspace.users.find((item) => item.id === activeProject.user_id);
    $('#running-description').textContent = `${activeUser.name} / ${activeProject.name}`;
  }
  renderUsers();
  renderProjects();
  renderEntries();
  tick();
}
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
    details.append(element('h2', '', project.name), element('p', 'tabular', `${duration(project.total_ms)} completed · ${project.entry_count} time entries`));
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
    const clockOut = element('div');
    clockOut.append(element('span', 'field-caption', 'Clock out'), element('time', entry.clock_out === null ? 'running-tag' : '', entry.clock_out === null ? 'Still running' : dateTime(entry.clock_out)));
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
  const active = activeEntry();
  const elapsed = active ? duration(Date.now() - active.clock_in) : '00:00:00';
  $('#running-elapsed').textContent = elapsed;
  $('#project-live').textContent = elapsed;
  $('#timer-display').textContent = active?.project_id === selectedProjectId ? elapsed : '00:00:00';
  document.querySelectorAll('[data-live-start]').forEach((node) => { node.textContent = duration(Date.now() - Number(node.dataset.liveStart)); });
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
$('#timer-form').addEventListener('submit', attempt(async () => {
  const active = activeEntry();
  const notes = $('#timer-notes').value;
  if (active && active.project_id === selectedProjectId) {
    await run('timer:stop', { id: active.id, notes });
    notify('Timer stopped. Your time is saved.');
  } else {
    await run('timer:start', { userId: selectedUserId, projectId: selectedProjectId, notes });
    notify('Timer started and saved. It keeps running if you close the app.');
  }
}));
$('#save-running-notes').addEventListener('click', attempt(async () => {
  const active = activeEntry();
  if (active) await run('entry:notes', { id: active.id, notes: $('#timer-notes').value });
  $('#notes-status').textContent = 'Notes saved';
}));
$('#timer-notes').addEventListener('input', () => {
  if (activeEntry()?.project_id === selectedProjectId) $('#notes-status').textContent = 'Save notes or stop the timer to keep changes.';
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
  } else if (op === 'entry:notes') {
    const entry = workspace.entries.find((item) => item.id === id);
    showDialog({ title: 'Edit session notes', description: 'Up to 255 characters. Leave blank for no notes.', field: 'Notes', value: entry.notes, action: (notes) => run(op, { id, notes }) });
  } else if (op === 'entry:delete') {
    const entry = workspace.entries.find((item) => item.id === id);
    showDialog({ title: 'Delete time entry?', description: entry.clock_out === null ? 'This permanently deletes the running session and its clock-in time. The timer will disappear.' : 'This permanently deletes the clock-in and clock-out pair, its duration, and its notes. The project total will update.', confirm: 'Delete entry', danger: true, action: () => run(op, { id }) });
  } else if (op === 'entry:reopen') {
    const entry = workspace.entries.find((item) => item.id === id);
    showDialog({ title: 'Remove clock-out?', description: `This session will run again from ${dateTime(entry.clock_in)}, including all time since then. Its completed duration leaves the total until you stop it again. It may overlap other saved entries.`, confirm: 'Remove clock-out', action: () => run(op, { id }) });
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
