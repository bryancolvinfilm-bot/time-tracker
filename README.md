# Time Tracker

A self-contained Electron desktop app with a local SQLite database. No server, account, network connection, or separately installed database is needed to run the packaged app.

Version 0.4.0 supports local users, projects, persistent sessions, live weekly totals, and a compact mini stopwatch window. Light and dark themes are included.

Project instructions for future agents are in [AGENTS.md](AGENTS.md). Verified progress and the agreement to preserve the same database across versions are recorded in [MILESTONES.md](MILESTONES.md).

## Use the app

1. Open **Users**, enter a name, and choose **Add user**.
2. Choose **View projects** for that user. Enter a project name and choose **Add project**.
3. Choose **Track time**, optionally enter session notes, and choose **Start timer**.
4. Choose **Stop timer** when finished to save the clock-out timestamp. Project and weekly totals include the session while it runs and retain its duration after stopping.

The Track time page also lets you switch users and projects. Its right-hand summary emphasizes **This week**, with the all-time **Project total** below in smaller text. The Projects page lists projects for the selected user, with live totals and controls to rename or delete them.

Both totals include running sessions and update every second. This week means Sunday at midnight through the following Sunday at midnight, including all of Saturday, in the computer's local timezone. Sessions crossing a week boundary contribute only the time inside that week. Calendar boundaries account for daylight-saving changes. The displayed date range identifies the current Sunday–Saturday week. Each saved clock-in and clock-out displays its date and time, including seconds.

Only one timer can run across the app. A running session is saved immediately with a random 64-character hexadecimal session code, its project, its start timestamp, and its notes. Closing or quitting the app does not clock out. Reopening finds the session without a clock-out time and displays elapsed time from its original start, including time spent with the app closed or the computer asleep. No background app process is needed for this behavior.

Notes are optional and limited to 255 characters. Initial notes save with Start. For a running session, use **Save notes** or **Stop timer** to save changes. Use **Edit notes** on any entry to edit its saved notes.

## Mini mode

Choose **Mini mode** in the upper-right toolbar to shrink the actual application window into an approximately 640 × 160 horizontal widget. It shows the current user and project, the live stopwatch, editable notes, Start/Stop, Save notes, and a small current-week total at the bottom.

If a timer is running, the widget follows that session even when a different project was selected in the full view. Stop it before switching the widget's user/project selectors; then enter notes and choose Start to create a new session. Timer state and note drafts are shared between the full and mini views. Use Save notes or Stop to save edits, with the same 255-character limit as the full view.

Check **Always on top** to pin the widget above other windows. **Exit mini** restores the normal window's previous size, position, and maximized state, and turns off pinning. Drag the mini header or footer to move the widget. Switching modes does not stop a session. Closing and reopening still recovers a running session; the app starts in normal mode with pinning off.

## Entry and deletion controls

- **Delete entry** removes the entire session: clock-in, any clock-out, and notes. Deleting a running session removes that timer.
- **Remove clock-out** keeps the original clock-in, session code, and notes, and makes that session run again from its original start. Stop any other running timer first. Elapsed time includes the whole interval since the original clock-in and can overlap later saved sessions.
- A clock-in cannot be deleted separately from its clock-out. The pair is one SQLite record.
- Deleting a project deletes all of its sessions, including an active one.
- Deleting a user deletes all of their projects and sessions, including an active one.

Destructive actions show a confirmation describing what will be removed. Deletions cannot be undone. Project totals sum `clock_out - clock_in` for stopped entries plus elapsed time for the running entry. Weekly totals clip those same intervals to the current week. Durations display as hours, minutes, and seconds, with hours allowed to exceed 24.

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
- `src/time-utils.js`: shared, tested calculations for live project totals and local Sunday–Saturday weeks. These summaries are computed from existing timestamps; versions 0.3.0 and 0.4.0 need no database migration.

The database has four shared relational tables: `users`, `projects`, `time_entries`, and `settings`. Projects reference a user; time entries reference a project. Foreign keys use `ON DELETE CASCADE`. A unique partial index enforces one entry with a null clock-out across the database, and a SQLite CHECK constraint enforces the 255-character notes limit. Each Start generates a new code using cryptographically random bytes. Timestamps are stored as Unix milliseconds and displayed in the computer's local timezone. Version 0.1 appearance preferences are preserved when the new tables are added.

The database lives at `<Electron userData>/time-tracker.sqlite`, outside the installed application so upgrades preserve data. Its exact location is shown in Settings. Typical parent folders are `%APPDATA%/Time Tracker` on Windows, `~/Library/Application Support/Time Tracker` on macOS, and `~/.config/Time Tracker` on Linux. The writable database deliberately remains in the user's application data directory, including when using the portable EXE.

## Verification

```sh
npm run check
npm test
```

Run suites individually with `npm run test:storage`, `npm run test:time`, and `npm run test:desktop`.

Database tests cover migration, ownership, session codes, exact totals, validation, persistence without an explicit close, cascading deletes, and the single-timer constraint across connections. Time-calculation tests cover running sessions, week boundaries, Sunday rollover, year boundaries, and spring/fall daylight-saving changes. Electron integration tests exercise the real interface, SQLite database, live weekly summaries, dated clock stamps, mini window sizing and native pinning, normal/maximized restoration, shared notes, reopening with a running timer, project/user management, renderer isolation, narrow-window overflow, and theme persistence. All test data is isolated in temporary directories.

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

Artifacts are written to `release/`. Users do not need Node.js or npm installed. Windows version 0.4.0 files are `Time Tracker Setup 0.4.0.exe` (installer) and `Time Tracker 0.4.0.exe` (portable launcher).

One source codebase produces separate applications for each operating system. Build on the target OS for predictable results. The workflow in `.github/workflows/build.yml` uses Windows, macOS, and Linux runners, tests the app, and uploads builds. Run it manually after pushing this project to GitHub, or push a `v*` tag. The workflow builds the architecture of its runner; it does not yet produce every CPU architecture.

Builds are currently unsigned. Signing and macOS notarization can be configured for public distribution. The CI workflow does not publish releases automatically. Advanced reports, manual timestamp editing, and exports are outside this version.
