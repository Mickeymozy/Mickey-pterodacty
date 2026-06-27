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
const packagesRouter = require('./routes/packages');
const paymentRouter = require('./routes/payment');
const userRouter = require('./routes/user');
const { requireAuth, requireAdmin, getUserFromSession } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// 1. CONNECT TO DATABASE (non-fatal for serverless)
// ============================================
connectDB().catch((err) => {
  console.error('❌ DB startup failed:', err);
});

// ============================================
// 2. PASSPORT CONFIG
// ============================================
require('./config/passport')(passport);

// ============================================
// 3. MIDDLEWARE
// ============================================
// IMEREKEBISHWA: 'trust proxy' imewekwa kuwa true ili kuruhusu Cloudflare/Nginx kupitisha secure cookies vizuri
app.set('trust proxy', true);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionStore = process.env.MONGODB_URI
  ? MongoStore.create({
      mongoUrl: process.env.MONGODB_URI,
      collectionName: 'sessions',
      ttl: 24 * 60 * 60,
      autoRemove: 'native'
    })
  : null;

// IMEREKEBISHWA: Mipangilio thabiti ya session kwa ajili ya Live Domain (HTTPS)
const isProduction = process.env.NODE_ENV === 'production';

app.use(session({
  secret: process.env.SESSION_SECRET || 'default-secret-change-this',
  resave: true, // Imewekwa true ili kuzuia session kufutika mapema kwenye baadhi ya hosting
  saveUninitialized: false,
  store: sessionStore || undefined,
  cookie: {
    secure: isProduction, // Itakuwa true kama ipo production na inatumia HTTPS
    httpOnly: true,
    sameSite: isProduction ? 'none' : 'lax', // 'none' inasaidia kama unavuka subdomains
    maxAge: 24 * 60 * 60 * 1000 // Saa 24
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
// 4. ROUTES
// ============================================
app.use('/', authRoutes);
app.use('/', apiRoutes);
app.use('/api', packagesRouter);
app.use('/api/payment', paymentRouter);
app.use('/api/user', userRouter);

// Dashboard (protected)
app.get('/dashboard.html', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/dashboard/packages', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard-packages.html'));
});

app.get('/admin/packages', requireAuth, requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-packages.html'));
});

app.get('/admin.html', requireAuth, requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-control.html'));
});

app.get('/admin', requireAuth, requireAdmin, (req, res) => {
  res.redirect('/admin.html');
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
