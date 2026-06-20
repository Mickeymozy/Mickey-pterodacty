require('dotenv').config();

const express = require('express');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const axios = require('axios');
const path = require('path');
const bcrypt = require('bcryptjs'); // Kwa ajili ya usalama wa password
const flash = require('connect-flash'); // Onyesha error/success alerts

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

// Database ya muda ya majaribio (In-memory array)
// Kwenye production unaweza kuunganisha na MySQL/MongoDB
const localUsersDB = [];

const PTERODACTYL_URL = process.env.PTERODACTYL_URL?.replace(/\/$/, '');
const PTERODACTYL_APP_API_KEY = process.env.PTERODACTYL_APP_API_KEY;
const PTERODACTYL_CLIENT_API_KEY = process.env.PTERODACTYL_CLIENT_API_KEY;

const hasPteroConfig = PTERODACTYL_URL && PTERODACTYL_APP_API_KEY && PTERODACTYL_CLIENT_API_KEY;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'change-this-secret',
    resave: false,
    saveUninitialized: false,
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

// Pasi data za Alerts kwenda kwenye HTML views kirahisi
app.use((req, res, next) => {
  res.locals.success_msg = req.flash('success_msg');
  res.locals.error_msg = req.flash('error_msg');
  res.locals.error = req.flash('error'); // Kutoka kwa passport yenyewe
  next();
});

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => {
  const user = localUsersDB.find(u => u.id === id);
  done(null, user);
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
  res.redirect('/login');
}

// --- PASSPORT LOCAL CONFIG (LOGIN LOGIC) ---
passport.use(
  new LocalStrategy({ usernameField: 'username' }, async (username, password, done) => {
    // Tafuta kama mtumiaji yupo kwa username au email
    const user = localUsersDB.find(u => u.username === username || u.email === username);
    if (!user) {
      return done(null, false, { message: 'Mtumiaji hapatikani au hajasajiliwa.' });
    }

    // Linganisha password iliyowekwa na ya kwenye database
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return done(null, false, { message: 'Password uliyoweka sio sahihi.' });
    }

    return done(null, user);
  })
);

// --- ROUTES ---

app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// API ya kurudisha ujumbe wa makosa kwenda kwenye login.html (kwa AJAX/Fetch)
app.get('/api/auth/flash', (req, res) => {
  res.json({
    success: req.flash('success_msg'),
    error: req.flash('error_msg') || req.flash('error')
  });
});

// 1. ROUTE YA LOGIN
app.post('/auth/login', (req, res, next) => {
  passport.authenticate('local', {
    successRedirect: '/',
    failureRedirect: '/login',
    failureFlash: true
  })(req, res, next);
});

// 2. ROUTE YA REGISTER (CREATE ACCOUNT & PTERO ACC)
app.post('/auth/register', async (req, res) => {
  const { username, email, password } = req.body;
  
  try {
    // Angalia kama mtumiaji tayari yupo
    const userExists = localUsersDB.some(u => u.username === username || u.email === email);
    if (userExists) {
      req.flash('error_msg', 'Username au Email tayari inatumiwa na mtu mwingine.');
      return res.redirect('/login?tab=register');
    }

    // Hash password kwa ajili ya usalama
    const hashedPassword = await bcrypt.hash(password, 10);
    const cleanUsername = username.toLowerCase().replace(/[^a-z0-9]/g, '');

    // Tengeneza akaunti kule Pterodactyl Panel kwanza
    let pteroId = null;
    if (hasPteroConfig) {
      const pteroRes = await appApi.post('/users', {
        username: cleanUsername,
        email: email,
        first_name: username,
        last_name: 'LocalUser',
        password: password, // Inashauriwa pia panel iwe na pass yake
        language: 'en'
      });
      pteroId = pteroRes.data.attributes.id;
    }

    // Hifadhi kwenye database ya ndani
    const newUser = {
      id: Date.now().toString(),
      username: cleanUsername,
      email: email,
      password: hashedPassword,
      pteroUserId: pteroId
    };
    localUsersDB.push(newUser);

    req.flash('success_msg', 'Akaunti imefunguliwa kikamilifu! Sasa unaweza kuingia.');
    res.redirect('/login?tab=login');

  } catch (err) {
    console.error(err.response?.data || err.message);
    req.flash('error_msg', 'Imefeli kutengeneza akaunti kwenye Pterodactyl Panel.');
    res.redirect('/login?tab=register');
  }
});

// 3. ROUTE YA RESET PASSWORD
app.post('/auth/reset-password', async (req, res) => {
  const { email } = req.body;
  const user = localUsersDB.find(u => u.email === email);

  if (!user) {
    req.flash('error_msg', 'Barua pepe hiyo haijasajiliwa kwenye mfumo wetu.');
    return res.redirect('/login?tab=reset');
  }

  // Hapa unaweza kuweka code ya kutuma email halisi. Kwa sasa tunaiga (mock simulation)
  req.flash('success_msg', `Link ya ku-reset imetumwa kwenda ${email} (Huu ni mfano tu).`);
  res.redirect('/login?tab=reset');
});

app.get('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.flash('success_msg', 'Umetoka kwenye akaunti yako.');
    res.redirect('/login');
  });
});

app.listen(PORT, () => console.log(`Server inapiga kazi kwenye http://localhost:${PORT}`));
