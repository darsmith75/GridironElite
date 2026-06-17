const METRIC_VIDEO_CONFIG = [
  { key: 'forty_yard_dash', fieldName: 'metricVideoFortyYardDash', verifiedField: 'metricVerifiedFortyYardDash', verifiedByField: 'metricVerifiedByFortyYardDash', recordedAtField: 'metricRecordedAtFortyYardDash' },
  { key: 'vertical_jump', fieldName: 'metricVideoVerticalJump', verifiedField: 'metricVerifiedVerticalJump', verifiedByField: 'metricVerifiedByVerticalJump', recordedAtField: 'metricRecordedAtVerticalJump' },
  { key: 'bench_press', fieldName: 'metricVideoBenchPress', verifiedField: 'metricVerifiedBenchPress', verifiedByField: 'metricVerifiedByBenchPress', recordedAtField: 'metricRecordedAtBenchPress' },
  { key: 'squat', fieldName: 'metricVideoSquat', verifiedField: 'metricVerifiedSquat', verifiedByField: 'metricVerifiedBySquat', recordedAtField: 'metricRecordedAtSquat' },
  { key: 'shuttle_5_10_5', fieldName: 'metricVideoShuttle5105', verifiedField: 'metricVerifiedShuttle5105', verifiedByField: 'metricVerifiedByShuttle5105', recordedAtField: 'metricRecordedAtShuttle5105' },
  { key: 'l_drill', fieldName: 'metricVideoLDrill', verifiedField: 'metricVerifiedLDrill', verifiedByField: 'metricVerifiedByLDrill', recordedAtField: 'metricRecordedAtLDrill' },
  { key: 'broad_jump', fieldName: 'metricVideoBroadJump', verifiedField: 'metricVerifiedBroadJump', verifiedByField: 'metricVerifiedByBroadJump', recordedAtField: 'metricRecordedAtBroadJump' },
  { key: 'power_clean', fieldName: 'metricVideoPowerClean', verifiedField: 'metricVerifiedPowerClean', verifiedByField: 'metricVerifiedByPowerClean', recordedAtField: 'metricRecordedAtPowerClean' },
  { key: 'single_leg_squat', fieldName: 'metricVideoSingleLegSquat', verifiedField: 'metricVerifiedSingleLegSquat', verifiedByField: 'metricVerifiedBySingleLegSquat', recordedAtField: 'metricRecordedAtSingleLegSquat' },
  { key: 'catapult', fieldName: 'metricVideoCatapult', verifiedField: 'metricVerifiedCatapult', verifiedByField: 'metricVerifiedByCatapult', recordedAtField: 'metricRecordedAtCatapult' },
  { key: 'metric_1080', fieldName: 'metricVideo1080', verifiedField: 'metricVerified1080', verifiedByField: 'metricVerifiedBy1080', recordedAtField: 'metricRecordedAt1080' },
  { key: 'hand_size', fieldName: 'metricVideoHandSize', verifiedField: 'metricVerifiedHandSize', verifiedByField: 'metricVerifiedByHandSize', recordedAtField: 'metricRecordedAtHandSize' },
  { key: 'wingspan', fieldName: 'metricVideoWingspan', verifiedField: 'metricVerifiedWingspan', verifiedByField: 'metricVerifiedByWingspan', recordedAtField: 'metricRecordedAtWingspan' }
];

const METRIC_TIP_CONFIG = [
  { key: 'forty_yard_dash', label: '40-Yard Dash' },
  { key: 'vertical_jump', label: 'Vertical Jump' },
  { key: 'bench_press', label: 'Bench Press' },
  { key: 'squat', label: 'Squat' },
  { key: 'shuttle_5_10_5', label: '5-10-5 Shuttle' },
  { key: 'l_drill', label: 'L-Drill' },
  { key: 'broad_jump', label: 'Broad Jump' },
  { key: 'power_clean', label: 'Power Clean' },
  { key: 'single_leg_squat', label: 'Single Leg Squat' },
  { key: 'catapult', label: 'Catapult' },
  { key: 'metric_1080', label: '1080' },
  { key: 'hand_size', label: 'Hand Size' },
  { key: 'wingspan', label: 'Wingspan' }
];
const METRIC_TIP_KEYS = new Set(METRIC_TIP_CONFIG.map(item => item.key));

const AD_SLOT_CONFIG = [
  { key: 'agent_dashboard_leaderboard', label: 'Agent Dashboard Top Leaderboard (728x90)' },
  { key: 'player_detail_top_leaderboard', label: 'Player Detail Top Leaderboard (728x90)' },
  { key: 'player_detail_inline', label: 'Player Detail Inline Banner (468x120)' }
];
const AD_SLOT_KEYS = new Set(AD_SLOT_CONFIG.map(item => item.key));

module.exports = {
  METRIC_VIDEO_CONFIG,
  METRIC_TIP_CONFIG,
  METRIC_TIP_KEYS,
  AD_SLOT_CONFIG,
  AD_SLOT_KEYS
};
