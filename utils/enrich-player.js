const db = require('../database');
const { normalizeCollegeLogoPath } = require('./college-logo-path');

function parseCollegeLogoOrderState(profile) {
  let collegeLogoOrderState = {};
  if (!profile?.college_logo_order) return collegeLogoOrderState;

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

  return collegeLogoOrderState;
}

function applyCollegeOrder(collegeLogoOrderState, group, schools) {
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

function computeAgeFlag(profile) {
  if (!profile.birth_date || !profile.graduation_year) return;
  const gradYear = Number(profile.graduation_year);
  if (!Number.isFinite(gradYear)) return;
  // Players born before Sept 1 of (gradYear - 18) are older than typical classmates
  const classStartDate = new Date(Date.UTC(gradYear - 18, 8, 1)); // Sept 1
  const birthDate = new Date(profile.birth_date);
  if (!Number.isFinite(birthDate.getTime())) return;
  profile.age_flag = birthDate < classStartDate ? 'old_for_class' : null;
}

function groupRowsByUser(rows, mapper) {
  const grouped = new Map();
  for (const row of rows || []) {
    const userId = Number(row.user_id);
    if (!Number.isInteger(userId)) continue;
    if (!grouped.has(userId)) grouped.set(userId, []);
    grouped.get(userId).push(mapper ? mapper(row) : row);
  }
  return grouped;
}

async function enrichPlayerProfiles(profiles) {
  if (!Array.isArray(profiles) || profiles.length === 0) return profiles;

  const playerIds = Array.from(new Set(
    profiles.map(profile => Number(profile?.user_id)).filter(Number.isInteger)
  ));
  if (playerIds.length === 0) return profiles;

  const [videos, videoLinks, images, metricVideos, schoolInterestsRaw, contacts] = await Promise.all([
    db.prepare('SELECT user_id, filename FROM player_videos WHERE user_id = ANY(?::int[]) ORDER BY user_id, id').all(playerIds),
    db.prepare('SELECT user_id, id, url, title FROM player_video_links WHERE user_id = ANY(?::int[]) ORDER BY user_id, id').all(playerIds),
    db.prepare('SELECT user_id, filename FROM player_images WHERE user_id = ANY(?::int[]) ORDER BY user_id, id').all(playerIds),
    db.prepare('SELECT user_id, metric_key, video_filename, is_verified, verified_by, recorded_at FROM player_metric_videos WHERE user_id = ANY(?::int[]) ORDER BY user_id, id').all(playerIds),
    db.prepare(`
      SELECT psi.user_id, psi.has_offer, psi.is_favorite, c.id, c.name, c.logo, c.division, c.conference, c.team, COALESCE(vc.visit_count, 0) AS visit_count
      FROM player_school_interests psi
      JOIN colleges c ON psi.college_id = c.id
      LEFT JOIN (
        SELECT user_id, college_id, COUNT(*) AS visit_count
        FROM school_notes
        WHERE user_id = ANY(?::int[]) AND visit_date IS NOT NULL AND TRIM(visit_date) <> ''
        GROUP BY user_id, college_id
      ) vc ON vc.user_id = psi.user_id AND vc.college_id = c.id
      WHERE psi.user_id = ANY(?::int[]) AND (psi.has_offer = 1 OR psi.is_favorite = 1)
      ORDER BY psi.user_id, c.name
    `).all(playerIds, playerIds),
    db.prepare('SELECT user_id, role, name, email, phone FROM player_contacts WHERE user_id = ANY(?::int[]) ORDER BY user_id, id').all(playerIds),
  ]);

  const videosByUser = groupRowsByUser(videos, row => row.filename);
  const videoLinksByUser = groupRowsByUser(videoLinks, row => ({ id: row.id, url: row.url, title: row.title }));
  const imagesByUser = groupRowsByUser(images, row => row.filename);
  const metricVideosByUser = groupRowsByUser(metricVideos, row => ({
    metric_key: row.metric_key,
    video_filename: row.video_filename,
    is_verified: row.is_verified,
    verified_by: row.verified_by,
    recorded_at: row.recorded_at
  }));
  const offerSchoolsByUser = new Map();
  const favoriteSchoolsByUser = new Map();
  for (const row of schoolInterestsRaw || []) {
    const userId = Number(row.user_id);
    if (!Number.isInteger(userId)) continue;
    const school = {
      id: row.id,
      name: row.name,
      logo: normalizeCollegeLogoPath(row.logo, row.division, row.conference),
      division: row.division,
      conference: row.conference,
      team: row.team,
      visit_count: row.visit_count
    };
    if (row.has_offer === 1) {
      if (!offerSchoolsByUser.has(userId)) offerSchoolsByUser.set(userId, []);
      offerSchoolsByUser.get(userId).push(school);
    }
    if (row.is_favorite === 1 && !row.has_offer) {
      if (!favoriteSchoolsByUser.has(userId)) favoriteSchoolsByUser.set(userId, []);
      favoriteSchoolsByUser.get(userId).push(school);
    }
  }
  const contactsByUser = groupRowsByUser(contacts, row => ({
    role: row.role,
    name: row.name,
    email: row.email,
    phone: row.phone
  }));

  for (const profile of profiles) {
    if (!profile) continue;
    profile.id = profile.user_id;

    const playerId = Number(profile.user_id);
    if (!Number.isInteger(playerId)) continue;

    const collegeLogoOrderState = parseCollegeLogoOrderState(profile);
    const videosForUser = videosByUser.get(playerId) || [];
    const videoLinksForUser = videoLinksByUser.get(playerId) || [];
    const imagesForUser = imagesByUser.get(playerId) || [];
    const metricVideosForUser = metricVideosByUser.get(playerId) || [];
    const offerSchoolsOrdered = applyCollegeOrder(collegeLogoOrderState, 'offers', offerSchoolsByUser.get(playerId) || []);
    const favoriteSchoolsOrdered = applyCollegeOrder(collegeLogoOrderState, 'favorites', favoriteSchoolsByUser.get(playerId) || []);
    const contactsForUser = contactsByUser.get(playerId) || [];

    profile.highlight_videos = videosForUser.length > 0 ? JSON.stringify(videosForUser) : null;
    profile.video_links = videoLinksForUser.length > 0 ? JSON.stringify(videoLinksForUser) : null;
    profile.additional_images = imagesForUser.length > 0 ? JSON.stringify(imagesForUser) : null;
    profile.metric_videos = metricVideosForUser.length > 0 ? JSON.stringify(metricVideosForUser) : null;
    profile.college_offer_schools = offerSchoolsOrdered.length > 0 ? JSON.stringify(offerSchoolsOrdered) : null;
    profile.college_favorite_schools = favoriteSchoolsOrdered.length > 0 ? JSON.stringify(favoriteSchoolsOrdered) : null;
    profile.college_logo_order = profile.college_logo_order || null;

    for (const contact of contactsForUser) {
      profile[contact.role + '_name'] = contact.name;
      profile[contact.role + '_email'] = contact.email;
      profile[contact.role + '_phone'] = contact.phone;
    }

    computeAgeFlag(profile);
  }

  return profiles;
}

// Helper: Enrich a player profile with data from normalized tables
async function enrichPlayerProfile(profile) {
  if (!profile) return profile;
  await enrichPlayerProfiles([profile]);
  return profile;
}

module.exports = { enrichPlayerProfile, enrichPlayerProfiles };
