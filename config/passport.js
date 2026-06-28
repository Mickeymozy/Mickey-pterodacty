const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const User = require('../models/User');
const { isAdminUser } = require('../middleware/auth');

module.exports = function(passport) {
  // Serialize user
  passport.serializeUser((user, done) => {
    done(null, user._id);
  });

  // Deserialize user
  passport.deserializeUser(async (id, done) => {
    try {
      const user = await User.findById(id);
      done(null, user);
    } catch (err) {
      done(err, null);
    }
  });

  // Local Strategy
  passport.use(new LocalStrategy(
    { usernameField: 'username' },
    async (username, password, done) => {
      try {
        // Find user by username or email
        const user = await User.findOne({
          $or: [
            { username: username.toLowerCase() },
            { email: username.toLowerCase() }
          ]
        });

        if (!user) {
          return done(null, false, { 
            message: '❌ Username au email haipatikani.' 
          });
        }

        // Check password
        const isValid = await user.comparePassword(password);
        if (!isValid) {
          return done(null, false, { 
            message: '❌ Password sio sahihi.' 
          });
        }

        // Update last login and admin status
        user.lastLogin = new Date();
        if (isAdminUser(user) && user.role !== 'admin') {
          user.role = 'admin';
          user.isAdmin = true;
        } else if (!isAdminUser(user) && user.role === 'admin') {
          user.role = 'user';
          user.isAdmin = false;
        }
        await user.save();

        return done(null, user);
      } catch (err) {
        return done(err);
      }
    }
  ));
};