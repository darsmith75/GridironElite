const requireAuth = (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  if (req.session.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  next();
};

// Admin can also access coach routes
const requireCoach = (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  if (req.session.role !== 'coach' && req.session.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  next();
};

module.exports = { requireAuth, requireAdmin, requireCoach };
