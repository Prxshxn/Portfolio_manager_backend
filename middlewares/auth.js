const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
  try {
    // Get token from headers
    const token = req.headers.authorization?.split(' ')[1];
    
    // Also check localStorage data forwarded from frontend
    const localStorageUser = req.headers['x-user-data'] 
      ? JSON.parse(req.headers['x-user-data'])
      : null;

    // Verify token if exists
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      // Merge decoded token data with localStorage user (so allowed_tabs etc. are preserved)
      req.user = localStorageUser ? { ...decoded, ...localStorageUser } : decoded;
    } 
    // Fallback to localStorage data
    else if (localStorageUser) {
      req.user = localStorageUser;
    }

    next();
  } catch (error) {
    console.error('Auth error:', error);
    res.status(401).json({ error: 'Authentication failed' });
  }
};
