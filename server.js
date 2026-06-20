require('dotenv').config();

const express = require('express');
const session = require('express-session');
const passport = require('passport');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

function getBaseUrl() {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, '');
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://localhost:${PORT}`;
}

const PTERODACTYL_URL = process.env.PTERODACTYL_URL?.replace(/\/$/, '');
const PTERODACTYL_APP_API_KEY = process.env.PTERODACTYL_APP_API_KEY;
const PTERODACTYL_CLIENT_API_KEY = process.env.PTERODACTYL_CLIENT_API_KEY;

const requiredEnv = [
  'PTERODACTYL_URL',
  'PTERODACTYL_APP_API_KEY',
  'PTERODACTYL_CLIENT_API_KEY'
];

const missingEnv = requiredEnv.filter((name) => !process.env[name]);
if (missingEnv.length > 0) {
  console.warn(
    `Missing environment variables: ${missingEnv.join(', ')}. ` +
    'The app may not work until these are configured.'
  );
}

const hasPteroConfig = missingEnv.length === 0;

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
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

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

const clientApi = hasPteroConfig
  ? axios.create({
      baseURL: `${PTERODACTYL_URL}/api/client`,
      headers: {
        Authorization: `Bearer ${PTERODACTYL_CLIENT_API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      }
    })
  : null;

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/login');
}

function requirePteroConfig(req, res, next) {
  if (!hasPteroConfig || !appApi || !clientApi) {
    return res.status(503).json({
      error: 'Pterodactyl API configuration is missing. Please set the required environment variables.'
    });
  }
  next();
}

async function getUserByExternalIdentifier(identifier) {
  let page = 1;
  while (true) {
    const res = await appApi.get(`/users?page=${page}&per_page=100`);
    const users = res.data.data || [];
    if (!users.length) break;

    const found = users.find((u) =>
      u.attributes.username === String(identifier) ||
      u.attributes.email === String(identifier)
    );

    if (found) return found;
    page += 1;
  }

  return null;
}

async function ensurePteroAccount(user) {
  const identifier = user.providerId || user.id;
  const existing = await getUserByExternalIdentifier(identifier);

  if (existing) return existing;

  const username = `${user.provider}-${user.id}`;
  const email = user.email || `${username}@local.invalid`;
  const password = Math.random().toString(36).slice(-12) + 'A1!';

  const res = await appApi.post('/users', {
    username,
    email,
    first_name: user.displayName || 'User',
    last_name: 'Account',
    password,
    language: 'en'
  });

  return res.data;
}

async function getServersForUser(user) {
  const panelUser = await ensurePteroAccount(user);
  const panelUserId = panelUser?.attributes?.id || panelUser?.data?.attributes?.id;
  if (!panelUserId) {
    throw new Error('Unable to resolve Pterodactyl user ID');
  }

  const res = await appApi.get(`/users/${panelUserId}/servers`);
  return res.data.data || [];
}

async function mapServerToClientData(server) {
  const identifier = server.attributes.identifier;
  const res = await clientApi.get(`/servers/${identifier}/resources`);
  return {
    id: server.attributes.id,
    name: server.attributes.name,
    identifier,
    user: server.attributes.user,
    status: res.data.attributes?.current_state || 'unknown'
  };
}

const DiscordStrategy = require('passport-discord').Strategy;
const baseUrl = getBaseUrl();
passport.use(
  new DiscordStrategy(
    {
      clientID: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
      callbackURL: `${baseUrl}/auth/discord/callback`,
      scope: ['identify', 'email']
    },
    async (accessToken, refreshToken, profile, done) => {
      const user = {
        provider: 'discord',
        providerId: profile.id,
        id: profile.id,
        username: profile.username,
        email: profile.email || `${profile.id}@discord.local`,
        displayName: profile.global_name || profile.username,
        avatar: profile.avatar
      };
      done(null, user);
    }
  )
);

const GitHubStrategy = require('passport-github2').Strategy;
passport.use(
  new GitHubStrategy(
    {
      clientID: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      callbackURL: `${baseUrl}/auth/github/callback`,
      scope: ['user:email']
    },
    async (accessToken, refreshToken, profile, done) => {
      const email = profile.emails?.[0]?.value || `${profile.username}@github.local`;
      const user = {
        provider: 'github',
        providerId: profile.id,
        id: profile.id,
        username: profile.username,
        email,
        displayName: profile.displayName || profile.username,
        avatar: profile.photos?.[0]?.value
      };
      done(null, user);
    }
  )
);

app.get('/', requireAuth, requirePteroConfig, async (req, res) => {
  try {
    await getServersForUser(req.user);
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load dashboard data' });
  }
});

app.get('/health', (req, res) => {
  res.json({ ok: true, message: 'Server is healthy' });
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    res.redirect('/login');
  });
});

app.get('/auth/discord', passport.authenticate('discord'));
app.get(
  '/auth/discord/callback',
  passport.authenticate('discord', { failureRedirect: '/login' }),
  (req, res) => res.redirect('/')
);

app.get('/auth/github', passport.authenticate('github'));
app.get(
  '/auth/github/callback',
  passport.authenticate('github', { failureRedirect: '/login' }),
  (req, res) => res.redirect('/')
);

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

app.get('/api/servers', requireAuth, requirePteroConfig, async (req, res) => {
  try {
    const serverList = await getServersForUser(req.user);
    const servers = await Promise.all(serverList.map(mapServerToClientData));
    res.json({ servers });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Unable to fetch servers' });
  }
});

app.post('/api/servers/create', requireAuth, requirePteroConfig, async (req, res) => {
  try {
    const { name, egg, cpu, memory, disk, startupCommand } = req.body;
    const panelUser = await ensurePteroAccount(req.user);
    const panelUserId = panelUser?.attributes?.id || panelUser?.data?.attributes?.id;

    if (!panelUserId) {
      return res.status(400).json({ error: 'Unable to locate Pterodactyl user' });
    }

    const response = await appApi.post('/servers', {
      name,
      user: panelUserId,
      egg,
      startup: startupCommand || 'npm start',
      environment: {
        USER_UPLOAD: '0',
        AUTO_UPDATE: '1'
      },
      limits: {
        memory,
        swap: 0,
        disk,
        io: 500,
        cpu
      },
      feature_limits: {
        databases: 0,
        backups: 1,
        allocations: 1
      },
      deploy: {
        locations: [1],
        dedicated_ip: false,
        port_range: []
      },
      start_on_completion: true
    });

    res.json({ success: true, server: response.data });
  } catch (err) {
    console.error(err.response?.data || err.message || err);
    res.status(500).json({ error: 'Failed to create server' });
  }
});

app.post('/api/servers/:identifier/power/:signal', requireAuth, requirePteroConfig, async (req, res) => {
  try {
    const { identifier, signal } = req.params;
    if (!['start', 'stop', 'restart'].includes(signal)) {
      return res.status(400).json({ error: 'Invalid power action' });
    }

    await clientApi.post(`/servers/${identifier}/power`, { signal });
    res.json({ success: true, signal });
  } catch (err) {
    console.error(err.response?.data || err.message || err);
    res.status(500).json({ error: 'Failed to execute power action' });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Dashboard running at http://localhost:${PORT}`);
  });
}

module.exports = app;
