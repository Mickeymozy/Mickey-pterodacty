const User = require('../models/User');

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

// Get user from database and attach to req
const getUserFromSession = async (req, res, next) => {
  if (req.isAuthenticated() && req.user) {
    try {
      const user = await User.findById(req.user._id);
      if (user) {
        req.user = user;
      }
    } catch (err) {
      console.error('❌ Error fetching user:', err);
    }
  }
  next();
};

module.exports = { requireAuth, requireGuest, getUserFromSession };