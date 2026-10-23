# Time Tracker

A self-contained Electron desktop app with a local SQLite database. No server, account, network connection, or separately installed database is needed to run the packaged app.

Version 0.4.3 supports local users, projects, persistent sessions, live weekly totals, a compact mini stopwatch window, and animated portable-startup feedback. Light and dark themes are included.

Project instructions for future agents are in [AGENTS.md](AGENTS.md). Verified progress and the agreement to preserve the same database across versions are recorded in [MILESTONES.md](MILESTONES.md).

## Download

Installers and portable builds are published on [GitHub Releases](https://github.com/bryancolvinfilm-bot/time-tracker/releases/latest). No Node.js installation is needed to use them.

| Platform | Download |
| --- | --- |
| Windows x64 | [Installer](https://github.com/bryancolvinfilm-bot/time-tracker/releases/latest/download/TimeTracker-0.4.3-windows-x64-setup.exe) · [Portable](https://github.com/bryancolvinfilm-bot/time-tracker/releases/latest/download/TimeTracker-0.4.3-windows-x64-portable.exe) |
| Mac, Apple Silicon and Intel | [Universal DMG](https://github.com/bryancolvinfilm-bot/time-tracker/releases/latest/download/TimeTracker-0.4.3-macos-universal.dmg) · [App ZIP](https://github.com/bryancolvinfilm-bot/time-tracker/releases/latest/download/TimeTracker-0.4.3-macos-universal.zip) |
| Linux x64 | [AppImage](https://github.com/bryancolvinfilm-bot/time-tracker/releases/latest/download/TimeTracker-0.4.3-linux-x64.AppImage) · [Debian / Ubuntu package](https://github.com/bryancolvinfilm-bot/time-tracker/releases/latest/download/TimeTracker-0.4.3-linux-x64.deb) |

Each release includes source/build metadata and SHA-256 checksums. Windows packages are unsigned; Mac apps are ad-hoc signed without Apple notarization and may be blocked by macOS after downloading. See the Mac notes below. Upgrades reuse the existing local database.

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

## Portable Windows startup

`Time Tracker 0.4.3.exe` is the portable launcher. It shows a small native status window with an animated activity bar while unpacking, changes the message to **Starting Time Tracker...**, and dismisses the window when the app is ready. The animation indicates activity rather than a completion percentage. Each launch uses its own temporary extraction folder and keeps the normal shared SQLite database in AppData.

The Setup EXE installs the app once; launch the installed shortcut afterward to avoid repeated extraction. The directly launched `release/win-unpacked/Time Tracker.exe` also starts without unpacking.

The startup customization lives in `build/portable-startup.nsh` and the in-memory adapter `scripts/portable-startup.cjs`. It uses the pinned electron-builder template and fails the build if its expected anchors change. After building on Windows, `npm run test:portable` launches the actual portable EXE with isolated test data and verifies native window visibility, marquee configuration, readiness handoff, and clean exit. The regular Electron suite tests the readiness signal as well.

## Mac development builds

The GitHub Mac release is universal, containing Apple Silicon (M1 and later) and Intel binaries. Download the DMG from Releases, mount it, and drag Time Tracker into Applications. Version 0.4.2 explicitly signs the app and its helpers with an ad-hoc development signature, preserving signature integrity after packaging. `npm run test:mac` verifies both architectures and signatures in the DMG and app ZIP and runs desktop integration tests on an app copied from the DMG, using the runner's native architecture.

Version 0.4.3 generates the Mac icon using Apple's native `sips` and `iconutil` tools. This replaces the pinned converter's malformed small Finder icon entries and incorrect Retina frame size. The generated `build/icon.icns` is ignored by Git and rebuilt by `npm run dist:mac`. The package checks also inspect the actual ICNS entries and ask Apple's tools to decode the packaged icon.

These builds are not signed with an Apple Developer ID or notarized by Apple. A successful cloud build does not guarantee Gatekeeper acceptance after browser download. If macOS blocks this development build and offers **System Settings > Privacy & Security > Open Anyway**, use that app-specific exception only for the copy obtained from this project's workflow. See [Apple's instructions](https://support.apple.com/en-us/102445). If macOS still reports damage, obtain the output of `codesign --verify --deep --strict --verbose=2 "/Applications/Time Tracker.app"` before changing security settings. Normal public distribution requires Developer ID signing and notarization, which are not configured yet.

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

The public GitHub repository is [bryancolvinfilm-bot/time-tracker](https://github.com/bryancolvinfilm-bot/time-tracker). The `origin` remote uses `https://github.com/bryancolvinfilm-bot/time-tracker.git`, and local `main` tracks `origin/main`. Upload new commits with:

```sh
git push
```

Git Credential Manager handles GitHub sign-in. Do not place a password or token in the remote URL or project files. A local commit saves version history on this machine; pushing backs those commits up to GitHub. Use `git status --short --branch` to see whether local commits are ahead of the last fetched remote state.

Git tracks source code, tests, icons, configuration, and project documentation. `.gitignore` excludes dependencies, downloaded tools, generated builds, test outputs, local SQLite files, and `.env` secrets. The live SQLite database in AppData is separate from the Git repository and needs its own backup if desired.

## Sharing, license, and repository access

Time Tracker is available under the [MIT license](LICENSE), copyright 2026 Bryan Colvin. You may use the code and make your own variants under that license, including retaining its copyright and permission notice.

This repository is maintained by its owner and is not accepting outside code contributions. Public visibility allows people to view, clone, and fork it; it does not give them permission to push or merge changes here. Only the owner account has write access. A pull request is a proposal and cannot change this repository unless the owner merges it. Do not grant collaborators write access without the owner's explicit instruction.

The `private: true` field in `package.json` prevents accidental npm publishing; it does not control GitHub visibility.

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

For headless Linux desktop tests, install Xvfb, Openbox, and `x11-utils`, then run `xvfb-run --auto-servernum --server-args="-screen 0 1920x1080x24" bash scripts/test-linux.sh`. The script starts Openbox on the virtual display, waits for it to register, runs the full test suite, and stops its window manager afterward. Xvfb alone does not supply the window manager needed by the maximize/restore checks. GitHub Actions configures this environment automatically.

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

Artifacts are written to `release/`. Users do not need Node.js or npm installed. Windows version 0.4.3 files are `Time Tracker Setup 0.4.3.exe` (installer) and `Time Tracker 0.4.3.exe` (portable launcher).

One source codebase produces separate applications for each operating system. Build on the target OS for predictable results. The workflow in `.github/workflows/build.yml` uses Windows, macOS, and Linux runners and tests both source and packaged apps. Release builds target Windows x64, universal macOS, and Linux x64. For a local universal Mac build, run `npm run dist:mac -- --universal`.

Follow [publish.md](publish.md) to publish. A manual workflow dispatch specifies the full expected source SHA and explicitly enables publication. Only after all platform checks pass does it upload a draft, verify all eight assets, publish the release, and verify anonymous downloads. A normal build or tag push does not publish a release. Windows builds are unsigned and Mac builds use ad-hoc signing; trusted platform signing and Mac notarization are not configured. Advanced reports, manual timestamp editing, and exports are outside this version.
