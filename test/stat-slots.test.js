const assert = require('node:assert/strict');
const { PLAYER_TRACKING_STATS, normalizeStatSlots } = require('../utils/stat-slots');

assert.ok(Array.isArray(PLAYER_TRACKING_STATS) && PLAYER_TRACKING_STATS.length > 0, 'stat list should exist');
assert.equal(PLAYER_TRACKING_STATS.includes('Pass Yards'), true, 'Pass Yards should be in the list');

const good = normalizeStatSlots({
  statSlot1: 'Pass Yards',
  statSlot2: 'Rush Yards',
  statSlot3: 'Sacks',
  statSlot4: 'INTs',
  statSlot5: 'Receptions'
});
assert.deepEqual(good, [
  'Pass Yards',
  'Rush Yards',
  'Sacks',
  'INTs',
  'Receptions'
], 'valid 5 slots should be preserved');

assert.throws(() => normalizeStatSlots({
  statSlot1: 'Pass Yards',
  statSlot2: 'Pass Yards',
  statSlot3: 'Sacks',
  statSlot4: 'INTs',
  statSlot5: 'Receptions'
}), /unique/i, 'duplicate labels should fail');

assert.throws(() => normalizeStatSlots({
  statSlot1: 'Pass Yards',
  statSlot2: 'Rush Yards',
  statSlot3: 'Sacks',
  statSlot4: 'INTs',
  statSlot5: 'Not A Real Stat'
}), /invalid/i, 'unknown stat labels should fail');

console.log('stat slot validation tests passed');
