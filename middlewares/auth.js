const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

module.exports = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    // Identity comes from the JWT only. Client x-user-data must not overwrite
    // id / role / isAdmin (that let a verifier stamp final-office approval).
    req.user = {
      ...decoded,
      id: decoded.id,
      username: decoded.username,
      role: decoded.role,
      originalRole: decoded.originalRole,
      isAdmin: decoded.isAdmin === true
    };

    next();
  } catch (error) {
    console.error('Auth error:', error);
    res.status(401).json({ success: false, error: 'Authentication failed' });
  }
};
