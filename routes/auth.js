const express = require('express');
const passport = require('passport');
const crypto = require('crypto');
const axios = require('axios');
const router = express.Router();
const User = require('../models/User');
const { requireGuest, ADMIN_EMAILS } = require('../middleware/auth');
const sendEmail = require('../utils/email');
const { appApi, hasPteroConfig } = require('../utils/pteroClient');

const COMMON_PASSWORDS = new Set([
  'password', '123456', '123456789', 'qwerty', 'password123', 'admin', 'welcome',
  'changeme', 'letmein', 'secret', 'test1234', 'iloveyou', 'sunshine', 'monkey'
]);

function isAcceptablePassword(password) {
  const trimmed = String(password || '').trim();
  return trimmed.length >= 4 && !COMMON_PASSWORDS.has(trimmed.toLowerCase());
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

async function getPteroUser(identifier) {
  if (!hasPteroConfig || !appApi) return null;
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
  passport.authenticate('local', async (err, user, info) => {
    if (err) {
      console.error('❌ Login error:', err);
      return next(err);
    }

    if (!user) {
      req.flash('error_msg', info?.message || '❌ Login failed.');
      return res.redirect('/login.html?error=1');
    }

    req.logIn(user, async (loginErr) => {
      if (loginErr) {
        console.error('❌ Session error:', loginErr);
        return next(loginErr);
      }

      user.lastLogin = new Date();
      await user.save().catch(() => {});

      const loginEmailSent = await sendEmail({
        to: user.email,
        subject: 'Login notification',
        text: `Hello ${user.displayName || user.username}, you signed in to your account at ${new Date().toLocaleString()}. If this was not you, please contact support immediately.`,
        html: `<p>Hello <strong>${user.displayName || user.username}</strong>,</p><p>You signed in to your account at <strong>${new Date().toLocaleString()}</strong>.</p><p>If this was not you, please contact support immediately.</p>`
      });

      if (!loginEmailSent) {
        console.warn(`⚠️ Login email could not be sent to ${user.email}`);
      }

      if (!user.isEmailVerified) {
        req.flash('success_msg', '✅ Ingia; unaweza kuendelea kutumia akaunti yako.');
      }

      return res.redirect('/dashboard.html');
    });
  })(req, res, next);
});

// IMEREKEBISHWA LOGIC YA USAJILI HAPA
router.post('/auth/register', async (req, res) => {
  const { username, email, password, confirmPassword, first_name, last_name } = req.body;
  const cleanUsername = String(username || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanEmail = String(email || '').trim().toLowerCase();

  if (!cleanUsername || !cleanEmail || !password) {
    req.flash('error_msg', '❌ Taarifa zote zinahitajika.');
    return res.redirect('/login.html?tab=register');
  }

  if (!isAcceptablePassword(password)) {
    req.flash('error_msg', '❌ Password lazima iwe na angalau herufi 4 na isiwe ya kawaida.');
    return res.redirect('/login.html?tab=register');
  }

  if (password !== confirmPassword) {
    req.flash('error_msg', '❌ Passwords do not match');
    return res.redirect('/login.html?tab=register');
  }

  try {
    // 1. Angalia kama yupo kwenye Local Database ya Node kwanza
    const existingUser = await User.findOne({
      $or: [{ username: cleanUsername }, { email: cleanEmail }]
    });

    if (existingUser) {
      req.flash('error_msg', '❌ Username au Email tayari imesajiliwa kwenye mfumo.');
      return res.redirect('/login.html?tab=register');
    }

    let pteroData = null;

    if (hasPteroConfig) {
      // 2. Angalia kama mtumiaji tayari yupo kule Pterodactyl Panel
      pteroData = await getPteroUser(cleanUsername) || await getPteroUser(cleanEmail);

      if (pteroData) {
        // Kama yupo Pterodactyl, hatumuundii upya, tunachukua data zake tu za sasa hivi
        console.log(`ℹ️ User found on Pterodactyl: ${pteroData.username}. Syncing to local DB.`);
      } else {
        // Kama hayupo kabisa Pterodactyl, basi mtengenezee akaunti mpya Pterodactyl kwa kutumia password hii hii ya sasa hivi
        try {
          const pteroUser = await appApi.post('/users', {
            username: cleanUsername,
            email: cleanEmail,
            first_name: first_name || username,
            last_name: last_name || 'User',
            password: password, // Inatumia ile ile aliyoweka mtumiaji
            language: 'en'
          });
          pteroData = pteroUser.data.attributes;
        } catch (pteroErr) {
          console.error('❌ Pterodactyl User Creation Failed:', pteroErr.response?.data || pteroErr.message);
          req.flash('error_msg', '❌ Pterodactyl imekataa kuunda user. Hakikisha password inakidhi vigezo vya panel.');
          return res.redirect('/login.html?tab=register');
        }
      }
    }

    const isAdminUser = ADMIN_EMAILS.includes(cleanEmail);

    // 3. Msajili huku kwenye Local Database ya Node (Awe ametoka Pterodactyl au amebuniwa upya)
    const newUser = new User({
      username: pteroData?.username || cleanUsername,
      email: pteroData?.email || cleanEmail,
      password: password, // Inahifadhi password ile ile ya Pterodactyl
      pteroId: pteroData?.id || 0,
      firstName: pteroData?.first_name || first_name || username,
      lastName: pteroData?.last_name || last_name || 'User',
      displayName: pteroData?.first_name || first_name || username,
      isEmailVerified: false,
      coins: 0,
      isAdmin: isAdminUser,
      role: isAdminUser ? 'admin' : 'user'
    });

    await newUser.save();
    const sent = await sendVerificationMessage(newUser);

    if (sent) {
      req.flash('success_msg', '✅ Akaunti imesawazishwa! Angalia email yako kwa msimbo wa uthibitisho.');
    } else {
      req.flash('error_msg', '⚠️ Akaunti imekamilika, lakini email ya uthibitisho haikutumwa.');
    }

    res.redirect('/login.html?tab=login');
  } catch (err) {
    console.error('❌ Registration error:', err.message);
    req.flash('error_msg', '❌ Imefeli kusajili akaunti.');
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
    req.flash('error_msg', '❌ Token au password si sahihi. lazima iwe na angalau herufi 4 na isiwe ya kawaida.');
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

router.get('/auth/password-requirements', (req, res) => {
  res.json({
    success: true,
    requirements: [
      { rule: 'At least 4 characters long', code: 'LENGTH' }
    ]
  });
});

module.exports = router;
