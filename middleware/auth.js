const User = require('../models/User');

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'mickidadyhamza@gmail.com')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

const isAdminUser = (user) => {
  if (!user) return false;
  if (user.role === 'admin' || user.isAdmin) return true;
  const email = String(user.email || '').trim().toLowerCase();
  return ADMIN_EMAILS.includes(email);
};

const syncAdminStatus = async (user) => {
  if (!user) return null;
  const shouldBeAdmin = isAdminUser(user);

  if (shouldBeAdmin && user.role !== 'admin') {
    user.role = 'admin';
  }

  if (shouldBeAdmin && !user.isAdmin) {
    user.isAdmin = true;
  }

  if (!shouldBeAdmin && user.role === 'admin') {
    user.role = 'user';
  }

  if (!shouldBeAdmin && user.isAdmin) {
    user.isAdmin = false;
  }

  if (user.isModified('role') || user.isModified('isAdmin')) {
    await user.save();
  }

  return user;
};

// Check if user is authenticated
const isApiRequest = (req) => {
  const path = req.originalUrl || req.url || '';
  return path.startsWith('/api') || req.headers.accept?.includes('application/json') || req.xhr;
};

const requireAuth = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  req.flash('error_msg', '⚠️ Tafadhali ingia kwanza.');
  if (isApiRequest(req)) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  res.redirect('/login.html');
};

// Check if user is guest (not logged in)
const requireGuest = (req, res, next) => {
  if (req.isAuthenticated()) {
    return res.redirect('/dashboard.html');
  }
  next();
};

// Check if the current user is an admin
const requireAdmin = async (req, res, next) => {
  if (req.isAuthenticated()) {
    try {
      const user = await User.findById(req.user?._id);
      if (user) {
        const syncedUser = await syncAdminStatus(user);
        req.user = syncedUser || user;
        if (isAdminUser(req.user)) return next();
      }
    } catch (err) {
      console.error('❌ Error checking admin access:', err);
    }
  }

  req.flash('error_msg', '⚠️ Hii sehemu ni ya Admin tu.');
  if (isApiRequest(req)) {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }
  res.redirect('/dashboard.html');
};

// Get user from database and attach to req
const getUserFromSession = async (req, res, next) => {
  if (req.isAuthenticated() && req.user) {
    try {
      const user = await User.findById(req.user._id);
      if (user) {
        const syncedUser = await syncAdminStatus(user);
        req.user = syncedUser || user;
      }
    } catch (err) {
      console.error('❌ Error fetching user:', err);
    }
  }
  next();
};

module.exports = { requireAuth, requireGuest, getUserFromSession, requireAdmin, isAdminUser, ADMIN_EMAILS, syncAdminStatus };