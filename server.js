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
  { name: 'cardPhoto', maxCount: 1 },
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
        broad_jump = ?, power_clean = ?, single_leg_squat = ?, gpa = ?, bio = ?,
        father_name = ?, father_email = ?, father_phone = ?,
        mother_name = ?, mother_email = ?, mother_phone = ?,
        coach_name = ?, coach_email = ?, coach_phone = ?,
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
      data.fatherName || null,
      data.fatherEmail || null,
      data.fatherPhone || null,
      data.motherName || null,
      data.motherEmail || null,
      data.motherPhone || null,
      data.coachName || null,
      data.coachEmail || null,
      data.coachPhone || null,
      data.hudlLink || null,
      data.instagramLink || null,
      data.twitterLink || null,
      data.hudlUsername || null,
      data.instagramUsername || null,
      data.twitterUsername || null,
      req.session.userId
    );
    
    console.log(`Profile update result: ${result.changes} rows changed`);
    
    // Update profile picture if provided
    if (files?.profilePicture) {
      db.prepare('UPDATE player_profiles SET profile_picture = ? WHERE user_id = ?')
        .run(files.profilePicture[0].filename, req.session.userId);
    }
    
    // Update card photo if provided
    if (files?.cardPhoto) {
      db.prepare('UPDATE player_profiles SET card_photo = ? WHERE user_id = ?')
        .run(files.cardPhoto[0].filename, req.session.userId);
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

// Delete card photo
app.delete('/api/player/card-photo', requireAuth, (req, res) => {
  try {
    const profile = db.prepare('SELECT card_photo FROM player_profiles WHERE user_id = ?').get(req.session.userId);
    
    if (profile && profile.card_photo) {
      // Delete file from disk
      const filePath = path.join('uploads', profile.card_photo);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      
      // Clear from database
      db.prepare('UPDATE player_profiles SET card_photo = NULL WHERE user_id = ?')
        .run(req.session.userId);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Delete card photo error:', error);
    res.status(500).json({ error: 'Failed to delete card photo' });
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
    bio: agent.bio
  });
});

// Agent: Update agent profile
app.post('/api/agent/profile', requireAuth, (req, res) => {
  if (req.session.role !== 'agent') return res.status(403).json({ error: 'Forbidden' });
  
  const { fullName, email, phone, organization, title, experience, bio } = req.body;
  
  try {
    db.prepare(`
      UPDATE users 
      SET full_name = ?, email = ?, phone = ?, organization = ?, title = ?, experience = ?, bio = ?
      WHERE id = ?
    `).run(fullName, email, phone, organization, title, experience, bio, req.session.userId);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating agent profile:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Agent: Change password
app.post('/api/agent/change-password', requireAuth, (req, res) => {
  if (req.session.role !== 'agent') return res.status(403).json({ error: 'Forbidden' });
  
  const { currentPassword, newPassword } = req.body;
  
  const agent = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  
  if (!agent || agent.password !== currentPassword) {
    return res.status(400).send('Current password is incorrect');
  }
  
  try {
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(newPassword, req.session.userId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).send('Failed to change password');
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

// Use named pipe for iisnode, or PORT for standalone
const server = app.listen(process.env.PORT || PORT, () => {
  console.log(`Server running on ${process.env.PORT ? 'iisnode' : 'http://localhost:' + PORT}`);
});
