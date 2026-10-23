const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { openStorage } = require('../electron/storage.cjs');

function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'tracker-storage-'));
  let storage = openStorage(directory);
  t.after(() => { storage.close(); rmSync(directory, { recursive: true, force: true }); });
  return { directory, get storage() { return storage; }, reopen() { storage.close(); storage = openStorage(directory); return storage; } };
}
const addUser = (storage, name = 'Alice') => storage.mutate('user:add', { name }).result;
const addProject = (storage, userId, name = 'Website') => storage.mutate('project:add', { userId, name }).result;
const start = (storage, userId, projectId, notes = '') => storage.mutate('timer:start', { userId, projectId, notes }).result;

test('v1 preferences migrate without data loss and remain after reopen', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'tracker-migration-'));
  const database = new DatabaseSync(path.join(directory, 'time-tracker.sqlite'));
  database.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO settings VALUES ('theme', 'dark'); PRAGMA user_version = 1;");
  database.close();
  const storage = openStorage(directory);
  try {
    assert.equal(storage.getTheme(), 'dark');
    assert.deepEqual(storage.snapshot().users, []);
    addProject(storage, addUser(storage));
    const inspect = new DatabaseSync(storage.file);
    assert.equal(inspect.prepare('PRAGMA user_version').get().user_version, 2);
    assert.deepEqual(inspect.prepare('PRAGMA foreign_key_check').all(), []);
    inspect.close();
  } finally { storage.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('projects belong to users, selections persist, and renaming keeps entries', (t) => {
  const f = fixture(t);
  const alice = addUser(f.storage);
  const bob = addUser(f.storage, 'Bob');
  const website = addProject(f.storage, alice, ' Website ');
  const id = start(f.storage, alice, website, 'Initial planning');
  assert.throws(() => f.storage.mutate('selection:set', { userId: bob, projectId: website }), /belonging/);
  assert.throws(() => start(f.storage, bob, website), /belonging/);
  f.storage.mutate('project:rename', { id: website, name: 'New website' });
  const state = f.reopen().snapshot();
  assert.equal(state.projects[0].name, 'New website');
  assert.equal(state.entries[0].id, id);
  assert.equal(state.selectedUserId, alice);
  assert.equal(state.selectedProjectId, website);
});

test('start persists a unique hash; reopen keeps it running; stop adds an exact completed total', (t) => {
  let now = 1_800_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const f = fixture(t);
  const user = addUser(f.storage);
  const project = addProject(f.storage, user);
  const first = start(f.storage, user, project, 'Working');
  assert.match(first, /^[a-f0-9]{64}$/);
  now += 3_723_000;
  let state = f.reopen().snapshot();
  assert.equal(state.entries[0].clock_out, null);
  assert.equal(state.entries[0].clock_in, now - 3_723_000);
  assert.equal(state.projects[0].total_ms, 0);
  f.storage.mutate('timer:stop', { id: first, notes: 'Finished' });
  assert.throws(() => f.storage.mutate('timer:stop', { id: first, notes: '' }), /already stopped/);
  now += 1000;
  const second = start(f.storage, user, project);
  assert.notEqual(first, second);
  now += 65_000;
  f.storage.mutate('timer:stop', { id: second, notes: '' });
  state = f.reopen().snapshot();
  assert.equal(state.projects[0].total_ms, 3_788_000);
  assert.equal(state.projects[0].entry_count, 2);
  assert.equal(state.entries.find((entry) => entry.id === first).notes, 'Finished');
});

test('only one timer can run, including across connections; removing clock-out reuses the original session', (t) => {
  let now = 1_800_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const f = fixture(t);
  const user = addUser(f.storage);
  const project = addProject(f.storage, user);
  const other = addProject(f.storage, user, 'Other');
  const first = start(f.storage, user, project, 'Keep me');
  const secondConnection = openStorage(f.directory);
  try { assert.throws(() => start(secondConnection, user, other), /Stop the running/); }
  finally { secondConnection.close(); }
  now += 60_000;
  f.storage.mutate('timer:stop', { id: first, notes: 'Keep me' });
  const second = start(f.storage, user, other);
  assert.throws(() => f.storage.mutate('entry:reopen', { id: first }), /Stop the running/);
  f.storage.mutate('entry:delete', { id: second });
  const state = f.storage.mutate('entry:reopen', { id: first });
  assert.equal(state.entries[0].id, first);
  assert.equal(state.entries[0].clock_in, 1_800_000_000_000);
  assert.equal(state.entries[0].clock_out, null);
  assert.equal(state.entries[0].notes, 'Keep me');
  assert.equal(state.projects.find((item) => item.id === project).total_ms, 0);
  now += 30_000;
  f.storage.mutate('timer:stop', { id: first, notes: 'Keep me' });
  assert.equal(f.storage.snapshot().projects.find((item) => item.id === project).total_ms, 90_000);
});

test('user and project deletions cascade, preserve unrelated work, and remove active sessions', (t) => {
  const f = fixture(t);
  const alice = addUser(f.storage);
  const bob = addUser(f.storage, 'Bob');
  const one = addProject(f.storage, alice, 'One');
  const two = addProject(f.storage, alice, 'Two');
  const three = addProject(f.storage, bob, 'Three');
  const first = start(f.storage, alice, one);
  f.storage.mutate('timer:stop', { id: first, notes: '' });
  const second = start(f.storage, alice, two);
  f.storage.mutate('timer:stop', { id: second, notes: '' });
  const third = start(f.storage, bob, three);
  let state = f.storage.mutate('project:delete', { id: one });
  assert.equal(state.entries.length, 2);
  assert.ok(!state.entries.some((entry) => entry.id === first));
  state = f.storage.mutate('user:delete', { id: alice });
  assert.deepEqual(state.users.map((user) => user.id), [bob]);
  assert.deepEqual(state.projects.map((project) => project.id), [three]);
  assert.deepEqual(state.entries.map((entry) => entry.id), [third]);
  state = f.storage.mutate('project:delete', { id: three });
  assert.equal(state.entries.length, 0);
  const lastProject = addProject(f.storage, bob, 'Last');
  start(f.storage, bob, lastProject);
  state = f.storage.mutate('user:delete', { id: bob });
  assert.equal(state.entries.length, 0);
  assert.equal(state.projects.length, 0);
});

test('notes enforce 255 characters in the API and SQLite; invalid changes roll back', (t) => {
  const f = fixture(t);
  assert.throws(() => addUser(f.storage, '   '), /name/);
  const user = addUser(f.storage, "<script>alert('x')</script>");
  const project = addProject(f.storage, user);
  assert.throws(() => start(f.storage, user, project, 'x'.repeat(256)), /255/);
  assert.equal(f.storage.snapshot().entries.length, 0);
  const id = start(f.storage, user, project, '🙂'.repeat(255));
  assert.throws(() => f.storage.mutate('entry:notes', { id, notes: null }), /255/);
  assert.throws(() => f.storage.mutate('entry:notes', { id, notes: 'a\0b' }), /255/);
  const direct = new DatabaseSync(f.storage.file);
  try {
    assert.throws(() => direct.prepare('UPDATE time_entries SET notes = ? WHERE id = ?').run('x'.repeat(256), id), /CHECK/);
    assert.throws(() => direct.prepare('INSERT INTO time_entries VALUES (?, ?, ?, NULL, ?)').run('f'.repeat(64), project, Date.now(), ''), /UNIQUE/);
    assert.throws(() => direct.prepare('UPDATE time_entries SET clock_out = clock_in - 1 WHERE id = ?').run(id), /CHECK/);
  } finally { direct.close(); }
  f.storage.mutate('entry:notes', { id, notes: 'Updated notes' });
  assert.equal(f.reopen().snapshot().entries[0].notes, 'Updated notes');
});

test('an entry deletes as a whole pair and completed totals update immediately', (t) => {
  let now = 1_800_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const f = fixture(t);
  const user = addUser(f.storage);
  const project = addProject(f.storage, user);
  const id = start(f.storage, user, project);
  now += 120_000;
  f.storage.mutate('timer:stop', { id, notes: '' });
  assert.throws(() => f.storage.mutate('entry:delete-clock-in', { id }), /Unknown/);
  assert.equal(f.storage.snapshot().projects[0].total_ms, 120_000);
  const state = f.storage.mutate('entry:delete', { id });
  assert.equal(state.entries.length, 0);
  assert.equal(state.projects[0].total_ms, 0);
  assert.equal(state.projects[0].entry_count, 0);
});

test('a session survives process exit without an explicit database close', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'tracker-process-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const child = spawnSync(process.execPath, ['-e', `
    const { openStorage } = require(process.argv[1]);
    const s = openStorage(process.argv[2]);
    const u = s.mutate('user:add', {name:'Alice'}).result;
    const p = s.mutate('project:add', {userId:u,name:'Persistent project'}).result;
    s.mutate('timer:start', {userId:u,projectId:p,notes:'Survives exit'});
    process.exit(0);
  `, path.resolve(__dirname, '../electron/storage.cjs'), directory], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  const storage = openStorage(directory);
  try {
    const state = storage.snapshot();
    assert.equal(state.entries.length, 1);
    assert.equal(state.entries[0].clock_out, null);
    assert.equal(state.entries[0].notes, 'Survives exit');
  } finally { storage.close(); }
});

test('stopped session edits persist exact times and duration while preserving identity, notes, and running work', (t) => {
  let now = 1_800_000_000_123;
  t.mock.method(Date, 'now', () => now);
  const f = fixture(t);
  const user = addUser(f.storage);
  const project = addProject(f.storage, user);
  const id = start(f.storage, user, project, 'Keep these notes');
  now += 60_000;
  f.storage.mutate('timer:stop', { id, notes: 'Keep these notes' });
  const runningId = start(f.storage, user, project, 'Still running');
  const running = { ...f.storage.snapshot().entries.find(entry => entry.id === runningId) };
  const clockIn = now - 5_400_456;
  let state = f.storage.mutate('entry:update', { id, projectId: project, clockIn, clockOut: clockIn + 3_600_789 });
  assert.equal(state.projects[0].total_ms, 3_600_789);
  // Durations may span days and retain millisecond precision; only clock-out changes.
  const durationMs = 100 * 3_600_000 + 12_345;
  state = f.storage.mutate('entry:update', { id, projectId: project, clockIn, durationMs });
  assert.equal(state.projects[0].total_ms, durationMs);
  const reopened = f.reopen().snapshot();
  assert.deepEqual({ ...reopened.entries.find(entry => entry.id === id) }, {
    id, project_id: project, clock_in: clockIn, clock_out: clockIn + durationMs, notes: 'Keep these notes',
  });
  assert.deepEqual({ ...reopened.entries.find(entry => entry.id === runningId) }, running);
  f.storage.mutate('entry:update', { id, projectId: project, clockIn, durationMs: 0 });
  assert.equal(f.storage.snapshot().entries.find(entry => entry.id === id).clock_out, clockIn);
});

test('a stopped session moves only between its owner\'s projects and transfers totals and counts', (t) => {
  let now = 1_800_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const f = fixture(t);
  const alice = addUser(f.storage);
  const source = addProject(f.storage, alice, 'Source');
  const target = addProject(f.storage, alice, 'Correct project');
  const bob = addUser(f.storage, 'Bob');
  const foreign = addProject(f.storage, bob, 'Correct project');
  const id = start(f.storage, alice, source, 'Original notes');
  const clockIn = now;
  now += 90_000;
  f.storage.mutate('timer:stop', { id, notes: 'Original notes' });
  const before = f.storage.snapshot();
  assert.throws(() => f.storage.mutate('entry:update', { id, userId: bob, projectId: foreign, clockIn: now, durationMs: 1 }), /belonging to this session's user/);
  assert.deepEqual(f.storage.snapshot(), before);
  f.storage.mutate('entry:update', { id, projectId: target, clockIn, clockOut: now });
  const state = f.reopen().snapshot();
  const totals = projectId => state.projects.find(project => project.id === projectId);
  assert.equal(totals(source).total_ms, 0);
  assert.equal(totals(source).entry_count, 0);
  assert.equal(totals(target).total_ms, 90_000);
  assert.equal(totals(target).entry_count, 1);
  assert.equal(totals(foreign).total_ms, 0);
  assert.deepEqual({ ...state.entries[0] }, { id, project_id: target, clock_in: clockIn, clock_out: now, notes: 'Original notes' });
});

test('session edits reject running entries, invalid dates and durations, and reversed times atomically', (t) => {
  const f = fixture(t);
  const user = addUser(f.storage);
  const project = addProject(f.storage, user);
  const id = start(f.storage, user, project, 'Preserve me');
  const input = { id, projectId: project, clockIn: Date.now(), clockOut: Date.now() + 1000 };
  assert.throws(() => f.storage.mutate('entry:update', input), /Stop this timer/);
  f.storage.mutate('timer:stop', { id, notes: 'Preserve me' });
  const before = f.storage.snapshot();
  for (const patch of [
    { clockIn: null }, { clockIn: '123' }, { clockIn: 0.5 }, { clockIn: NaN },
    { clockOut: null }, { clockOut: Infinity }, { clockOut: 8_640_000_000_000_001 },
    { clockOut: input.clockIn - 1 }, { projectId: 'missing' },
  ]) {
    assert.throws(() => f.storage.mutate('entry:update', { ...input, ...patch }));
    assert.deepEqual(f.storage.snapshot(), before);
  }
  for (const durationMs of [-1, 1.1, '1000', null, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => f.storage.mutate('entry:update', { id, projectId: project, clockIn: input.clockIn, durationMs }));
    assert.deepEqual(f.storage.snapshot(), before);
  }
  assert.throws(() => f.storage.mutate('entry:update', { ...input, durationMs: 1000 }), /without a separate clock-out/);
  assert.deepEqual(f.reopen().snapshot(), before);
});
