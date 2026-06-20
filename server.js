require('dotenv').config();

const express = require('express');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const axios = require('axios');
const path = require('path');
const bcrypt = require('bcryptjs');
const flash = require('connect-flash');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

// Kuzuia crash kwenye Serverless: Array hii itatumika kwa session ya muda mfupi tu
const tempUsersDB = [];

const PTERODACTYL_URL = process.env.PTERODACTYL_URL?.replace(/\/$/, '');
const PTERODACTYL_APP_API_KEY = process.env.PTERODACTYL_APP_API_KEY;

const hasPteroConfig = PTERODACTYL_URL && PTERODACTYL_APP_API_KEY;

// MUHIMU KWA VERCEL: Kuwa na uhakika folder la public linasomeka
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'ptero-secret-key-123',
    resave: true, // Imebadilishwa kuwa true kwa serverless uthabiti
    saveUninitialized: true,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax'
    }
  })
);

app.use(flash());
app.use(passport.initialize());
app.use(passport.session());

app.use((req, res, next) => {
  res.locals.success_msg = req.flash('success_msg');
  res.locals.error_msg = req.flash('error_msg');
  res.locals.error = req.flash('error');
  next();
});

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => {
  const user = tempUsersDB.find(u => u.id === id);
  if (user) return done(null, user);
  // Kama function imerestart na kumfuta kwenye RAM, mtengeneze memba wa muda ili isicrash
  done(null, { id, username: 'user_' + id });
});

const appApi = hasPteroConfig
  ? axios.create({
      baseURL: `${PTERODACTYL_URL}/api/application`,
      headers: {
        Authorization: `Bearer ${PTERODACTYL_APP_API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      }
    })
  : null;

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/login.html'); // Vercel inapenda direct static path
}

// Tafuta mtumiaji moja kwa moja kutoka kwenye Pterodactyl Panel (Njia salama kwa Vercel)
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
    console.error('Ptero API Error:', err.message);
  }
  return null;
}

// --- PASSPORT STRATEGY ---
passport.use(
  new LocalStrategy({ usernameField: 'username' }, async (username, password, done) => {
    try {
      // 1. Kagua kama mtumiaji yupo Pterodactyl Panel
      const pteroUser = await getPteroUser(username);
      if (!pteroUser) {
        return done(null, false, { message: 'Akaunti haikupatikana kwenye Pterodactyl.' });
      }

      // 2. Tengeneza session object ya huyu mtumiaji
      const sessionUser = {
        id: String(pteroUser.id),
        username: pteroUser.username,
        email: pteroUser.email,
        displayName: pteroUser.first_name
      };

      // Hifadhi kwenye temp RAM kwa ajili ya session ya sasa hivi
      if (!tempUsersDB.some(u => u.id === sessionUser.id)) {
        tempUsersDB.push(sessionUser);
      }

      return done(null, sessionUser);
    } catch (err) {
      return done(err);
    }
  })
);

// --- ROUTES ---

// Badala ya "/" direct, itafungua dashboard.html kutoka public folder automatic
app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/login', (req, res) => {
  res.redirect('/login.html');
});

app.get('/api/auth/flash', (req, res) => {
  res.json({
    success: req.flash('success_msg'),
    error: req.flash('error_msg') || req.flash('error')
  });
});

// 1. LOGIN HANDLER
app.post('/auth/login', (req, res, next) => {
  passport.authenticate('local', {
    successRedirect: '/dashboard.html',
    failureRedirect: '/login.html?error=1',
    failureFlash: true
  })(req, res, next);
});

// 2. REGISTER HANDLER
app.post('/auth/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!hasPteroConfig) {
    req.flash('error_msg', 'Mfumo wa Pterodactyl haujafanyiwa config kwenye server.');
    return res.redirect('/login.html?tab=register');
  }

  try {
    const cleanUsername = username.toLowerCase().replace(/[^a-z0-9]/g, '');
    
    // Angalia kama tayari yupo panel kuzuia duplicate
    const checkUser = await getPteroUser(cleanUsername);
    if (checkUser) {
      req.flash('error_msg', 'Username au Email tayari ipo kwenye mfumo wetu.');
      return res.redirect('/login.html?tab=register');
    }

    // Tuma ombi la kutengeneza akaunti moja kwa moja Pterodactyl Panel
    await appApi.post('/users', {
      username: cleanUsername,
      email: email,
      first_name: username,
      last_name: 'DashboardUser',
      password: password,
      language: 'en'
    });

    req.flash('success_msg', 'Akaunti imefunguliwa kwenye Panel! Sasa unaweza kuingia hapa.');
    res.redirect('/login.html?tab=login');

  } catch (err) {
    console.error(err.response?.data || err.message);
    req.flash('error_msg', 'Imefeli kutengeneza akaunti. Hakikisha password ina herufi kubwa, ndogo na namba.');
    res.redirect('/login.html?tab=register');
  }
});

// 3. RESET PASSWORD HANDLER
app.post('/auth/reset-password', async (req, res) => {
  const { email } = req.body;
  const checkUser = await getPteroUser(email);

  if (!checkUser) {
    req.flash('error_msg', 'Barua pepe hiyo haijasajiliwa kwenye mfumo yetu.');
    return res.redirect('/login.html?tab=reset');
  }

  req.flash('success_msg', `Maelezo ya nenosiri jipya yametumwa kwenda ${email} (Simulation tu).`);
  res.redirect('/login.html?tab=reset');
});

app.get('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.flash('success_msg', 'Umetoka kwenye akaunti yako kikamilifu.');
    res.redirect('/login.html');
  });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;
