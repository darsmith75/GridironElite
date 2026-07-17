const DEFAULT_POSITION_HIGHLIGHTS = [
  {
    positionKey: 'edge',
    displayName: 'Edge Rusher',
    imagePath: '/images/positionHighlight/edgeRusher.JPEG',
    aliases: ['edge', 'de', 'defensive end', 'edge rusher', 'rush end', 'olb']
  },
  {
    positionKey: 'ot',
    displayName: 'Offensive Tackle',
    imagePath: '/images/positionHighlight/offensiveTackle.JPEG',
    aliases: ['ot', 'offensive tackle', 'tackle', 'ol', 'offensive line']
  },
  {
    positionKey: 'qb',
    displayName: 'Quarterback',
    imagePath: '/images/positionHighlight/quarterBack.JPEG',
    aliases: ['qb', 'quarterback']
  },
  {
    positionKey: 'rb',
    displayName: 'Running Back',
    imagePath: '/images/positionHighlight/runningBack.JPEG',
    aliases: ['rb', 'running back', 'hb', 'tailback']
  },
  {
    positionKey: 'te',
    displayName: 'Tight End',
    imagePath: '/images/positionHighlight/tightEnd.JPEG',
    aliases: ['te', 'tight end']
  },
  {
    positionKey: 'wr',
    displayName: 'Wide Receiver',
    imagePath: '/images/positionHighlight/wideReceiver.JPEG',
    aliases: ['wr', 'wide receiver', 'slot', 'x', 'z', 'y']
  }
];

function normalizePositionToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseAliasesCsv(raw) {
  return String(raw || '')
    .split(',')
    .map((item) => normalizePositionToken(item))
    .filter(Boolean);
}

function toAliasesCsv(aliases) {
  if (!Array.isArray(aliases)) return '';
  return aliases
    .map((item) => normalizePositionToken(item))
    .filter(Boolean)
    .join(', ');
}

function guideMatchesPosition(guide, playerPosition) {
  const target = normalizePositionToken(playerPosition);
  if (!target) return false;

  const key = normalizePositionToken(guide?.positionKey);
  if (key && key === target) return true;

  const aliases = parseAliasesCsv(guide?.aliasesCsv || guide?.aliases || '');
  return aliases.includes(target);
}

module.exports = {
  DEFAULT_POSITION_HIGHLIGHTS,
  normalizePositionToken,
  parseAliasesCsv,
  toAliasesCsv,
  guideMatchesPosition
};
