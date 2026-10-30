const express = require('express');
const passport = require('passport');
const crypto = require('crypto');
const router = express.Router();
const User = require('../models/User');
const { validatePasswordComplexity } = require('../utils/passwordValidator');
const { requireGuest, ADMIN_EMAILS } = require('../middleware/auth');
const sendEmail = require('../utils/email');
const axios = require('axios');
const LoginActivity = require('../models/LoginActivity');
const { isIP } = require('net');
const { normalizePhone, sendTextMessage } = require('../services/smsService');

function isAcceptablePassword(password) {
  return validatePasswordComplexity(String(password || '')).isValid;
}

function generateRandomPassword(length = 24) {
  return crypto.randomBytes(length).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, length);
}

async function inspectLoginIp(ip) {
  const token = process.env.IPINFO_TOKEN;
  const address = String(ip || '').replace(/^::ffff:/, '');
  if (!token || !address || isIP(address) === 0 || address === '::1' || address === '127.0.0.1') return null;
  if (/^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(address)) return null;
  if (/^(fc|fd|fe80:)/i.test(address)) return null;

  try {
    const response = await axios.get(`https://ipinfo.io/${encodeURIComponent(address)}/json`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 2500
    });
    const details = response.data || {};
    const privacy = details.privacy || {};
    const homeCountry = String(process.env.LOGIN_HOME_COUNTRY || 'TZ').toUpperCase();
    const country = String(details.country || '').toUpperCase();
    const vpnOrProxy = Boolean(privacy.vpn || privacy.proxy || privacy.tor || privacy.relay || privacy.hosting);
    return {
      country: country || null,
      foreign: Boolean(country && country !== homeCountry),
      vpnOrProxy
    };
  } catch (error) {
    console.warn('Login IP intelligence lookup failed:', error.message);
    return null;
  }
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
const { normalizePanelBaseUrl } = require('../utils/panelUrl');
const PTERODACTYL_URL = normalizePanelBaseUrl(process.env.PANEL_URL || process.env.PTERODACTYL_URL);
const PTERODACTYL_APP_API_KEY = process.env.PANEL_API_KEY || process.env.PTERODACTYL_APP_API_KEY;
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
    subject: 'Thibitisha akaunti yako',
    text: `Msimbo wako wa kuthibitisha akaunti ni ${code}. Msimbo huu utaisha baada ya dakika 5.`,
    html: `
      <p style="margin:0 0 8px; color:#506466;">Karibu kwenye akaunti yako.</p>
      <h1 style="margin:0 0 18px; color:#173638; font-size:26px; line-height:1.2;">Thibitisha email yako</h1>
      <p style="margin:0 0 18px;">Tumia msimbo huu kukamilisha usajili wako:</p>
      <div style="margin:0 0 20px; padding:18px; border:1px solid #b9ded8; border-radius:12px; background:#effaf8; color:#0f766e; font-size:32px; font-weight:700; letter-spacing:8px; text-align:center;">${code}</div>
      <p style="margin:0; color:#506466;">Msimbo huu utaisha baada ya <strong>dakika 5</strong>. Kama hukuomba akaunti hii, unaweza kupuuza ujumbe huu.</p>
    `
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
      const attemptedLogin = String(req.body.username || '').trim().toLowerCase();
      if (attemptedLogin) {
        const knownUser = await User.findOne({
          $or: [{ username: attemptedLogin }, { email: attemptedLogin }]
        }).select('_id').lean().catch(() => null);
        if (knownUser) {
          await LoginActivity.create({
            userId: knownUser._id,
            success: false,
            ip: req.ip || '',
            userAgent: req.get('user-agent') || ''
          }).catch(() => {});
        }
      }
      const requestedReturnTo = String(req.body.returnTo || '');
      const returnToMatch = requestedReturnTo.match(/^\/api\/bot-scripts\/[a-f\d]{24}\/download$/i);
      const returnToQuery = returnToMatch ? `&returnTo=${encodeURIComponent(returnToMatch[0])}` : '';
      req.flash('error_msg', info?.message || '❌ Login failed.');
      return res.redirect(`/login.html?error=1${returnToQuery}`);
    }

    req.logIn(user, async (loginErr) => {
      if (loginErr) {
        console.error('❌ Session error:', loginErr);
        return next(loginErr);
      }

      user.lastLogin = new Date();
      await user.save().catch(() => {});
      const loginIp = req.ip || '';
      const loginUserAgent = req.get('user-agent') || '';
      const failedLoginFilter = {
        userId: user._id,
        success: false,
        alerted: { $ne: true },
        createdAt: { $gte: new Date(Date.now() - 15 * 60 * 1000) }
      };
      const recentFailedLogins = await LoginActivity.find(failedLoginFilter).select('_id').lean().catch(() => []);
      const ipRisk = await inspectLoginIp(loginIp);
      await LoginActivity.create({ userId: user._id, success: true, ip: loginIp, userAgent: loginUserAgent }).catch(() => {});

      const repeatedFailures = recentFailedLogins.length >= 3;
      const suspiciousIp = Boolean(ipRisk?.foreign || ipRisk?.vpnOrProxy);
      const suspiciousLogin = repeatedFailures || suspiciousIp;

      if (suspiciousLogin) {
        const loginTime = new Date().toLocaleString();
        const reasons = [];
        if (repeatedFailures) reasons.push(`${recentFailedLogins.length} failed login attempts in the last 15 minutes`);
        if (ipRisk?.foreign) reasons.push(`login from country ${ipRisk.country}`);
        if (ipRisk?.vpnOrProxy) reasons.push('VPN, proxy, Tor, or hosting IP detected');
        const loginEmailSent = await sendEmail({
          to: user.email,
          subject: 'Tahadhari: kuingia kusiko kwa kawaida kwenye akaunti yako',
          text: `Tumegundua login inayotia shaka saa ${loginTime}. Sababu: ${reasons.join('; ')}. IP: ${loginIp}. Kama hukuwa wewe, badilisha password na wasiliana na support.`,
          html: `<p style="margin:0 0 8px; color:#506466;">Usalama wa akaunti</p><h1 style="margin:0 0 18px; color:#173638; font-size:26px;">Login inayotia shaka imegunduliwa</h1><p style="margin:0 0 12px;">Tumegundua shughuli isiyo ya kawaida kwenye akaunti yako.</p><div style="padding:14px 16px; border-left:4px solid #0f766e; background:#f2f8f7; color:#506466;"><strong>Muda:</strong> ${loginTime}<br><strong>Sababu:</strong> ${reasons.join('; ')}<br><strong>IP:</strong> ${loginIp || 'Haijulikani'}${ipRisk?.country ? `<br><strong>Nchi:</strong> ${ipRisk.country}` : ''}</div><p style="margin:18px 0 0; color:#506466;">Kama si wewe, badilisha password mara moja na wasiliana na support.</p>`
        }).catch((error) => {
          console.error('Suspicious login email failed:', error.message);
          return false;
        });

        if (loginEmailSent && recentFailedLogins.length) {
          await LoginActivity.updateMany(
            { _id: { $in: recentFailedLogins.map((activity) => activity._id) } },
            { $set: { alerted: true } }
          ).catch(() => {});
        }
        if (!loginEmailSent) {
          console.warn(`⚠️ Suspicious login email could not be sent to ${user.email}`);
        }
      }

      if (!user.isEmailVerified) {
        req.flash('success_msg', '✅ Ingia; unaweza kuendelea kutumia akaunti yako.');
      }

      const returnTo = String(req.body.returnTo || '');
      const scriptDownloadMatch = returnTo.match(/^\/api\/bot-scripts\/([a-f\d]{24})\/download$/i);
      if (scriptDownloadMatch) {
        return res.redirect(`/api/bot-scripts/${scriptDownloadMatch[1]}/download`);
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
  const cleanPhone = normalizePhone(req.body.phone);

  if (!cleanUsername || !cleanEmail || !password || !cleanPhone) {
    req.flash('error_msg', '❌ Taarifa zote zinahitajika.');
    return res.redirect('/login.html?tab=register');
  }

  if (!/^255[67]\d{8}$/.test(cleanPhone)) {
    req.flash('error_msg', '❌ Weka namba sahihi ya Tanzania, mfano 07XXXXXXXX au 2557XXXXXXXX.');
    return res.redirect('/login.html?tab=register');
  }

  if (!isAcceptablePassword(password)) {
    req.flash('error_msg', '❌ Password lazima iwe na angalau herufi 8.');
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
      phone: cleanPhone,
      password: password, // Inahifadhi password ile ile ya Pterodactyl
      pteroId: pteroData?.id || undefined,
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
  const channel = String(req.body.channel || 'email').toLowerCase();
  const email = String(req.body.email || '').trim().toLowerCase();
  const phone = normalizePhone(req.body.phone);

  if (!['email', 'sms'].includes(channel)) {
    req.flash('error_msg', '❌ Chagua email au SMS.');
    return res.redirect('/login.html?tab=reset');
  }
  if (channel === 'email' && !email) {
    req.flash('error_msg', '❌ Taarifa ya email inahitajika.');
    return res.redirect('/login.html?tab=reset');
  }
  if (channel === 'sms' && !/^255[67]\d{8}$/.test(phone)) {
    req.flash('error_msg', '❌ Weka namba sahihi ya Tanzania kwa ajili ya SMS.');
    return res.redirect('/login.html?tab=reset');
  }

  const user = channel === 'email'
    ? await User.findOne({ email })
    : await User.findOne({ phone });
  if (!user) {
    req.flash('success_msg', `Kama akaunti yenye taarifa hizo ipo, token ya reset itatumwa kwa ${channel === 'email' ? 'email' : 'SMS'}.`);
    return res.redirect('/login.html?tab=reset');
  }

  const token = generateToken();
  user.resetToken = token;
  user.resetTokenExpires = Date.now() + 30 * 60 * 1000;
  await user.save();

  let sent = false;
  try {
    if (channel === 'sms') {
      const result = await sendTextMessage({
        phoneNumbers: [user.phone],
        message: `MickeyPanel: Token ya kubadili password ni ${token}. Itaisha baada ya dakika 30.`
      });
      sent = result.sent;
      if (!sent) console.warn('Password reset SMS was not sent:', result.reason || 'Unknown SMS error');
    } else {
      const resetLink = `${process.env.APP_URL || 'http://localhost:3000'}/login.html?tab=reset&token=${token}`;
      sent = await sendEmail({
        to: user.email,
        subject: 'Badilisha password ya akaunti yako',
        text: `Fungua link hii kubadilisha password yako: ${resetLink}. Link hii itaisha baada ya muda mfupi.`,
        html: `<p style="margin:0 0 8px; color:#506466;">Ombi la usalama wa akaunti</p><h1 style="margin:0 0 18px; color:#173638; font-size:26px;">Badilisha password yako</h1><p style="margin:0 0 22px;">Bonyeza kitufe hapa chini kuweka password mpya. Link hii ni ya matumizi ya mara moja.</p><p style="margin:0 0 22px;"><a href="${resetLink}" style="display:inline-block; padding:13px 20px; border-radius:9px; background:#0f766e; color:#ffffff; font-weight:700; text-decoration:none;">Badilisha password</a></p><p style="margin:0; color:#718083; font-size:13px;">Kama kitufe hakifanyi kazi, tumia link hii: <a href="${resetLink}" style="color:#0f766e; word-break:break-all;">${resetLink}</a></p>`
      });
    }
  } catch (error) {
    console.error(`Password reset ${channel} delivery failed:`, error.message);
  }

  if (sent) {
    req.flash('success_msg', `✅ Token ya kubadili password imetumwa kwa ${channel === 'email' ? 'email' : 'SMS'}. Itaisha baada ya dakika 30.`);
  } else {
    user.resetToken = null;
    user.resetTokenExpires = null;
    await user.save();
    req.flash('error_msg', channel === 'email'
      ? '❌ Haikuweza kutuma email ya reset. Angalia SMTP settings.'
      : '❌ Haikuweza kutuma SMS ya reset. Hakikisha SMSTAPSA imewekwa na salio linatosha.');
  }

  res.redirect('/login.html?tab=reset');
});

router.post('/auth/reset-password/confirm', async (req, res) => {
  const { token, password } = req.body;

  if (!token || !password || !isAcceptablePassword(password)) {
    req.flash('error_msg', '❌ Token au password si sahihi. Password lazima iwe na angalau herufi 8.');
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
