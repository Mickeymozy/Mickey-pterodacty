const User = require('../models/User');

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'mickidadyhamza@gmail.com')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

const isAdminUser = (user) => {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const email = String(user.email || '').trim().toLowerCase();
  return ADMIN_EMAILS.includes(email);
};

// Check if user is authenticated
const requireAuth = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  req.flash('error_msg', '⚠️ Tafadhali ingia kwanza.');
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
const requireAdmin = (req, res, next) => {
  if (req.isAuthenticated() && isAdminUser(req.user)) return next();
  req.flash('error_msg', '⚠️ Hii sehemu ni ya Admin tu.');
  res.redirect('/dashboard.html');
};

// Get user from database and attach to req
const getUserFromSession = async (req, res, next) => {
  if (req.isAuthenticated() && req.user) {
    try {
      const user = await User.findById(req.user._id);
      if (user) {
        if (isAdminUser(user) && user.role !== 'admin') {
          user.role = 'admin';
          await user.save();
        }
        req.user = user;
      }
    } catch (err) {
      console.error('❌ Error fetching user:', err);
    }
  }
  next();
};

module.exports = { requireAuth, requireGuest, getUserFromSession, requireAdmin, isAdminUser, ADMIN_EMAILS };