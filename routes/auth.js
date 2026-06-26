const express = require('express');
const passport = require('passport');
const crypto = require('crypto');
const router = express.Router();
const User = require('../models/User');
const { requireGuest } = require('../middleware/auth');
const sendEmail = require('../utils/email');
const { validatePasswordComplexity, getStrengthLabel } = require('../utils/passwordValidator');
const axios = require('axios');

const COMMON_PASSWORDS = new Set([
  'password', '123456', '123456789', 'qwerty', 'password123', 'admin', 'welcome',
  'changeme', 'letmein', 'secret', 'test1234', 'iloveyou', 'sunshine', 'monkey'
]);

function isAcceptablePassword(password) {
  const trimmed = String(password || '').trim();
  const digitCount = (trimmed.match(/\d/g) || []).length;
  return trimmed.length >= 8 && digitCount >= 4 && !COMMON_PASSWORDS.has(trimmed.toLowerCase());
}

function generateRandomPassword(length = 24) {
  return crypto.randomBytes(length).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, length);
}

async function findOrCreateGithubUser(profile) {
  const email = String(profile.email || '').trim().toLowerCase();
  let user = await User.findOne({ githubId: String(profile.id) });

  if (!user && email) {
    user = await User.findOne({ email });
  }

  if (!user) {
    const baseUsername = String(profile.login || profile.name || 'githubuser')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 20) || 'githubuser';

    let username = baseUsername;
    let suffix = 1;
    while (await User.findOne({ username })) {
      username = `${baseUsername}${suffix}`;
      suffix += 1;
    }

    user = new User({
      username,
      email: email || `${username}@github.local`,
      password: generateRandomPassword(),
      githubId: String(profile.id),
      authProvider: 'github',
      firstName: profile.name?.split(' ')[0] || profile.login || 'GitHub',
      lastName: profile.name?.split(' ').slice(1).join(' ') || '',
      displayName: profile.name || profile.login || username,
      isEmailVerified: true
    });

    await user.save();
  } else if (!user.githubId) {
    user.githubId = String(profile.id);
    user.authProvider = 'github';
    if (!user.displayName) user.displayName = profile.name || profile.login || user.username;
    if (!user.firstName) user.firstName = profile.name?.split(' ')[0] || profile.login || 'GitHub';
    await user.save();
  }

  return user;
}

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
  const { username, email, password, confirmPassword, first_name, last_name } = req.body;
  const cleanUsername = String(username || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanEmail = String(email || '').trim().toLowerCase();

  if (!cleanUsername || !cleanEmail || !password) {
    req.flash('error_msg', '❌ Taarifa zote zinahitajika.');
    return res.redirect('/login.html?tab=register');
  }

  // Validate password complexity
  const passwordValidation = validatePasswordComplexity(password);
  if (!passwordValidation.isValid) {
    req.flash('error_msg', `❌ ${passwordValidation.errors.join(', ')}`);
    return res.redirect('/login.html?tab=register');
  }

  // Check if passwords match
  if (password !== confirmPassword) {
    req.flash('error_msg', '❌ Passwords do not match');
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
      isEmailVerified: false,
      coins: 0
    });

    await newUser.save();
    const sent = await sendVerificationMessage(newUser);

    if (sent) {
      req.flash('success_msg', '✅ Akaunti imeundwa. Angalia email yako kwa msimbo wa uthibitisho.');
    } else {
      req.flash('error_msg', '⚠️ Akaunti imeundwa, lakini email ya uthibitisho haikuweza kutumwa. Tafadhali wasiliana na support.');
    }

    res.redirect('/login.html?tab=login');
  } catch (err) {
    console.error('❌ Registration error:', err.response?.data || err.message);
    req.flash('error_msg', '❌ Imefeli kusajili. Hakikisha password ina herufi kubwa, ndogo, namba, na alama maalum.');
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

  if (!token || !password || !isAcceptablePassword(password)) {
    req.flash('error_msg', '❌ Token au password si sahihi. Password lazima iwe na angalau herufi 8 na namba 4, na isiwe ya kawaida.');
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

router.get('/auth/github', (req, res) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const redirectUri = `${process.env.APP_URL || 'http://localhost:3000'}/auth/github/callback`;

  if (!clientId) {
    req.flash('error_msg', '❌ GitHub login haijasanidiwa bado.');
    return res.redirect('/login.html?tab=login');
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'read:user user:email',
    allow_signup: 'true'
  });

  res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
});

router.get('/auth/github/callback', async (req, res, next) => {
  const code = req.query.code;
  if (!code) {
    req.flash('error_msg', '❌ GitHub login ilikatishwa.');
    return res.redirect('/login.html?tab=login');
  }

  try {
    const tokenRes = await axios.post(
      'https://github.com/login/oauth/access_token',
      {
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${process.env.APP_URL || 'http://localhost:3000'}/auth/github/callback`
      },
      {
        headers: {
          Accept: 'application/json'
        }
      }
    );

    const accessToken = tokenRes.data?.access_token;
    if (!accessToken) {
      throw new Error('GitHub token not provided.');
    }

    const userRes = await axios.get('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json'
      }
    });

    const profile = userRes.data || {};
    let email = profile.email || '';

    if (!email) {
      const emailRes = await axios.get('https://api.github.com/user/emails', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json'
        }
      });
      const primaryEmail = (emailRes.data || []).find((entry) => entry.primary && entry.verified);
      email = primaryEmail?.email || '';
    }

    const user = await findOrCreateGithubUser({
      id: profile.id,
      login: profile.login,
      name: profile.name,
      email
    });

    req.logIn(user, async (loginErr) => {
      if (loginErr) return next(loginErr);
      user.lastLogin = new Date();
      await user.save();
      res.redirect('/dashboard.html');
    });
  } catch (err) {
    console.error('❌ GitHub auth error:', err.response?.data || err.message);
    req.flash('error_msg', '❌ GitHub login ilifeli. Jaribu tena baadaye.');
    res.redirect('/login.html?tab=login');
  }
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


// Password requirements endpoint
router.get('/auth/password-requirements', (req, res) => {
  res.json({
    success: true,
    requirements: [
      { rule: 'At least 8 characters long', code: 'LENGTH' },
      { rule: 'Contains uppercase letter (A-Z)', code: 'UPPERCASE' },
      { rule: 'Contains lowercase letter (a-z)', code: 'LOWERCASE' },
      { rule: 'Contains numeric character (0-9)', code: 'NUMERIC' },
      { rule: 'Contains special character (!@#$%^&* etc.)', code: 'SPECIAL' }
    ]
  });
});

module.exports = router;