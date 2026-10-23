# Publish Time Tracker

Adapted from Cult Copy's `publish.md`: build on native runners, keep the source
SHA fixed, verify all packages, upload a draft, check downloaded bytes, then
publish and verify public downloads anonymously.

The owner can ask: "Build all platform installers and publish a release.
Follow publish.md." That request authorizes the required source commit, push,
native builds, and public release. A request only to push code does not.

1. Read `AGENTS.md`, `README.md`, `MILESTONES.md`, Git status, diff, recent
   history, and the actual origin. Preserve unrelated work and the user's real
   database. Never commit credentials, `.tools`, dependencies, or `release/`.
2. Use `main`; fetch origin and tags and fast-forward without force. Read the
   version from `package.json`. If `v<version>` already identifies another
   commit or a public release already exists, use the next patch version and
   update both package files and the README. Never move an existing tag.
3. With Node 24 and `npm ci`, run `npm run check` and `npm test`. Tests use
   temporary databases. On Windows, native desktop testing may require the
   normal user's desktop outside the automation sandbox; retain sandboxing in
   the application. Review, stage, commit, and push only intended files.
4. Confirm GitHub's main SHA equals the local release commit. Dispatch:

   ```powershell
   $releaseSha = git rev-parse HEAD
   gh workflow run build.yml --ref main -f "expected_sha=$releaseSha" -F publish_release=true
   gh run list --workflow build.yml --branch main
   gh run watch RUN_ID --exit-status
   ```

5. Keep following that exact workflow and SHA until every job finishes. A
   successful push or queued build is not completion. If a job fails, inspect
   its logs and fix the cause without weakening tests. Do not dispatch a second
   build just because the first is still running. A changed main SHA requires
   rebuilding the new commit. No publication occurs unless every build passes.
6. The workflow tests source on Windows, Mac, and Linux; builds Windows x64
   Setup/portable EXEs, a universal Apple Silicon/Intel Mac DMG and ZIP, and
   Linux x64 AppImage/DEB. It tests the packaged Windows app and portable EXE,
   both Mac bundle signatures/icons/architectures plus the DMG's copied app,
   and applications extracted from both Linux packages. Linux desktop tests
   retain Xvfb and Openbox. Intel Mac coverage verifies the binary architecture;
   runtime desktop tests run on the Mac runner's native architecture.
7. The publish job requires six packages from that same workflow, generates
   `BUILD-INFO.json` and `CHECKSUMS.sha256`, checks main, and creates `v<version>`
   at the exact tested SHA. It uploads eight assets to a draft and downloads
   each to verify sizes and SHA-256 hashes before marking the release latest.
   It then downloads all public files anonymously and verifies metadata,
   hashes, and the version tag. Existing releases are never overwritten.
8. Verify again from this machine and report the actual source commit, release
   URL, platform download links, and any remaining failure:

   ```powershell
   node scripts/release.cjs verify .tools/public-download-vVERSION FULL_SOURCE_SHA
   ```

Public downloads: <https://github.com/bryancolvinfilm-bot/time-tracker/releases/latest>.
Package names are `TimeTracker-<version>-windows-x64-setup.exe`,
`windows-x64-portable.exe`, `macos-universal.dmg`, `macos-universal.zip`,
`linux-x64.AppImage`, and `linux-x64.deb`, all with the same version prefix.

Windows packages are unsigned. Mac bundles are ad-hoc signed, without Developer
ID signing or notarization. State that accurately in release notes and reports;
a passing native test does not establish browser-download Gatekeeper acceptance
or resolve the previously reported M1 launch failure. No signing credentials are
currently configured. Linux package testing verifies extracted applications,
not installation on every distribution. Windows/Linux ARM64 are not included.

If a publish fails, inspect the draft before retrying. The script intentionally
refuses to replace an existing release; do not delete or overwrite published
downloads. A timeout does not cancel cloud jobs. Use normal GitHub CLI/Git
Credential Manager authentication; never put tokens in files or remote URLs.
