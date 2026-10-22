const positionAliasToBlueprintKey = {
  qb: 'QB', quarterback: 'QB',
  rb: 'RB', runningback: 'RB', hb: 'RB', tailback: 'RB',
  wr: 'WR', widereceiver: 'WR', receiver: 'WR',
  te: 'TE', tightend: 'TE',
  ol: 'OL', offensiveline: 'OL',
  ot: 'OT', offensivetackle: 'OT', tackle: 'OT',
  og: 'OG', offensiveguard: 'OG', guard: 'OG',
  c: 'C', center: 'C',
  dl: 'DL', defensiveline: 'DL',
  edge: 'EDGE', edgerusher: 'EDGE', de: 'EDGE', defensiveend: 'EDGE',
  lb: 'LB', linebacker: 'LB', olb: 'LB', mlb: 'LB',
  cb: 'CB', cornerback: 'CB',
  s: 'S', safety: 'S', fs: 'S', ss: 'S',
  k: 'K', kicker: 'K', punter: 'K', p: 'K'
};

const positionBlueprints = {
  QB: {
    label: 'QB', fullName: 'Quarterback',
    summary: 'A position blueprint for arm talent, decision-making, poise, verified production, and command of the offense.',
    frame: [['Power 4', '6-2 to 6-5', '200-225', '4.65-4.95'], ['FCS', '6-1 to 6-4', '190-220', '4.70-5.00'], ['Division II', '6-0 to 6-3', '185-215', '4.75-5.05'], ['Division III', '5-11 to 6-3', '180-210', '4.80-5.15']],
    film: ['Accuracy and ball placement', 'Quick release and mechanics', 'Pocket presence', 'Decision-making', 'Throwing on the run', 'Deep-ball touch', 'Reading coverage', 'Leadership and command'],
    production: [['COMP %', 'Efficiency'], ['PASS YDS', 'Production'], ['TD-INT', 'Decision making'], ['QBR', 'Command'], ['RUSH YDS', 'Mobility'], ['WINS', 'Leadership']],
    traits: ['Accuracy', 'Arm strength', 'Footwork and mechanics', 'Football IQ', 'Pocket poise', 'Decision-making', 'Mobility and escapability', 'Leadership'],
    mistakes: ['Locking onto first read', 'Drifting in the pocket', 'Poor footwork', 'Forcing throws', 'Taking sacks unnecessarily'],
    skills: ['Footwork and dropbacks', 'Pocket movement', 'Timing and anticipation', 'Progression reads', 'Throwing on the run', 'Leadership and communication'],
    note: 'College coaches recruit quarterbacks who show accuracy, timing, decision-making, poise, leadership, and verified production.'
  },
  RB: {
    label: 'RB', fullName: 'Running Back',
    summary: 'A position blueprint for burst, vision, contact balance, receiving value, protection toughness, and ball security.',
    frame: [['Power 4', '5-9 to 6-1', '195-225', '4.40-4.60'], ['FCS', '5-8 to 6-0', '185-215', '4.50-4.70'], ['Division II', '5-8 to 5-11', '180-210', '4.55-4.75'], ['Division III', '5-7 to 5-11', '170-200', '4.60-4.85']],
    film: ['Burst through the hole', 'Contact balance', 'Vision and cut timing', 'Finishing runs', 'Pass protection reps', 'Receiving out of backfield', 'Ball security', 'Short-yardage toughness'],
    production: [['YPC', 'Explosiveness'], ['RUSH YDS', 'Volume'], ['TDs', 'Finish'], ['REC', 'Versatility'], ['1ST DOWNS', 'Reliability'], ['FUMBLES', 'Security']],
    traits: ['Burst', 'Vision', 'Contact balance', 'Pad level', 'Lateral agility', 'Ball security', 'Receiving hands', 'Protection toughness'],
    mistakes: ['Bouncing every run outside', 'Running too high', 'Missing protection assignments', 'Loose ball carriage', 'Not finishing runs'],
    skills: ['Track and press reads', 'One-cut acceleration', 'Pass protection fits', 'Route releases', 'Ball security', 'Lower-body power'],
    note: 'College coaches recruit backs who create yards, protect the football, help on passing downs, and finish through contact.'
  },
  WR: {
    label: 'WR', fullName: 'Wide Receiver',
    summary: 'A position blueprint for separation, hands, route detail, yards after catch, contested catches, and perimeter toughness.',
    frame: [['Power 4', '6-0 to 6-4', '180-215', '4.35-4.55'], ['FCS', '5-11 to 6-3', '170-205', '4.45-4.65'], ['Division II', '5-10 to 6-2', '165-200', '4.50-4.75'], ['Division III', '5-9 to 6-2', '160-195', '4.55-4.85']],
    film: ['Release versus press', 'Route tempo and separation', 'Hands away from body', 'Contested catches', 'YAC ability', 'Blocking effort', 'Sideline awareness', 'Explosive plays'],
    production: [['REC', 'Volume'], ['REC YDS', 'Production'], ['TDs', 'Finish'], ['YAC', 'Explosive'], ['1ST DOWNS', 'Reliable'], ['DROP %', 'Hands']],
    traits: ['Speed', 'Hands', 'Route running', 'Body control', 'Release package', 'Catch radius', 'Blocking effort', 'Football IQ'],
    mistakes: ['Rounded routes', 'Body-catching', 'No release plan', 'Poor stalk blocking', 'Not attacking the ball'],
    skills: ['Release mechanics', 'Top-of-route separation', 'High-point catches', 'Sideline catches', 'YAC finish', 'Perimeter blocking'],
    note: 'College coaches recruit receivers who separate, catch cleanly, create explosives, and compete without the ball.'
  },
  TE: {
    label: 'TE', fullName: 'Tight End',
    summary: 'A position blueprint for size, versatility, toughness, hands, blocking value, and verified production.',
    frame: [['Power 4', '6-3 to 6-6', '225-255', '4.60-4.85'], ['FCS', '6-2 to 6-5', '215-245', '4.70-4.95'], ['Division II', '6-2 to 6-5', '210-245', '4.75-5.00'], ['Division III', '6-1 to 6-4', '205-240', '4.85-5.10']],
    film: ['Reliable hands and catches', 'Route running and separation', 'Contested catches', 'Catch radius and ball skills', 'YAC ability', 'In-line blocking effort', 'Pass protection willingness', 'Red-zone production'],
    production: [['REC', 'Volume'], ['REC YDS', 'Production'], ['TDs', 'Finish'], ['YAC', 'Explosive'], ['1ST DOWNS', 'Reliable'], ['BLOCKING', 'Complete game']],
    traits: ['Size and frame', 'Hands and catch radius', 'Route running', 'Physicality and toughness', 'Run blocking ability', 'Body control', 'Versatility and alignment value', 'Football IQ'],
    mistakes: ['Body-catching', 'Rounded routes', 'Poor blocking effort', 'Inconsistent hand placement', 'Not finishing through contact'],
    skills: ['Release mechanics', 'Route tempo', 'Blocking leverage', 'Hand placement', 'Ball tracking', 'Pass protection fundamentals'],
    note: 'College coaches recruit tight ends who show catches, route running, physicality, and complete tight end play.'
  },
  OL: {
    label: 'OL', fullName: 'Offensive Line',
    summary: 'A position blueprint for size, leverage, footwork, hand placement, play strength, and finish.',
    frame: [['Power 4', '6-3 to 6-6', '285-325', '5.05-5.35'], ['FCS', '6-2 to 6-5', '270-310', '5.15-5.50'], ['Division II', '6-1 to 6-5', '255-300', '5.25-5.65'], ['Division III', '6-0 to 6-4', '245-290', '5.35-5.85']],
    film: ['Pass sets versus speed', 'Run-game displacement', 'Second-level climbs', 'Hand placement', 'Leverage and pad level', 'Recovering against counters', 'Finish through whistle', 'Communication'],
    production: [['PANCAKES', 'Finish'], ['SACKS ALLOWED', 'Protection'], ['TFL ALLOWED', 'Control'], ['EXPLOSIVE RUNS', 'Movement'], ['GRADES', 'Consistency'], ['SNAPS', 'Durability']],
    traits: ['Size and length', 'Feet and balance', 'Hand usage', 'Play strength', 'Leverage', 'Awareness', 'Toughness', 'Finish'],
    mistakes: ['Over-setting in pass pro', 'High pad level', 'Wide hands', 'Stopping feet on contact', 'Missing line calls'],
    skills: ['Pass-set angles', 'Independent hands', 'Hip roll on contact', 'Combo timing', 'Anchor work', 'Second-level tracking'],
    note: 'College coaches recruit linemen who can move people, protect space, communicate, and play with consistent technique.'
  },
  OT: {
    label: 'OT', fullName: 'Offensive Tackle',
    summary: 'A position blueprint for length, pass-set range, anchor strength, hand timing, and edge protection.',
    frame: [['Power 4', '6-5 to 6-8', '290-330', '5.05-5.35'], ['FCS', '6-4 to 6-7', '275-315', '5.15-5.50'], ['Division II', '6-3 to 6-6', '260-305', '5.25-5.65'], ['Division III', '6-2 to 6-5', '250-295', '5.35-5.85']],
    film: ['Kick-slide range', 'Anchor versus power', 'Hands inside frame', 'Recovery against counters', 'Edge run blocking', 'Second-level finish', 'Screen space movement', 'Communication'],
    production: [['SACKS ALLOWED', 'Protection'], ['PRESSURES', 'Control'], ['PANCAKES', 'Finish'], ['RUSH AVG', 'Movement'], ['GRADES', 'Consistency'], ['SNAPS', 'Durability']],
    traits: ['Length', 'Foot quickness', 'Balance', 'Punch timing', 'Anchor', 'Range', 'Awareness', 'Finish'],
    mistakes: ['Opening the gate early', 'Lunging', 'Catching rushers', 'High hands', 'Stopping feet'],
    skills: ['Vertical sets', 'Independent hands', 'Anchor resets', 'Counter recovery', 'Reach blocks', 'Second-level angles'],
    note: 'College coaches recruit tackles who protect the edge, recover in space, and show length with controlled feet.'
  },
  OG: {
    label: 'OG', fullName: 'Offensive Guard',
    summary: 'A position blueprint for power, leverage, short-area quickness, combo timing, and interior toughness.',
    frame: [['Power 4', '6-2 to 6-5', '295-335', '5.10-5.45'], ['FCS', '6-1 to 6-4', '280-320', '5.20-5.60'], ['Division II', '6-0 to 6-4', '265-310', '5.30-5.75'], ['Division III', '5-11 to 6-3', '250-300', '5.40-5.90']],
    film: ['Drive blocks', 'Combo blocks', 'Pulling in space', 'Anchor versus bull rush', 'Hands and leverage', 'Short-yardage finish', 'Screen movement', 'Pass-pro communication'],
    production: [['PANCAKES', 'Finish'], ['SACKS ALLOWED', 'Protection'], ['RUN GRADE', 'Movement'], ['PULLS', 'Space value'], ['PRESSURES', 'Control'], ['SNAPS', 'Durability']],
    traits: ['Power', 'Leverage', 'Hip explosion', 'Short-area quickness', 'Hand strength', 'Anchor', 'Toughness', 'Awareness'],
    mistakes: ['Playing too tall', 'Slow hands', 'Poor combo timing', 'Crossing over on pulls', 'Losing inside leverage'],
    skills: ['Double teams', 'Pull footwork', 'Anchor sets', 'Strike timing', 'Leverage work', 'Line calls'],
    note: 'College coaches recruit guards who create movement inside, anchor in protection, and finish physical reps.'
  },
  C: {
    label: 'C', fullName: 'Center',
    summary: 'A position blueprint for accuracy, intelligence, leverage, anchor strength, communication, and consistency.',
    frame: [['Power 4', '6-1 to 6-4', '285-320', '5.10-5.45'], ['FCS', '6-0 to 6-3', '270-310', '5.20-5.60'], ['Division II', '5-11 to 6-3', '255-300', '5.30-5.75'], ['Division III', '5-10 to 6-2', '245-290', '5.40-5.90']],
    film: ['Clean snaps', 'Line calls', 'Reach blocks', 'Combo timing', 'Anchor versus nose', 'Second-level angles', 'Pass-pro awareness', 'Finish through whistle'],
    production: [['SNAP ERRORS', 'Accuracy'], ['SACKS ALLOWED', 'Protection'], ['RUN GRADE', 'Movement'], ['CALLS', 'Command'], ['PANCAKES', 'Finish'], ['SNAPS', 'Reliability']],
    traits: ['Football IQ', 'Snap accuracy', 'Leverage', 'Anchor', 'Balance', 'Communication', 'Short-area quickness', 'Toughness'],
    mistakes: ['High snaps', 'Late line calls', 'Over-setting', 'Losing leverage', 'Poor combo timing'],
    skills: ['Shotgun and under-center snaps', 'Protection IDs', 'Reach steps', 'Anchor resets', 'Combo timing', 'Second-level tracking'],
    note: 'College coaches recruit centers who control the front, snap accurately, and play with leverage under pressure.'
  },
  DL: {
    label: 'DL', fullName: 'Defensive Line',
    summary: 'A position blueprint for get-off, leverage, block destruction, gap control, disruption, and motor.',
    frame: [['Power 4', '6-2 to 6-5', '270-315', '4.90-5.25'], ['FCS', '6-1 to 6-4', '255-300', '5.00-5.40'], ['Division II', '6-0 to 6-4', '245-290', '5.10-5.55'], ['Division III', '5-11 to 6-3', '235-280', '5.20-5.75']],
    film: ['First-step get-off', 'Hands and shed', 'Gap control', 'Backfield disruption', 'Pass-rush counters', 'Run stops', 'Pursuit effort', 'Finish on contact'],
    production: [['TFL', 'Disruption'], ['SACKS', 'Finish'], ['PRESSURES', 'Impact'], ['RUN STOPS', 'Strength'], ['FF/FR', 'Turnovers'], ['SNAPS', 'Motor']],
    traits: ['Explosive get-off', 'Leverage', 'Heavy hands', 'Play strength', 'Block destruction', 'Gap discipline', 'Motor', 'Football IQ'],
    mistakes: ['Standing straight up', 'Running around blocks', 'No counter move', 'Losing gap control', 'Taking plays off'],
    skills: ['Stance and start', 'Hand combat', 'Shed technique', 'Pass-rush plan', 'Counter moves', 'Run-fit discipline'],
    note: 'College coaches recruit defensive linemen who disrupt, control gaps, shed blocks, and play with relentless effort.'
  },
  EDGE: {
    label: 'EDGE', fullName: 'Edge Rusher',
    summary: 'A position blueprint for explosiveness, length, bend, pass-rush plan, run edge, and finish.',
    frame: [['Power 4', '6-3 to 6-6', '235-265', '4.55-4.80'], ['FCS', '6-2 to 6-5', '225-255', '4.65-4.90'], ['Division II', '6-1 to 6-4', '220-255', '4.70-5.00'], ['Division III', '6-0 to 6-4', '210-250', '4.80-5.10']],
    film: ['Sacks and pressures', 'Block destruction', 'Forced fumbles', 'Pursuit from backside', 'Tackles for loss', 'Setting the edge', 'Open-field tackles', 'Special-teams effort'],
    production: [['SACKS', 'Finish'], ['TFL', 'Disruption'], ['PRESSURES', 'Impact'], ['FF', 'Turnovers'], ['RUN STOPS', 'Strength'], ['MOTOR', 'Effort']],
    traits: ['Explosive get-off', 'Length and reach', 'Bend and body control', 'Violent hand usage', 'Speed-to-power', 'Set the edge', 'Pursuit and motor', 'Football IQ'],
    mistakes: ['Standing straight up', 'Running around every block', 'No counter move', 'Poor hand placement', 'Taking plays off'],
    skills: ['Pass-rush plan', 'Run defense', 'Hand combat', 'Counter moves', 'Block shedding', 'Open-field finish'],
    note: 'College coaches recruit edge players who show explosiveness, violence, finish, projection, and verified production.'
  },
  LB: {
    label: 'LB', fullName: 'Linebacker',
    summary: 'A position blueprint for instincts, range, physicality, coverage value, tackling, and communication.',
    frame: [['Power 4', '6-1 to 6-3', '220-245', '4.50-4.75'], ['FCS', '6-0 to 6-2', '210-235', '4.60-4.85'], ['Division II', '5-11 to 6-2', '205-230', '4.65-4.95'], ['Division III', '5-10 to 6-1', '195-225', '4.75-5.05']],
    film: ['Run fits', 'Open-field tackling', 'Block shedding', 'Coverage drops', 'Blitz timing', 'Sideline-to-sideline range', 'Communication', 'Special teams'],
    production: [['TACKLES', 'Volume'], ['TFL', 'Impact'], ['SACKS', 'Blitz'], ['INT/PBU', 'Coverage'], ['FF/FR', 'Turnovers'], ['ST', 'Value']],
    traits: ['Instincts', 'Speed and range', 'Physicality', 'Tackling', 'Block destruction', 'Coverage ability', 'Communication', 'Motor'],
    mistakes: ['False steps', 'Overrunning fits', 'Poor angles', 'Catching blocks', 'Guessing in coverage'],
    skills: ['Read steps', 'Run-fit tracking', 'Block shed', 'Zone drops', 'Open-field tackling', 'Pressure timing'],
    note: 'College coaches recruit linebackers who diagnose quickly, tackle reliably, communicate, and affect both run and pass.'
  },
  CB: {
    label: 'CB', fullName: 'Cornerback',
    summary: 'A position blueprint for speed, coverage technique, ball skills, confidence, tackling, and short memory.',
    frame: [['Power 4', '5-11 to 6-2', '175-200', '4.35-4.55'], ['FCS', '5-10 to 6-1', '170-195', '4.45-4.65'], ['Division II', '5-9 to 6-0', '165-190', '4.50-4.75'], ['Division III', '5-8 to 6-0', '160-185', '4.55-4.85']],
    film: ['Man coverage reps', 'Zone awareness', 'Press technique', 'Ball skills', 'Open-field tackling', 'Recovery speed', 'Route recognition', 'Special teams'],
    production: [['INT/PBU', 'Ball skills'], ['TARGETS', 'Trust'], ['COMP %', 'Coverage'], ['TACKLES', 'Finish'], ['TFL', 'Support'], ['ST', 'Value']],
    traits: ['Long speed', 'Change of direction', 'Hip fluidity', 'Ball skills', 'Press patience', 'Tackling', 'Confidence', 'Football IQ'],
    mistakes: ['Opening hips early', 'Panicking at catch point', 'Poor eye discipline', 'Avoiding tackles', 'Slow transition'],
    skills: ['Press footwork', 'Off-man breaks', 'Zone eyes', 'Ball tracking', 'Tackle leverage', 'Recovery technique'],
    note: 'College coaches recruit corners who can cover, compete at the catch point, tackle in space, and handle pressure.'
  },
  S: {
    label: 'S', fullName: 'Safety',
    summary: 'A position blueprint for range, instincts, ball skills, tackling, communication, and dependable run support.',
    frame: [['Power 4', '6-0 to 6-2', '190-210', '4.45-4.65'], ['FCS', '5-11 to 6-1', '185-205', '4.50-4.70'], ['Division II', '5-10 to 6-0', '180-200', '4.55-4.75'], ['Division III', '5-9 to 5-11', '175-195', '4.60-4.80']],
    film: ['Range and closing speed', 'Ball skills and turnovers', 'Open-field tackling', 'Instincts and diagnose ability', 'Run support and physicality', 'Man-to-man coverage', 'Zone awareness', 'Communication and leadership'],
    production: [['TACKLES', 'Solo stops'], ['INT/PBU', 'Breakups'], ['PASSER RTG', 'Coverage'], ['TFL', 'Run support'], ['FF/FR', 'Turnovers'], ['ST', 'Contributor']],
    traits: ['Instincts and football IQ', 'Reaction time', 'Speed and range', 'Change of direction', 'Ball skills', 'Physicality', 'Open-field tackling', 'Leadership'],
    mistakes: ['Taking poor angles', 'Over-pursuing plays', 'Getting blocked out of the play', 'Lack of communication', 'Ball watching', 'Giving up explosive plays'],
    skills: ['Speed and range', 'Reading the QB', 'Ball tracking and hands', 'Tackling fundamentals', 'Coverage techniques', 'Pursuit and angles'],
    note: 'College coaches recruit safeties who are smart, physical, dependable, and able to control the deep field and support the run.'
  },
  K: {
    label: 'K', fullName: 'Kicker',
    summary: 'A position blueprint for repeatable mechanics, leg strength, accuracy, operation time, pressure, and kickoff value.',
    frame: [['Power 4', '5-10 to 6-3', '170-205', 'Specialist'], ['FCS', '5-9 to 6-2', '165-200', 'Specialist'], ['Division II', '5-8 to 6-2', '160-195', 'Specialist'], ['Division III', '5-8 to 6-1', '155-190', 'Specialist']],
    film: ['Field goals by distance', 'Kickoffs with hang and depth', 'PAT consistency', 'Operation timing', 'Bad-weather reps', 'Pressure kicks', 'Onside/squib options', 'Tackling willingness'],
    production: [['FG %', 'Accuracy'], ['PAT %', 'Reliability'], ['KO AVG', 'Leg strength'], ['TOUCHBACKS', 'Field position'], ['LONG FG', 'Range'], ['CLUTCH', 'Pressure']],
    traits: ['Leg strength', 'Accuracy', 'Repeatable mechanics', 'Mental composure', 'Flexibility', 'Operation speed', 'Consistency', 'Competitiveness'],
    mistakes: ['Only showing makes', 'No charted distances', 'Slow operation', 'Inconsistent approach', 'Ignoring kickoffs'],
    skills: ['Approach rhythm', 'Plant foot consistency', 'Contact point', 'Kickoff trajectory', 'Pressure routine', 'Charted sessions'],
    note: 'College coaches recruit kickers who prove range, consistency, operation speed, kickoff value, and poise under pressure.'
  }
};

function escapePositionBlueprintHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getPositionBlueprintKey(positionValue) {
  const raw = String(positionValue || '').trim();
  const upper = raw.toUpperCase();
  if (positionBlueprints[upper]) return upper;
  const token = raw.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return positionAliasToBlueprintKey[token] || '';
}

function renderPositionBlueprint(positionValue, containerId = 'positionBlueprint') {
  const container = document.getElementById(containerId);
  if (!container) return;
  const blueprintKey = getPositionBlueprintKey(positionValue);
  const blueprint = blueprintKey ? positionBlueprints[blueprintKey] : null;
  if (!blueprint) {
    container.innerHTML = '<div class="position-blueprint-header"><div><p class="position-blueprint-kicker">What college coaches look for</p><h3 class="position-blueprint-title">Position</h3><p class="position-blueprint-subtitle">Add a position to your profile to unlock a recruiting blueprint with frame targets, film priorities, production markers, traits, mistakes, and position skills.</p></div><div class="position-blueprint-badge">My Position Blueprint</div></div><div class="position-blueprint-body"><p class="position-blueprint-empty">Your position-specific blueprint will appear here after your profile position is saved.</p></div>';
    return;
  }
  const safe = escapePositionBlueprintHtml;
  const frameRows = blueprint.frame.map((row) => '<tr><td>' + safe(row[0]) + '</td><td>' + safe(row[1]) + '</td><td>' + safe(row[2]) + '</td><td>' + safe(row[3]) + '</td></tr>').join('');
  const filmItems = blueprint.film.map((item) => '<li>' + safe(item) + '</li>').join('');
  const productionCards = blueprint.production.map((item) => '<div class="position-metric-card"><strong>' + safe(item[0]) + '</strong><span>' + safe(item[1]) + '</span></div>').join('');
  const traitCards = blueprint.traits.map((item, index) => '<div class="position-trait-card"><strong>' + String(index + 1).padStart(2, '0') + '</strong><span>' + safe(item) + '</span></div>').join('');
  const mistakeItems = blueprint.mistakes.map((item) => '<li>' + safe(item) + '</li>').join('');
  const skillItems = blueprint.skills.map((item) => '<li>' + safe(item) + '</li>').join('');
  container.innerHTML = '<div class="position-blueprint-header"><div><p class="position-blueprint-kicker">What college coaches look for</p><h3 class="position-blueprint-title">' + safe(blueprint.label) + '</h3><p class="position-blueprint-subtitle">' + safe(blueprint.summary) + '</p></div><div class="position-blueprint-badge">' + safe(blueprint.fullName) + ' Blueprint</div></div><div class="position-blueprint-body"><section class="position-blueprint-section"><h4>Ideal College Frame</h4><table class="position-frame-table"><thead><tr><th>Level</th><th>Height</th><th>Weight</th><th>40-YD</th></tr></thead><tbody>' + frameRows + '</tbody></table><p class="position-blueprint-note">General recruiting ranges only. Scheme, age, production, verified film, and projection can outweigh one measurement.</p></section><section class="position-blueprint-section"><h4>Film Must Show</h4><ul class="position-check-grid">' + filmItems + '</ul></section><section class="position-blueprint-section"><h4>Traits Coaches Evaluate</h4><div class="position-trait-grid">' + traitCards + '</div></section><section class="position-blueprint-section"><h4>Production That Matters</h4><div class="position-metric-grid">' + productionCards + '</div></section><section class="position-blueprint-section"><h4>Common Mistakes</h4><ul class="position-mistake-list">' + mistakeItems + '</ul></section><section class="position-blueprint-section"><h4>Build These Position Skills</h4><ul class="position-skill-grid">' + skillItems + '</ul></section><div class="position-coach-note"><div class="position-coach-note-icon" aria-hidden="true">🏈</div><div><strong>Coach\'s Note</strong><p>' + safe(blueprint.note) + '</p></div></div></div>';
}