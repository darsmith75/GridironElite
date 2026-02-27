const db = require('./database');

// Sample data for each player based on their position
const sampleMetrics = {
  'Marcus Johnson': { // QB
    shuttle_5_10_5: 4.35,
    l_drill: 7.15,
    broad_jump: 115,
    power_clean: 275,
    single_leg_squat: 185
  },
  'Tyrell Washington': { // WR
    shuttle_5_10_5: 4.18,
    l_drill: 6.85,
    broad_jump: 125,
    power_clean: 245,
    single_leg_squat: 165
  },
  'James Rodriguez': { // LB
    shuttle_5_10_5: 4.42,
    l_drill: 7.28,
    broad_jump: 118,
    power_clean: 315,
    single_leg_squat: 225
  },
  'Devon Harris': { // RB
    shuttle_5_10_5: 4.25,
    l_drill: 6.95,
    broad_jump: 122,
    power_clean: 285,
    single_leg_squat: 195
  },
  'Brandon Mitchell': { // DL
    shuttle_5_10_5: 4.68,
    l_drill: 7.55,
    broad_jump: 108,
    power_clean: 335,
    single_leg_squat: 245
  }
};

console.log('Adding sample metrics to existing players...\n');

// Get all players
const players = db.prepare('SELECT id, full_name FROM player_profiles').all();

players.forEach(player => {
  const metrics = sampleMetrics[player.full_name];
  
  if (metrics) {
    db.prepare(`
      UPDATE player_profiles 
      SET shuttle_5_10_5 = ?, l_drill = ?, broad_jump = ?, power_clean = ?, single_leg_squat = ?
      WHERE id = ?
    `).run(
      metrics.shuttle_5_10_5,
      metrics.l_drill,
      metrics.broad_jump,
      metrics.power_clean,
      metrics.single_leg_squat,
      player.id
    );
    
    console.log(`✓ Updated ${player.full_name}:`);
    console.log(`  5-10-5 Shuttle: ${metrics.shuttle_5_10_5}s`);
    console.log(`  L-Drill: ${metrics.l_drill}s`);
    console.log(`  Broad Jump: ${metrics.broad_jump}"`);
    console.log(`  Power Clean: ${metrics.power_clean} lbs`);
    console.log(`  Single Leg Squat: ${metrics.single_leg_squat} lbs\n`);
  } else {
    console.log(`⚠ No sample data for ${player.full_name}\n`);
  }
});

console.log('Sample metrics added successfully!');
