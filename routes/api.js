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
    id: 16,
    key: 'nodejs',
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
    id: 27,
    key: 'python',
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
    id: 28,
    key: 'java',
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

async function getFirstValidLocation() {
  if (!appApi) return null;
  try {
    const response = await appApi.get('/locations?per_page=100');
    const locations = response.data?.data || [];
    const firstLocation = locations.find((loc) => loc?.attributes?.id);
    return firstLocation?.attributes?.id || null;
  } catch (err) {
    console.error('Failed to fetch locations:', err.message);
    return null;
  }
}

async function fetchPanelEggOptions() {
  if (!appApi) return [];

  try {
    const nestsResponse = await appApi.get('/nests?per_page=1000');
    const nests = nestsResponse.data?.data || [];
    const eggs = [];

    for (const nest of nests) {
      const nestId = nest?.attributes?.id;
      if (!nestId) continue;

      const eggsResponse = await appApi.get(`/nests/${nestId}/eggs?per_page=1000`);
      const eggEntries = eggsResponse.data?.data || [];

      for (const entry of eggEntries) {
        const attrs = entry?.attributes || {};
        eggs.push({
          id: Number(attrs.id),
          name: attrs.name || `Egg ${attrs.id}`,
          docker_image: attrs.docker_image || '',
          startup: attrs.startup || '',
          environment: attrs.environment || {},
          nestId
        });
      }
    }

    return eggs.filter((egg) => Number.isFinite(egg.id));
  } catch (err) {
    console.error('Failed to fetch panel eggs:', err.message);
    return [];
  }
}

async function resolveEggConfig(rawEgg) {
  if (rawEgg === null || rawEgg === undefined || rawEgg === '') {
    return null;
  }

  const lookup = String(rawEgg).trim().toLowerCase();
  const aliasMap = {
    nodejs: '16',
    node: '16',
    python: '27',
    java: '28'
  };

  const normalized = aliasMap[lookup] || lookup;
  const numericValue = Number(normalized);
  const configKey = Number.isFinite(numericValue) ? numericValue : normalized;

  if (eggConfigs[configKey]) {
    return eggConfigs[configKey];
  }

  const panelEggOptions = await fetchPanelEggOptions();
  return panelEggOptions.find((egg) => Number(egg.id) === Number(configKey)) || null;
}

async function resolveAndSavePteroId(user) {
  if (!appApi || !user) return null;

  const currentId = Number(user.pteroId);
  if (currentId > 0) {
    try {
      const response = await appApi.get(`/users/${currentId}`);
      if (response?.data?.attributes?.id) {
        return currentId;
      }
    } catch (err) {
      // ignore and continue lookup by username/email below
    }
  }

  try {
    let page = 1;
    while (true) {
      const response = await appApi.get(`/users?page=${page}&per_page=100`);
      const users = response.data?.data || [];
      if (!users.length) break;

      const matched = users.find((entry) => {
        const attrs = entry?.attributes || {};
        return (
          attrs.username === String(user.username || '').toLowerCase() ||
          attrs.email === String(user.email || '').toLowerCase()
        );
      });

      if (matched?.attributes?.id) {
        user.pteroId = matched.attributes.id;
        await user.save();
        return Number(matched.attributes.id);
      }

      if (users.length < 100) break;
      page += 1;
    }
  } catch (err) {
    console.error('Failed to resolve Pterodactyl user:', err.message);
  }

  return null;
}

// Get current user info
router.get('/api/me', requireAuth, (req, res) => {
  res.json({
    user: {
      id: req.user._id,
      username: req.user.username,
      email: req.user.email,
      displayName: req.user.displayName || req.user.firstName || req.user.username,
      pterodactylId: req.user.pteroId,
      linkedToPtero: Boolean(req.user.pteroId && Number(req.user.pteroId) > 0)
    }
  });
});

// Get user servers
router.get('/api/servers', requireAuth, async (req, res) => {
  if (!appApi) {
    return res.status(503).json({ success: false, error: 'Pterodactyl API is not configured.' });
  }

  try {
    const resolvedPteroId = await resolveAndSavePteroId(req.user);
    if (!resolvedPteroId) {
      return res.status(400).json({
        success: false,
        error: 'Your Pterodactyl account is not linked yet. Please register or log in again after the panel settings are fixed.'
      });
    }

    const response = await appApi.get('/servers?per_page=1000');
    const servers = (response.data?.data || [])
      .filter((server) => Number(server?.attributes?.user) === Number(resolvedPteroId))
      .map(sanitizeServer);

    res.json({ success: true, servers });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || 'Failed to fetch servers.' });
  }
});

// Get eggs available in the panel
router.get('/api/eggs', requireAuth, async (req, res) => {
  if (!appApi) {
    return res.status(503).json({ success: false, error: 'Pterodactyl API is not configured.' });
  }

  try {
    const eggs = await fetchPanelEggOptions();
    res.json({ success: true, eggs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || 'Failed to fetch eggs.' });
  }
});

// Create server
router.post('/api/servers/create', requireAuth, async (req, res) => {
  if (!appApi) {
    return res.status(503).json({ success: false, error: 'Pterodactyl API is not configured.' });
  }

  try {
    const { name, egg, cpu, memory, disk } = req.body;
    const eggConfig = await resolveEggConfig(egg);

    if (!name || !eggConfig) {
      return res.status(400).json({
        success: false,
        error: 'Please select a valid server type before creating the server.'
      });
    }

    const resolvedPteroId = await resolveAndSavePteroId(req.user);
    if (!resolvedPteroId) {
      return res.status(400).json({
        success: false,
        error: 'Your Pterodactyl account is not linked yet. Please log in again or register correctly.'
      });
    }

    const locationId = await getFirstValidLocation();
    if (!locationId) {
      return res.status(503).json({
        success: false,
        error: 'No valid server location is available right now.'
      });
    }

    const pteroUserId = Number(resolvedPteroId);
    const panelUser = await appApi.get(`/users/${pteroUserId}`);
    if (!panelUser?.data?.attributes?.id) {
      return res.status(400).json({
        success: false,
        error: 'This account is not linked to a valid Pterodactyl user.'
      });
    }

    const safeCpu = Math.min(25, Math.max(1, Number(cpu) || 25));
    const payload = {
      name,
      user: pteroUserId,
      egg: Number(eggConfig.id),
      docker_image: eggConfig.docker_image,
      startup: eggConfig.startup,
      environment: eggConfig.environment,
      limits: {
        memory: Number(memory) || 1024,
        swap: 0,
        disk: Number(disk) || 2048,
        io: 500,
        cpu: safeCpu,
        oom_disabled: false
      },
      feature_limits: {
        databases: 0,
        backups: 1,
        allocations: 1
      },
      deploy: {
        locations: [locationId],
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
    const status = err.response?.status;
    const apiError = err.response?.data?.errors?.[0]?.detail || err.response?.data?.message || err.message;
    const message =
      status === 401 || status === 403
        ? 'This action is unauthorized. Please check the Pterodactyl API key permissions or linked account.'
        : apiError || 'Failed to create server.';

    res.status(status && status !== 500 ? status : 500).json({
      success: false,
      error: message
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