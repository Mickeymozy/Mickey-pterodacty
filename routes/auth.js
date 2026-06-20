const express = require('express');
const passport = require('passport');
const router = express.Router();
const User = require('../models/User');
const { requireGuest } = require('../middleware/auth');
const axios = require('axios');

// Pterodactyl API helper
const PTERODACTYL_URL = process.env.PTERODACTYL_URL?.replace(/\/$/, '');
const PTERODACTYL_APP_API_KEY = process.env.PTERODACTYL_APP_API_KEY;
const hasPteroConfig = PTERODACTYL_URL && PTERODACTYL_APP_API_KEY;

const appApi = hasPteroConfig
  ? axios.create({
      baseURL: `${PTERODACTYL_URL}/api/application`,
      headers: {
        Authorization: `Bearer ${PTERODACTYL_APP_API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      timeout: 10000
    })
  : null;

// Helper: Get Pterodactyl user
async function getPteroUser(identifier) {
  if (!hasPteroConfig) return null;
  try {
    let page = 1;
    while (true) {
      const res = await appApi.get(`/users?page=${page}&per_page=50`);
      const users = res.data.data || [];
      if (!users.length) break;

      const found = users.find((u) =>
        u.attributes.username === String(identifier).toLowerCase() ||
        u.attributes.email === String(identifier).toLowerCase()
      );

      if (found) return found.attributes;
      page += 1;
    }
  } catch (err) {
    console.error('❌ Ptero API Error:', err.message);
  }
  return null;
}

// ============================================
// ROUTES
// ============================================

// Login page
router.get('/login', requireGuest, (req, res) => {
  res.sendFile('login.html', { root: './public' });
});

// Login handler
router.post('/auth/login', (req, res, next) => {
  passport.authenticate('local', {
    successRedirect: '/dashboard.html',
    failureRedirect: '/login.html?error=1',
    failureFlash: true
  })(req, res, next);
});

// Register handler
router.post('/auth/register', async (req, res) => {
  const { username, email, password, first_name, last_name } = req.body;

  if (!hasPteroConfig) {
    req.flash('error_msg', '❌ Mfumo wa Pterodactyl haujasanidiwa.');
    return res.redirect('/login.html?tab=register');
  }

  try {
    const cleanUsername = username.toLowerCase().replace(/[^a-z0-9]/g, '');

    // Check if user exists in MongoDB
    const existingUser = await User.findOne({
      $or: [{ username: cleanUsername }, { email: email.toLowerCase() }]
    });
    if (existingUser) {
      req.flash('error_msg', '❌ Username au Email tayari imesajiliwa.');
      return res.redirect('/login.html?tab=register');
    }

    // Check if user exists in Pterodactyl
    const pteroCheck = await getPteroUser(cleanUsername);
    if (pteroCheck) {
      req.flash('error_msg', '❌ Username au Email tayari ipo kwenye panel.');
      return res.redirect('/login.html?tab=register');
    }

    // Create user in Pterodactyl
    const pteroUser = await appApi.post('/users', {
      username: cleanUsername,
      email: email.toLowerCase(),
      first_name: first_name || username,
      last_name: last_name || 'User',
      password: password,
      language: 'en'
    });

    const pteroData = pteroUser.data.attributes;

    // Save user to MongoDB
    const newUser = new User({
      username: cleanUsername,
      email: email.toLowerCase(),
      password: password,
      pterodactylId: pteroData.id,
      firstName: pteroData.first_name,
      lastName: pteroData.last_name
    });

    await newUser.save();

    req.flash('success_msg', '✅ Akaunti imefunguliwa! Sasa unaweza kuingia.');
    res.redirect('/login.html?tab=login');

  } catch (err) {
    console.error('❌ Registration error:', err.response?.data || err.message);
    req.flash('error_msg', '❌ Imefeli kusajili. Hakikisha password ina herufi kubwa, ndogo na namba.');
    res.redirect('/login.html?tab=register');
  }
});

// Reset password
router.post('/auth/reset-password', async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email: email.toLowerCase() });

  if (!user) {
    req.flash('error_msg', '❌ Barua pepe hiyo haijasajiliwa.');
    return res.redirect('/login.html?tab=reset');
  }

  // In production, send email with reset link
  req.flash('success_msg', `✅ Maelezo ya kubadili password yametumwa kwa ${email}`);
  res.redirect('/login.html?tab=reset');
});

// Logout
router.get('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.flash('success_msg', '✅ Umetoka kikamilifu.');
    res.redirect('/login.html');
  });
});

// Get flash messages
router.get('/api/auth/flash', (req, res) => {
  res.json({
    success: req.flash('success_msg'),
    error: req.flash('error_msg') || req.flash('error')
  });
});

module.exports = router;