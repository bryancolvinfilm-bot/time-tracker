const fs = require('node:fs');
const assert = require('node:assert/strict');

function checkMacIcon(buffer) {
  assert.equal(buffer.toString('ascii', 0, 4), 'icns', 'Icon must be an ICNS container.');
  assert.equal(buffer.readUInt32BE(4), buffer.length, 'ICNS length is invalid.');
  const dimensions = { icp4: 16, icp5: 32, icp6: 64, ic04: 16, ic05: 32, is32: 16, il32: 32, ic07: 128, ic08: 256, ic09: 512, ic10: 1024, ic11: 32, ic12: 64, ic13: 256, ic14: 512 };
  const sizes = new Set();
  const frames = [];
  let offset = 8;
  while (offset < buffer.length) {
    assert.ok(offset + 8 <= buffer.length, 'ICNS entry header is truncated.');
    const type = buffer.toString('ascii', offset, offset + 4);
    const length = buffer.readUInt32BE(offset + 4);
    assert.ok(length > 8 && offset + length <= buffer.length, 'ICNS entry bounds are invalid.');
    const payload = buffer.subarray(offset + 8, offset + length);
    if (payload.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
      assert.ok(!['icp4', 'icp5', 'icp6'].includes(type), `${type} contains PNG data that renders corrupt in macOS Finder.`);
      assert.ok(payload.length >= 24, 'Icon PNG header is truncated.');
      if (dimensions[type]) {
        assert.equal(payload.readUInt32BE(16), dimensions[type], `${type} has the wrong PNG width.`);
        assert.equal(payload.readUInt32BE(20), dimensions[type], `${type} has the wrong PNG height.`);
      }
    }
    if (dimensions[type]) sizes.add(dimensions[type]);
    frames.push(type);
    offset += length;
  }
  for (const size of [16, 32, 128, 256, 512, 1024]) assert.ok(sizes.has(size), `Icon is missing a ${size}px representation.`);
  return frames;
}

module.exports = { checkMacIcon };
if (require.main === module) {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: node scripts/check-mac-icon.cjs path/to/icon.icns');
  console.log(`Mac icon validated (${file}): ${checkMacIcon(fs.readFileSync(file)).join(', ')}`);
}
