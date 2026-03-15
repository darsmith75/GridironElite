try { require('dotenv').config(); } catch (_) {}

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
const db = require('./database');
const { b2Enabled, uploadToB2, deleteFromB2, deleteFromB2Prefix, getB2Url } = require('./backblaze');

const app = express();
const PORT = 3000;

// Create uploads directory
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
if (!fs.existsSync(path.join('images', 'collegelogos'))) fs.mkdirSync(path.join('images', 'collegelogos'), { recursive: true });

// Migrate existing flat uploads into per-user folders
(function migrateUploads() {
  try {
    // Migrate profile_picture, card_photo, and report_card_image
    const profiles = db.prepare('SELECT user_id, profile_picture, card_photo, report_card_image FROM player_profiles').all();
    profiles.forEach(p => {
      ['profile_picture', 'card_photo', 'report_card_image'].forEach(col => {
        const filename = p[col];
        if (filename && !filename.includes('/')) {
          const src = path.join('uploads', filename);
          const userDir = path.join('uploads', String(p.user_id));
          const dest = path.join(userDir, filename);
          if (fs.existsSync(src)) {
            if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
            fs.renameSync(src, dest);
          }
          db.prepare(`UPDATE player_profiles SET ${col} = ? WHERE user_id = ?`)
            .run(p.user_id + '/' + filename, p.user_id);
        }
      });
    });
    // Migrate player_videos
    const videos = db.prepare('SELECT id, player_id, filename FROM player_videos').all();
    videos.forEach(v => {
      if (!v.filename.includes('/')) {
        const src = path.join('uploads', v.filename);
        const userDir = path.join('uploads', String(v.player_id));
        const dest = path.join(userDir, v.filename);
        if (fs.existsSync(src)) {
          if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
          fs.renameSync(src, dest);
        }
        db.prepare('UPDATE player_videos SET filename = ? WHERE id = ?')
          .run(v.player_id + '/' + v.filename, v.id);
      }
    });
    // Migrate player_images
    const images = db.prepare('SELECT id, player_id, filename FROM player_images').all();
    images.forEach(i => {
      if (!i.filename.includes('/')) {
        const src = path.join('uploads', i.filename);
        const userDir = path.join('uploads', String(i.player_id));
        const dest = path.join(userDir, i.filename);
        if (fs.existsSync(src)) {
          if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
          fs.renameSync(src, dest);
        }
        db.prepare('UPDATE player_images SET filename = ? WHERE id = ?')
          .run(i.player_id + '/' + i.filename, i.id);
      }
    });
    console.log('Upload migration check complete');
  } catch (err) {
    console.error('Upload migration error:', err.message);
  }
})();

// Allowed file types for uploads
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
const ALLOWED_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES];

// Multer configuration for file uploads
// Use memory storage – files are streamed to Backblaze B2 (or written to disk if B2
// is not configured) by processUploadedFiles() inside each route handler.
const storage = multer.memoryStorage();
const fileFilter = (req, file, cb) => {
  if (ALLOWED_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only images and videos are allowed.'), false);
  }
};
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 }, fileFilter });

// Process uploaded files: assign a safe filename, then upload to B2 or save to local disk.
// Must be awaited at the start of any route handler that receives user file uploads.
async function processUploadedFiles(userId, reqFiles) {
  if (!reqFiles) return;
  const allFiles = Object.values(reqFiles).flat();
  for (const file of allFiles) {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = Date.now() + '-' + Math.round(Math.random() * 1e9) + ext;
    file.filename = safeName; // keep existing field-name references working
    if (b2Enabled) {
      await uploadToB2('uploads/' + userId + '/' + safeName, file.buffer, file.mimetype);
    } else {
      const userDir = path.join('uploads', String(userId));
      if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
      fs.writeFileSync(path.join(userDir, safeName), file.buffer);
    }
  }
}

// Multer configuration for college logos
const collegeLogoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join('images', 'collegelogos')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = Date.now() + '-' + Math.round(Math.random() * 1e9) + ext;
    cb(null, safeName);
  }
});
const collegeLogoUpload = multer({ storage: collegeLogoStorage, limits: { fileSize: 50 * 1024 * 1024 }, fileFilter });

// Helper: resolve a safe file path within uploads directory
function safeUploadPath(filename) {
  // filename may be "userId/file.ext" or legacy "file.ext"
  const normalized = path.normalize(filename).replace(/^\.[\/\\]+/, '');
  const resolved = path.resolve('uploads', normalized);
  const uploadsDir = path.resolve('uploads');
  if (!resolved.startsWith(uploadsDir + path.sep)) {
    return null;
  }
  return resolved;
}

function normalizeUploadFilename(filename) {
  if (!filename) return '';
  const decoded = decodeURIComponent(String(filename));
  const trimmed = decoded.replace(/^\/+/, '');
  const withoutUploadsPrefix = trimmed.startsWith('uploads/') ? trimmed.slice('uploads/'.length) : trimmed;
  return withoutUploadsPrefix;
}

async function deleteUploadFile(filename) {
  if (!filename) return false;
  const normalizedFilename = normalizeUploadFilename(filename);

  let deletedInB2 = false;
  // Delete from Backblaze B2 using normalized and legacy key shapes.
  if (b2Enabled) {
    deletedInB2 = await deleteFromB2('uploads/' + normalizedFilename);
    if (!deletedInB2 && normalizedFilename.startsWith('uploads/')) {
      deletedInB2 = await deleteFromB2(normalizedFilename);
    }
  }

  // Also remove local copy for legacy files that pre-date B2 migration
  const safePath = safeUploadPath(normalizedFilename);
  if (safePath && fs.existsSync(safePath)) {
    try { fs.unlinkSync(safePath); } catch (_) {}
    return true;
  }

  // If B2 is enabled and no key existed/deleted, signal failure so route can inform UI.
  if (b2Enabled) return deletedInB2;
  return false;
}

async function replacePlayerProfileFile(userId, columnName, newFilename) {
  const current = db.prepare(`SELECT ${columnName} AS filename FROM player_profiles WHERE user_id = ?`).get(userId);

  if (current?.filename && current.filename !== newFilename) {
    await deleteUploadFile(current.filename);
  }

  db.prepare(`UPDATE player_profiles SET ${columnName} = ? WHERE user_id = ?`).run(newFilename, userId);
}

async function clearPlayerProfileFile(userId, columnName) {
  const current = db.prepare(`SELECT ${columnName} AS filename FROM player_profiles WHERE user_id = ?`).get(userId);

  if (current?.filename) {
    await deleteUploadFile(current.filename);
    db.prepare(`UPDATE player_profiles SET ${columnName} = NULL WHERE user_id = ?`).run(userId);
  }
}

async function replaceUserFile(userId, columnName, newFilename) {
  const current = db.prepare(`SELECT ${columnName} AS filename FROM users WHERE id = ?`).get(userId);

  if (current?.filename && current.filename !== newFilename) {
    await deleteUploadFile(current.filename);
  }

  db.prepare(`UPDATE users SET ${columnName} = ? WHERE id = ?`).run(newFilename, userId);
}

async function deleteOwnedPlayerMedia(tableName, playerId, filename) {
  const normalizedFilename = normalizeUploadFilename(filename);
  const media = db.prepare(`SELECT id, filename FROM ${tableName} WHERE player_id = ? AND (filename = ? OR filename = ? OR filename = ?)`)
    .get(playerId, filename, normalizedFilename, normalizedFilename.replace(/^uploads\//, ''));
  if (!media) {
    return false;
  }

  const fileDeleted = await deleteUploadFile(media.filename);
  if (b2Enabled && !fileDeleted) {
    return false;
  }

  db.prepare(`DELETE FROM ${tableName} WHERE id = ?`).run(media.id);
  return true;
}

// Guard against accidental double-submit of the same profile upload payload.
const recentProfileUploadSignatures = new Map();
function buildProfileUploadSignature(userId, reqBody, reqFiles) {
  const fileEntries = Object.entries(reqFiles || {})
    .flatMap(([field, files]) => (files || []).map(f => `${field}:${f.originalname}:${f.size}:${f.mimetype}`))
    .sort();

  const bodyFields = [
    reqBody.fullName || '',
    reqBody.highSchool || '',
    reqBody.position || '',
    reqBody.graduationYear || '',
    reqBody.gpa || ''
  ].join('|');

  return `${userId}|${bodyFields}|${fileEntries.join('|')}`;
}

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
// User uploads: redirect to Backblaze B2 when enabled; otherwise serve from local disk.
if (b2Enabled) {
  app.use('/uploads', (req, res) => {
    // req.path is e.g. "/5/abc.jpg" – prepend "uploads" to form the B2 object key
    const key = 'uploads' + req.path;
    res.redirect(302, getB2Url(key));
  });
} else {
  app.use('/uploads', express.static('uploads'));
}
app.use('/images', express.static('images'));
app.use('/logos', express.static('logos'));
app.use(session({
  secret: 'football-agent-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Auth middleware
const requireAuth = (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  next();
};

// Helper: Enrich a player profile with data from normalized tables
function enrichPlayerProfile(profile) {
  if (!profile) return profile;

  // Keep API compatibility: expose player id as the account/user id.
  profile.id = profile.user_id;

  const playerId = profile.user_id;

  const videos = db.prepare('SELECT filename FROM player_videos WHERE player_id = ? ORDER BY id').all(playerId);
  profile.highlight_videos = videos.length > 0 ? JSON.stringify(videos.map(v => v.filename)) : null;

  const videoLinks = db.prepare('SELECT id, url, title FROM player_video_links WHERE player_id = ? ORDER BY id').all(playerId);
  profile.video_links = videoLinks.length > 0 ? JSON.stringify(videoLinks) : null;

  const images = db.prepare('SELECT filename FROM player_images WHERE player_id = ? ORDER BY id').all(playerId);
  profile.additional_images = images.length > 0 ? JSON.stringify(images.map(i => i.filename)) : null;

  const offerSchools = db.prepare(`SELECT c.id, c.name, c.logo, c.conference, c.team FROM player_school_interests psi JOIN colleges c ON psi.college_id = c.id WHERE psi.player_id = ? AND psi.has_offer = 1 ORDER BY c.name`).all(playerId);
  profile.college_offer_schools = offerSchools.length > 0 ? JSON.stringify(offerSchools) : null;

  const favoriteSchools = db.prepare(`SELECT c.id, c.name, c.logo, c.conference, c.team FROM player_school_interests psi JOIN colleges c ON psi.college_id = c.id WHERE psi.player_id = ? AND psi.is_favorite = 1 AND (psi.has_offer = 0 OR psi.has_offer IS NULL) ORDER BY c.name`).all(playerId);
  profile.college_favorite_schools = favoriteSchools.length > 0 ? JSON.stringify(favoriteSchools) : null;

  const contacts = db.prepare('SELECT role, name, email, phone FROM player_contacts WHERE player_id = ?').all(playerId);
  contacts.forEach(c => {
    profile[c.role + '_name'] = c.name;
    profile[c.role + '_email'] = c.email;
    profile[c.role + '_phone'] = c.phone;
  });

  return profile;
}

// Register
app.post('/api/register', async (req, res) => {
  const { email, password, role, fullName } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = db.prepare('INSERT INTO users (email, password, role) VALUES (?, ?, ?)').run(email, hashedPassword, role);
    
    if (role === 'player') {
      db.prepare('INSERT INTO player_profiles (user_id, full_name) VALUES (?, ?)').run(result.lastInsertRowid, fullName);
    }
    
    // Notify all admin users about the new registration
    const admins = db.prepare("SELECT id FROM users WHERE role = 'admin'").all();
    const roleLabel = role === 'player' ? 'Athlete' : role.charAt(0).toUpperCase() + role.slice(1);
    const notifMessage = `New ${roleLabel} registration: ${fullName || email} (${email})`;
    const insertMsg = db.prepare('INSERT INTO messages (sender_id, recipient_id, message) VALUES (?, ?, ?)');
    for (const admin of admins) {
      insertMsg.run(result.lastInsertRowid, admin.id, notifMessage);
    }
    
    res.json({ success: true, message: 'Registration successful' });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(400).json({ error: 'Email already exists or registration failed' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  req.session.userId = user.id;
  req.session.role = user.role;
  res.json({ success: true, role: user.role });
});

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Get current user
app.get('/api/user', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, email, role FROM users WHERE id = ?').get(req.session.userId);
  res.json(user);
});

// Get player profile
app.get('/api/player/profile', requireAuth, (req, res) => {
  const profile = db.prepare('SELECT * FROM player_profiles WHERE user_id = ?').get(req.session.userId);
  const user = db.prepare('SELECT email FROM users WHERE id = ?').get(req.session.userId);
  enrichPlayerProfile(profile);
  res.json({ ...(profile || {}), email: user?.email || '' });
});

// Update player profile
app.post('/api/player/profile', requireAuth, upload.fields([
  { name: 'profilePicture', maxCount: 1 },
  { name: 'cardPhoto', maxCount: 1 },
  { name: 'reportCardImage', maxCount: 1 },
  { name: 'highlightVideos', maxCount: 5 },
  { name: 'additionalImages', maxCount: 10 }
]), async (req, res) => {
  const data = req.body;
  const files = req.files;
  
  console.log('Update request for user:', req.session.userId);
  console.log('Data received:', data);
  
  try {
    const hasIncomingMedia = Object.values(files || {}).some(arr => Array.isArray(arr) && arr.length > 0);
    if (hasIncomingMedia) {
      const now = Date.now();
      const signature = buildProfileUploadSignature(req.session.userId, data, files);
      const previousAt = recentProfileUploadSignatures.get(signature);
      if (previousAt && now - previousAt < 15000) {
        return res.json({ success: true, deduped: true });
      }
      recentProfileUploadSignatures.set(signature, now);
      if (recentProfileUploadSignatures.size > 200) {
        const cutoff = now - 60000;
        for (const [sig, ts] of recentProfileUploadSignatures.entries()) {
          if (ts < cutoff) recentProfileUploadSignatures.delete(sig);
        }
      }
    }

    // Upload any incoming files to B2 (or local disk if B2 not configured)
    await processUploadedFiles(req.session.userId, files);
    // Update basic profile info
    const result = db.prepare(`
      UPDATE player_profiles SET
        full_name = ?, high_school = ?, graduation_year = ?, position = ?,
        height = ?, weight = ?, forty_yard_dash = ?, bench_press = ?,
        squat = ?, vertical_jump = ?, shuttle_5_10_5 = ?, l_drill = ?,
        broad_jump = ?, power_clean = ?, single_leg_squat = ?, gpa = ?, bio = ?,
        phone = ?,
        hudl_link = ?, instagram_link = ?, twitter_link = ?,
        hudl_username = ?, instagram_username = ?, twitter_username = ?
      WHERE user_id = ?
    `).run(
      data.fullName || null, 
      data.highSchool || null, 
      data.graduationYear || null, 
      data.position || null,
      data.height || null, 
      data.weight || null, 
      data.fortyYardDash || null, 
      data.benchPress || null,
      data.squat || null, 
      data.verticalJump || null,
      data.shuttle5105 || null,
      data.lDrill || null,
      data.broadJump || null,
      data.powerClean || null,
      data.singleLegSquat || null,
      data.gpa || null, 
      data.bio || null,
      data.phone || null,
      data.hudlLink || null,
      data.instagramLink || null,
      data.twitterLink || null,
      data.hudlUsername || null,
      data.instagramUsername || null,
      data.twitterUsername || null,
      req.session.userId
    );

    // Update contacts in normalized table
    db.prepare('DELETE FROM player_contacts WHERE player_id = ?').run(req.session.userId);
    const insertContact = db.prepare('INSERT INTO player_contacts (player_id, role, name, email, phone) VALUES (?, ?, ?, ?, ?)');
    if (data.fatherName || data.fatherEmail || data.fatherPhone) {
      insertContact.run(req.session.userId, 'father', data.fatherName || null, data.fatherEmail || null, data.fatherPhone || null);
    }
    if (data.motherName || data.motherEmail || data.motherPhone) {
      insertContact.run(req.session.userId, 'mother', data.motherName || null, data.motherEmail || null, data.motherPhone || null);
    }
    if (data.coachName || data.coachEmail || data.coachPhone) {
      insertContact.run(req.session.userId, 'coach', data.coachName || null, data.coachEmail || null, data.coachPhone || null);
    }
    
    console.log(`Profile update result: ${result.changes} rows changed`);
    
    const userPrefix = req.session.userId + '/';
    
    // Update profile picture if provided
    if (files?.profilePicture) {
      await replacePlayerProfileFile(req.session.userId, 'profile_picture', userPrefix + files.profilePicture[0].filename);
    }
    
    // Update card photo if provided
    if (files?.cardPhoto) {
      await replacePlayerProfileFile(req.session.userId, 'card_photo', userPrefix + files.cardPhoto[0].filename);
    }

    // Update report card image if provided
    if (files?.reportCardImage) {
      await replacePlayerProfileFile(req.session.userId, 'report_card_image', userPrefix + files.reportCardImage[0].filename);
    }
    
    // Add new videos to normalized table
    if (files?.highlightVideos) {
      const insertVideo = db.prepare('INSERT INTO player_videos (player_id, filename) VALUES (?, ?)');
      files.highlightVideos.forEach(f => insertVideo.run(req.session.userId, userPrefix + f.filename));
    }
    
    // Add new images to normalized table
    if (files?.additionalImages) {
      const insertImage = db.prepare('INSERT INTO player_images (player_id, filename) VALUES (?, ?)');
      files.additionalImages.forEach(f => insertImage.run(req.session.userId, userPrefix + f.filename));
    }
    
    // Verify the update
    const updated = db.prepare('SELECT gpa, vertical_jump FROM player_profiles WHERE user_id = ?').get(req.session.userId);
    console.log('Verified data in DB:', updated);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Delete card photo
app.delete('/api/player/card-photo', requireAuth, async (req, res) => {
  try {
    await clearPlayerProfileFile(req.session.userId, 'card_photo');
    
    res.json({ success: true });
  } catch (error) {
    console.error('Delete card photo error:', error);
    res.status(500).json({ error: 'Failed to delete card photo' });
  }
});

// Delete profile picture
app.delete('/api/player/profile-picture', requireAuth, async (req, res) => {
  try {
    await clearPlayerProfileFile(req.session.userId, 'profile_picture');

    res.json({ success: true });
  } catch (error) {
    console.error('Delete profile picture error:', error);
    res.status(500).json({ error: 'Failed to delete profile picture' });
  }
});

// Delete report card image
app.delete('/api/player/report-card', requireAuth, async (req, res) => {
  try {
    await clearPlayerProfileFile(req.session.userId, 'report_card_image');

    res.json({ success: true });
  } catch (error) {
    console.error('Delete report card image error:', error);
    res.status(500).json({ error: 'Failed to delete report card image' });
  }
});

// Delete report card image via POST (for environments that block DELETE)
app.post('/api/player/report-card/delete', requireAuth, async (req, res) => {
  try {
    await clearPlayerProfileFile(req.session.userId, 'report_card_image');

    res.json({ success: true });
  } catch (error) {
    console.error('Delete report card image error:', error);
    res.status(500).json({ error: 'Failed to delete report card image' });
  }
});

// Agent: Get all players with filters
app.get('/api/agent/players', requireAuth, (req, res) => {
  if (req.session.role !== 'agent') return res.status(403).json({ error: 'Forbidden' });
  
  // Disable caching
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  
  let query = 'SELECT * FROM player_profiles WHERE 1=1';
  const params = [];
  
  // Filter by favorites only
  if (req.query.favoritesOnly === 'true') {
    query = `SELECT pp.* FROM player_profiles pp 
             INNER JOIN agent_favorites af ON pp.user_id = af.player_id 
             WHERE af.agent_id = ?`;
    params.push(req.session.userId);
  }
  
  if (req.query.position) {
    query += ' AND position = ?';
    params.push(req.query.position);
  }
  if (req.query.graduationYear) {
    query += ' AND graduation_year = ?';
    params.push(req.query.graduationYear);
  }
  if (req.query.minGpa) {
    query += ' AND gpa >= ?';
    params.push(req.query.minGpa);
  }
  
  const players = db.prepare(query).all(...params);
  players.forEach(p => enrichPlayerProfile(p));
  console.log(`Agent query returned ${players.length} players at ${new Date().toISOString()}`);
  
  // Log Brandon's GPA for debugging
  const brandon = players.find(p => p.full_name.includes('Brandon'));
  if (brandon) {
    console.log(`Brandon Mitchell GPA: ${brandon.gpa}`);
  }
  
  res.json(players);
});

// Agent: Get single player detail
app.get('/api/agent/player/:id', requireAuth, (req, res) => {
  if (req.session.role !== 'agent') return res.status(403).json({ error: 'Forbidden' });
  
  // Disable caching
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  
  const player = db.prepare('SELECT pp.*, u.email FROM player_profiles pp JOIN users u ON pp.user_id = u.id WHERE pp.user_id = ?').get(req.params.id);
  
  if (!player) {
    return res.status(404).json({ error: 'Player not found' });
  }
  
  enrichPlayerProfile(player);
  res.json(player);
});

// Agent: Get agent profile
app.get('/api/agent/profile', requireAuth, (req, res) => {
  if (req.session.role !== 'agent') return res.status(403).json({ error: 'Forbidden' });
  
  const agent = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  res.json({
    email: agent.email,
    full_name: agent.full_name,
    phone: agent.phone,
    organization: agent.organization,
    title: agent.title,
    experience: agent.experience,
    bio: agent.bio,
    profile_picture: agent.profile_picture
  });
});

// Agent: Update agent profile
app.post('/api/agent/profile', requireAuth, upload.fields([
  { name: 'profilePicture', maxCount: 1 }
]), async (req, res) => {
  if (req.session.role !== 'agent') return res.status(403).json({ error: 'Forbidden' });
  const data = req.body;
  const files = req.files;
  try {
    // Upload any incoming files to B2 (or local disk if B2 not configured)
    await processUploadedFiles(req.session.userId, files);
    const existingAgent = db.prepare('SELECT profile_picture FROM users WHERE id = ?').get(req.session.userId);
    let profilePicFilename = existingAgent?.profile_picture || null;
    if (files && files.profilePicture && files.profilePicture[0]) {
      profilePicFilename = req.session.userId + '/' + files.profilePicture[0].filename;
      console.log('Profile picture saved as:', profilePicFilename);
    } else {
      console.log('No profile picture uploaded.');
    }
    // Log received data for debugging
    console.log('Agent profile update:', {
      userId: req.session.userId,
      fullName: data.fullName,
      email: data.email,
      phone: data.phone,
      organization: data.organization,
      title: data.title,
      experience: data.experience,
      bio: data.bio,
      profile_picture: profilePicFilename
    });
    const result = db.prepare(`UPDATE users SET full_name = ?, email = ?, phone = ?, organization = ?, title = ?, experience = ?, bio = ? WHERE id = ?`).run(
      data.fullName,
      data.email,
      data.phone,
      data.organization,
      data.title,
      data.experience,
      data.bio,
      req.session.userId
    );
    if (files && files.profilePicture && files.profilePicture[0]) {
      await replaceUserFile(req.session.userId, 'profile_picture', profilePicFilename);
    }
    console.log('DB update result:', result);
    res.json({ success: true });
  } catch (error) {
    console.error('Agent update profile error:', error);
    res.status(500).json({ error: error.message || 'Failed to update profile' });
  }
});

// Agent: Change password
app.post('/api/agent/change-password', requireAuth, async (req, res) => {
  if (req.session.role !== 'agent') return res.status(403).json({ error: 'Forbidden' });
  
  const { currentPassword, newPassword } = req.body;
  
  const agent = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  
  if (!agent || !(await bcrypt.compare(currentPassword, agent.password))) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  
  try {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, req.session.userId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// Agent: Add player to favorites
app.post('/api/agent/favorites/:playerId', requireAuth, (req, res) => {
  if (req.session.role !== 'agent') return res.status(403).json({ error: 'Forbidden' });
  
  try {
    db.prepare('INSERT OR IGNORE INTO agent_favorites (agent_id, player_id) VALUES (?, ?)').run(req.session.userId, req.params.playerId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error adding favorite:', error);
    res.status(500).json({ error: 'Failed to add favorite' });
  }
});

// Agent: Remove player from favorites
app.delete('/api/agent/favorites/:playerId', requireAuth, (req, res) => {
  if (req.session.role !== 'agent') return res.status(403).json({ error: 'Forbidden' });
  
  try {
    db.prepare('DELETE FROM agent_favorites WHERE agent_id = ? AND player_id = ?').run(req.session.userId, req.params.playerId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error removing favorite:', error);
    res.status(500).json({ error: 'Failed to remove favorite' });
  }
});

// Agent: Get all favorite player IDs
app.get('/api/agent/favorites', requireAuth, (req, res) => {
  if (req.session.role !== 'agent') return res.status(403).json({ error: 'Forbidden' });
  
  try {
    const favorites = db.prepare('SELECT player_id FROM agent_favorites WHERE agent_id = ?').all(req.session.userId);
    res.json(favorites.map(f => f.player_id));
  } catch (error) {
    console.error('Error getting favorites:', error);
    res.status(500).json({ error: 'Failed to get favorites' });
  }
});

// Agent: Check if player is favorited
app.get('/api/agent/favorites/:playerId', requireAuth, (req, res) => {
  if (req.session.role !== 'agent') return res.status(403).json({ error: 'Forbidden' });
  
  try {
    const favorite = db.prepare('SELECT id FROM agent_favorites WHERE agent_id = ? AND player_id = ?').get(req.session.userId, req.params.playerId);
    res.json({ isFavorite: !!favorite });
  } catch (error) {
    console.error('Error checking favorite:', error);
    res.status(500).json({ error: 'Failed to check favorite' });
  }
});

// Messaging endpoints
// Send a message
app.post('/api/messages/send', requireAuth, (req, res) => {
  const { recipientId, message } = req.body;
  
  if (!recipientId || !message) {
    return res.status(400).json({ error: 'Recipient and message are required' });
  }
  
  try {
    db.prepare('INSERT INTO messages (sender_id, recipient_id, message) VALUES (?, ?, ?)')
      .run(req.session.userId, recipientId, message);
    res.json({ success: true });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Get conversations list
app.get('/api/messages/conversations', requireAuth, (req, res) => {
  try {
    // First get all unique conversation partners
    const conversationPartners = db.prepare(`
      SELECT DISTINCT
        CASE 
          WHEN sender_id = ? THEN recipient_id
          ELSE sender_id
        END as other_user_id
      FROM messages
      WHERE sender_id = ? OR recipient_id = ?
    `).all(req.session.userId, req.session.userId, req.session.userId);
    
    // Then get details for each conversation
    const conversations = conversationPartners.map(partner => {
      const user = db.prepare('SELECT email, full_name, role FROM users WHERE id = ?').get(partner.other_user_id);
      
      // If the user is a player, get their name from player_profiles
      let displayName = user.full_name || user.email;
      if (user.role === 'player') {
        const playerProfile = db.prepare('SELECT full_name FROM player_profiles WHERE user_id = ?').get(partner.other_user_id);
        if (playerProfile && playerProfile.full_name) {
          displayName = playerProfile.full_name;
        }
      }
      
      const lastMessage = db.prepare(`
        SELECT message, created_at 
        FROM messages 
        WHERE (sender_id = ? AND recipient_id = ?) 
           OR (sender_id = ? AND recipient_id = ?)
        ORDER BY created_at DESC 
        LIMIT 1
      `).get(req.session.userId, partner.other_user_id, partner.other_user_id, req.session.userId);
      
      const unreadCount = db.prepare(`
        SELECT COUNT(*) as count 
        FROM messages 
        WHERE sender_id = ? AND recipient_id = ? AND read = 0
      `).get(partner.other_user_id, req.session.userId);
      
      return {
        other_user_id: partner.other_user_id,
        email: user.email,
        full_name: displayName,
        role: user.role,
        last_message: lastMessage ? lastMessage.message : null,
        last_message_time: lastMessage ? lastMessage.created_at : null,
        unread_count: unreadCount.count
      };
    });
    
    // Sort by last message time
    conversations.sort((a, b) => {
      if (!a.last_message_time) return 1;
      if (!b.last_message_time) return -1;
      return new Date(b.last_message_time) - new Date(a.last_message_time);
    });
    
    res.json(conversations);
  } catch (error) {
    console.error('Error getting conversations:', error);
    res.status(500).json({ error: 'Failed to get conversations' });
  }
});

// Get messages with a specific user
app.get('/api/messages/:userId', requireAuth, (req, res) => {
  try {
    const messages = db.prepare(`
      SELECT m.*, 
        sender.email as sender_email, 
        sender.full_name as sender_name,
        recipient.email as recipient_email,
        recipient.full_name as recipient_name
      FROM messages m
      JOIN users sender ON m.sender_id = sender.id
      JOIN users recipient ON m.recipient_id = recipient.id
      WHERE (sender_id = ? AND recipient_id = ?) 
         OR (sender_id = ? AND recipient_id = ?)
      ORDER BY created_at ASC
    `).all(req.session.userId, req.params.userId, req.params.userId, req.session.userId);
    
    // Mark messages as read
    db.prepare('UPDATE messages SET read = 1 WHERE sender_id = ? AND recipient_id = ? AND read = 0')
      .run(req.params.userId, req.session.userId);
    
    res.json(messages);
  } catch (error) {
    console.error('Error getting messages:', error);
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

// Get unread message count
app.get('/api/messages/unread/count', requireAuth, (req, res) => {
  try {
    const result = db.prepare('SELECT COUNT(*) as count FROM messages WHERE recipient_id = ? AND read = 0')
      .get(req.session.userId);
    res.json({ count: result.count });
  } catch (error) {
    console.error('Error getting unread count:', error);
    res.status(500).json({ error: 'Failed to get unread count' });
  }
});

// Delete video from player profile (query param variant)
app.delete('/api/player/video', requireAuth, async (req, res) => {
  try {
    const filename = req.query.filename;
    if (!filename) return res.status(400).json({ error: 'Filename is required' });

    const deleted = await deleteOwnedPlayerMedia('player_videos', req.session.userId, filename);
    if (!deleted) return res.status(404).json({ error: 'Video file not found in storage' });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete video error:', error);
    res.status(500).json({ error: 'Failed to delete video' });
  }
});

// Delete video from player profile via POST (for environments that block DELETE)
app.post('/api/player/video/delete', requireAuth, async (req, res) => {
  try {
    const filename = req.body?.filename;
    if (!filename) return res.status(400).json({ error: 'Filename is required' });

    const deleted = await deleteOwnedPlayerMedia('player_videos', req.session.userId, filename);
    if (!deleted) return res.status(404).json({ error: 'Video file not found in storage' });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete video error:', error);
    res.status(500).json({ error: 'Failed to delete video' });
  }
});

// Delete video from player profile
app.delete('/api/player/video/:filename', requireAuth, async (req, res) => {
  try {
    const filename = req.query.filename || req.params.filename;
    if (!filename) return res.status(400).json({ error: 'Filename is required' });

    const deleted = await deleteOwnedPlayerMedia('player_videos', req.session.userId, filename);
    if (!deleted) return res.status(404).json({ error: 'Video file not found in storage' });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Delete video error:', error);
    res.status(500).json({ error: 'Failed to delete video' });
  }
});

// Support prefixed filenames that include slashes (e.g. "123/file.mp4")
app.delete('/api/player/video/*', requireAuth, async (req, res) => {
  try {
    const wildcardFilename = req.params[0];
    const filename = req.query.filename || wildcardFilename;
    if (!filename) return res.status(400).json({ error: 'Filename is required' });

    const deleted = await deleteOwnedPlayerMedia('player_videos', req.session.userId, filename);
    if (!deleted) return res.status(404).json({ error: 'Video file not found in storage' });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete video error:', error);
    res.status(500).json({ error: 'Failed to delete video' });
  }
});

// Add video link to player profile
app.post('/api/player/video-link', requireAuth, (req, res) => {
  try {
    const { url, title } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });
    // Basic URL validation
    try { new URL(url); } catch { return res.status(400).json({ error: 'Invalid URL' }); }
    const result = db.prepare('INSERT INTO player_video_links (player_id, url, title) VALUES (?, ?, ?)')
      .run(req.session.userId, url, title || null);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (error) {
    console.error('Add video link error:', error);
    res.status(500).json({ error: 'Failed to add video link' });
  }
});

// Delete video link from player profile
app.delete('/api/player/video-link/:id', requireAuth, (req, res) => {
  try {
    const linkId = parseInt(req.params.id, 10);
    if (isNaN(linkId)) return res.status(400).json({ error: 'Invalid ID' });
    db.prepare('DELETE FROM player_video_links WHERE id = ? AND player_id = ?')
      .run(linkId, req.session.userId);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete video link error:', error);
    res.status(500).json({ error: 'Failed to delete video link' });
  }
});

// Delete image from player profile (query param variant)
app.delete('/api/player/image', requireAuth, async (req, res) => {
  try {
    const filename = req.query.filename;
    if (!filename) return res.status(400).json({ error: 'Filename is required' });

    const deleted = await deleteOwnedPlayerMedia('player_images', req.session.userId, filename);
    if (!deleted) return res.status(404).json({ error: 'Image file not found in storage' });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete image error:', error);
    res.status(500).json({ error: 'Failed to delete image' });
  }
});

// Delete image from player profile via POST (for environments that block DELETE)
app.post('/api/player/image/delete', requireAuth, async (req, res) => {
  try {
    const filename = req.body?.filename;
    if (!filename) return res.status(400).json({ error: 'Filename is required' });

    const deleted = await deleteOwnedPlayerMedia('player_images', req.session.userId, filename);
    if (!deleted) return res.status(404).json({ error: 'Image file not found in storage' });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete image error:', error);
    res.status(500).json({ error: 'Failed to delete image' });
  }
});

// Delete image from player profile
app.delete('/api/player/image/:filename', requireAuth, async (req, res) => {
  try {
    const filename = req.query.filename || req.params.filename;
    if (!filename) return res.status(400).json({ error: 'Filename is required' });

    const deleted = await deleteOwnedPlayerMedia('player_images', req.session.userId, filename);
    if (!deleted) return res.status(404).json({ error: 'Image file not found in storage' });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Delete image error:', error);
    res.status(500).json({ error: 'Failed to delete image' });
  }
});

// Support prefixed filenames that include slashes (e.g. "123/file.png")
app.delete('/api/player/image/*', requireAuth, async (req, res) => {
  try {
    const wildcardFilename = req.params[0];
    const filename = req.query.filename || wildcardFilename;
    if (!filename) return res.status(400).json({ error: 'Filename is required' });

    const deleted = await deleteOwnedPlayerMedia('player_images', req.session.userId, filename);
    if (!deleted) return res.status(404).json({ error: 'Image file not found in storage' });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete image error:', error);
    res.status(500).json({ error: 'Failed to delete image' });
  }
});

// Admin middleware
const requireAdmin = (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  if (req.session.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  next();
};

// Admin: Update own profile
// Admin: Get own profile
app.get('/api/admin/profile', requireAdmin, (req, res) => {
  try {
    const admin = db.prepare('SELECT email, full_name, phone, organization, title, experience, bio FROM users WHERE id = ?').get(req.session.userId);
    if (!admin) return res.status(404).json({ error: 'Admin not found' });
    res.json(admin);
  } catch (error) {
    console.error('Admin get own profile error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});
app.post('/api/admin/profile', requireAdmin, (req, res) => {
  const { fullName, email, phone, organization, title, experience, bio } = req.body;
  try {
    db.prepare(`UPDATE users SET full_name = ?, email = ?, phone = ?, organization = ?, title = ?, experience = ?, bio = ? WHERE id = ?`)
      .run(fullName, email, phone, organization, title, experience, bio, req.session.userId);
    res.json({ success: true });
  } catch (error) {
    console.error('Admin update own profile error:', error);
    res.status(500).json({ error: error.message || 'Failed to update profile' });
  }
});
// Admin: Get all users
app.get('/api/admin/users', requireAdmin, (req, res) => {
  try {
    const users = db.prepare(`
      SELECT u.id, u.email, u.role, u.full_name, u.phone, u.organization, u.created_at,
        pp.full_name as player_name, pp.high_school, pp.position, pp.graduation_year, pp.gpa
      FROM users u
      LEFT JOIN player_profiles pp ON u.id = pp.user_id
      ORDER BY u.created_at DESC
    `).all();
    res.json(users);
  } catch (error) {
    console.error('Admin get users error:', error);
    res.status(500).json({ error: 'Failed to get users' });
  }
});

// Admin: Get single user details
app.get('/api/admin/users/:id', requireAdmin, (req, res) => {
  try {
    const user = db.prepare('SELECT id, email, role, full_name, phone, organization, title, experience, bio, created_at FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    let profile = null;
    if (user.role === 'player') {
      profile = db.prepare('SELECT * FROM player_profiles WHERE user_id = ?').get(user.id);
      enrichPlayerProfile(profile);
    }
    res.json({ user, profile });
  } catch (error) {
    console.error('Admin get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// Admin: Update user
app.put('/api/admin/users/:id', requireAdmin, (req, res) => {
  const { email, full_name, role, phone, organization } = req.body;
  try {
    const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'User not found' });

    db.prepare('UPDATE users SET email = ?, full_name = ?, role = ?, phone = ?, organization = ? WHERE id = ?')
      .run(email, full_name, role, phone || null, organization || null, req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Admin update user error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Admin: Update player profile
app.put('/api/admin/players/:id', requireAdmin, (req, res) => {
  const { full_name, high_school, graduation_year, position, height, weight, gpa } = req.body;
  try {
    const profile = db.prepare('SELECT id FROM player_profiles WHERE user_id = ?').get(req.params.id);
    if (!profile) return res.status(404).json({ error: 'Player profile not found' });

    db.prepare(`UPDATE player_profiles SET full_name = ?, high_school = ?, graduation_year = ?, position = ?, height = ?, weight = ?, gpa = ? WHERE user_id = ?`)
      .run(full_name, high_school || null, graduation_year || null, position || null, height || null, weight || null, gpa || null, req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Admin update player error:', error);
    res.status(500).json({ error: 'Failed to update player profile' });
  }
});

// Admin: Delete user
app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Prevent deleting yourself
    if (user.id === req.session.userId) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    // Delete related data
    db.prepare('DELETE FROM messages WHERE sender_id = ? OR recipient_id = ?').run(user.id, user.id);
    db.prepare('DELETE FROM agent_favorites WHERE agent_id = ? OR player_id = ?').run(user.id, user.id);
    if (user.role === 'player') {
      db.prepare('DELETE FROM player_videos WHERE player_id = ?').run(user.id);
      db.prepare('DELETE FROM player_images WHERE player_id = ?').run(user.id);
      db.prepare('DELETE FROM player_video_links WHERE player_id = ?').run(user.id);
      db.prepare('DELETE FROM player_school_interests WHERE player_id = ?').run(user.id);
      db.prepare('DELETE FROM player_contacts WHERE player_id = ?').run(user.id);
      db.prepare('DELETE FROM school_notes WHERE player_id = ?').run(user.id);
      db.prepare('DELETE FROM school_contacts WHERE player_id = ?').run(user.id);
      db.prepare('DELETE FROM player_profiles WHERE user_id = ?').run(user.id);
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
    db.prepare('DELETE FROM users WHERE id = ?').run(user.id);

    res.json({ success: true });
  } catch (error) {
    console.error('Admin delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Admin: Reset user password
app.post('/api/admin/users/:id/reset-password', requireAdmin, async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  try {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Admin reset password error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// Admin: Get site stats
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  try {
    const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const totalPlayers = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'player'").get().count;
    const totalAgents = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'agent'").get().count;
    const totalMessages = db.prepare('SELECT COUNT(*) as count FROM messages').get().count;
    res.json({ totalUsers, totalPlayers, totalAgents, totalMessages });
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// Admin: College Management - List all colleges
app.get('/api/admin/colleges', requireAdmin, (req, res) => {
  try {
    const colleges = db.prepare('SELECT * FROM colleges ORDER BY name ASC').all();
    res.json(colleges);
  } catch (error) {
    console.error('Admin get colleges error:', error);
    res.status(500).json({ error: 'Failed to get colleges' });
  }
});

// Admin: Add a college
app.post('/api/admin/colleges', requireAdmin, collegeLogoUpload.fields([
  { name: 'logo', maxCount: 1 }
]), (req, res) => {
  try {
    const { name, website_url, conference, team } = req.body;
    if (!name) return res.status(400).json({ error: 'College name is required' });

    const logo = req.files?.logo ? 'images/collegelogos/' + req.files.logo[0].filename : null;
    const result = db.prepare('INSERT INTO colleges (name, website_url, logo, conference, team) VALUES (?, ?, ?, ?, ?)')
      .run(name, website_url || null, logo, conference || null, team || null);
    
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (error) {
    console.error('Admin add college error:', error);
    res.status(500).json({ error: 'Failed to add college' });
  }
});

// Admin: Update a college
app.put('/api/admin/colleges/:id', requireAdmin, collegeLogoUpload.fields([
  { name: 'logo', maxCount: 1 }
]), (req, res) => {
  try {
    const { name, website_url, conference, team } = req.body;
    if (!name) return res.status(400).json({ error: 'College name is required' });

    if (req.files?.logo) {
      // Delete old logo file
      const old = db.prepare('SELECT logo FROM colleges WHERE id = ?').get(req.params.id);
      if (old && old.logo) {
        const oldPath = path.resolve(old.logo);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
      db.prepare('UPDATE colleges SET name = ?, website_url = ?, logo = ?, conference = ?, team = ? WHERE id = ?')
        .run(name, website_url || null, 'images/collegelogos/' + req.files.logo[0].filename, conference || null, team || null, req.params.id);
    } else {
      db.prepare('UPDATE colleges SET name = ?, website_url = ?, conference = ?, team = ? WHERE id = ?')
        .run(name, website_url || null, conference || null, team || null, req.params.id);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Admin update college error:', error);
    res.status(500).json({ error: 'Failed to update college' });
  }
});

// Admin: Delete a college
app.delete('/api/admin/colleges/:id', requireAdmin, (req, res) => {
  try {
    const college = db.prepare('SELECT logo FROM colleges WHERE id = ?').get(req.params.id);
    if (college && college.logo) {
      const logoPath = path.resolve(college.logo);
      if (fs.existsSync(logoPath)) fs.unlinkSync(logoPath);
    }
    db.prepare('DELETE FROM colleges WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Admin delete college error:', error);
    res.status(500).json({ error: 'Failed to delete college' });
  }
});

// Send player card image via email
app.post('/api/send-player-card', requireAuth, express.json({ limit: '10mb' }), async (req, res) => {
  try {
    const { recipientEmail, subject, message, imageData, playerName } = req.body;

    if (!recipientEmail || !imageData) {
      return res.status(400).json({ error: 'Recipient email and image are required' });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(recipientEmail)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    // Get sender info
    const sender = db.prepare('SELECT email, full_name FROM users WHERE id = ?').get(req.session.userId);

    // Extract base64 data from data URL
    const base64Data = imageData.replace(/^data:image\/png;base64,/, '');

    // Configure transporter - uses local SMTP or can be configured for external service
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: false,
      auth: {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || ''
      }
    });

    const safeName = (playerName || 'Player').replace(/[^a-zA-Z0-9_ ]/g, '');

    await transporter.sendMail({
      from: process.env.SMTP_FROM || sender.email,
      to: recipientEmail,
      subject: subject || `${safeName} - Player Card`,
      text: message || `Please see the attached player card for ${safeName}.`,
      html: `<p>${message || `Please see the attached player card for ${safeName}.`}</p><p>Sent via Gridiron Elite</p>`,
      attachments: [{
        filename: `${safeName.replace(/\s+/g, '_')}_Player_Card.png`,
        content: base64Data,
        encoding: 'base64',
        cid: 'playercard'
      }]
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Email send error:', error);
    res.status(500).json({ error: 'Failed to send email. Please check SMTP configuration.' });
  }
});

// Player: Get all colleges (read-only, for players)
app.get('/api/player/colleges', requireAuth, (req, res) => {
  try {
    const colleges = db.prepare('SELECT * FROM colleges ORDER BY name ASC').all();
    // Get this player's interests
    const interests = db.prepare('SELECT college_id, is_favorite, has_offer FROM player_school_interests WHERE player_id = ?').all(req.session.userId);
    const interestMap = {};
    interests.forEach(i => { interestMap[i.college_id] = { is_favorite: i.is_favorite, has_offer: i.has_offer }; });
    const result = colleges.map(c => ({
      ...c,
      is_favorite: interestMap[c.id]?.is_favorite || 0,
      has_offer: interestMap[c.id]?.has_offer || 0
    }));
    res.json(result);
  } catch (error) {
    console.error('Player get colleges error:', error);
    res.status(500).json({ error: 'Failed to get colleges' });
  }
});

// Player: Toggle favorite on a college
app.post('/api/player/colleges/:collegeId/favorite', requireAuth, (req, res) => {
  try {
    const collegeId = parseInt(req.params.collegeId, 10);
    if (isNaN(collegeId)) return res.status(400).json({ error: 'Invalid college ID' });
    const college = db.prepare('SELECT id FROM colleges WHERE id = ?').get(collegeId);
    if (!college) return res.status(404).json({ error: 'College not found' });

    const existing = db.prepare('SELECT id, is_favorite FROM player_school_interests WHERE player_id = ? AND college_id = ?').get(req.session.userId, collegeId);
    if (existing) {
      const newVal = existing.is_favorite ? 0 : 1;
      db.prepare('UPDATE player_school_interests SET is_favorite = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newVal, existing.id);
      res.json({ is_favorite: newVal });
    } else {
      db.prepare('INSERT INTO player_school_interests (player_id, college_id, is_favorite) VALUES (?, ?, 1)').run(req.session.userId, collegeId);
      res.json({ is_favorite: 1 });
    }
  } catch (error) {
    console.error('Toggle favorite error:', error);
    res.status(500).json({ error: 'Failed to toggle favorite' });
  }
});

// Player: Toggle offer on a college
app.post('/api/player/colleges/:collegeId/offer', requireAuth, (req, res) => {
  try {
    const collegeId = parseInt(req.params.collegeId, 10);
    if (isNaN(collegeId)) return res.status(400).json({ error: 'Invalid college ID' });
    const college = db.prepare('SELECT id FROM colleges WHERE id = ?').get(collegeId);
    if (!college) return res.status(404).json({ error: 'College not found' });

    const existing = db.prepare('SELECT id, has_offer FROM player_school_interests WHERE player_id = ? AND college_id = ?').get(req.session.userId, collegeId);
    if (existing) {
      const newVal = existing.has_offer ? 0 : 1;
      db.prepare('UPDATE player_school_interests SET has_offer = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newVal, existing.id);
      res.json({ has_offer: newVal });
    } else {
      db.prepare('INSERT INTO player_school_interests (player_id, college_id, has_offer) VALUES (?, ?, 1)').run(req.session.userId, collegeId);
      res.json({ has_offer: 1 });
    }
  } catch (error) {
    console.error('Toggle offer error:', error);
    res.status(500).json({ error: 'Failed to toggle offer' });
  }
});

// ======== School Notes & Contacts ========

// Player: Get notes for a specific college
app.get('/api/player/colleges/:collegeId/notes', requireAuth, (req, res) => {
  try {
    const collegeId = parseInt(req.params.collegeId, 10);
    if (isNaN(collegeId)) return res.status(400).json({ error: 'Invalid college ID' });
    const notes = db.prepare(
      'SELECT * FROM school_notes WHERE player_id = ? AND college_id = ? ORDER BY COALESCE(visit_date, created_at) DESC'
    ).all(req.session.userId, collegeId);
    res.json(notes);
  } catch (error) {
    console.error('Get school notes error:', error);
    res.status(500).json({ error: 'Failed to get notes' });
  }
});

// Player: Add a note for a college
app.post('/api/player/colleges/:collegeId/notes', requireAuth, (req, res) => {
  try {
    const collegeId = parseInt(req.params.collegeId, 10);
    if (isNaN(collegeId)) return res.status(400).json({ error: 'Invalid college ID' });
    const { note, visitDate } = req.body;
    if (!note || !note.trim()) return res.status(400).json({ error: 'Note text is required' });

    const college = db.prepare('SELECT id FROM colleges WHERE id = ?').get(collegeId);
    if (!college) return res.status(404).json({ error: 'College not found' });

    const result = db.prepare(
      'INSERT INTO school_notes (player_id, college_id, note, visit_date) VALUES (?, ?, ?, ?)'
    ).run(req.session.userId, collegeId, note.trim(), visitDate || null);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (error) {
    console.error('Add school note error:', error);
    res.status(500).json({ error: 'Failed to add note' });
  }
});

// Player: Update a note
app.put('/api/player/colleges/:collegeId/notes/:noteId', requireAuth, (req, res) => {
  try {
    const noteId = parseInt(req.params.noteId, 10);
    if (isNaN(noteId)) return res.status(400).json({ error: 'Invalid note ID' });
    const { note, visitDate } = req.body;
    if (!note || !note.trim()) return res.status(400).json({ error: 'Note text is required' });

    const existing = db.prepare('SELECT id FROM school_notes WHERE id = ? AND player_id = ?').get(noteId, req.session.userId);
    if (!existing) return res.status(404).json({ error: 'Note not found' });

    db.prepare('UPDATE school_notes SET note = ?, visit_date = ? WHERE id = ?').run(note.trim(), visitDate || null, noteId);
    res.json({ success: true });
  } catch (error) {
    console.error('Update school note error:', error);
    res.status(500).json({ error: 'Failed to update note' });
  }
});

// Player: Delete a note
app.delete('/api/player/colleges/:collegeId/notes/:noteId', requireAuth, (req, res) => {
  try {
    const noteId = parseInt(req.params.noteId, 10);
    if (isNaN(noteId)) return res.status(400).json({ error: 'Invalid note ID' });

    const existing = db.prepare('SELECT id FROM school_notes WHERE id = ? AND player_id = ?').get(noteId, req.session.userId);
    if (!existing) return res.status(404).json({ error: 'Note not found' });

    db.prepare('DELETE FROM school_notes WHERE id = ?').run(noteId);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete school note error:', error);
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

// Player: Get contacts for a specific college
app.get('/api/player/colleges/:collegeId/contacts', requireAuth, (req, res) => {
  try {
    const collegeId = parseInt(req.params.collegeId, 10);
    if (isNaN(collegeId)) return res.status(400).json({ error: 'Invalid college ID' });
    const contacts = db.prepare(
      'SELECT * FROM school_contacts WHERE player_id = ? AND college_id = ? ORDER BY name ASC'
    ).all(req.session.userId, collegeId);
    res.json(contacts);
  } catch (error) {
    console.error('Get school contacts error:', error);
    res.status(500).json({ error: 'Failed to get contacts' });
  }
});

// Player: Add a contact for a college
app.post('/api/player/colleges/:collegeId/contacts', requireAuth, (req, res) => {
  try {
    const collegeId = parseInt(req.params.collegeId, 10);
    if (isNaN(collegeId)) return res.status(400).json({ error: 'Invalid college ID' });
    const { name, title, email, phone } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Contact name is required' });

    const college = db.prepare('SELECT id FROM colleges WHERE id = ?').get(collegeId);
    if (!college) return res.status(404).json({ error: 'College not found' });

    const result = db.prepare(
      'INSERT INTO school_contacts (player_id, college_id, name, title, email, phone) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(req.session.userId, collegeId, name.trim(), title?.trim() || null, email?.trim() || null, phone?.trim() || null);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (error) {
    console.error('Add school contact error:', error);
    res.status(500).json({ error: 'Failed to add contact' });
  }
});

// Player: Update a contact
app.put('/api/player/colleges/:collegeId/contacts/:contactId', requireAuth, (req, res) => {
  try {
    const contactId = parseInt(req.params.contactId, 10);
    if (isNaN(contactId)) return res.status(400).json({ error: 'Invalid contact ID' });
    const { name, title, email, phone } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Contact name is required' });

    const existing = db.prepare('SELECT id FROM school_contacts WHERE id = ? AND player_id = ?').get(contactId, req.session.userId);
    if (!existing) return res.status(404).json({ error: 'Contact not found' });

    db.prepare('UPDATE school_contacts SET name = ?, title = ?, email = ?, phone = ? WHERE id = ?')
      .run(name.trim(), title?.trim() || null, email?.trim() || null, phone?.trim() || null, contactId);
    res.json({ success: true });
  } catch (error) {
    console.error('Update school contact error:', error);
    res.status(500).json({ error: 'Failed to update contact' });
  }
});

// Player: Delete a contact
app.delete('/api/player/colleges/:collegeId/contacts/:contactId', requireAuth, (req, res) => {
  try {
    const contactId = parseInt(req.params.contactId, 10);
    if (isNaN(contactId)) return res.status(400).json({ error: 'Invalid contact ID' });

    const existing = db.prepare('SELECT id FROM school_contacts WHERE id = ? AND player_id = ?').get(contactId, req.session.userId);
    if (!existing) return res.status(404).json({ error: 'Contact not found' });

    db.prepare('DELETE FROM school_contacts WHERE id = ?').run(contactId);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete school contact error:', error);
    res.status(500).json({ error: 'Failed to delete contact' });
  }
});

// Centralized upload error handling so clients see actionable errors.
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'A file is too large. Max size is 50MB per file.' });
    }
    return res.status(400).json({ error: err.message || 'Upload failed' });
  }

  if (err?.message === 'Invalid file type. Only images and videos are allowed.') {
    return res.status(400).json({ error: err.message });
  }

  return next(err);
});

// Use named pipe for iisnode, or PORT for standalone
const server = app.listen(process.env.PORT || PORT, () => {
  console.log(`Server running on ${process.env.PORT ? 'iisnode' : 'http://localhost:' + PORT}`);
});
