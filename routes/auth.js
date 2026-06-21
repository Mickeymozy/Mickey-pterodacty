const express = require('express');
const passport = require('passport');
const crypto = require('crypto');
const router = express.Router();
const User = require('../models/User');
const { requireGuest } = require('../middleware/auth');
const sendEmail = require('../utils/email');
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

function generateCode(length = 6) {
  return crypto.randomInt(0, 10 ** length).toString().padStart(length, '0');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function sendVerificationMessage(user) {
  if (!user || !user.email) return;

  const code = generateCode();
  user.verificationCode = code;
  user.verificationCodeExpires = Date.now() + 5 * 60 * 1000;
  await user.save();

  const sent = await sendEmail({
    to: user.email,
    subject: 'Verify your account',
    text: `Your verification code is ${code}`,
    html: `<p>Your verification code is <strong>${code}</strong>. It expires in 5 minutes.</p>`
  });

  return sent;
}

// ============================================
// ROUTES
// ============================================

router.get('/login', requireGuest, (req, res) => {
  res.sendFile('login.html', { root: './public' });
});

router.post('/auth/login', (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) {
      console.error('❌ Login error:', err);
      return next(err);
    }

    if (!user) {
      req.flash('error_msg', info?.message || '❌ Login failed.');
      return res.redirect('/login.html?error=1');
    }

    req.logIn(user, (loginErr) => {
      if (loginErr) {
        console.error('❌ Session error:', loginErr);
        return next(loginErr);
      }

      if (!user.isEmailVerified) {
        req.flash('success_msg', '✅ Ingia; unaweza kuendelea kutumia akaunti yako.');
      }

      return res.redirect('/dashboard.html');
    });
  })(req, res, next);
});

router.post('/auth/register', async (req, res) => {
  const { username, email, password, first_name, last_name } = req.body;
  const cleanUsername = String(username || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanEmail = String(email || '').trim().toLowerCase();

  if (!cleanUsername || !cleanEmail || !password) {
    req.flash('error_msg', '❌ Taarifa zote zinahitajika.');
    return res.redirect('/login.html?tab=register');
  }

  try {
    const existingUser = await User.findOne({
      $or: [{ username: cleanUsername }, { email: cleanEmail }]
    });

    if (existingUser) {
      req.flash('error_msg', '❌ Username au Email tayari imesajiliwa.');
      return res.redirect('/login.html?tab=register');
    }

    let pteroData = null;
    if (hasPteroConfig) {
      const pteroCheck = await getPteroUser(cleanUsername);
      if (pteroCheck) {
        req.flash('error_msg', '❌ Username au Email tayari ipo kwenye panel.');
        return res.redirect('/login.html?tab=register');
      }

      const pteroUser = await appApi.post('/users', {
        username: cleanUsername,
        email: cleanEmail,
        first_name: first_name || username,
        last_name: last_name || 'User',
        password,
        language: 'en'
      });
      pteroData = pteroUser.data.attributes;
    }

    const newUser = new User({
      username: cleanUsername,
      email: cleanEmail,
      password,
      pteroId: pteroData?.id || 0,
      firstName: pteroData?.first_name || first_name || username,
      lastName: pteroData?.last_name || last_name || 'User',
      displayName: pteroData?.first_name || first_name || username,
      isEmailVerified: false
    });

    await newUser.save();
    await sendVerificationMessage(newUser);

    req.flash('success_msg', '✅ Akaunti imeundwa. Angalia email yako kwa msimbo wa uthibitisho.');
    res.redirect('/login.html?tab=login');
  } catch (err) {
    console.error('❌ Registration error:', err.response?.data || err.message);
    req.flash('error_msg', '❌ Imefeli kusajili. Hakikisha password ina herufi kubwa, ndogo na namba.');
    res.redirect('/login.html?tab=register');
  }
});

router.post('/auth/reset-password', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();

  if (!email) {
    req.flash('error_msg', '❌ Taarifa ya email inahitajika.');
    return res.redirect('/login.html?tab=reset');
  }

  const user = await User.findOne({ email });
  if (!user) {
    req.flash('error_msg', '❌ Barua pepe hiyo haijasajiliwa.');
    return res.redirect('/login.html?tab=reset');
  }

  const token = generateToken();
  user.resetToken = token;
  user.resetTokenExpires = Date.now() + 30 * 60 * 1000;
  await user.save();

  const resetLink = `${process.env.APP_URL || 'http://localhost:3000'}/login.html?tab=reset&token=${token}`;
  const sent = await sendEmail({
    to: user.email,
    subject: 'Reset your password',
    text: `Use this link to reset your password: ${resetLink}`,
    html: `<p>Use this link to reset your password:</p><p><a href="${resetLink}">${resetLink}</a></p>`
  });

  if (sent) {
    req.flash('success_msg', `✅ Maelezo ya kubadili password yametumwa kwa ${email}`);
  } else {
    req.flash('error_msg', '❌ Haikuweza kutuma email ya reset. Angalia SMTP settings.');
  }

  res.redirect('/login.html?tab=reset');
});

router.post('/auth/reset-password/confirm', async (req, res) => {
  const { token, password } = req.body;

  if (!token || !password || password.length < 6) {
    req.flash('error_msg', '❌ Token au password si sahihi.');
    return res.redirect('/login.html?tab=reset');
  }

  const user = await User.findOne({
    resetToken: token,
    resetTokenExpires: { $gt: Date.now() }
  });

  if (!user) {
    req.flash('error_msg', '❌ Token ya reset imepita au si sahihi.');
    return res.redirect('/login.html?tab=reset');
  }

  user.password = password;
  user.resetToken = null;
  user.resetTokenExpires = null;
  await user.save();

  req.flash('success_msg', '✅ Password yako imebadilishwa.');
  res.redirect('/login.html?tab=login');
});

router.get('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.flash('success_msg', '✅ Umetoka kikamilifu.');
    res.redirect('/login.html');
  });
});

router.get('/api/auth/flash', (req, res) => {
  res.json({
    success: res.locals.success_msg || [],
    error: res.locals.error_msg || res.locals.error || []
  });
});

module.exports = router;