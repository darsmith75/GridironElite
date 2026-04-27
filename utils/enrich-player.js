const db = require('../database');

// Helper: Enrich a player profile with data from normalized tables
async function enrichPlayerProfile(profile) {
  if (!profile) return profile;

  // Keep API compatibility: expose player id as the account/user id.
  profile.id = profile.user_id;

  const playerId = profile.user_id;

  let collegeLogoOrderState = {};
  if (profile.college_logo_order) {
    try {
      if (typeof profile.college_logo_order === 'string') {
        const parsed = JSON.parse(profile.college_logo_order);
        collegeLogoOrderState = parsed && typeof parsed === 'object' ? parsed : {};
      } else if (typeof profile.college_logo_order === 'object') {
        collegeLogoOrderState = profile.college_logo_order;
      }
    } catch (_) {
      collegeLogoOrderState = {};
    }
  }

  function applyCollegeOrder(group, schools) {
    if (!Array.isArray(schools) || schools.length === 0) return [];
    const ids = Array.isArray(collegeLogoOrderState[group])
      ? collegeLogoOrderState[group].map(id => Number(id)).filter(Number.isFinite)
      : [];
    if (ids.length === 0) return schools;

    const indexMap = new Map(ids.map((id, index) => [id, index]));
    return [...schools].sort((a, b) => {
      const ai = indexMap.has(Number(a.id)) ? indexMap.get(Number(a.id)) : Number.MAX_SAFE_INTEGER;
      const bi = indexMap.has(Number(b.id)) ? indexMap.get(Number(b.id)) : Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  }

  const [videos, videoLinks, images, metricVideos, offerSchoolsRaw, favoriteSchoolsRaw, contacts] = await Promise.all([
    db.prepare('SELECT filename FROM player_videos WHERE user_id = ? ORDER BY id').all(playerId),
    db.prepare('SELECT id, url, title FROM player_video_links WHERE user_id = ? ORDER BY id').all(playerId),
    db.prepare('SELECT filename FROM player_images WHERE user_id = ? ORDER BY id').all(playerId),
    db.prepare('SELECT metric_key, video_filename, is_verified, verified_by, recorded_at FROM player_metric_videos WHERE user_id = ? ORDER BY id').all(playerId),
    db.prepare(`
      SELECT c.id, c.name, c.logo, c.conference, c.team, COALESCE(vc.visit_count, 0) AS visit_count
      FROM player_school_interests psi
      JOIN colleges c ON psi.college_id = c.id
      LEFT JOIN (
        SELECT college_id, COUNT(*) AS visit_count
        FROM school_notes
        WHERE user_id = ? AND visit_date IS NOT NULL AND TRIM(visit_date) <> ''
        GROUP BY college_id
      ) vc ON vc.college_id = c.id
      WHERE psi.user_id = ? AND psi.has_offer = 1
      ORDER BY c.name
    `).all(playerId, playerId),
    db.prepare(`
      SELECT c.id, c.name, c.logo, c.conference, c.team, COALESCE(vc.visit_count, 0) AS visit_count
      FROM player_school_interests psi
      JOIN colleges c ON psi.college_id = c.id
      LEFT JOIN (
        SELECT college_id, COUNT(*) AS visit_count
        FROM school_notes
        WHERE user_id = ? AND visit_date IS NOT NULL AND TRIM(visit_date) <> ''
        GROUP BY college_id
      ) vc ON vc.college_id = c.id
      WHERE psi.user_id = ? AND psi.is_favorite = 1 AND (psi.has_offer = 0 OR psi.has_offer IS NULL)
      ORDER BY c.name
    `).all(playerId, playerId),
    db.prepare('SELECT role, name, email, phone FROM player_contacts WHERE user_id = ?').all(playerId),
  ]);

  profile.highlight_videos = videos.length > 0 ? JSON.stringify(videos.map(v => v.filename)) : null;
  profile.video_links = videoLinks.length > 0 ? JSON.stringify(videoLinks) : null;
  profile.additional_images = images.length > 0 ? JSON.stringify(images.map(i => i.filename)) : null;
  profile.metric_videos = metricVideos.length > 0 ? JSON.stringify(metricVideos) : null;

  const offerSchools = applyCollegeOrder('offers', offerSchoolsRaw);
  profile.college_offer_schools = offerSchools.length > 0 ? JSON.stringify(offerSchools) : null;

  const favoriteSchools = applyCollegeOrder('favorites', favoriteSchoolsRaw);
  profile.college_favorite_schools = favoriteSchools.length > 0 ? JSON.stringify(favoriteSchools) : null;

  // Include college logo ordering from database
  profile.college_logo_order = profile.college_logo_order || null;

  contacts.forEach(c => {
    profile[c.role + '_name'] = c.name;
    profile[c.role + '_email'] = c.email;
    profile[c.role + '_phone'] = c.phone;
  });

  return profile;
}

module.exports = { enrichPlayerProfile };
