const PLAYER_TRACKING_STATS = [
  'Completion %',
  'FG %',
  'FG Made',
  'Forced Fumbles',
  'Games Started',
  'Inside 20',
  'INTs',
  'Knockdowns',
  'Long FG',
  'Long Punt',
  'Long Reception',
  'Long Return',
  'Net Average',
  'Pancakes',
  'Pass Breakups',
  'Pass TDs',
  'Pass Yards',
  'PAT %',
  'Pressures Allowed',
  'Punt Average',
  'Punts',
  'QB Hurries',
  'Rec TDs',
  'Rec Yards',
  'Receptions',
  'Return Average',
  'Return TDs',
  'Return Yards',
  'Rush TDs',
  'Rush Yards',
  'Sacks',
  'Sacks Allowed',
  'Tackles',
  'TDs Allowed',
  'TFLs',
  'Total Returns',
  'Total Tackles',
  'Total TDs',
  'Touchbacks',
  'Yards/Carry',
  'Yards/Catch'
];

function normalizeStatSlots(rawInput) {
  const values = [];
  const maybeArray = Array.isArray(rawInput) ? rawInput : [];

  if (maybeArray.length > 0) {
    maybeArray.forEach((entry, index) => {
      const rawValue = typeof entry === 'string' ? entry : (entry && entry.label) || '';
      values.push(String(rawValue || '').trim());
    });
  } else {
    for (let i = 1; i <= 5; i += 1) {
      const key = `statSlot${i}`;
      const rawValue = rawInput && rawInput[key];
      values.push(String(rawValue || '').trim());
    }
  }

  const sanitized = values.slice(0, 5);
  const invalid = sanitized.find(value => !PLAYER_TRACKING_STATS.includes(value));
  if (invalid) {
    throw new Error(`Invalid stat label: ${invalid}`);
  }

  const duplicates = sanitized.filter((value, index) => value && sanitized.indexOf(value) !== index);
  if (duplicates.length > 0) {
    throw new Error('Stat labels must be unique.');
  }

  if (sanitized.length !== 5 || sanitized.some(value => !value)) {
    throw new Error('Please choose 5 unique stats.');
  }

  return sanitized;
}

module.exports = {
  PLAYER_TRACKING_STATS,
  normalizeStatSlots
};
