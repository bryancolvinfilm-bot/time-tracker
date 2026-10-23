const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createReadStream, createWriteStream } = require('node:fs');
const { mkdir, readdir, readFile, writeFile, stat } = require('node:fs/promises');
const { pipeline } = require('node:stream/promises');
const path = require('node:path');
const { version } = require('../package.json');

const repository = 'bryancolvinfilm-bot/time-tracker';
const apiRoot = `https://api.github.com/repos/${repository}`;
const tag = `v${version}`;
const prefix = `TimeTracker-${version}`;
const targets = [
  { name: `${prefix}-windows-x64-setup.exe`, source: `Time Tracker Setup ${version}.exe`, platform: 'Windows x64 installer' },
  { name: `${prefix}-windows-x64-portable.exe`, source: `Time Tracker ${version}.exe`, platform: 'Windows x64 portable' },
  { name: `${prefix}-macos-universal.dmg`, extension: '.dmg', platform: 'macOS Apple Silicon + Intel' },
  { name: `${prefix}-macos-universal.zip`, extension: '.zip', platform: 'macOS app archive' },
  { name: `${prefix}-linux-x64.AppImage`, extension: '.AppImage', platform: 'Linux x64 AppImage' },
  { name: `${prefix}-linux-x64.deb`, extension: '.deb', platform: 'Debian / Ubuntu x64' },
];
const assetNames = [...targets.map(target => target.name), 'BUILD-INFO.json', 'CHECKSUMS.sha256'];

async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function validateChecksums(text) {
  const rows = text.trim().split(/\r?\n/).map(line => {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$/.exec(line);
    assert(match, 'Invalid checksum row or unsafe filename.');
    return { sha256: match[1], name: match[2] };
  });
  assert.deepEqual(rows.map(row => row.name).sort(), assetNames.filter(name => name !== 'CHECKSUMS.sha256').sort(), 'Incomplete or duplicate checksum manifest.');
  return rows;
}

async function prepare(directory, sha, workflowUrl) {
  assert.match(sha, /^[a-f0-9]{40}$/, 'A full source SHA is required.');
  const files = (await readdir(directory)).filter(name => /\.(exe|dmg|zip|AppImage|deb)$/.test(name));
  assert.equal(files.length, targets.length, 'Expected exactly six distributable packages.');
  const entries = [];
  for (const target of targets) {
    const matches = files.filter(name => target.source ? name === target.source : name.endsWith(target.extension) && name.includes(version));
    assert.equal(matches.length, 1, `Missing or ambiguous package: ${target.name}`);
    const source = path.join(directory, matches[0]);
    const size = (await stat(source)).size;
    assert(size > 0, `Empty package: ${matches[0]}`);
    entries.push({ name: target.name, size, sha256: await hashFile(source), source });
  }
  const output = path.join(directory, 'public');
  await mkdir(output, { recursive: true });
  const metadata = {
    version, sourceCommit: sha, repository, workflowUrl,
    signing: { windows: 'unsigned', macOS: 'ad-hoc signed; not notarized', linux: 'unsigned' },
    packages: entries.map(({ source, ...entry }) => entry),
  };
  const metadataFile = path.join(output, 'BUILD-INFO.json');
  await writeFile(metadataFile, `${JSON.stringify(metadata, null, 2)}\n`);
  entries.push({ name: 'BUILD-INFO.json', source: metadataFile, size: (await stat(metadataFile)).size, sha256: await hashFile(metadataFile) });
  const checksumFile = path.join(output, 'CHECKSUMS.sha256');
  await writeFile(checksumFile, entries.map(entry => `${entry.sha256}  ${entry.name}\n`).join(''));
  entries.push({ name: 'CHECKSUMS.sha256', source: checksumFile, size: (await stat(checksumFile)).size, sha256: await hashFile(checksumFile) });
  return entries;
}

async function api(endpoint, options = {}) {
  assert(process.env.GH_TOKEN, 'GH_TOKEN is required for publishing.');
  const response = await fetch(endpoint.startsWith('https://') ? endpoint : `${apiRoot}${endpoint}`, {
    ...options,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${process.env.GH_TOKEN}`, 'X-GitHub-Api-Version': '2022-11-28', ...options.headers },
  });
  if (response.status === 404 && options.allowMissing) return null;
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${await response.text()}`);
  if (response.status === 204) return null;
  return response.json();
}

function jsonRequest(method, value) {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) };
}

async function hashDownload(url, authenticated, destination) {
  const headers = authenticated ? { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/octet-stream' } : {};
  const response = await fetch(url, { headers, redirect: 'follow' });
  assert(response.ok, `Asset download failed: HTTP ${response.status}`);
  if (destination) {
    await pipeline(response.body, createWriteStream(destination));
    return { sha256: await hashFile(destination), size: (await stat(destination)).size };
  }
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of response.body) { hash.update(chunk); size += chunk.length; }
  return { sha256: hash.digest('hex'), size };
}

async function publish(directory, sha) {
  assert.equal(process.env.GITHUB_REPOSITORY, repository, 'Publish only from the intended repository workflow.');
  assert.equal(process.env.GITHUB_SHA, sha, 'Requested SHA must match the workflow source.');
  const workflowUrl = `https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  const entries = await prepare(directory, sha, workflowUrl);
  const main = await api('/commits/main');
  assert.equal(main.sha, sha, 'main changed during this build; build its new commit before publishing.');
  const existing = await api(`/releases/tags/${tag}`, { allowMissing: true });
  assert(!existing, `Release ${tag} already exists; do not overwrite it.`);
  const existingTag = await api(`/git/ref/tags/${tag}`, { allowMissing: true });
  if (existingTag) {
    assert.equal((await api(`/commits/${tag}`)).sha, sha, 'Version tag already points to a different commit.');
  } else {
    await api('/git/refs', jsonRequest('POST', { ref: `refs/tags/${tag}`, sha }));
  }
  const downloadRoot = `https://github.com/${repository}/releases/download/${tag}`;
  const body = [
    `Time Tracker ${version} is a local, offline desktop time tracker with users, projects, persistent timers, notes, weekly totals, light/dark themes, and a compact mini stopwatch.`,
    '', '| Platform | Download |', '| --- | --- |',
    ...targets.map(target => `| ${target.platform} | [${target.name}](${downloadRoot}/${target.name}) |`),
    '', 'Windows: use Setup to install, or portable to run without installation. macOS: mount the DMG and drag Time Tracker into Applications. Linux: use the AppImage or install the Debian package.',
    '', 'Existing users keep the same local database when upgrading. No login, server, or network connection is required to use the app.',
    '', '**Signing:** Windows packages are unsigned. The Mac app has an ad-hoc development signature and is not Apple notarized; macOS may block opening it after download. The previous Mac launch report remains unverified on the reporting machine. These tests do not certify Gatekeeper acceptance.',
    '', `Source: [${sha}](https://github.com/${repository}/commit/${sha}). [Native build and test results](${workflowUrl}).`,
    '', 'BUILD-INFO.json records source, package sizes, and SHA-256 hashes. CHECKSUMS.sha256 covers all packages and build metadata.',
  ].join('\n');
  const release = await api('/releases', jsonRequest('POST', { tag_name: tag, target_commitish: sha, name: `Time Tracker ${version}`, body, draft: true, prerelease: false }));
  console.log(`Created draft ${release.html_url}`);
  const uploadUrl = release.upload_url.replace(/\{.*$/, '');
  for (const entry of entries) {
    console.log(`Uploading and verifying ${entry.name} (${entry.size} bytes)`);
    const asset = await api(`${uploadUrl}?name=${encodeURIComponent(entry.name)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(entry.size) },
      body: createReadStream(entry.source), duplex: 'half',
    });
    const downloaded = await hashDownload(asset.url, true);
    assert.equal(downloaded.size, entry.size, `Uploaded size mismatch: ${entry.name}`);
    assert.equal(downloaded.sha256, entry.sha256, `Uploaded hash mismatch: ${entry.name}`);
  }
  const uploaded = await api(`/releases/${release.id}`);
  assert.deepEqual(uploaded.assets.map(asset => asset.name).sort(), [...assetNames].sort(), 'Incomplete draft release.');
  assert.equal((await api('/commits/main')).sha, sha, 'main changed before publication.');
  const published = await api(`/releases/${release.id}`, jsonRequest('PATCH', { draft: false, make_latest: 'true' }));
  console.log(`Published ${published.html_url}`);
  await verify(path.resolve('.tools', `public-download-${tag}`), sha);
}

async function verify(directory, sha) {
  assert.match(sha, /^[a-f0-9]{40}$/, 'A full expected source SHA is required.');
  // No authentication is used here: these must be real public downloads.
  const response = await fetch(`${apiRoot}/releases/tags/${tag}`);
  assert(response.ok, `Public release lookup failed: HTTP ${response.status}`);
  const release = await response.json();
  assert.equal(release.draft, false);
  assert.equal(release.prerelease, false);
  assert.deepEqual(release.assets.map(asset => asset.name).sort(), [...assetNames].sort(), 'Incomplete public release.');
  await mkdir(directory, { recursive: true });
  const checksum = release.assets.find(asset => asset.name === 'CHECKSUMS.sha256');
  await hashDownload(checksum.browser_download_url, false, path.join(directory, checksum.name));
  const rows = validateChecksums(await readFile(path.join(directory, checksum.name), 'utf8'));
  for (const row of rows) {
    const asset = release.assets.find(candidate => candidate.name === row.name);
    console.log(`Verifying anonymous download: ${row.name}`);
    const downloaded = await hashDownload(asset.browser_download_url, false, path.join(directory, row.name));
    assert.equal(downloaded.sha256, row.sha256, `Public hash mismatch: ${row.name}`);
    assert.equal(downloaded.size, asset.size, `Public size mismatch: ${row.name}`);
  }
  const metadata = JSON.parse(await readFile(path.join(directory, 'BUILD-INFO.json'), 'utf8'));
  assert.equal(metadata.sourceCommit, sha, 'Release source does not match the tested commit.');
  assert.equal(metadata.version, version);
  assert.equal(metadata.repository, repository);
  assert.deepEqual(metadata.packages.map(entry => entry.name).sort(), targets.map(target => target.name).sort());
  for (const entry of metadata.packages) {
    assert.equal(entry.sha256, rows.find(row => row.name === entry.name).sha256);
    assert.equal(entry.size, (await stat(path.join(directory, entry.name))).size);
  }
  const tagResponse = await fetch(`${apiRoot}/commits/${tag}`);
  assert(tagResponse.ok, 'Could not resolve the published version tag.');
  assert.equal((await tagResponse.json()).sha, sha, 'Published tag points to a different source commit.');
  console.log(`All eight public assets verified: ${release.html_url}`);
}

if (require.main === module) {
  const [mode, directory, argumentSha] = process.argv.slice(2);
  const sha = argumentSha || process.env.EXPECTED_SHA;
  const action = mode === 'publish' ? publish : mode === 'verify' ? verify : null;
  if (!action || !directory) throw new Error('Usage: node scripts/release.cjs <publish|verify> DIRECTORY EXPECTED_SHA');
  action(path.resolve(directory), sha).catch(error => { console.error(error); process.exitCode = 1; });
}

module.exports = { prepare, validateChecksums, hashFile, assetNames };
