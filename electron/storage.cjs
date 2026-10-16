const { DatabaseSync } = require('node:sqlite');
const { mkdirSync } = require('node:fs');
const { randomUUID, randomBytes } = require('node:crypto');
const path = require('node:path');

function nameValue(value) {
  if (typeof value !== 'string' || !value.trim() || [...value.trim()].length > 100 || value.includes('\u0000')) {
    throw new Error('Enter a name between 1 and 100 characters.');
  }
  return value.trim();
}

function notesValue(value) {
  if (typeof value !== 'string' || [...value].length > 255 || value.includes('\u0000')) {
    throw new Error('Notes must be text with at most 255 characters.');
  }
  return value;
}

function openStorage(directory) {
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'time-tracker.sqlite');
  const database = new DatabaseSync(file);
  database.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    BEGIN IMMEDIATE;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS projects_by_user ON projects(user_id);
    CREATE TABLE IF NOT EXISTS time_entries (
      id TEXT PRIMARY KEY CHECK(length(id) = 64),
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      clock_in INTEGER NOT NULL CHECK(typeof(clock_in) = 'integer'),
      clock_out INTEGER CHECK(clock_out IS NULL OR (typeof(clock_out) = 'integer' AND clock_out >= clock_in)),
      notes VARCHAR(255) NOT NULL DEFAULT '' CHECK(length(notes) <= 255 AND instr(notes, char(0)) = 0)
    );
    CREATE INDEX IF NOT EXISTS entries_by_project ON time_entries(project_id, clock_in DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS one_running_timer ON time_entries((1)) WHERE clock_out IS NULL;
    PRAGMA user_version = 2;
    COMMIT;
  `);

  function requireRow(table, id) {
    if (typeof id !== 'string') throw new Error('Invalid record ID.');
    // Table names are constants supplied by this module, never renderer input.
    const row = database.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    if (!row) throw new Error('This record no longer exists. Refresh and try again.');
    return row;
  }
  function transaction(action) {
    database.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      database.exec('COMMIT');
      return result;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
  function ensureStopped() {
    if (database.prepare('SELECT id FROM time_entries WHERE clock_out IS NULL').get()) {
      throw new Error('Stop the running timer before starting or reopening another entry.');
    }
  }
  function snapshot() {
    return transaction(() => ({
      users: database.prepare('SELECT * FROM users ORDER BY name COLLATE NOCASE, id').all(),
      projects: database.prepare(`SELECT projects.*, COALESCE(SUM(CASE WHEN clock_out IS NOT NULL THEN clock_out - clock_in ELSE 0 END), 0) AS total_ms,
        COUNT(time_entries.id) AS entry_count FROM projects LEFT JOIN time_entries ON projects.id = time_entries.project_id
        GROUP BY projects.id ORDER BY projects.name COLLATE NOCASE, projects.id`).all(),
      entries: database.prepare('SELECT * FROM time_entries ORDER BY clock_in DESC, id').all(),
      selectedUserId: database.prepare("SELECT value FROM settings WHERE key = 'selected_user'").get()?.value ?? null,
      selectedProjectId: database.prepare("SELECT value FROM settings WHERE key = 'selected_project'").get()?.value ?? null,
    }));
  }
  function setSetting(key, value) {
    database.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }
  function mutate(operation, input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid request.');
    const result = transaction(() => {
      switch (operation) {
        case 'user:add': {
          const id = randomUUID();
          database.prepare('INSERT INTO users VALUES (?, ?, ?)').run(id, nameValue(input.name), Date.now());
          setSetting('selected_user', id);
          setSetting('selected_project', '');
          return id;
        }
        case 'user:delete':
          requireRow('users', input.id);
          database.prepare('DELETE FROM users WHERE id = ?').run(input.id);
          break;
        case 'project:add': {
          requireRow('users', input.userId);
          const id = randomUUID();
          database.prepare('INSERT INTO projects VALUES (?, ?, ?, ?)').run(id, input.userId, nameValue(input.name), Date.now());
          setSetting('selected_user', input.userId);
          setSetting('selected_project', id);
          return id;
        }
        case 'project:rename':
          requireRow('projects', input.id);
          database.prepare('UPDATE projects SET name = ? WHERE id = ?').run(nameValue(input.name), input.id);
          break;
        case 'project:delete':
          requireRow('projects', input.id);
          database.prepare('DELETE FROM projects WHERE id = ?').run(input.id);
          break;
        case 'selection:set': {
          if (input.userId !== null) requireRow('users', input.userId);
          if (input.projectId !== null) {
            const project = requireRow('projects', input.projectId);
            if (project.user_id !== input.userId) throw new Error('Choose a project belonging to this user.');
          }
          setSetting('selected_user', input.userId ?? '');
          setSetting('selected_project', input.projectId ?? '');
          break;
        }
        case 'timer:start': {
          const project = requireRow('projects', input.projectId);
          if (project.user_id !== input.userId) throw new Error('Choose a project belonging to this user.');
          ensureStopped();
          const id = randomBytes(32).toString('hex');
          database.prepare('INSERT INTO time_entries (id, project_id, clock_in, notes) VALUES (?, ?, ?, ?)')
            .run(id, project.id, Date.now(), notesValue(input.notes));
          setSetting('selected_user', project.user_id);
          setSetting('selected_project', project.id);
          return id;
        }
        case 'timer:stop': {
          const entry = requireRow('time_entries', input.id);
          if (entry.clock_out !== null) throw new Error('This timer has already stopped.');
          database.prepare('UPDATE time_entries SET clock_out = ?, notes = ? WHERE id = ?')
            .run(Math.max(Date.now(), entry.clock_in), notesValue(input.notes), entry.id);
          break;
        }
        case 'entry:notes':
          requireRow('time_entries', input.id);
          database.prepare('UPDATE time_entries SET notes = ? WHERE id = ?').run(notesValue(input.notes), input.id);
          break;
        case 'entry:delete':
          requireRow('time_entries', input.id);
          // Clock-in and clock-out are a single record and can only be deleted together.
          database.prepare('DELETE FROM time_entries WHERE id = ?').run(input.id);
          break;
        case 'entry:reopen': {
          const entry = requireRow('time_entries', input.id);
          ensureStopped();
          database.prepare('UPDATE time_entries SET clock_out = NULL WHERE id = ?').run(entry.id);
          const project = requireRow('projects', entry.project_id);
          setSetting('selected_user', project.user_id);
          setSetting('selected_project', project.id);
          break;
        }
        default: throw new Error('Unknown workspace action.');
      }
      return null;
    });
    return { ...snapshot(), result };
  }
  return {
    file, snapshot, mutate,
    getTheme: () => database.prepare("SELECT value FROM settings WHERE key = 'theme'").get()?.value ?? 'light',
    setTheme: (theme) => {
      if (!['light', 'dark'].includes(theme)) throw new Error('Invalid theme.');
      setSetting('theme', theme);
    },
    close: () => database.close(),
  };
}

module.exports = { openStorage };
