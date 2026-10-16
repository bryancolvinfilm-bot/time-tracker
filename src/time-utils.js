// Shared by the bundled renderer and Node tests; calendar boundaries use local time.
((root) => {
  function weekBounds(now = Date.now()) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - start.getDay());
    const end = new Date(start);
    // Calendar days, rather than a fixed millisecond duration, handle DST changes.
    end.setDate(end.getDate() + 7);
    return { start: start.getTime(), end: end.getTime() };
  }

  function projectTotals(entries, projectId, now = Date.now()) {
    const week = weekBounds(now);
    let totalMs = 0;
    let weekMs = 0;
    for (const entry of entries) {
      if (entry.project_id !== projectId) continue;
      const end = entry.clock_out ?? now;
      totalMs += Math.max(0, end - entry.clock_in);
      weekMs += Math.max(0, Math.min(end, week.end) - Math.max(entry.clock_in, week.start));
    }
    return { totalMs, weekMs, week };
  }

  const api = { weekBounds, projectTotals };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.timeTrackerTime = Object.freeze(api);
})(globalThis);
