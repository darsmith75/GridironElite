const express = require('express');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const db = require('../database');
const { requireAdmin } = require('../middleware/auth');
const { b2Enabled, deleteFromB2Prefix } = require('../backblaze');
const { upload, processUploadedFiles, normalizeOptionalInteger, normalizeOptionalFloat } = require('../utils/upload');
const { replaceUserFile } = require('../utils/file-mgmt');
const { enrichPlayerProfile } = require('../utils/enrich-player');

const router = express.Router();

function parsePagination(query) {
  const rawPage = parseInt(query?.page, 10);
  const rawLimit = parseInt(query?.limit, 10);
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 50;
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

// Admin: Update own profile
router.post('/admin/profile', requireAdmin, upload.fields([
  { name: 'profilePicture', maxCount: 1 }
]), async (req, res) => {
  const { fullName, email, phone, organization, title, experience, bio } = req.body;
  const files = req.files;
  try {
    await processUploadedFiles(req.session.userId, files);
    const existingAdmin = await db.prepare('SELECT profile_picture FROM users WHERE id = ?').get(req.session.userId);
    let profilePicFilename = existingAdmin?.profile_picture || null;
    if (files && files.profilePicture && files.profilePicture[0]) {
      profilePicFilename = req.session.userId + '/' + files.profilePicture[0].filename;
    }

    await db.prepare(`UPDATE users SET full_name = ?, email = ?, phone = ?, organization = ?, title = ?, experience = ?, bio = ? WHERE id = ?`)
      .run(fullName, email, phone, organization, title, experience, bio, req.session.userId);

    if (files && files.profilePicture && files.profilePicture[0]) {
      await replaceUserFile(req.session.userId, 'profile_picture', profilePicFilename);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Admin update own profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Admin: Get all users
router.get('/admin/users', requireAdmin, async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const search = String(req.query?.search || '').trim();
    const role = String(req.query?.role || '').trim().toLowerCase();
    const allowedRoles = ['player', 'agent', 'admin', 'coach'];

    const whereParts = [];
    const whereParams = [];

    if (allowedRoles.includes(role)) {
      whereParts.push('u.role = ?');
      whereParams.push(role);
    }

    if (search) {
      const likeSearch = `%${search}%`;
      whereParts.push(`(
        LOWER(u.email) LIKE LOWER(?)
        OR LOWER(COALESCE(u.full_name, '')) LIKE LOWER(?)
        OR LOWER(COALESCE(pp.full_name, '')) LIKE LOWER(?)
      )`);
      whereParams.push(likeSearch, likeSearch, likeSearch);
    }

    const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

    const totals = await db.prepare(`
      SELECT COUNT(*)::int AS count
      FROM users u
      LEFT JOIN player_profiles pp ON u.id = pp.user_id
      ${whereSql}
    `).get(...whereParams);
    const total = totals?.count || 0;
    const totalPages = Math.max(1, Math.ceil(total / limit));

    const users = await db.prepare(`
      SELECT u.id, u.email, u.role, u.full_name, u.phone, u.organization, u.created_at, u.last_login_at, u.login_count,
        pp.full_name as player_name, pp.high_school, pp.position, pp.graduation_year, pp.gpa
      FROM users u
      LEFT JOIN player_profiles pp ON u.id = pp.user_id
      ${whereSql}
      ORDER BY u.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...whereParams, limit, offset);

    res.json({
      items: users,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasPrev: page > 1,
        hasNext: page < totalPages
      }
    });
  } catch (error) {
    console.error('Admin get users error:', error);
    res.status(500).json({ error: 'Failed to get users' });
  }
});

// Admin: Create user
router.post('/admin/users', requireAdmin, async (req, res) => {
  const { email, password, role, full_name, phone, organization } = req.body || {};
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedRole = String(role || '').trim().toLowerCase();
  const normalizedFullName = String(full_name || '').trim();

  const allowedRoles = ['player', 'agent', 'admin', 'coach'];
  if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return res.status(400).json({ error: 'Valid email is required' });
  }
  if (!password || String(password).length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  if (!allowedRoles.includes(normalizedRole)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  try {
    const existing = await db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').get(normalizedEmail);
    if (existing) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    const hashedPassword = await bcrypt.hash(String(password), 10);
    const created = await db.prepare(
      'INSERT INTO users (email, password, role, full_name, phone, organization, email_verified) VALUES (?, ?, ?, ?, ?, ?, true)'
    ).run(
      normalizedEmail,
      hashedPassword,
      normalizedRole,
      normalizedFullName || null,
      String(phone || '').trim() || null,
      String(organization || '').trim() || null
    );

    const userId = created.lastInsertRowid;

    if (normalizedRole === 'player') {
      await db.prepare('INSERT INTO player_profiles (user_id, full_name) VALUES (?, ?)')
        .run(userId, normalizedFullName || normalizedEmail);
    }

    const user = await db.prepare('SELECT id, email, role, full_name, phone, organization, created_at FROM users WHERE id = ?').get(userId);
    res.status(201).json({ success: true, user });
  } catch (error) {
    console.error('Admin create user error:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Admin: Get single user details
router.get('/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    const user = await db.prepare('SELECT id, email, role, full_name, phone, organization, title, experience, bio, created_at, last_login_at, login_count FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    let profile = null;
    if (user.role === 'player') {
      profile = await db.prepare('SELECT * FROM player_profiles WHERE user_id = ?').get(user.id);
      await enrichPlayerProfile(profile);
    }
    res.json({ user, profile });
  } catch (error) {
    console.error('Admin get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// Admin: Update user
router.put('/admin/users/:id', requireAdmin, async (req, res) => {
  const { email, full_name, role, phone, organization } = req.body;
  try {
    const existing = await db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'User not found' });

    await db.prepare('UPDATE users SET email = ?, full_name = ?, role = ?, phone = ?, organization = ? WHERE id = ?')
      .run(email, full_name, role, phone || null, organization || null, req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Admin update user error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Admin: Delete user
router.delete('/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    const user = await db.prepare('SELECT id, role FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Prevent deleting yourself
    if (user.id === req.session.userId) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    // Delete related data
    await db.prepare('DELETE FROM agent_favorites WHERE agent_id = ? OR user_id = ?').run(user.id, user.id);
    if (user.role === 'player') {
      await db.prepare('DELETE FROM player_videos WHERE user_id = ?').run(user.id);
      await db.prepare('DELETE FROM player_images WHERE user_id = ?').run(user.id);
      await db.prepare('DELETE FROM player_video_links WHERE user_id = ?').run(user.id);
      await db.prepare('DELETE FROM player_school_interests WHERE user_id = ?').run(user.id);
      await db.prepare('DELETE FROM player_contacts WHERE user_id = ?').run(user.id);
      await db.prepare('DELETE FROM school_notes WHERE user_id = ?').run(user.id);
      await db.prepare('DELETE FROM school_contacts WHERE user_id = ?').run(user.id);
      await db.prepare('DELETE FROM player_profiles WHERE user_id = ?').run(user.id);
      // Remove user's uploads from Backblaze B2
      if (b2Enabled) {
        await deleteFromB2Prefix('uploads/' + user.id + '/');
      }
      // Remove local upload folder (legacy / non-B2 fallback)
      const userUploadDir = path.join('uploads', String(user.id));
      if (fs.existsSync(userUploadDir)) {
        fs.rmSync(userUploadDir, { recursive: true, force: true });
      }
    }
    await db.prepare('DELETE FROM users WHERE id = ?').run(user.id);

    res.json({ success: true });
  } catch (error) {
    console.error('Admin delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Admin: Reset user password
router.post('/admin/users/:id/reset-password', requireAdmin, async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  try {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Admin reset password error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

module.exports = router;
