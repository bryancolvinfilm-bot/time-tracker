# Time Tracker

A self-contained Electron desktop app with a local SQLite database. No server, account, network connection, or separately installed database is needed to run the packaged app.

Version 0.2.0 supports local users, their projects, and persistent clock-in / clock-out sessions. Light and dark themes are included.

Project instructions for future agents are in [AGENTS.md](AGENTS.md). Verified progress and the agreement to preserve the same database across versions are recorded in [MILESTONES.md](MILESTONES.md).

## Use the app

1. Open **Users**, enter a name, and choose **Add user**.
2. Choose **View projects** for that user. Enter a project name and choose **Add project**.
3. Choose **Track time**, optionally enter session notes, and choose **Start timer**.
4. Choose **Stop timer** when finished. The project's completed total updates immediately.

The Track time page also lets you switch users and projects. The Projects page lists projects for the selected user, with completed totals and controls to rename or delete them.

Only one timer can run across the app. A running session is saved immediately with a random 64-character hexadecimal session code, its project, its start timestamp, and its notes. Closing or quitting the app does not clock out. Reopening finds the session without a clock-out time and displays elapsed time from its original start, including time spent with the app closed or the computer asleep. No background app process is needed for this behavior.

Notes are optional and limited to 255 characters. Initial notes save with Start. For a running session, use **Save notes** or **Stop timer** to save changes. Use **Edit notes** on any entry to edit its saved notes.

## Entry and deletion controls

- **Delete entry** removes the entire session: clock-in, any clock-out, and notes. Deleting a running session removes that timer.
- **Remove clock-out** keeps the original clock-in, session code, and notes, and makes that session run again from its original start. Stop any other running timer first. Elapsed time includes the whole interval since the original clock-in and can overlap later saved sessions.
- A clock-in cannot be deleted separately from its clock-out. The pair is one SQLite record.
- Deleting a project deletes all of its sessions, including an active one.
- Deleting a user deletes all of their projects and sessions, including an active one.

Destructive actions show a confirmation describing what will be removed. Deletions cannot be undone. Completed project totals sum `clock_out - clock_in` for stopped entries; the running duration appears separately. Durations display as hours, minutes, and seconds, with hours allowed to exceed 24.

## Development

Install Node.js 24 LTS, then run:

```sh
npm ci
npm start
```

This workspace also includes a portable Node runtime under `.tools/` (ignored by Git). If Node is not on PATH, run `./dev.ps1` from PowerShell to use it.

The app uses bundled HTML, CSS, and JavaScript, with no frontend build server. Restart after main-process changes; reload the window after UI changes.

## Git workflow

This project is a local Git repository on the `main` branch. Git for Windows and Git Credential Manager are installed on this development machine. New terminals pick up Git from PATH; restart an already-open terminal or editor if `git` is not recognized. The executable is `C:\Program Files\Git\cmd\git.exe`.

Commit identity is Bryan Colvin (`bryancolvinfilm@gmail.com`). Inspect progress with:

```sh
git status --short --branch
git diff
git log --oneline -10
git remote -v
```

To save a change, stage its intended files and commit. For example:

```sh
git add src/app.js
git diff --cached
git commit -m "Describe the change"
```

The private GitHub backup is [bryancolvinfilm-bot/time-tracker](https://github.com/bryancolvinfilm-bot/time-tracker). The `origin` remote uses `https://github.com/bryancolvinfilm-bot/time-tracker.git`, and local `main` tracks `origin/main`. Upload new commits with:

```sh
git push
```

Git Credential Manager handles GitHub sign-in. Do not place a password or token in the remote URL or project files. A local commit saves version history on this machine; pushing backs those commits up to GitHub. Use `git status --short --branch` to see whether local commits are ahead of the last fetched remote state.

Git tracks source code, tests, icons, configuration, and project documentation. `.gitignore` excludes dependencies, downloaded tools, generated builds, test outputs, local SQLite files, and `.env` secrets. The live SQLite database in AppData is separate from the Git repository and needs its own backup if desired.

## Storage and architecture

- `electron/main.cjs`: window lifecycle, single-instance handling, local asset protocol, and trusted-frame IPC handlers.
- `electron/preload.cjs`: narrow API between the sandboxed UI and the main process. The renderer has no direct Node or SQL access.
- `electron/storage.cjs`: SQLite schema, validation, transactional mutations, saved selections, and completed totals using Node's bundled `node:sqlite`.
- `src/`: bundled interface, styles, scripts, and icons. No remote fonts or assets.

The database has four shared relational tables: `users`, `projects`, `time_entries`, and `settings`. Projects reference a user; time entries reference a project. Foreign keys use `ON DELETE CASCADE`. A unique partial index enforces one entry with a null clock-out across the database, and a SQLite CHECK constraint enforces the 255-character notes limit. Each Start generates a new code using cryptographically random bytes. Timestamps are stored as Unix milliseconds and displayed in the computer's local timezone. Version 0.1 appearance preferences are preserved when the new tables are added.

The database lives at `<Electron userData>/time-tracker.sqlite`, outside the installed application so upgrades preserve data. Its exact location is shown in Settings. Typical parent folders are `%APPDATA%/Time Tracker` on Windows, `~/Library/Application Support/Time Tracker` on macOS, and `~/.config/Time Tracker` on Linux. The writable database deliberately remains in the user's application data directory, including when using the portable EXE.

## Verification

```sh
npm run check
npm test
```

Run suites individually with `npm run test:storage` and `npm run test:desktop`.

Database tests cover migration, ownership, session codes, exact totals, validation, persistence without an explicit close, cascading deletes, and the single-timer constraint across connections. Electron integration tests exercise the real interface and SQLite database, application reopening with a running timer, notes, renaming, deleting entries, removing clock-out, project/user deletion, navigation, renderer isolation, narrow-window overflow, and theme persistence. All test data is isolated in temporary directories.

To verify the built Windows application in PowerShell:

```powershell
$env:TIME_TRACKER_EXECUTABLE = "$PWD/release/win-unpacked/Time Tracker.exe"
npm run test:desktop
Remove-Item Env:TIME_TRACKER_EXECUTABLE
```

Linux desktop testing needs a display or `xvfb-run --auto-servernum npm test`.

## Packaging

```sh
npm run pack        # unpacked app for the current OS
npm run dist:win    # Windows installer and portable EXE
npm run dist:mac    # macOS DMG and ZIP
npm run dist:linux  # Linux AppImage and DEB
```

Artifacts are written to `release/`. Users do not need Node.js or npm installed. Windows version 0.2.0 files are `Time Tracker Setup 0.2.0.exe` (installer) and `Time Tracker 0.2.0.exe` (portable launcher).

One source codebase produces separate applications for each operating system. Build on the target OS for predictable results. The workflow in `.github/workflows/build.yml` uses Windows, macOS, and Linux runners, tests the app, and uploads builds. Run it manually after pushing this project to GitHub, or push a `v*` tag. The workflow builds the architecture of its runner; it does not yet produce every CPU architecture.

Builds are currently unsigned. Signing and macOS notarization can be configured for public distribution. The CI workflow does not publish releases automatically. Advanced reports, manual timestamp editing, and exports are outside this version.
