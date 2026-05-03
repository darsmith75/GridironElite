const db = require('../database');
const fs = require('fs');
const path = require('path');
const { b2Enabled, deleteFromB2Prefix } = require('../backblaze');
const { buildB2DeleteCandidateKeys, tryDeleteB2KeyWithRetries, enqueuePendingB2Delete } = require('./b2-queue');
const { normalizeUploadFilename, safeUploadPath } = require('./upload');

async function deleteUploadFile(filename) {
  if (!filename) return false;
  const normalizedFilename = normalizeUploadFilename(filename);

  let deletedInB2 = false;
  if (b2Enabled) {
    const candidateKeys = buildB2DeleteCandidateKeys(normalizedFilename);
    for (const objectKey of candidateKeys) {
      const deleted = await tryDeleteB2KeyWithRetries(objectKey, {
        filename: normalizedFilename,
        source: 'deleteUploadFile'
      });
      if (deleted) {
        deletedInB2 = true;
      } else {
        await enqueuePendingB2Delete(objectKey, { filename: normalizedFilename, source: 'deleteUploadFile' }, 'immediate-delete-failed');
      }
    }
  }

  const safePath = safeUploadPath(normalizedFilename);
  if (safePath && fs.existsSync(safePath)) {
    try { fs.unlinkSync(safePath); } catch (_) {}
    return true;
  }

  if (b2Enabled) return deletedInB2;
  return false;
}

async function replacePlayerProfileFile(userId, columnName, newFilename) {
  const current = await db.prepare(`SELECT ${columnName} AS filename FROM player_profiles WHERE user_id = ?`).get(userId);

  if (current?.filename && current.filename !== newFilename) {
    await deleteUploadFile(current.filename);
  }

  await db.prepare(`UPDATE player_profiles SET ${columnName} = ? WHERE user_id = ?`).run(newFilename, userId);
}

async function clearPlayerProfileFile(userId, columnName) {
  const current = await db.prepare(`SELECT ${columnName} AS filename FROM player_profiles WHERE user_id = ?`).get(userId);

  if (current?.filename) {
    await deleteUploadFile(current.filename);
    await db.prepare(`UPDATE player_profiles SET ${columnName} = NULL WHERE user_id = ?`).run(userId);
  }
}

async function replaceUserFile(userId, columnName, newFilename) {
  const current = await db.prepare(`SELECT ${columnName} AS filename FROM users WHERE id = ?`).get(userId);

  if (current?.filename && current.filename !== newFilename) {
    await deleteUploadFile(current.filename);
  }

  await db.prepare(`UPDATE users SET ${columnName} = ? WHERE id = ?`).run(newFilename, userId);
}

async function deleteOwnedPlayerMedia(tableName, playerId, filename) {
  const normalizedFilename = normalizeUploadFilename(filename);
  const media = await db.prepare(`SELECT id, filename FROM ${tableName} WHERE user_id = ? AND (filename = ? OR filename = ? OR filename = ?)`)
    .get(playerId, filename, normalizedFilename, normalizedFilename.replace(/^uploads\//, ''));
  if (!media) {
    return false;
  }

  const fileDeleted = await deleteUploadFile(media.filename);
  if (b2Enabled && !fileDeleted) {
    return false;
  }

  await db.prepare(`DELETE FROM ${tableName} WHERE id = ?`).run(media.id);
  return true;
}

async function deleteOwnedPlayerMetricVideo(playerId, metricKey) {
  const media = await db.prepare(
    'SELECT id, video_filename FROM player_metric_videos WHERE user_id = ? AND metric_key = ?'
  ).get(playerId, metricKey);
  if (!media?.video_filename) {
    return false;
  }

  const fileDeleted = await deleteUploadFile(media.video_filename);
  if (b2Enabled && !fileDeleted) {
    return false;
  }

  await db.prepare('DELETE FROM player_metric_videos WHERE id = ?').run(media.id);
  return true;
}

async function deletePlayerAccountAndAssociatedData(playerId) {
  const user = await db.prepare('SELECT id, email, role, profile_picture FROM users WHERE id = ?').get(playerId);
  if (!user) {
    return { deleted: false, reason: 'not-found' };
  }
  if (user.role !== 'player') {
    return { deleted: false, reason: 'forbidden-role' };
  }

  const mediaFiles = new Set();
  if (user.profile_picture) {
    mediaFiles.add(user.profile_picture);
  }

  const profileMedia = await db.prepare(
    'SELECT profile_picture, card_photo, report_card_image FROM player_profiles WHERE user_id = ?'
  ).get(playerId);
  ['profile_picture', 'card_photo', 'report_card_image'].forEach(key => {
    if (profileMedia?.[key]) mediaFiles.add(profileMedia[key]);
  });

  const [videos, images, metricVideos] = await Promise.all([
    db.prepare('SELECT filename FROM player_videos WHERE user_id = ?').all(playerId),
    db.prepare('SELECT filename FROM player_images WHERE user_id = ?').all(playerId),
    db.prepare('SELECT video_filename FROM player_metric_videos WHERE user_id = ?').all(playerId)
  ]);

  videos.forEach(row => row?.filename && mediaFiles.add(row.filename));
  images.forEach(row => row?.filename && mediaFiles.add(row.filename));
  metricVideos.forEach(row => row?.video_filename && mediaFiles.add(row.video_filename));

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      'DELETE FROM team_invites WHERE player_user_id = $1 OR LOWER(player_email) = LOWER($2)',
      [playerId, user.email]
    );
    await client.query('DELETE FROM ai_events WHERE actor_user_id = $1 OR player_user_id = $1', [playerId]);
    await client.query('DELETE FROM site_traffic_events WHERE user_id = $1', [playerId]);

    const deleteUserResult = await client.query(
      'DELETE FROM users WHERE id = $1 AND role = $2 RETURNING id',
      [playerId, 'player']
    );

    if ((deleteUserResult.rowCount || 0) !== 1) {
      await client.query('ROLLBACK');
      return { deleted: false, reason: 'delete-failed' };
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  for (const filename of mediaFiles) {
    try {
      await deleteUploadFile(filename);
    } catch (error) {
      console.error(`Player account delete: failed to delete media "${filename}":`, error?.message || error);
    }
  }

  const userPrefix = String(playerId).trim();
  if (userPrefix) {
    if (b2Enabled) {
      try {
        await deleteFromB2Prefix(`uploads/${userPrefix}/`);
      } catch (error) {
        console.error('Player account delete: B2 prefix delete failed:', error?.message || error);
      }
    }

    try {
      fs.rmSync(path.join('uploads', userPrefix), { recursive: true, force: true });
    } catch (error) {
      console.error('Player account delete: local uploads cleanup failed:', error?.message || error);
    }
  }

  return { deleted: true };
}

module.exports = {
  deleteUploadFile,
  replacePlayerProfileFile,
  clearPlayerProfileFile,
  replaceUserFile,
  deleteOwnedPlayerMedia,
  deleteOwnedPlayerMetricVideo,
  deletePlayerAccountAndAssociatedData
};
