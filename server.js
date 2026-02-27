const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('./database');

const app = express();
const PORT = 3000;

// Create uploads directory
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));
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

// Register
app.post('/api/register', async (req, res) => {
  const { email, password, role, fullName } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = db.prepare('INSERT INTO users (email, password, role) VALUES (?, ?, ?)').run(email, hashedPassword, role);
    
    if (role === 'player') {
      db.prepare('INSERT INTO player_profiles (user_id, full_name) VALUES (?, ?)').run(result.lastInsertRowid, fullName);
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
  res.json(profile || {});
});

// Update player profile
app.post('/api/player/profile', requireAuth, upload.fields([
  { name: 'profilePicture', maxCount: 1 },
  { name: 'highlightVideos', maxCount: 5 },
  { name: 'additionalImages', maxCount: 10 },
  { name: 'collegeOffers', maxCount: 20 }
]), (req, res) => {
  const data = req.body;
  const files = req.files;
  
  console.log('Update request for user:', req.session.userId);
  console.log('Data received:', data);
  
  try {
    // Update basic profile info
    const result = db.prepare(`
      UPDATE player_profiles SET
        full_name = ?, high_school = ?, graduation_year = ?, position = ?,
        height = ?, weight = ?, forty_yard_dash = ?, bench_press = ?,
        squat = ?, vertical_jump = ?, shuttle_5_10_5 = ?, l_drill = ?,
        broad_jump = ?, power_clean = ?, single_leg_squat = ?, gpa = ?, bio = ?
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
      req.session.userId
    );
    
    console.log(`Profile update result: ${result.changes} rows changed`);
    
    // Update profile picture if provided
    if (files?.profilePicture) {
      db.prepare('UPDATE player_profiles SET profile_picture = ? WHERE user_id = ?')
        .run(files.profilePicture[0].filename, req.session.userId);
    }
    
    // Add new videos to existing ones
    if (files?.highlightVideos) {
      const profile = db.prepare('SELECT highlight_videos FROM player_profiles WHERE user_id = ?').get(req.session.userId);
      let videos = profile.highlight_videos ? JSON.parse(profile.highlight_videos) : [];
      const newVideos = files.highlightVideos.map(f => f.filename);
      videos = [...videos, ...newVideos];
      db.prepare('UPDATE player_profiles SET highlight_videos = ? WHERE user_id = ?')
        .run(JSON.stringify(videos), req.session.userId);
    }
    
    // Add new images to existing ones
    if (files?.additionalImages) {
      const profile = db.prepare('SELECT additional_images FROM player_profiles WHERE user_id = ?').get(req.session.userId);
      let images = profile.additional_images ? JSON.parse(profile.additional_images) : [];
      const newImages = files.additionalImages.map(f => f.filename);
      images = [...images, ...newImages];
      db.prepare('UPDATE player_profiles SET additional_images = ? WHERE user_id = ?')
        .run(JSON.stringify(images), req.session.userId);
    }
    
    // Add new college offer logos to existing ones
    if (files?.collegeOffers) {
      const profile = db.prepare('SELECT college_offers FROM player_profiles WHERE user_id = ?').get(req.session.userId);
      let offers = profile.college_offers ? JSON.parse(profile.college_offers) : [];
      const newOffers = files.collegeOffers.map(f => f.filename);
      offers = [...offers, ...newOffers];
      db.prepare('UPDATE player_profiles SET college_offers = ? WHERE user_id = ?')
        .run(JSON.stringify(offers), req.session.userId);
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

// Delete college offer logo from player profile
app.delete('/api/player/offer/:filename', requireAuth, (req, res) => {
  try {
    const profile = db.prepare('SELECT college_offers FROM player_profiles WHERE user_id = ?').get(req.session.userId);
    
    if (!profile || !profile.college_offers) {
      return res.status(404).json({ error: 'No college offers found' });
    }
    
    let offers = JSON.parse(profile.college_offers);
    offers = offers.filter(offer => offer !== req.params.filename);
    
    db.prepare('UPDATE player_profiles SET college_offers = ? WHERE user_id = ?')
      .run(JSON.stringify(offers), req.session.userId);
    
    // Delete file from disk
    const filePath = path.join('uploads', req.params.filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Delete offer error:', error);
    res.status(500).json({ error: 'Failed to delete college offer' });
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
  
  const player = db.prepare('SELECT * FROM player_profiles WHERE id = ?').get(req.params.id);
  
  if (!player) {
    return res.status(404).json({ error: 'Player not found' });
  }
  
  res.json(player);
});

// Delete video from player profile
app.delete('/api/player/video/:filename', requireAuth, (req, res) => {
  try {
    const profile = db.prepare('SELECT highlight_videos FROM player_profiles WHERE user_id = ?').get(req.session.userId);
    
    if (!profile || !profile.highlight_videos) {
      return res.status(404).json({ error: 'No videos found' });
    }
    
    let videos = JSON.parse(profile.highlight_videos);
    videos = videos.filter(v => v !== req.params.filename);
    
    db.prepare('UPDATE player_profiles SET highlight_videos = ? WHERE user_id = ?')
      .run(JSON.stringify(videos), req.session.userId);
    
    // Delete file from disk
    const filePath = path.join('uploads', req.params.filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Delete video error:', error);
    res.status(500).json({ error: 'Failed to delete video' });
  }
});

// Delete image from player profile
app.delete('/api/player/image/:filename', requireAuth, (req, res) => {
  try {
    const profile = db.prepare('SELECT additional_images FROM player_profiles WHERE user_id = ?').get(req.session.userId);
    
    if (!profile || !profile.additional_images) {
      return res.status(404).json({ error: 'No images found' });
    }
    
    let images = JSON.parse(profile.additional_images);
    images = images.filter(img => img !== req.params.filename);
    
    db.prepare('UPDATE player_profiles SET additional_images = ? WHERE user_id = ?')
      .run(JSON.stringify(images), req.session.userId);
    
    // Delete file from disk
    const filePath = path.join('uploads', req.params.filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Delete image error:', error);
    res.status(500).json({ error: 'Failed to delete image' });
  }
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
