const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const axios = require('axios');

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

// Get current user info
router.get('/api/me', requireAuth, (req, res) => {
  res.json({
    user: {
      id: req.user._id,
      username: req.user.username,
      email: req.user.email,
      displayName: req.user.firstName || req.user.username,
      pterodactylId: req.user.pterodactylId
    }
  });
});

// Get user servers
router.get('/api/servers', requireAuth, async (req, res) => {
  try {
    // Placeholder - inaweza kubadilishwa baadaye
    res.json({ success: true, servers: [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create server
router.post('/api/servers/create', requireAuth, async (req, res) => {
  res.json({ success: false, error: '🚧 Feature in development' });
});

// Power action
router.post('/api/servers/:id/power/:action', requireAuth, async (req, res) => {
  res.json({ success: false, error: '🚧 Feature in development' });
});

module.exports = router;