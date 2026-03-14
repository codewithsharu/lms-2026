const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');

// Verify JWT token from HTTP-only cookie
const verifyToken = async (req, res, next) => {
  try {
    const token = req.cookies?.token;
    
    if (!token) {
      return res.status(401).json({ error: 'Access denied. No token provided.' });
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Fetch user from database to ensure they still exist and are active
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, full_name, role, is_active')
      .eq('id', decoded.userId)
      .single();

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid token. User not found.' });
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'Account is deactivated.' });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token has expired.' });
    }
    return res.status(401).json({ error: 'Invalid token.' });
  }
};

// Check if user is admin
const isAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
  }
  next();
};

// Check if user is teacher or admin
const isTeacherOrAdmin = (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'teacher') {
    return res.status(403).json({ error: 'Access denied. Teacher or Admin privileges required.' });
  }
  next();
};

// Check specific roles
const hasRole = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Access denied. Required roles: ${roles.join(', ')}` });
    }
    next();
  };
};

module.exports = {
  verifyToken,
  isAdmin,
  isTeacherOrAdmin,
  hasRole
};
