# Time Tracker: instructions for future agents

Read [README.md](README.md) for usage and architecture and [MILESTONES.md](MILESTONES.md) for the last verified milestone. Keep this file focused on ongoing requirements; record completed work in the milestone log.

## Preserve the user's local data across versions

The user explicitly wants successive builds and versions to connect to the same local dataset. This is a product requirement.

- Store the database at `path.join(app.getPath('userData'), 'time-tracker.sqlite')`.
- Keep `app.setName('Time Tracker')`, the product name `Time Tracker`, and app ID `app.timetracker.desktop` stable. If an identity or storage-path change is ever necessary, migrate the existing data rather than silently starting with an empty database.
- On Windows, the normal location is `%APPDATA%\Time Tracker\time-tracker.sqlite`. On the current development account it is `C:\Users\dev\AppData\Roaming\Time Tracker\time-tracker.sqlite`. Resolve the path at runtime; do not hardcode this account's absolute path.
- The installer and portable EXE use the same database for the same OS account. The database stays outside the application directory, source tree, and `release/` output.
- Do not put the app version in the database filename or directory. Rebuilding, replacing the EXE, or upgrading the application must preserve users, projects, sessions, notes, and settings.
- Evolve the schema through explicit, versioned migrations that preserve existing records, IDs, timestamps, notes, preferences, and running sessions. Never drop/recreate or reset the user's database to make new code work.
- Before changing the schema, inspect `electron/storage.cjs` and its current `PRAGMA user_version`. Test migrations using populated temporary databases from the previous supported schema, including an unfinished session. Do not lower a newer database's schema version or silently treat it as an older schema.
- Tests must use isolated temporary databases. `TIME_TRACKER_TEST_DATA` is a test override, not the production storage location. Never use the real user database as a test fixture or delete it during builds or cleanup.
- Settings must continue to show the actual database path.

## Current behavior to preserve

- The app is local and works offline. Users are local profiles; no login or server is required.
- Shared relational tables are `users`, `projects`, `time_entries`, and `settings`. A user owns projects; a project owns time entries.
- Deleting a user cascades to their projects and entries. Deleting a project cascades to its entries. These actions also remove any affected running session and require the existing in-app confirmation.
- Each Start persists a new random 64-character hexadecimal session ID, project, clock-in timestamp, and notes immediately. Only one session may have a null clock-out across the database.
- Closing, quitting, sleeping, or reopening must not clock out automatically. A session with no clock-out continues from its original timestamp, including time spent with the app closed.
- Notes are optional and limited to 255 characters in both application validation and SQLite constraints.
- A time entry contains the clock-in and optional clock-out in one record. Delete the whole entry, or remove only clock-out to reopen it. Do not support deleting a clock-in while leaving its clock-out.
- Removing clock-out preserves the original ID, clock-in, and notes. Another timer must be stopped first.
- Project totals include both stopped sessions and elapsed running time and update every second. The right summary emphasizes the selected project's current-week total (Sunday 00:00 through the following Sunday 00:00 in local time) and shows a smaller all-time project total. Clip sessions to week boundaries, including those started in an earlier week; handle local calendar changes and DST.
- Mini mode resizes the same native window into an approximately 640 × 160 widget. Preserve the shared timer and note drafts when switching modes. Follow the running session; allow user/project switching when stopped. Always-on-top is opt-in and applies only in mini mode. Exit restores normal bounds/maximized state and clears pinning; reopening starts in normal mode without stopping the persisted timer. Keep window IPC narrow, caller-validated, and boolean-validated.
- The Windows portable EXE shows a native animated unpacking/starting status window before Electron loads. Keep its ready handoff and per-launch temporary extraction directory. The in-memory adapter in `scripts/portable-startup.cjs` targets pinned electron-builder 26.15.3; review its template anchors when changing builder versions. After portable packaging, run `npm run test:portable` against the real launcher in addition to the unpacked-app integration tests. Test-only diagnostics and inspection delays must be opt-in; normal launches must not include an artificial delay.

## Implementation and verification

- This project is a local Git repository on `main`. Inspect `git status --short --branch` and `git diff` before editing; preserve any existing uncommitted work. Use `git log --oneline -10` to review recent commits and `git remote -v` to check the actual remote configuration.
- The public GitHub repository is `bryancolvinfilm-bot/time-tracker`. `origin` is `https://github.com/bryancolvinfilm-bot/time-tracker.git`, and `main` tracks `origin/main`. Verify the actual configuration and distinguish local commits from successfully pushed backups.
- The user wants this repository public with owner-only write access. Do not add collaborators, writable deploy keys, or other write grants without explicit instruction. Outside contributions are not accepted; others may fork and make variants under the MIT license in `LICENSE`. Keep its copyright and permission notice. The npm `private: true` flag is separate from GitHub visibility and should remain enabled.
- Git for Windows is installed at `C:\Program Files\Git\cmd\git.exe`. If the current automation process has an old PATH, invoke that executable directly or prepend its directory for that command. New terminals inherit the installed PATH entry.
- For requested commits, stage intended source/documentation files, inspect the staged diff, and keep ignored dependencies, builds, test data, runtime databases, and credentials out of history. Use Git Credential Manager for authentication; do not write tokens into files or remote URLs.

- Keep SQL and validation in `electron/storage.cjs`. Use foreign keys, database constraints, parameterized values, and transactions for mutations.
- Keep the renderer sandboxed and isolated from Node. Expose a narrow preload API and validate IPC callers in the main process.
- Run `npm run check` and the relevant tests. `npm run test:storage` verifies persistence and data rules; `npm run test:time` verifies live totals and local week boundaries; `npm run test:desktop` exercises the real Electron interface. `npm test` runs all three suites.
- Node 24 is available under `.tools/node-v24.22.0-win-x64` in this workspace. `dev.ps1` uses the portable runtime when it is present.
- Desktop tests can require execution outside the restricted automation sandbox on Windows. Do not disable Electron's renderer sandbox to work around test-runner restrictions.
- Build Windows artifacts with `npm run dist:win -- --publish never`. To reuse the installed Electron runtime, append `--config.electronDist=node_modules/electron/dist`.
- When producing a new build, test `release/win-unpacked/Time Tracker.exe` using `TIME_TRACKER_EXECUTABLE` as described in README. Keep test data isolated.
- Update `MILESTONES.md` after a completed milestone with the version, actual validation results, and remaining scope. Do not describe planned work as implemented or tests as passed unless verified.
