# Time Tracker milestones

## 2026-10-16: version 0.4.1 portable startup feedback

### Implemented

- The Windows portable EXE now shows a small native status window with an animated activity bar before extracting Electron. It says **Unpacking Time Tracker...**, then **Starting Time Tracker...**, and hides when the application window appears.
- Each launch uses its own temporary extraction directory. The launcher waits for the application to exit before cleaning up its files.
- Added a readiness handshake, a guarded adapter for the pinned electron-builder portable template, and a real portable-launch verification command. The Windows GitHub packaging job also runs that check.
- Kept the same application identity, SQLite location, schema, records, and running-timer recovery. Normal startup has no artificial delay; the installer keeps its existing setup behavior.

### Validation completed

- Syntax checks passed. The initial complete source run passed all 19 tests: 8 database, 6 time-calculation, and 5 Electron integration tests.
- The final packaged app passed shell, readiness, weekly-total, and tracking integration tests. Later mini tests failed because native `setAlwaysOnTop(true)` returned false on this desktop. Repeating the test with the previous committed main process and mini test reproduced the same failure; it is not caused by the startup changes. Mini pinning needs a further check on a desktop where Windows permits native pinning.
- The real portable EXE passed visible-window/animation-style, readiness/hiding, isolated SQLite, version, and clean-exit checks. Visually inspected the status window and observed the animation change between frames during an opt-in inspection pause.
- Built both `release/Time Tracker 0.4.1.exe` and `release/Time Tracker Setup 0.4.1.exe`, with product version 0.4.1. No macOS/Linux build or GitHub workflow was triggered.

## 2026-10-16: version 0.4.0 mini stopwatch widget

### Implemented

- Added a **Mini mode** button to the full window's toolbar and an **Exit mini** button on the widget.
- Mini mode resizes the existing native window to approximately 640 × 160 content pixels (4:1), with fixed sizing, a draggable header/footer, and light/dark styling.
- The widget shows the running session's user/project, stopwatch, editable notes, Save notes, Start/Stop, and a tiny current-week project total.
- After Stop, user/project selectors become available and Start creates a new session with a new code. Entering mini from a different selected project follows the actual running session.
- The opt-in **Always on top** checkbox controls native window pinning. Exit turns pinning off and restores the prior position, size, and maximized state. A DPI-rounding correction prevents normal-window size drift after repeated toggles.
- Timer state and unsaved note drafts carry between views; switching modes does not stop or duplicate a session. Closing the widget and reopening recovers the running timer in normal mode, with pinning off.
- Kept the same database path, app identity, relational schema version 2, session recovery, 255-character note limit, and Sunday–Saturday live totals.

### Validation completed

- Syntax checks and all 18 source tests passed: 8 database tests, 6 time-calculation tests, and 4 real Electron integration tests.
- All 4 Electron integration tests also passed against the final packaged Windows v0.4.0 build; both installer and portable launcher report product version 0.4.0.
- The mini integration test verifies native sizing, repeated-toggle bounds stability, native always-on-top, normal/maximized restoration, switching between projects, shared multi-line note drafts, new session IDs, live increments, and recovery after closing a pinned widget.
- Inspected light and dark mini-mode screenshots and checked that widget controls fit without page overflow.

Windows packages are `release/Time Tracker 0.4.0.exe` and `release/Time Tracker Setup 0.4.0.exe`. The GitHub multi-platform workflow was not triggered; macOS and Linux mini-mode behavior remains unverified here.

## 2026-10-16: version 0.3.0 live totals and current week

### Implemented

- Project totals now include elapsed running sessions and refresh every second, both in the tracking summary and the Projects list.
- The right-hand summary emphasizes the selected project's **This week** total and shows the all-time project total below in smaller text.
- Weeks run from Sunday 00:00 through the next Sunday 00:00 in the computer's local timezone, including all of Saturday. The summary displays the week's date range.
- Weekly totals include only the portion of each session within that week, including running sessions that began before Sunday. Week rollover, year boundaries, and daylight-saving changes use local calendar boundaries.
- Confirmed that clock-in and clock-out already store timestamps and display full dates and times including seconds. Added ISO datetime attributes to the displayed timestamps.
- Updated the remove-clock-out confirmation to reflect that reopened time continues to count in live totals.
- Database location, app identity, session records, and schema version 2 remain unchanged. Existing data and running sessions continue to work across the update.

### Validation completed

- Syntax checks passed.
- All 8 database tests, 6 time-calculation tests, and 3 source Electron integration tests passed.
- All 3 Electron integration tests passed against the packaged Windows build.
- Verified live increments, project/user isolation, week-boundary clipping, Sunday rollover, year boundaries, and both Los Angeles daylight-saving transitions.
- Inspected updated light/dark and narrow-window screenshots. The weekly total is larger than the all-time project total.
- Built `release/Time Tracker 0.3.0.exe` and `release/Time Tracker Setup 0.3.0.exe`; both report product version 0.3.0.

The GitHub multi-platform build workflow was not triggered for this milestone. macOS and Linux builds remain unverified here.

## 2026-10-16: Git setup and private GitHub backup

- Installed Git for Windows 2.55.0.windows.5 through Windows Package Manager, with Git Credential Manager 2.9.1.
- Confirmed commit identity: Bryan Colvin (`bryancolvinfilm@gmail.com`). New repositories default to `main`.
- Initialized this project as a local repository on `main` for the version 0.2.0 baseline and project documentation.
- Added `.gitattributes` for consistent source line endings and expanded `.gitignore` to exclude local environment secrets and SQLite journal files.
- Added everyday status, diff, log, commit, and remote setup instructions to README and agent instructions.
- Created the private repository [bryancolvinfilm-bot/time-tracker](https://github.com/bryancolvinfilm-bot/time-tracker) after the user's GitHub browser sign-in.
- Connected `origin` at `https://github.com/bryancolvinfilm-bot/time-tracker.git`; local `main` tracks `origin/main`.
- Created and pushed baseline commit `36637ce` (`Build Time Tracker 0.2.0 with persistent local time tracking`). Verified that remote `main` matched the full local commit hash after that push.
- Repository integrity checks passed; only intended source, tests, assets, configuration, and documentation were tracked. Check `git status`, `git remote -v`, and actual push results when reporting future backup status.
- Git covers project source/history. The live database remains in AppData and is not included in Git backups.

## 2026-10-16: persistent data across application versions

**Agreed requirement:** successive builds and application versions must reuse the same local dataset. Users should be able to add data in version 0.2.0, install or open the next build, and continue with those records.

The database is separate from the executable and build output:

```text
Windows: %APPDATA%\Time Tracker\time-tracker.sqlite
Current account: C:\Users\dev\AppData\Roaming\Time Tracker\time-tracker.sqlite
Runtime: path.join(app.getPath('userData'), 'time-tracker.sqlite')
```

The portable app and installed app use this location for the same Windows account. Changing the EXE filename, compiling again, or incrementing the application version does not select a new database. Settings displays the actual path. Other OS accounts and computers have their own local data.

Future schema changes must migrate existing data in place and preserve unfinished sessions. Keep the application identity and storage location stable. See [AGENTS.md](AGENTS.md) for the ongoing instructions.

## 2026-10-16: version 0.2.0 built and verified

### Implemented

- Add and delete local users.
- Add, rename, and delete projects belonging to a user.
- Select a user and project to start tracking time.
- Persist a unique 64-character session code and clock-in immediately on Start.
- Recover an unfinished session when reopening the app; elapsed time includes time spent closed.
- Stop a session to save clock-out.
- Add and edit optional session notes, limited to 255 characters.
- Delete a whole entry, or remove its clock-out to resume from the original clock-in without changing the session code or notes.
- Enforce one running timer across the app, including at the database level.
- Cascade user/project deletion to all related records, including running sessions.
- Display completed project totals with running time shown separately.
- Preserve light/dark appearance preferences from the 0.1 database.

The database uses shared relational tables: `users`, `projects`, `time_entries`, and `settings`. The schema version is currently 2. Clock-in and clock-out are fields in one entry, so a clock-in cannot be removed while leaving an orphaned clock-out.

### Validation completed

- JavaScript syntax checks passed.
- All 8 database tests passed, covering migration, ownership, session IDs, totals, note constraints, reopening, cascading deletion, and persistence after process exit.
- Both Electron integration tests passed against the source application.
- Both Electron integration tests passed against the packaged Windows application.
- Light/dark and populated tracking screenshots were inspected, including a narrow window.

Desktop tests passed outside the restricted automation sandbox; the app's renderer sandbox remains enabled. The Windows build used the installed Electron runtime.

### Windows artifacts

- Portable launcher: `release/Time Tracker 0.2.0.exe`
- Installer: `release/Time Tracker Setup 0.2.0.exe`
- Unpacked application used for build verification: `release/win-unpacked/Time Tracker.exe`

These are local Windows x64 builds. macOS and Linux packaging configurations exist, but those builds have not been verified here. The current builds are unsigned.

### Current limits and follow-up scope

- Advanced reporting, exports, and manual timestamp editing are not implemented.
- Running notes save when Start, Save notes, or Stop is used; later edits are not automatically saved on every keystroke.
- Removing a historical clock-out includes all elapsed time since that entry's original clock-in and may overlap other saved entries. The confirmation explains this behavior.
- No next feature milestone has been selected yet.

## 2026-10-15: version 0.1.0 foundation

Created the Electron desktop interface, navigation, settings, light/dark appearance, and SQLite preference storage. Windows installer and portable artifacts were built. Timers, users, project management, and time entries were added in version 0.2.0.
