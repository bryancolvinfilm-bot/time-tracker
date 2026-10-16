const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { weekBounds, projectTotals } = require('../src/time-utils.js');
const hour = 3_600_000;
const now = new Date(2026, 9, 14, 12).getTime();
const entry = (clock_in, clock_out, project_id = 'project') => ({ clock_in, clock_out, project_id });

test('local weeks begin Sunday at midnight and end at the next Sunday, including year boundaries', () => {
  const week = weekBounds(new Date(2026, 0, 1, 12).getTime());
  assert.equal(week.start, new Date(2025, 11, 28).getTime());
  assert.equal(week.end, new Date(2026, 0, 4).getTime());
  assert.deepEqual(weekBounds(week.start), week);
  assert.deepEqual(weekBounds(week.end - 1), week);
  assert.equal(weekBounds(week.end).start, week.end);
});

test('all-time totals include stopped and running sessions and isolate the selected project', () => {
  const entries = [entry(now - 4 * hour, now - 2 * hour), entry(now - hour, null), entry(now - 10 * hour, now, 'other')];
  const totals = projectTotals(entries, 'project', now);
  assert.equal(totals.totalMs, 3 * hour);
  assert.equal(totals.weekMs, 3 * hour);
  assert.equal(projectTotals(entries, 'project', now + 5000).totalMs, 3 * hour + 5000);
  assert.equal(projectTotals(entries, 'missing', now).totalMs, 0);
});

test('weekly totals clip crossing sessions and exclude sessions outside the week', () => {
  const { start, end } = weekBounds(now);
  const entries = [
    entry(start - 2 * hour, start - hour),
    entry(start - hour, start + hour),
    entry(start + 2 * hour, start + 4 * hour),
    entry(end - hour, end + hour),
    entry(end, end + hour),
  ];
  assert.equal(projectTotals(entries, 'project', now).weekMs, 4 * hour);
  assert.equal(projectTotals([entry(start - hour, null)], 'project', now).weekMs, now - start);
});

test('a running timer carries forward while its weekly contribution resets at Sunday midnight', () => {
  const { end } = weekBounds(now);
  const entries = [entry(end - hour, null)];
  assert.equal(projectTotals(entries, 'project', end - 1).weekMs, hour - 1);
  const midnight = projectTotals(entries, 'project', end);
  assert.equal(midnight.totalMs, hour);
  assert.equal(midnight.weekMs, 0);
  assert.equal(projectTotals(entries, 'project', end + 5000).weekMs, 5000);
});

test('stopping a timer does not double-count or change its total at the stop instant', () => {
  const running = entry(now - hour, null);
  const before = projectTotals([running], 'project', now);
  const stopped = { ...running, clock_out: now };
  assert.deepEqual(projectTotals([stopped], 'project', now), before);
  assert.equal(projectTotals([stopped], 'project', now + hour).totalMs, hour);
  assert.equal(projectTotals([entry(now + hour, null)], 'project', now).totalMs, 0);
});

test('Sunday calendar weeks handle spring-forward and fall-back in America/Los_Angeles', () => {
  const child = spawnSync(process.execPath, ['-e', `
    const { weekBounds, projectTotals } = require(process.argv[1]);
    const dates = ['2026-03-11T12:00:00-07:00', '2026-11-04T12:00:00-08:00'];
    const results = dates.map(date => {
      const week = weekBounds(new Date(date).getTime());
      return { start: new Date(week.start).toISOString(), end: new Date(week.end).toISOString(),
        total: projectTotals([{project_id:'p',clock_in:week.start,clock_out:week.end}], 'p', new Date(date).getTime()).weekMs };
    });
    process.stdout.write(JSON.stringify(results));
  `, path.resolve(__dirname, '../src/time-utils.js')], { env: { ...process.env, TZ: 'America/Los_Angeles' }, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), [
    { start: '2026-03-08T08:00:00.000Z', end: '2026-03-15T07:00:00.000Z', total: 167 * hour },
    { start: '2026-11-01T07:00:00.000Z', end: '2026-11-08T08:00:00.000Z', total: 169 * hour },
  ]);
});
