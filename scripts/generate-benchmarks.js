/**
 * generate-benchmarks.js
 * 
 * Generates public/data/player-benchmarks.json from real NFL Combine CSV data
 * exported from Pro Football Reference.
 * 
 * STEP 1: Download combine data from PFR
 *   https://www.pro-football-reference.com/draft/
 *   - Click each year (recommend 2015–2025 for NFL benchmarks)
 *   - Scroll to the combine table → "Share & Export" → "Get table as CSV"
 *   - Save all years into one file, or pass multiple files (they'll be merged)
 * 
 * STEP 2: Run this script
 *   node scripts/generate-benchmarks.js --input combine-2015-2025.csv
 *   node scripts/generate-benchmarks.js --input combine.csv --output public/data/player-benchmarks.json
 * 
 * The same combine data is used for both benchmark levels:
 *   - college_fbs  = ALL combine invitees (they're college-level elite to get an invite)
 *   - nfl          = rounds 1–3 only (players most likely to become NFL starters)
 *                    NOTE: round filtering requires the --rounds-col option or a rounds CSV
 * 
 * CSV columns expected (PFR export format):
 *   Rk, Player, School, Year, Pos, Height (e.g. "6-2"), Weight, 40yd, Vertical,
 *   BenchReps, BroadJump, 3Cone, Shuttle
 * 
 * Usage:
 *   node scripts/generate-benchmarks.js --input <csv_file> [--nfl-rounds-max 3] [--output <json_file>]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(flag, defaultVal = null) {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : defaultVal;
}

const inputFile   = getArg('--input');
const outputFile  = getArg('--output', path.join(__dirname, '..', 'public', 'data', 'player-benchmarks.json'));
const nflRoundsMax = parseInt(getArg('--nfl-rounds-max', '3'), 10);

if (!inputFile) {
  console.error('\nUsage: node scripts/generate-benchmarks.js --input <combine.csv> [options]\n');
  console.error('  --input           Path to PFR combine CSV (required)');
  console.error('  --output          Output JSON path (default: public/data/player-benchmarks.json)');
  console.error('  --nfl-rounds-max  Max draft round for NFL tier (default: 3, use 7 for all drafted)');
  console.error('\nSee file header for download instructions.\n');
  process.exit(1);
}

// ── Position group mapping ────────────────────────────────────────────────────
// Maps PFR position codes → our benchmark group keys
const POS_MAP = {
  QB:  'QB',
  RB:  'RB', FB: 'RB',
  WR:  'WR',
  TE:  'TE',
  T:   'OL', OT: 'OL', G: 'OL', OG: 'OL', C: 'OL',
  DT:  'DL', NT: 'DL',
  DE:  'DL',      // 4-3 DE → DL
  EDGE:'EDGE',    // labelled EDGE in newer PFR data
  OLB: 'EDGE',    // 3-4 OLB pass rushers – overlap with LB but EDGE is more accurate combine-wise
  ILB: 'LB', MLB: 'LB', LB: 'LB',
  CB:  'CB',
  S:   'S', FS: 'S', SS: 'S',
  K:   'KP', P: 'KP', LS: null,  // LS skipped – too few
};

const GROUP_LABELS = {
  nfl: {
    QB: 'NFL Quarterback', RB: 'NFL Running Back', WR: 'NFL Wide Receiver',
    TE: 'NFL Tight End', OL: 'NFL Offensive Line', DL: 'NFL Defensive Line',
    EDGE: 'NFL EDGE Rusher', LB: 'NFL Linebacker', CB: 'NFL Cornerback',
    S: 'NFL Safety', KP: 'NFL Kicker/Punter',
  },
  college_fbs: {
    QB: 'College FBS Quarterback', RB: 'College FBS Running Back', WR: 'College FBS Wide Receiver',
    TE: 'College FBS Tight End', OL: 'College FBS Offensive Line', DL: 'College FBS Defensive Line',
    EDGE: 'College FBS EDGE', LB: 'College FBS Linebacker', CB: 'College FBS Cornerback',
    S: 'College FBS Safety', KP: 'College FBS Kicker/Punter',
  },
};

// Which metrics to include per group (subset of all available)
const GROUP_METRICS = {
  QB:   ['height_inches', 'weight', 'forty_yard_dash', 'vertical_jump', 'broad_jump'],
  RB:   ['height_inches', 'weight', 'forty_yard_dash', 'vertical_jump', 'broad_jump', 'shuttle_5_10_5'],
  WR:   ['height_inches', 'weight', 'forty_yard_dash', 'vertical_jump', 'broad_jump', 'shuttle_5_10_5'],
  TE:   ['height_inches', 'weight', 'forty_yard_dash', 'vertical_jump', 'broad_jump', 'bench_press'],
  OL:   ['height_inches', 'weight', 'forty_yard_dash', 'bench_press'],
  DL:   ['height_inches', 'weight', 'forty_yard_dash', 'vertical_jump', 'bench_press'],
  EDGE: ['height_inches', 'weight', 'forty_yard_dash', 'vertical_jump', 'broad_jump'],
  LB:   ['height_inches', 'weight', 'forty_yard_dash', 'vertical_jump', 'bench_press'],
  CB:   ['height_inches', 'weight', 'forty_yard_dash', 'vertical_jump', 'broad_jump', 'shuttle_5_10_5'],
  S:    ['height_inches', 'weight', 'forty_yard_dash', 'vertical_jump', 'broad_jump'],
  KP:   ['forty_yard_dash'],
};

const METRIC_META = {
  height_inches:  { label: 'Height',       unit: 'in',  best_direction: 'higher' },
  weight:         { label: 'Weight',        unit: 'lbs', best_direction: 'higher' },
  forty_yard_dash:{ label: '40-Yard Dash',  unit: 's',   best_direction: 'lower'  },
  vertical_jump:  { label: 'Vertical Jump', unit: 'in',  best_direction: 'higher' },
  broad_jump:     { label: 'Broad Jump',    unit: 'in',  best_direction: 'higher' },
  bench_press:    { label: 'Bench Press',   unit: 'reps',best_direction: 'higher' },
  shuttle_5_10_5: { label: '5-10-5 Shuttle',unit: 's',  best_direction: 'lower'  },
  cone_3:         { label: '3-Cone Drill',  unit: 's',   best_direction: 'lower'  },
};

// ── Height parser: "6-2" → 74 inches ─────────────────────────────────────────
function parseHeight(raw) {
  if (!raw || !raw.trim()) return null;
  const clean = raw.trim().replace(/[""]/g, '');
  // formats: "6-2", "6'2", "6'2\"", "74"
  const dashMatch = clean.match(/^(\d+)-(\d+)$/);
  if (dashMatch) return parseInt(dashMatch[1], 10) * 12 + parseInt(dashMatch[2], 10);
  const quoteMatch = clean.match(/^(\d+)'(\d+)/);
  if (quoteMatch) return parseInt(quoteMatch[1], 10) * 12 + parseInt(quoteMatch[2], 10);
  const num = parseFloat(clean);
  return Number.isFinite(num) && num > 48 && num < 100 ? num : null;
}

function parseNum(raw) {
  if (!raw || !raw.trim() || raw.trim() === '--') return null;
  const n = parseFloat(raw.trim());
  return Number.isFinite(n) ? n : null;
}

// ── CSV parser (handles quoted fields) ───────────────────────────────────────
function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { fields.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  fields.push(current.trim());
  return fields;
}

// ── Percentile calculator ─────────────────────────────────────────────────────
function percentile(sorted, p) {
  if (!sorted.length) return null;
  const index = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function computeStats(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p25:       round2(percentile(sorted, 25)),
    p50:       round2(percentile(sorted, 50)),
    p75:       round2(percentile(sorted, 75)),
    p90:       round2(percentile(sorted, 90)),
    prototype: round2(percentile(sorted, 75)), // use p75 as "prototype" target
    n:         sorted.length,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function readCSV(filePath) {
  const rows = [];
  const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
  let headers = null;
  let lineNum = 0;
  for await (const line of rl) {
    lineNum++;
    const trimmed = line.trim();
    if (!trimmed) continue;
    const fields = parseCSVLine(trimmed);
    if (!headers) {
      // Normalize header names
      headers = fields.map(h => h.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase());
      continue;
    }
    // Skip PFR repeated header rows (they insert "Rk" header rows periodically)
    if (fields[0] === 'Rk' || fields[0] === '') continue;

    const row = {};
    headers.forEach((h, i) => { row[h] = (fields[i] || '').trim(); });
    rows.push(row);
  }
  if (!headers) throw new Error('CSV appears to be empty — no header row found.');
  console.log(`  Read ${rows.length} data rows. Headers: ${headers.join(', ')}`);
  return rows;
}

function normalizeRow(row) {
  // PFR header names vary slightly by export; try multiple aliases
  const get = (...keys) => {
    for (const k of keys) {
      const found = Object.keys(row).find(h => h === k || h.replace(/[^a-z0-9]/g, '') === k.replace(/[^a-z0-9]/g, ''));
      if (found !== undefined && row[found] !== '') return row[found];
    }
    return '';
  };

  const pos = (get('pos', 'position') || '').toUpperCase().trim();
  const group = POS_MAP[pos];
  if (group === undefined) return null; // unknown position
  if (group === null) return null;      // explicitly skipped (LS)

  const round = parseInt(get('rnd', 'round', 'dr', 'draftround') || '99', 10);

  return {
    pos,
    group,
    round: Number.isFinite(round) ? round : 99,
    height_inches:   parseHeight(get('ht', 'height')),
    weight:          parseNum(get('wt', 'weight')),
    forty_yard_dash: parseNum(get('40yd', 'fortyyarddash', '40')),
    vertical_jump:   parseNum(get('vertical', 'vert')),
    broad_jump:      parseNum(get('broadjump', 'broad', 'bj')),
    bench_press:      parseNum(get('benchreps', 'bench')),
    shuttle_5_10_5:  parseNum(get('shuttle', 'shu')),
    cone_3:          parseNum(get('3cone', 'cone')),
  };
}

function buildGroupData(players, levelLabel, groupLabels) {
  const byGroup = {};
  for (const p of players) {
    if (!byGroup[p.group]) byGroup[p.group] = [];
    byGroup[p.group].push(p);
  }

  const result = {};
  const metricKeys = Object.keys(METRIC_META);

  for (const [group, members] of Object.entries(byGroup)) {
    const wantedMetrics = GROUP_METRICS[group] || metricKeys;
    const metrics = {};

    for (const metricKey of wantedMetrics) {
      const values = members.map(m => m[metricKey]).filter(v => v !== null && Number.isFinite(v));
      if (values.length < 5) continue; // skip if too few data points
      const stats = computeStats(values);
      if (!stats) continue;
      metrics[metricKey] = {
        ...METRIC_META[metricKey],
        p25: stats.p25,
        p50: stats.p50,
        p75: stats.p75,
        p90: stats.p90,
        prototype: stats.prototype,
      };
    }

    if (Object.keys(metrics).length === 0) continue;

    result[group] = {
      label: groupLabels[group] || group,
      sample_size: members.length,
      metrics,
    };
  }

  // Sort groups in standard order
  const ORDER = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'EDGE', 'LB', 'CB', 'S', 'KP'];
  const sorted = {};
  for (const k of ORDER) {
    if (result[k]) sorted[k] = result[k];
  }
  // Append any unexpected groups at the end
  for (const k of Object.keys(result)) {
    if (!sorted[k]) sorted[k] = result[k];
  }
  return sorted;
}

async function main() {
  console.log(`\n=== GridironElite Benchmark Generator ===`);
  console.log(`Input:  ${inputFile}`);
  console.log(`Output: ${outputFile}`);
  console.log(`NFL tier: rounds 1–${nflRoundsMax}\n`);

  if (!fs.existsSync(inputFile)) {
    console.error(`Error: File not found: ${inputFile}`);
    console.error('\nDownload combine data from:');
    console.error('  https://www.pro-football-reference.com/draft/');
    console.error('  → "Share & Export" → "Get table as CSV" for each year (2015–2025 recommended)');
    console.error('  → Merge all years into one CSV file\n');
    process.exit(1);
  }

  console.log('Reading CSV...');
  const rawRows = await readCSV(inputFile);

  console.log('Normalizing rows...');
  const normalized = rawRows.map(normalizeRow).filter(Boolean);
  console.log(`  ${normalized.length} valid player rows (${rawRows.length - normalized.length} skipped)`);

  // NFL tier: top rounds only
  const nflPlayers = normalized.filter(p => p.round <= nflRoundsMax);
  // College FBS tier: all combine invitees
  const allPlayers = normalized;

  console.log(`  NFL tier (rounds 1–${nflRoundsMax}): ${nflPlayers.length} players`);
  console.log(`  College FBS tier (all invitees): ${allPlayers.length} players`);

  if (nflPlayers.length < 50) {
    console.warn('\n  Warning: very few NFL-tier players. Check that the CSV has a round/draft column.');
    console.warn('  Using all players for NFL tier as fallback.\n');
  }

  const nflData     = buildGroupData(nflPlayers.length >= 50 ? nflPlayers : allPlayers, 'nfl', GROUP_LABELS.nfl);
  const collegeData = buildGroupData(allPlayers, 'college_fbs', GROUP_LABELS.college_fbs);

  const output = {
    meta: {
      version: 2,
      generated_at: new Date().toISOString(),
      sources: [path.basename(inputFile)],
      nfl_rounds_max: nflRoundsMax,
      total_players: allPlayers.length,
      note: `Generated from real NFL Combine data. NFL tier = rounds 1–${nflRoundsMax}. College FBS tier = all combine invitees.`,
    },
    levels: {
      nfl:         nflData,
      college_fbs: collegeData,
    },
  };

  // Summary
  console.log('\nPosition groups generated:');
  console.log('  NFL:         ', Object.keys(nflData).join(', '));
  console.log('  College FBS: ', Object.keys(collegeData).join(', '));

  const outDir = path.dirname(outputFile);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // Back up existing file
  if (fs.existsSync(outputFile)) {
    const backup = outputFile.replace('.json', `.backup-${Date.now()}.json`);
    fs.copyFileSync(outputFile, backup);
    console.log(`\nBacked up existing file → ${path.basename(backup)}`);
  }

  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2), 'utf8');
  console.log(`\n✓ Wrote ${outputFile}\n`);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
