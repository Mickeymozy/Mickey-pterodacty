require('dotenv').config();

const express = require('express');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const axios = require('axios');
const path = require('path');
const bcrypt = require('bcryptjs');
const flash = require('connect-flash');
const MongoStore = require('connect-mongo');
const mongoose = require('mongoose');

// Import Models
const User = require('./models/User');
const Server = require('./models/Server');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== MONGODB CONNECTION ====================
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ MongoDB connected successfully'))
.catch(err => console.error('❌ MongoDB connection error:', err));

// ==================== MIDDLEWARE ====================
app.set('trust proxy', 1);
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session with MongoDB Store
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'default-secret-change-me',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGODB_URI,
      collectionName: 'sessions',
      ttl: 14 * 24 * 60 * 60 // 14 days
    }),
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 14 * 24 * 60 * 60 * 1000 // 14 days
    }
  })
);

app.use(flash());
app.use(passport.initialize());
app.use(passport.session());

// Flash messages middleware
app.use((req, res, next) => {
  res.locals.success_msg = req.flash('success_msg');
  res.locals.error_msg = req.flash('error_msg');
  res.locals.error = req.flash('error');
  res.locals.user = req.user || null;
  next();
});

// ==================== PASSPORT CONFIGURATION ====================
passport.serializeUser((user, done) => {
  done(null, user._id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

// ==================== PTERODACTYL API ====================
const PTERODACTYL_URL = process.env.PTERODACTYL_URL?.replace(/\/$/, '');
const PTERODACTYL_APP_API_KEY = process.env.PTERODACTYL_APP_API_KEY;
const PTERODACTYL_CLIENT_API_KEY = process.env.PTERODACTYL_CLIENT_API_KEY;

const hasPteroConfig = PTERODACTYL_URL && PTERODACTYL_APP_API_KEY;

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

const clientApi = hasPteroConfig && PTERODACTYL_CLIENT_API_KEY
  ? axios.create({
      baseURL: `${PTERODACTYL_URL}/api/client`,
      headers: {
        Authorization: `Bearer ${PTERODACTYL_CLIENT_API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      }
    })
  : null;

// ==================== HELPER FUNCTIONS ====================
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

async function getPteroServers(userId) {
  if (!clientApi) return [];
  try {
    const res = await clientApi.get(`/users/${userId}/servers`);
    return res.data.data || [];
  } catch (err) {
    console.error('Error fetching servers:', err.message);
    return [];
  }
}

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/login.html');
}

// ==================== PASSPORT STRATEGY ====================
passport.use(
  new LocalStrategy(
    { usernameField: 'username' },
    async (username, password, done) => {
      try {
        // Find user in MongoDB first
        let user = await User.findOne({ 
          $or: [{ username: username.toLowerCase() }, { email: username.toLowerCase() }] 
        });

        if (!user) {
          // Check if user exists in Pterodactyl
          const pteroUser = await getPteroUser(username);
          if (!pteroUser) {
            return done(null, false, { message: 'Invalid username or password.' });
          }

          // Create user in MongoDB
          user = new User({
            pteroId: pteroUser.id,
            username: pteroUser.username,
            email: pteroUser.email,
            displayName: pteroUser.first_name || pteroUser.username,
            password: password // Will be hashed by pre-save hook
          });
          await user.save();
        }

        // Verify password
        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) {
          return done(null, false, { message: 'Invalid username or password.' });
        }

        // Update last login
        user.lastLogin = new Date();
        await user.save();

        return done(null, user);
      } catch (err) {
        return done(err);
      }
    }
  )
);

// ==================== ROUTES ====================

// Static pages
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

// ==================== AUTH ROUTES ====================

// LOGIN
app.post('/auth/login', (req, res, next) => {
  passport.authenticate('local', {
    successRedirect: '/dashboard.html',
    failureRedirect: '/login.html?error=1',
    failureFlash: true
  })(req, res, next);
});

// REGISTER
app.post('/auth/register', async (req, res) => {
  const { username, email, password } = req.body;
  
  if (!hasPteroConfig) {
    req.flash('error_msg', 'Pterodactyl configuration is missing.');
    return res.redirect('/login.html?tab=register');
  }

  try {
    const cleanUsername = username.toLowerCase().replace(/[^a-z0-9]/g, '');

    // Check if user exists in MongoDB
    const existingUser = await User.findOne({ 
      $or: [{ username: cleanUsername }, { email: email.toLowerCase() }] 
    });
    if (existingUser) {
      req.flash('error_msg', 'Username or email already registered.');
      return res.redirect('/login.html?tab=register');
    }

    // Check if user exists in Pterodactyl
    const pteroCheck = await getPteroUser(cleanUsername);
    if (pteroCheck) {
      req.flash('error_msg', 'Username or email already exists in panel.');
      return res.redirect('/login.html?tab=register');
    }

    // Create user in Pterodactyl
    const createRes = await appApi.post('/users', {
      username: cleanUsername,
      email: email.toLowerCase(),
      first_name: username,
      last_name: 'User',
      password: password,
      language: 'en'
    });

    const pteroUser = createRes.data.attributes;

    // Create user in MongoDB
    const newUser = new User({
      pteroId: pteroUser.id,
      username: pteroUser.username,
      email: pteroUser.email,
      displayName: pteroUser.first_name || pteroUser.username,
      password: password
    });
    await newUser.save();

    req.flash('success_msg', 'Account created successfully! Please login.');
    res.redirect('/login.html?tab=login');

  } catch (err) {
    console.error('Registration error:', err.response?.data || err.message);
    req.flash('error_msg', 'Registration failed. Please try again.');
    res.redirect('/login.html?tab=register');
  }
});

// RESET PASSWORD
app.post('/auth/reset-password', async (req, res) => {
  const { email } = req.body;
  
  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      req.flash('error_msg', 'Email not found in our system.');
      return res.redirect('/login.html?tab=reset');
    }

    // Here you would send an email with reset link
    req.flash('success_msg', `Password reset link sent to ${email}`);
    res.redirect('/login.html?tab=reset');
  } catch (err) {
    req.flash('error_msg', 'Something went wrong. Please try again.');
    res.redirect('/login.html?tab=reset');
  }
});

// LOGOUT
app.get('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.flash('success_msg', 'You have been logged out successfully.');
    res.redirect('/login.html');
  });
});

// ==================== API ROUTES ====================

// Get current user
app.get('/api/me', requireAuth, (req, res) => {
  res.json({ 
    user: {
      id: req.user._id,
      username: req.user.username,
      email: req.user.email,
      displayName: req.user.displayName
    }
  });
});

// Get user's servers from Pterodactyl
app.get('/api/servers', requireAuth, async (req, res) => {
  try {
    const pteroServers = await getPteroServers(req.user.pteroId);
    res.json({ servers: pteroServers });
  } catch (err) {
    console.error('Error fetching servers:', err);
    res.status(500).json({ error: 'Failed to fetch servers' });
  }
});

// Create server
app.post('/api/servers/create', requireAuth, async (req, res) => {
  const { name, egg, cpu, memory, disk, startupCommand } = req.body;

  if (!hasPteroConfig) {
    return res.status(400).json({ error: 'Pterodactyl not configured' });
  }

  try {
    // Get user's Pterodactyl ID
    const pteroUser = await getPteroUser(req.user.username);
    if (!pteroUser) {
      return res.status(404).json({ error: 'Pterodactyl user not found' });
    }

    // Create server in Pterodactyl
    const createRes = await appApi.post('/servers', {
      name: name || `${req.user.username}-server`,
      user: pteroUser.id,
      egg: egg || 16,
      docker_image: 'ghcr.io/pterodactyl/yolks:nodejs_18',
      startup: startupCommand || 'npm start',
      environment: {
        INSTALL: 'npm install',
        USER: 'container'
      },
      limits: {
        memory: memory || 1024,
        swap: 0,
        disk: disk || 2048,
        io: 500,
        cpu: cpu || 100
      },
      feature_limits: {
        databases: 1,
        allocations: 1,
        backups: 2
      },
      allocation: {
        default: 1
      }
    });

    // Save server to MongoDB
    const serverData = createRes.data.attributes;
    const newServer = new Server({
      pteroId: serverData.id,
      userId: req.user._id,
      name: serverData.name,
      identifier: serverData.identifier,
      nodeId: serverData.node,
      eggId: egg,
      status: 'installing',
      limits: {
        cpu: cpu || 100,
        memory: memory || 1024,
        disk: disk || 2048
      }
    });
    await newServer.save();

    res.json({ 
      success: true, 
      server: serverData,
      message: 'Server created successfully!'
    });

  } catch (err) {
    console.error('Create server error:', err.response?.data || err.message);
    res.status(500).json({ 
      error: err.response?.data?.errors?.[0]?.detail || 'Failed to create server' 
    });
  }
});

// Power actions (start/stop/restart)
app.post('/api/servers/:id/power/:action', requireAuth, async (req, res) => {
  const { id, action } = req.params;
  
  if (!['start', 'stop', 'restart', 'kill'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action' });
  }

  if (!clientApi) {
    return res.status(400).json({ error: 'Client API not configured' });
  }

  try {
    // Get server from MongoDB to verify ownership
    const server = await Server.findOne({ identifier: id, userId: req.user._id });
    if (!server) {
      return res.status(404).json({ error: 'Server not found or not owned by you' });
    }

    await clientApi.post(`/servers/${id}/power`, { signal: action });
    res.json({ success: true, message: `Server ${action} command sent` });
  } catch (err) {
    console.error('Power action error:', err.message);
    res.status(500).json({ error: 'Failed to execute power action' });
  }
});

// Delete server
app.delete('/api/servers/:id', requireAuth, async (req, res) => {
  const { id } = req.params;

  if (!hasPteroConfig) {
    return res.status(400).json({ error: 'Pterodactyl not configured' });
  }

  try {
    // Verify ownership
    const server = await Server.findOne({ identifier: id, userId: req.user._id });
    if (!server) {
      return res.status(404).json({ error: 'Server not found or not owned by you' });
    }

    // Delete from Pterodactyl
    await appApi.delete(`/servers/${server.pteroId}`);

    // Delete from MongoDB
    await Server.deleteOne({ _id: server._id });

    res.json({ success: true, message: 'Server deleted successfully' });
  } catch (err) {
    console.error('Delete server error:', err.message);
    res.status(500).json({ error: 'Failed to delete server' });
  }
});

// ==================== START SERVER ====================
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}`);
    console.log(`🔐 Login: http://localhost:${PORT}/login.html`);
  });
}

module.exports = app;