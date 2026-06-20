require('dotenv').config();

const express = require('express');
const session = require('express-session');
const passport = require('passport');
const flash = require('connect-flash');
const MongoStore = require('connect-mongo');
const path = require('path');

// Import modules
const connectDB = require('./config/database');
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const { requireAuth, getUserFromSession } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// 1. CONNECT TO DATABASE
// ============================================
connectDB();

// ============================================
// 2. MIDDLEWARE
// ============================================
app.set('trust proxy', 1);
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session with MongoDB store
app.use(session({
  secret: process.env.SESSION_SECRET || 'default-secret-change-this',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    collectionName: 'sessions',
    ttl: 24 * 60 * 60,
    autoRemove: 'native'
  }),
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

app.use(flash());
app.use(passport.initialize());
app.use(passport.session());
app.use(getUserFromSession);

// Flash messages middleware
app.use((req, res, next) => {
  res.locals.success_msg = req.flash('success_msg');
  res.locals.error_msg = req.flash('error_msg');
  res.locals.error = req.flash('error');
  res.locals.user = req.user || null;
  next();
});

// ============================================
// 3. PASSPORT CONFIG
// ============================================
require('./config/passport')(passport);

// ============================================
// 4. ROUTES
// ============================================
app.use('/', authRoutes);
app.use('/', apiRoutes);

// Dashboard (protected)
app.get('/dashboard.html', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/', requireAuth, (req, res) => {
  res.redirect('/dashboard.html');
});

// ============================================
// 5. ERROR HANDLER
// ============================================
app.use((err, req, res, next) => {
  console.error('❌ Server Error:', err.stack);
  res.status(500).send('Something broke!');
});

// ============================================
// 6. START SERVER
// ============================================
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`🔗 Login: http://localhost:${PORT}/login.html`);
    console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard.html`);
  });
}

module.exports = app;