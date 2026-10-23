const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, writeFile, readFile, rm, unlink } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { version } = require('../package.json');
const { prepare, validateChecksums, hashFile, assetNames } = require('../scripts/release.cjs');

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tracker-release-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const names = [
    `Time Tracker Setup ${version}.exe`, `Time Tracker ${version}.exe`,
    `Time Tracker-${version}-universal.dmg`, `Time Tracker-${version}-universal-mac.zip`,
    `Time Tracker-${version}.AppImage`, `time-tracker_${version}_amd64.deb`,
  ];
  for (const name of names) await writeFile(path.join(directory, name), `fixture package ${name}`);
  return { directory, names };
}

test('release preparation requires all platforms and binds every package to its source and hash', async t => {
  const { directory, names } = await fixture(t);
  const sha = 'a'.repeat(40);
  const entries = await prepare(directory, sha, 'https://example.test/run');
  assert.deepEqual(entries.map(entry => entry.name).sort(), [...assetNames].sort());
  const metadata = JSON.parse(await readFile(path.join(directory, 'public/BUILD-INFO.json')));
  assert.equal(metadata.sourceCommit, sha);
  assert.equal(metadata.packages.length, 6);
  const rows = validateChecksums(await readFile(path.join(directory, 'public/CHECKSUMS.sha256'), 'utf8'));
  for (const entry of entries.filter(entry => entry.name !== 'CHECKSUMS.sha256')) {
    assert.equal(rows.find(row => row.name === entry.name).sha256, await hashFile(entry.source));
  }
  await unlink(path.join(directory, names[0]));
  await assert.rejects(prepare(directory, sha, ''), /exactly six/);
});

test('release preparation rejects an incorrect version and invalid source commit', async t => {
  const { directory, names } = await fixture(t);
  await assert.rejects(prepare(directory, 'main', ''), /full source SHA/);
  await unlink(path.join(directory, names[2]));
  await writeFile(path.join(directory, 'Time Tracker-0.0.0-universal.dmg'), 'wrong version');
  await assert.rejects(prepare(directory, 'a'.repeat(40), ''), /Missing or ambiguous/);
});

test('checksum validation rejects missing, duplicate, malformed, or unsafe entries', () => {
  const rows = assetNames.filter(name => name !== 'CHECKSUMS.sha256').map(name => `${'b'.repeat(64)}  ${name}`);
  assert.equal(validateChecksums(rows.join('\n')).length, 7);
  assert.throws(() => validateChecksums(rows.slice(1).join('\n')), /Incomplete/);
  assert.throws(() => validateChecksums([...rows.slice(1), rows[1]].join('\n')), /Incomplete/);
  assert.throws(() => validateChecksums(`${'b'.repeat(64)}  ../escape.exe`), /unsafe filename/);
  assert.throws(() => validateChecksums('invalid checksum'), /Invalid checksum/);
});
