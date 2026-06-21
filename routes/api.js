const express = require('express');
const router = express.Router();
const axios = require('axios');
const { requireAuth } = require('../middleware/auth');

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

const eggConfigs = {
  16: {
    name: 'Node.js',
    docker_image: 'ghcr.io/parkervcp/yolks:nodejs_21',
    startup: `if [[ -d .git ]] && [[ "$AUTO_UPDATE" == "1" ]]; then git pull; fi; if [[ ! -z "$NODE_PACKAGES" ]]; then /usr/local/bin/npm install $NODE_PACKAGES; fi; if [[ ! -z "$UNNODE_PACKAGES" ]]; then /usr/local/bin/npm uninstall $UNNODE_PACKAGES; fi; if [ -f /home/container/package.json ]; then /usr/local/bin/npm install; fi; if [[ "$MAIN_FILE" == "*.js" ]]; then /usr/local/bin/node "/home/container/$MAIN_FILE" $NODE_ARGS; else /usr/local/bin/ts-node --esm "/home/container/$MAIN_FILE" $NODE_ARGS; fi`,
    environment: {
      USER_UPLOAD: '0',
      MAIN_FILE: 'index.js',
      AUTO_UPDATE: '1',
      STARTUP_CMD: 'npm start'
    }
  },
  27: {
    name: 'Python',
    docker_image: 'ghcr.io/parkervcp/yolks:python_3.10',
    startup: `if [[ -d .git ]] && [[ "$AUTO_UPDATE" == "1" ]]; then git pull; fi; if [[ ! -z "$PY_PACKAGES" ]]; then pip install -U --prefix .local $PY_PACKAGES; fi; if [[ -f /home/container/$REQUIREMENTS_FILE ]]; then pip install -U --prefix .local -r $REQUIREMENTS_FILE; fi; /usr/local/bin/python /home/container/$PY_FILE`,
    environment: {
      USER_UPLOAD: '0',
      PY_FILE: 'main.py',
      REQUIREMENTS_FILE: 'requirements.txt',
      AUTO_UPDATE: '1',
      STARTUP_CMD: 'python3 main.py'
    }
  },
  28: {
    name: 'Java',
    docker_image: 'ghcr.io/parkervcp/yolks:java_17',
    startup: 'java -Dterminal.jline=false -Dterminal.ansi=true -jar $JARFILE',
    environment: {
      USER_UPLOAD: '0',
      JARFILE: 'server.jar',
      AUTO_UPDATE: '1',
      STARTUP_CMD: 'java -jar server.jar'
    }
  }
};

const sanitizeServer = (server) => {
  const attrs = server?.attributes || {};
  return {
    id: attrs.id,
    uuid: attrs.uuid,
    identifier: attrs.identifier,
    name: attrs.name,
    status: attrs.status,
    user: attrs.user,
    limits: attrs.limits || {}
  };
};

// Get current user info
router.get('/api/me', requireAuth, (req, res) => {
  res.json({
    user: {
      id: req.user._id,
      username: req.user.username,
      email: req.user.email,
      displayName: req.user.displayName || req.user.firstName || req.user.username,
      pterodactylId: req.user.pteroId
    }
  });
});

// Get user servers
router.get('/api/servers', requireAuth, async (req, res) => {
  if (!appApi) {
    return res.status(503).json({ success: false, error: 'Pterodactyl API is not configured.' });
  }

  try {
    const response = await appApi.get('/servers?per_page=1000');
    const servers = (response.data?.data || [])
      .filter((server) => server?.attributes?.user === req.user.pteroId)
      .map(sanitizeServer);

    res.json({ success: true, servers });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || 'Failed to fetch servers.' });
  }
});

// Create server
router.post('/api/servers/create', requireAuth, async (req, res) => {
  if (!appApi) {
    return res.status(503).json({ success: false, error: 'Pterodactyl API is not configured.' });
  }

  try {
    const { name, egg, cpu, memory, disk } = req.body;
    const eggConfig = eggConfigs[Number(egg)];

    if (!name || !eggConfig) {
      return res.status(400).json({ success: false, error: 'Invalid server details.' });
    }

    const payload = {
      name,
      user: req.user.pteroId,
      egg: Number(egg),
      docker_image: eggConfig.docker_image,
      startup: eggConfig.startup,
      environment: eggConfig.environment,
      limits: {
        memory: Number(memory) || 1024,
        swap: 0,
        disk: Number(disk) || 2048,
        io: 500,
        cpu: Number(cpu) || 100,
        oom_disabled: false
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
    };

    const response = await appApi.post('/servers', payload);

    res.json({
      success: true,
      message: 'Server created successfully.',
      server: sanitizeServer(response.data)
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.response?.data?.errors?.[0]?.detail || err.message || 'Failed to create server.'
    });
  }
});

// Power action
router.post('/api/servers/:id/power/:action', requireAuth, async (req, res) => {
  if (!appApi) {
    return res.status(503).json({ success: false, error: 'Pterodactyl API is not configured.' });
  }

  const validActions = ['start', 'stop', 'restart'];
  const { action } = req.params;

  if (!validActions.includes(action)) {
    return res.status(400).json({ success: false, error: 'Invalid power action.' });
  }

  try {
    const response = await appApi.post(`/servers/${req.params.id}/power`, { signal: action });
    res.json({ success: true, data: response.data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || 'Failed to update server.' });
  }
});

// Delete server
router.delete('/api/servers/:id', requireAuth, async (req, res) => {
  if (!appApi) {
    return res.status(503).json({ success: false, error: 'Pterodactyl API is not configured.' });
  }

  try {
    const response = await appApi.delete(`/servers/${req.params.id}`);
    res.json({ success: true, data: response.data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || 'Failed to delete server.' });
  }
});

module.exports = router;