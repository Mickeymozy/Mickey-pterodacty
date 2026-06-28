const express = require('express');
const router = express.Router();
const axios = require('axios');
const { requireAuth, isAdminUser } = require('../middleware/auth');
const { createServerFromPackage } = require('../utils/serverHelper');

const PTERODACTYL_URL = process.env.PTERODACTYL_URL?.replace(/\/$/, '');
const PTERODACTYL_APP_API_KEY = process.env.PTERODACTYL_APP_API_KEY;
const PTERODACTYL_CLIENT_API_KEY = process.env.PTERODACTYL_CLIENT_API_KEY || process.env.PTERODACTYL_CLIENT_KEY || process.env.PTERODACTYL_API_KEY || process.env.PTERODACTYL_APP_API_KEY;
const hasPteroConfig = PTERODACTYL_URL && PTERODACTYL_APP_API_KEY;
const hasClientConfig = PTERODACTYL_URL && PTERODACTYL_CLIENT_API_KEY;

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

const clientApi = hasClientConfig
  ? axios.create({
      baseURL: `${PTERODACTYL_URL}/api/client`,
      headers: {
        Authorization: `Bearer ${PTERODACTYL_CLIENT_API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      timeout: 10000
    })
  : null;

const DEFAULT_SERVER_PASSWORD = process.env.DEFAULT_SERVER_PASSWORD || process.env.SERVER_DEFAULT_PASSWORD || 'MICKEY24@';

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

const normalizeServerStatus = (value) => {
  const raw = String(value || 'offline').trim().toLowerCase();
  if (['running', 'online', 'active'].includes(raw)) return 'online';
  if (['installing', 'installing...'].includes(raw)) return 'installing';
  if (['offline', 'stopped', 'stopping', 'suspended', 'disabled'].includes(raw)) return 'offline';
  return raw || 'offline';
};

const extractConnectionDetails = (serverData = {}) => {
  const attrs = serverData?.attributes || {};
  const allocations = attrs?.relationships?.allocations || attrs?.allocations || [];
  const primaryAllocation = Array.isArray(allocations) ? allocations[0] : null;
  const allocationAttrs = primaryAllocation?.attributes || primaryAllocation || {};
  const ipAddress = allocationAttrs.ip || allocationAttrs.address || allocationAttrs.ipv4 || allocationAttrs.ip_address || '';
  const port = allocationAttrs.port || allocationAttrs.public_port || allocationAttrs.port_number || '';
  const host = allocationAttrs.alias || allocationAttrs.hostname || allocationAttrs.domain || ipAddress || '';

  return {
    ipAddress: ipAddress || '',
    port: port ? String(port) : '',
    sftpHost: host || process.env.PTERODACTYL_URL || '',
    sftpUser: attrs?.identifier || attrs?.uuid || attrs?.id || ''
  };
};

async function getServerConnectionDetails(serverId) {
  if (!serverId) return extractConnectionDetails({});

  try {
    if (clientApi) {
      const response = await clientApi.get(`/servers/${encodeURIComponent(serverId)}/network/allocations`);
      const allocations = response.data?.data || [];
      const allocation = allocations.find((item) => item?.attributes?.is_primary) || allocations[0];
      const attrs = allocation?.attributes || {};
      const resolvedHost = attrs.alias || attrs.hostname || attrs.domain || attrs.ip || attrs.address || '';
      return {
        ipAddress: attrs.ip || attrs.address || attrs.ipv4 || attrs.ip_address || '',
        port: attrs.port ? String(attrs.port) : '',
        sftpHost: resolvedHost || process.env.PTERODACTYL_URL || '',
        sftpUser: String(serverId)
      };
    }

    if (appApi) {
      const response = await appApi.get(`/servers/${encodeURIComponent(serverId)}/network/allocations`);
      const allocations = response.data?.data || [];
      const allocation = allocations.find((item) => item?.attributes?.is_primary) || allocations[0];
      const attrs = allocation?.attributes || {};
      const resolvedHost = attrs.alias || attrs.hostname || attrs.domain || attrs.ip || attrs.address || '';
      return {
        ipAddress: attrs.ip || attrs.address || attrs.ipv4 || attrs.ip_address || '',
        port: attrs.port ? String(attrs.port) : '',
        sftpHost: resolvedHost || process.env.PTERODACTYL_URL || '',
        sftpUser: String(serverId)
      };
    }
  } catch (err) {
    // fall back to the application-level attributes if the client endpoint is unavailable
  }

  return extractConnectionDetails({});
}

const sanitizeServer = (server, resourceAttrs = {}, user = null, connectionDetails = null) => {
  const attrs = server?.attributes || {};
  const resolvedConnection = connectionDetails || extractConnectionDetails(server);
  const status = normalizeServerStatus(resourceAttrs?.current_state || attrs.status || 'offline');
  return {
    id: attrs.id,
    uuid: attrs.uuid,
    identifier: attrs.identifier,
    name: attrs.name,
    status,
    user: attrs.user,
    limits: attrs.limits || {},
    resources: resourceAttrs || {},
    ipAddress: resolvedConnection.ipAddress || '',
    port: resolvedConnection.port || '',
    sftpHost: resolvedConnection.sftpHost || '',
    sftpUser: user?.username || user?.displayName || resolvedConnection.sftpUser || ''
  };
};

async function resolveServerId(serverIdentifier) {
  if (!serverIdentifier || !appApi) return serverIdentifier;

  const rawValue = String(serverIdentifier).trim();
  if (!rawValue) return rawValue;

  const candidates = [rawValue, rawValue.toLowerCase(), rawValue.toUpperCase()];

  for (const candidate of candidates) {
    try {
      const response = await appApi.get(`/servers/${encodeURIComponent(candidate)}`);
      if (response?.data?.attributes?.id) {
        return String(response.data.attributes.id);
      }
    } catch (err) {
      if (err.response?.status !== 404) {
        throw err;
      }
    }
  }

  try {
    const listResponse = await appApi.get('/servers?per_page=1000');
    const match = (listResponse.data?.data || []).find((server) => {
      const attrs = server?.attributes || {};
      const candidates = [attrs.id, attrs.uuid, attrs.identifier, attrs.external_id];
      return candidates.some((value) => String(value) === rawValue);
    });

    return match?.attributes?.id ? String(match.attributes.id) : rawValue;
  } catch (err) {
    return rawValue;
  }
}

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

async function fetchEggDetails(eggConfig) {
  if (!appApi || !eggConfig?.id || !eggConfig?.nestId) return eggConfig;

  try {
    const response = await appApi.get(`/nests/${eggConfig.nestId}/eggs/${eggConfig.id}?include=variables`);
    const attrs = response.data?.attributes || {};
    const included = response.data?.included || [];

    const variableDefaults = {};
    for (const item of included) {
      if (item?.type !== 'egg_variable') continue;
      const variable = item?.attributes || {};
      const envKey = variable.env_variable;
      if (envKey && variable.default_value !== undefined && variable.default_value !== null) {
        variableDefaults[envKey] = String(variable.default_value);
      }
    }

    return {
      ...eggConfig,
      docker_image: attrs.docker_image || eggConfig.docker_image,
      startup: attrs.startup || eggConfig.startup,
      environment: {
        ...(eggConfig.environment || {}),
        ...(attrs.environment || {}),
        ...variableDefaults
      }
    };
  } catch (err) {
    console.warn('Unable to fetch egg details, using fallback defaults:', err.message);
    return eggConfig;
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

function getDefaultStartupFile(eggConfig = {}) {
  const eggId = Number(eggConfig.id);
  if (eggId === 27) return 'main.py';
  if (eggId === 28) return 'server.jar';
  return 'index.js';
}

function getDefaultStartupCommand(eggConfig = {}) {
  const eggId = Number(eggConfig.id);
  if (eggId === 27) return 'python3 main.py';
  if (eggId === 28) return 'java -jar server.jar';
  return 'npm start';
}

function buildServerEnvironment(eggConfig, options = {}) {
  const resolvedEggConfig = eggConfig || {};
  const baseEnvironment = {
    USER_UPLOAD: '0',
    AUTO_UPDATE: '1',
    ...(resolvedEggConfig.environment || {})
  };

  const requestedEnvironment = {
    ...baseEnvironment,
    ...(options.environment || {})
  };

  const eggId = Number(resolvedEggConfig.id);
  const startupFile = options.startupFile || options.mainFile || options.main_file || getDefaultStartupFile(resolvedEggConfig);
  const startupCommand = options.startupCommand || getDefaultStartupCommand(resolvedEggConfig);

  if (startupFile) {
    if (eggId === 16) {
      requestedEnvironment.MAIN_FILE = startupFile;
    } else if (eggId === 27) {
      requestedEnvironment.PY_FILE = startupFile;
    } else if (eggId === 28) {
      requestedEnvironment.JARFILE = startupFile;
    } else if (!requestedEnvironment.MAIN_FILE && !requestedEnvironment.PY_FILE && !requestedEnvironment.JARFILE) {
      requestedEnvironment.MAIN_FILE = startupFile;
    }
  }

  if (startupCommand) {
    requestedEnvironment.STARTUP_CMD = startupCommand;
  }

  return Object.fromEntries(
    Object.entries(requestedEnvironment).filter(([, value]) => value !== undefined && value !== null).map(([key, value]) => [key, String(value)])
  );
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
  const coins = Number(req.user.coins) || 0;
  res.json({
    user: {
      id: req.user._id,
      username: req.user.username,
      email: req.user.email,
      displayName: req.user.displayName || req.user.firstName || req.user.username,
      pterodactylId: req.user.pteroId,
      linkedToPtero: Boolean(req.user.pteroId && Number(req.user.pteroId) > 0),
      isAdmin: isAdminUser(req.user),
      role: req.user.role || 'user',
      coins,
      balance: coins
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
    const ownedServers = (response.data?.data || []).filter((server) => Number(server?.attributes?.user) === Number(resolvedPteroId));

    const servers = await Promise.all(
      ownedServers.map(async (server) => {
        const attrs = server?.attributes || {};
        const serverId = attrs.id || attrs.identifier || attrs.uuid;
        if (!serverId) {
          return sanitizeServer(server, {}, req.user);
        }

        try {
          const [resourcesResponse, connectionDetails] = await Promise.all([
            clientApi ? clientApi.get(`/servers/${encodeURIComponent(serverId)}/resources`) : Promise.resolve(null),
            getServerConnectionDetails(serverId)
          ]);

          const resourceAttrs = resourcesResponse?.data?.attributes || {};
          return sanitizeServer(server, resourceAttrs, req.user, connectionDetails);
        } catch (resourceErr) {
          return sanitizeServer(server, {}, req.user);
        }
      })
    );

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
    const { name, egg, cpu, memory, disk, startupFile, startupCommand, mainFile, main_file, environment } = req.body;
    const eggConfig = await resolveEggConfig(egg);

    if (!name || !eggConfig) {
      return res.status(400).json({
        success: false,
        error: 'Please select a valid server type before creating the server.'
      });
    }

    const resolvedEggConfig = await fetchEggDetails(eggConfig);
    const safeEnvironment = buildServerEnvironment(resolvedEggConfig, {
      startupFile: startupFile || mainFile || main_file || '',
      startupCommand,
      environment
    });

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
      egg: Number(resolvedEggConfig.id),
      docker_image: resolvedEggConfig.docker_image,
      startup: resolvedEggConfig.startup,
      environment: safeEnvironment,
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

// Server access details
router.get('/api/servers/:id/access', requireAuth, async (req, res) => {
  if (!appApi) {
    return res.status(503).json({ success: false, error: 'Pterodactyl API is not configured.' });
  }

  try {
    const resolvedServerId = await resolveServerId(req.params.id);
    const serverResponse = await appApi.get(`/servers/${encodeURIComponent(resolvedServerId)}`);
    const attrs = serverResponse.data?.attributes || {};

    const connectionDetails = await getServerConnectionDetails(resolvedServerId);
    const panelUrl = process.env.PTERODACTYL_URL || '';

    res.json({
      success: true,
      access: {
        panelUrl,
        username: req.user?.username || req.user?.displayName || '',
        email: req.user?.email || '',
        password: DEFAULT_SERVER_PASSWORD,
        serverName: attrs.name || '',
        serverId: attrs.identifier || attrs.id || '',
        ipAddress: connectionDetails.ipAddress,
        port: connectionDetails.port,
        sftpHost: connectionDetails.sftpHost || panelUrl,
        sftpUser: req.user?.username || req.user?.displayName || ''
      }
    });
  } catch (err) {
    const status = err.response?.status;
    const message = err.response?.data?.errors?.[0]?.detail || err.response?.data?.message || err.message || 'Failed to load server access details.';
    res.status(status && status !== 500 ? status : 500).json({ success: false, error: message });
  }
});

// Server details
router.get('/api/servers/:id/details', requireAuth, async (req, res) => {
  if (!appApi) {
    return res.status(503).json({ success: false, error: 'Pterodactyl API is not configured.' });
  }

  try {
    const resolvedServerId = await resolveServerId(req.params.id);
    const serverId = encodeURIComponent(resolvedServerId);
    const [serverResponse, resourcesResponse] = await Promise.allSettled([
      appApi.get(`/servers/${serverId}`),
      clientApi ? clientApi.get(`/servers/${serverId}/resources`) : Promise.resolve(null)
    ]);

    if (serverResponse.status === 'rejected') {
      throw serverResponse.reason;
    }

    const attrs = serverResponse.value?.data?.attributes || {};
    const resourceAttrs = resourcesResponse.status === 'fulfilled' ? resourcesResponse.value?.data?.attributes || {} : {};
    const connectionDetails = await getServerConnectionDetails(resolvedServerId);

    res.json({
      success: true,
      server: {
        id: attrs.id,
        uuid: attrs.uuid,
        identifier: attrs.identifier,
        name: attrs.name,
        status: normalizeServerStatus(resourceAttrs.current_state || attrs.status || 'unknown'),
        limits: attrs.limits || {},
        resources: resourceAttrs,
        ipAddress: connectionDetails.ipAddress,
        port: connectionDetails.port,
        sftpHost: connectionDetails.sftpHost
      }
    });
  } catch (err) {
    const status = err.response?.status;
    const message = err.response?.data?.errors?.[0]?.detail || err.response?.data?.message || err.message || 'Failed to load server details.';
    res.status(status && status !== 500 ? status : 500).json({ success: false, error: message });
  }
});

// Power action
router.post('/api/servers/:id/power/:action', requireAuth, async (req, res) => {
  if (!appApi && !clientApi) {
    return res.status(503).json({ success: false, error: 'Pterodactyl API is not configured.' });
  }

  const validActions = ['start', 'stop', 'restart'];
  const { action } = req.params;

  if (!validActions.includes(action)) {
    return res.status(400).json({ success: false, error: 'Invalid power action.' });
  }

  try {
    const resolvedServerId = await resolveServerId(req.params.id);
    const powerApi = clientApi || appApi;
    const response = await powerApi.post(`/servers/${encodeURIComponent(resolvedServerId)}/power`, { signal: action });
    res.json({ success: true, data: response.data });
  } catch (err) {
    const status = err.response?.status;
    const detail = err.response?.data?.errors?.[0]?.detail || err.response?.data?.message || err.message;
    res.status(status && status !== 500 ? status : 500).json({ success: false, error: detail || 'Failed to update server.' });
  }
});

// Delete server
router.delete('/api/servers/:id', requireAuth, async (req, res) => {
  if (!appApi) {
    return res.status(503).json({ success: false, error: 'Pterodactyl API is not configured.' });
  }

  try {
    const resolvedServerId = await resolveServerId(req.params.id);
    const response = await appApi.delete(`/servers/${encodeURIComponent(resolvedServerId)}`);
    res.json({ success: true, data: response.data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || 'Failed to delete server.' });
  }
});

// Create server from package
router.post('/api/servers/from-package', requireAuth, async (req, res) => {
  try {
    const { packageId, serverName } = req.body;
    
    if (!packageId) {
      return res.status(400).json({ success: false, error: 'Package ID is required.' });
    }
    
    const serverData = await createServerFromPackage(req.user, packageId, serverName);

    res.json({
      success: true,
      message: 'Server created successfully from package.',
      server: serverData.server,
      packageId: packageId
    });
  } catch (err) {
    const status = err.response?.status;
    const apiError = err.response?.data?.errors?.[0]?.detail || err.response?.data?.message || err.message;
    const message =
      status === 401 || status === 403
        ? 'This action is unauthorized. Please check the Pterodactyl API key permissions or linked account.'
        : apiError || 'Failed to create server from package.';

    res.status(status && status !== 500 ? status : 500).json({
      success: false,
      error: message
    });
  }
});

module.exports = router;