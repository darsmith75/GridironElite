const PLAYER_POSITION_OPTIONS = [
  { value: 'QB', label: 'Quarterback (QB)' },
  { value: 'RB', label: 'Running Back (RB)' },
  { value: 'WR', label: 'Wide Receiver (WR)' },
  { value: 'TE', label: 'Tight End (TE)' },
  { value: 'OL', label: 'Offensive Line (OL)' },
  { value: 'OT', label: 'Tackle (OT)' },
  { value: 'OG', label: 'Guard (OG)' },
  { value: 'C', label: 'Center (C)' },
  { value: 'DL', label: 'Defensive Line (DL)' },
  { value: 'EDGE', label: 'EDGE (EDGE)' },
  { value: 'LB', label: 'Linebacker (LB)' },
  { value: 'CB', label: 'Cornerback (CB)' },
  { value: 'S', label: 'Safety (S)' },
  { value: 'K', label: 'Kicker (K)' }
];

const PLAYER_POSITION_KEYS = new Set(PLAYER_POSITION_OPTIONS.map((item) => item.value));

const POSITION_ALIAS_TO_KEY = {
  qb: 'QB',
  quarterback: 'QB',
  rb: 'RB',
  runningback: 'RB',
  runningbacks: 'RB',
  hb: 'RB',
  tailback: 'RB',
  wr: 'WR',
  widereceiver: 'WR',
  widereceivers: 'WR',
  te: 'TE',
  tightend: 'TE',
  tightends: 'TE',
  ol: 'OL',
  offensiveline: 'OL',
  ot: 'OT',
  offensivetackle: 'OT',
  tackle: 'OT',
  og: 'OG',
  offensiveguard: 'OG',
  guard: 'OG',
  c: 'C',
  center: 'C',
  dl: 'DL',
  defensiveline: 'DL',
  edge: 'EDGE',
  edgerusher: 'EDGE',
  de: 'EDGE',
  lb: 'LB',
  linebacker: 'LB',
  linebackers: 'LB',
  olb: 'LB',
  mlb: 'LB',
  cb: 'CB',
  cornerback: 'CB',
  cornerbacks: 'CB',
  s: 'S',
  safety: 'S',
  fs: 'S',
  ss: 'S',
  k: 'K',
  kicker: 'K'
};

function toAliasLookupToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function canonicalizePositionKey(value) {
  const upper = String(value || '').trim().toUpperCase();
  if (PLAYER_POSITION_KEYS.has(upper)) return upper;
  const aliasToken = toAliasLookupToken(value);
  return POSITION_ALIAS_TO_KEY[aliasToken] || '';
}

const DEFAULT_POSITION_HIGHLIGHTS = [
  {
    positionKey: 'EDGE',
    displayName: 'Edge Rusher',
    imagePath: '/images/positionHighlight/edgeRusher.JPEG',
    aliases: ['edge', 'de', 'defensive end', 'edge rusher', 'rush end', 'dl']
  },
  {
    positionKey: 'OT',
    displayName: 'Offensive Tackle',
    imagePath: '/images/positionHighlight/offensiveTackle.JPEG',
    aliases: ['ot', 'offensive tackle', 'tackle', 'ol', 'offensive line', 'og', 'c']
  },
  {
    positionKey: 'QB',
    displayName: 'Quarterback',
    imagePath: '/images/positionHighlight/quarterBack.JPEG',
    aliases: ['qb', 'quarterback']
  },
  {
    positionKey: 'RB',
    displayName: 'Running Back',
    imagePath: '/images/positionHighlight/runningBack.JPEG',
    aliases: ['rb', 'running back', 'hb', 'tailback']
  },
  {
    positionKey: 'TE',
    displayName: 'Tight End',
    imagePath: '/images/positionHighlight/tightEnd.JPEG',
    aliases: ['te', 'tight end']
  },
  {
    positionKey: 'WR',
    displayName: 'Wide Receiver',
    imagePath: '/images/positionHighlight/wideReceiver.JPEG',
    aliases: ['wr', 'wide receiver', 'slot', 'x', 'z', 'y']
  },
  {
    positionKey: 'CB',
    displayName: 'Cornerback',
    imagePath: '/images/positionHighlight/cornerBack.jpeg',
    aliases: ['cb', 'cornerback']
  },
  {
    positionKey: 'LB',
    displayName: 'Linebacker',
    imagePath: '/images/positionHighlight/lineBacker.jpeg',
    aliases: ['lb', 'linebacker']
  },
  {
    positionKey: 'S',
    displayName: 'Safety',
    imagePath: '/images/positionHighlight/safety.png',
    aliases: ['s', 'safety', 'fs', 'ss']
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
    .map((item) => String(item || '').trim())
    .map((item) => canonicalizePositionKey(item) || normalizePositionToken(item))
    .filter(Boolean);
}

function toAliasesCsv(aliases) {
  if (!Array.isArray(aliases)) return '';
  return aliases
    .map((item) => canonicalizePositionKey(item) || normalizePositionToken(item))
    .filter(Boolean)
    .join(', ');
}

function guideMatchesPosition(guide, playerPosition) {
  const target = canonicalizePositionKey(playerPosition) || normalizePositionToken(playerPosition);
  if (!target) return false;

  const key = canonicalizePositionKey(guide?.positionKey) || normalizePositionToken(guide?.positionKey);
  if (key && key === target) return true;

  const aliases = parseAliasesCsv(guide?.aliasesCsv || guide?.aliases || '');
  return aliases.includes(target);
}

module.exports = {
  PLAYER_POSITION_OPTIONS,
  PLAYER_POSITION_KEYS,
  DEFAULT_POSITION_HIGHLIGHTS,
  canonicalizePositionKey,
  normalizePositionToken,
  parseAliasesCsv,
  toAliasesCsv,
  guideMatchesPosition
};
