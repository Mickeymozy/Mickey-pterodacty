const express = require('express');
const router = express.Router();
const axios = require('axios');
const mongoose = require('mongoose');
const User = require('../models/User');
const sendEmail = require('../utils/email');
const { requireAuth, requireAdmin, isAdminUser } = require('../middleware/auth');
const { createServerFromPackage, isValidGitUrl } = require('../utils/serverHelper');
const { writeAuditLog } = require('../utils/auditLog');

const PTERODACTYL_URL = process.env.PTERODACTYL_URL?.replace(/\/$/, '');
const PTERODACTYL_APP_API_KEY = process.env.PTERODACTYL_APP_API_KEY;
const PTERODACTYL_CLIENT_API_KEY = process.env.PTERODACTYL_CLIENT_API_KEY || process.env.PTERODACTYL_CLIENT_KEY || process.env.PTERODACTYL_API_KEY || process.env.PTERODACTYL_APP_API_KEY;
const hasPteroConfig = PTERODACTYL_URL && PTERODACTYL_APP_API_KEY;
const hasClientConfig = PTERODACTYL_URL && PTERODACTYL_CLIENT_API_KEY;

// Power control and live resource/status reads only work through the Pterodactyl
// Client API, which requires a client key (prefixed "ptlc_"). An application key
// ("ptla_") cannot call client endpoints, so we detect a usable client key here.
const isClientApiKey = (key) => typeof key === 'string' && key.startsWith('ptlc_');
const clientApiUsable = Boolean(hasClientConfig && isClientApiKey(PTERODACTYL_CLIENT_API_KEY));
const CLIENT_KEY_REQUIRED_MESSAGE = 'Kipengele hiki kinahitaji Pterodactyl CLIENT API key (inayoanza na "ptlc_"). Weka PTERODACTYL_CLIENT_API_KEY kwenye mipangilio ya server (.env).';

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

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    startup: 'java -Dterminal.jline=false -Dterminal.ansi=true -jar $SERVER_JARFILE',
    environment: {
      USER_UPLOAD: '0',
      SERVER_JARFILE: 'server.jar',
      AUTO_UPDATE: '1',
      STARTUP_CMD: 'java -jar server.jar'
    }
  }
};

const normalizeServerStatus = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || ['unknown', 'null', 'none'].includes(raw)) return 'unknown';
  if (['running', 'online', 'active', 'started'].includes(raw)) return 'online';
  if (['starting', 'booting', 'launching', 'restarting'].includes(raw)) return 'starting';
  if (['installing', 'installing', 'creating', 'building', 'setting up'].includes(raw)) return 'installing';
  if (['offline', 'stopped', 'stopping', 'suspended', 'disabled', 'crashed', 'dead', 'failed'].includes(raw)) return 'offline';
  return raw;
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

async function getServerConnectionDetails(ref) {
  const { id, identifier } = (ref && typeof ref === 'object')
    ? ref
    : { id: ref, identifier: ref };
  if (!id && !identifier) return extractConnectionDetails({});

  try {
    if (clientApiUsable && clientApi && identifier) {
      const response = await clientApi.get(`/servers/${encodeURIComponent(identifier)}/network/allocations`);
      const allocations = response.data?.data || [];
      const allocation = allocations.find((item) => item?.attributes?.is_primary) || allocations[0];
      const attrs = allocation?.attributes || {};
      const resolvedHost = attrs.alias || attrs.hostname || attrs.domain || attrs.ip || attrs.address || '';
      return {
        ipAddress: attrs.ip || attrs.address || attrs.ipv4 || attrs.ip_address || '',
        port: attrs.port ? String(attrs.port) : '',
        sftpHost: resolvedHost || process.env.PTERODACTYL_URL || '',
        sftpUser: String(identifier)
      };
    }

    if (appApi && id) {
      const response = await appApi.get(`/servers/${encodeURIComponent(id)}/network/allocations`);
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
  const status = normalizeServerStatus(resourceAttrs?.current_state || attrs.status || '');
  return {
    id: attrs.id,
    uuid: attrs.uuid,
    identifier: attrs.identifier,
    name: attrs.name,
    status,
    user: attrs.user,
    limits: attrs.limits || {},
    resources: resourceAttrs || {},
    panelUrl: PTERODACTYL_URL || '',
    ipAddress: resolvedConnection.ipAddress || '',
    port: resolvedConnection.port || '',
    sftpHost: resolvedConnection.sftpHost || '',
    sftpUser: user?.username || user?.displayName || resolvedConnection.sftpUser || ''
  };
};

// Resolve any server reference (numeric id, uuid, or short identifier) to both the
// application numeric `id` and the client `identifier` (short hash). The Application
// API is keyed by numeric id; the Client API is keyed by the identifier.
async function resolveServerRef(serverIdentifier) {
  const rawValue = String(serverIdentifier || '').trim();
  const fallback = { id: rawValue, identifier: rawValue };
  if (!rawValue || !appApi) return fallback;

  const candidates = [rawValue, rawValue.toLowerCase(), rawValue.toUpperCase()];

  for (const candidate of candidates) {
    try {
      const response = await appApi.get(`/servers/${encodeURIComponent(candidate)}`);
      const attrs = response?.data?.attributes;
      if (attrs?.id) {
        return { id: String(attrs.id), identifier: attrs.identifier || rawValue };
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
      const ids = [attrs.id, attrs.uuid, attrs.identifier, attrs.external_id];
      return ids.some((value) => String(value) === rawValue);
    });

    if (match?.attributes?.id) {
      return { id: String(match.attributes.id), identifier: match.attributes.identifier || rawValue };
    }
  } catch (err) {
    return fallback;
  }

  return fallback;
}

async function resolveServerId(serverIdentifier) {
  const ref = await resolveServerRef(serverIdentifier);
  return ref.id;
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

async function getFirstAvailableAllocation() {
  if (!appApi) return null;
  try {
    const nodesResponse = await appApi.get('/nodes?per_page=100');
    const nodes = nodesResponse.data?.data || [];

    for (const node of nodes) {
      const nodeId = node?.attributes?.id;
      if (!nodeId) continue;

      const response = await appApi.get(`/nodes/${nodeId}/allocations?per_page=1000`);
      const allocations = response.data?.data || [];
      const firstUnassigned = allocations.find((allocation) => !allocation?.attributes?.assigned);
      if (firstUnassigned?.attributes?.id) {
        return Number(firstUnassigned.attributes.id);
      }
    }
  } catch (err) {
    console.warn('Failed to fetch available allocations:', err.message);
  }

  return null;
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
          startup_command: attrs.environment?.STARTUP_CMD || '',
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
      startup_command: attrs.environment?.STARTUP_CMD || eggConfig.startup_command || '',
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
      requestedEnvironment.SERVER_JARFILE = startupFile;
    } else if (!requestedEnvironment.MAIN_FILE && !requestedEnvironment.PY_FILE && !requestedEnvironment.SERVER_JARFILE && !requestedEnvironment.JARFILE) {
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

async function requireOwnedServer(user, serverRef) {
  const pteroUserId = await resolveAndSavePteroId(user);
  if (!pteroUserId || !appApi || !serverRef?.id) return null;
  const response = await appApi.get(`/servers/${encodeURIComponent(serverRef.id)}`);
  const attrs = response.data?.attributes || {};
  if (Number(attrs.user) !== Number(pteroUserId)) return null;
  return attrs;
}

async function fetchPteroUserById(pteroUserId) {
  if (!appApi || !pteroUserId) return null;
  try {
    const response = await appApi.get(`/users/${encodeURIComponent(pteroUserId)}`);
    return response.data?.attributes || null;
  } catch (err) {
    return null;
  }
}

async function getServerOwnerContact(pteroUserId) {
  if (!pteroUserId) return null;
  const numericId = Number(pteroUserId);
  if (!Number.isFinite(numericId)) return null;

  const localOwner = await User.findOne({ pteroId: numericId }).select('username email');
  if (localOwner?.email) {
    return { email: localOwner.email, username: localOwner.username || null };
  }

  const pteroUser = await fetchPteroUserById(numericId);
  if (pteroUser?.email && emailRegex.test(pteroUser.email)) {
    return { email: pteroUser.email, username: pteroUser.username || null };
  }

  return null;
}

// Admin: List all Pterodactyl servers for management
router.get(['/admin/servers', '/api/admin/servers'], requireAuth, requireAdmin, async (req, res) => {
  if (!appApi) {
    return res.status(503).json({ success: false, error: 'Pterodactyl API is not configured.' });
  }

  try {
    const response = await appApi.get('/servers?per_page=1000');
    const servers = response.data?.data || [];
    const localUsers = await User.find({ pteroId: { $exists: true, $ne: null } }).select('pteroId username email');
    const userMap = new Map(localUsers.map((user) => [Number(user.pteroId), user]));

    const serverList = servers.map((server) => {
      const attrs = server?.attributes || {};
      const ownerId = Number(attrs.user) || null;
      const owner = ownerId ? userMap.get(ownerId) : null;

      return {
        id: String(attrs.id || ''),
        identifier: attrs.identifier || attrs.uuid || '',
        name: attrs.name || '',
        status: String(attrs.status || '').toLowerCase(),
        ownerId,
        ownerEmail: owner?.email || '',
        ownerUsername: owner?.username || '',
        node: attrs.node || attrs.node_id || ''
      };
    });

    res.json({ success: true, data: serverList });
  } catch (err) {
    console.error('Error fetching admin server list:', err);
    res.status(500).json({ success: false, error: 'Error fetching servers.' });
  }
});

router.post(['/admin/servers/:id/:action', '/api/admin/servers/:id/:action'], requireAuth, requireAdmin, async (req, res) => {
  if (!appApi) {
    return res.status(503).json({ success: false, error: 'Pterodactyl API is not configured.' });
  }

  const { action } = req.params;
  const validActions = ['suspend', 'unsuspend'];

  if (!validActions.includes(action)) {
    return res.status(400).json({ success: false, error: 'Invalid server action.' });
  }

  try {
    const ref = await resolveServerRef(req.params.id);
    await appApi.post(`/servers/${encodeURIComponent(ref.id)}/${action}`);
    const serverResponse = await appApi.get(`/servers/${encodeURIComponent(ref.id)}`);
    const attrs = serverResponse.data?.attributes || {};
    const ownerContact = await getServerOwnerContact(attrs.user);
    const serverName = attrs.name || attrs.identifier || `Server ${ref.id}`;
    const reason = String(req.body?.reason || '').trim();

    if (ownerContact?.email) {
      let subject;
      let html;
      let text;

      if (action === 'suspend') {
        subject = `Server yako "${serverName}" imekatishwa`;
        html = `
          <p>Habari,</p>
          <p>Server yako <strong>${serverName}</strong> imekatishwa kwa sasa.</p>
          <p><strong>Sababu:</strong> ${reason || 'Malipo hayakamilika au ukaguzi wa malipo haujakamilika.'}</p>
          <p>Ikiwa server imekatishwa kimkoa, tafadhali wasiliana na developer au admin ili ikarabatiwe.</p>
          <p>Asante.</p>
        `;
        text = `Server yako ${serverName} imekatishwa. Sababu: ${reason || 'Malipo hayakamilika au ukaguzi wa malipo haujakamilika.'} Ikiwa server imekatishwa kimkoa, tafadhali wasiliana na developer au admin.`;
      } else {
        subject = `Server yako "${serverName}" imefunguliwa tena`;
        html = `
          <p>Habari,</p>
          <p>Server yako <strong>${serverName}</strong> imefunguliwa tena.</p>
          <p>Asante kwa kusuluhisha malipo yake.</p>
        `;
        text = `Server yako ${serverName} imefunguliwa tena. Asante kwa kusuluhisha malipo yake.`;
      }

      await sendEmail({
        to: ownerContact.email,
        subject,
        html,
        text
      });
    }

    await writeAuditLog(req, `server.${action}`, { type: 'PterodactylServer', id: ref.id }, { serverName, reason });

    res.json({ success: true, message: `Server ${action} operation completed.`, data: { server: attrs, owner: ownerContact } });
  } catch (err) {
    const status = err.response?.status;
    const detail = err.response?.data?.errors?.[0]?.detail || err.response?.data?.message || err.message;
    res.status(status && status !== 500 ? status : 500).json({ success: false, error: detail || 'Failed to update server state.' });
  }
});

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
router.get('/api/health', requireAuth, async (req, res) => {
  const checks = {
    database: mongoose.connection.readyState === 1,
    pterodactyl: false,
    panelUrl: PTERODACTYL_URL || ''
  };
  if (appApi) {
    try {
      await appApi.get('/nodes?per_page=1');
      checks.pterodactyl = true;
    } catch (error) {}
  }
  const healthy = checks.database && checks.pterodactyl;
  res.status(healthy ? 200 : 503).json({ success: healthy, status: healthy ? 'healthy' : 'degraded', checks, timestamp: new Date().toISOString() });
});

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
        const numericId = attrs.id;
        const clientId = attrs.identifier || attrs.uuid;
        if (!numericId && !clientId) {
          return sanitizeServer(server, {}, req.user);
        }

        try {
          const [resourcesResponse, connectionDetails] = await Promise.all([
            (clientApiUsable && clientApi && clientId)
              ? clientApi.get(`/servers/${encodeURIComponent(clientId)}/resources`)
              : Promise.resolve(null),
            getServerConnectionDetails({ id: numericId, identifier: clientId })
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
    const syncedEggs = await Promise.all(eggs.map((egg) => fetchEggDetails(egg)));
    res.json({
      success: true,
      eggs: syncedEggs.map((egg) => ({
        id: egg.id,
        name: egg.name,
        docker_image: egg.docker_image || '',
        startup: egg.startup || '',
        startup_command: egg.startup_command || egg.environment?.STARTUP_CMD || '',
        environment: egg.environment || {},
        nestId: egg.nestId
      }))
    });
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
    const { name, egg, cpu, memory, disk, startupFile, startupCommand, mainFile, main_file, environment, dockerImage, botRepoUrl } = req.body;
    const eggConfig = await resolveEggConfig(egg);

    if (!name || !eggConfig) {
      return res.status(400).json({
        success: false,
        error: 'Please select a valid server type before creating the server.'
      });
    }

    if (botRepoUrl && !isValidGitUrl(botRepoUrl)) {
      return res.status(400).json({ success: false, error: 'Invalid GitHub/Git repository URL. Use a public HTTPS .git URL.' });
    }

    const resolvedEggConfig = await fetchEggDetails(eggConfig);
    const syncedDockerImage = resolvedEggConfig.docker_image || dockerImage;
    const syncedStartupCommand = resolvedEggConfig.startup || startupCommand;
    const safeEnvironment = buildServerEnvironment(resolvedEggConfig, {
      startupFile: startupFile || mainFile || main_file || '',
      startupCommand: syncedStartupCommand,
      environment,
      botRepoUrl
    });

    const resolvedStartupCommand = botRepoUrl
      ? `set -e; if [ -z \"$BOT_REPO_URL\" ]; then echo \"[BOT_REPO] ERROR: BOT_REPO_URL is not set\"; exit 1; fi; if [ -d \"/home/container/.git\" ]; then cd /home/container && (git pull --depth=1 origin main || git pull --depth=1 origin master); else rm -rf /tmp/mickey-bot-repo && git clone --depth=1 \"$BOT_REPO_URL\" /tmp/mickey-bot-repo && cp -a /tmp/mickey-bot-repo/. /home/container/ && rm -rf /tmp/mickey-bot-repo; fi; cd /home/container && ${syncedStartupCommand}`
      : syncedStartupCommand;

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

    const allocationId = await getFirstAvailableAllocation();
    const pteroUserId = Number(resolvedPteroId);
    const panelUser = await appApi.get(`/users/${pteroUserId}`);
    if (!panelUser?.data?.attributes?.id) {
      return res.status(400).json({
        success: false,
        error: 'This account is not linked to a valid Pterodactyl user.'
      });
    }

    const safeCpu = Math.max(25, Math.min(1000, Number.isFinite(Number(cpu)) ? (Number(cpu) > 100 ? Number(cpu) : Number(cpu) * 100) : 100));
    const basePayload = {
      name,
      user: pteroUserId,
      egg: Number(resolvedEggConfig.id),
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

    if (syncedDockerImage) {
      basePayload.docker_image = syncedDockerImage;
    }
    if (syncedStartupCommand) {
      basePayload.startup = resolvedStartupCommand;
    }

    const payloads = [basePayload];

    if (allocationId) {
      payloads.push({
        ...basePayload,
        allocation: { default: allocationId }
      });
    }

    const fallbackPayload = {
      ...basePayload,
      deploy: {
        locations: [locationId],
        dedicated_ip: false,
        port_range: []
      }
    };
    if (allocationId) {
      fallbackPayload.allocation = { default: allocationId };
    }
    payloads.push(fallbackPayload);

    const minimalPayload = {
      name,
      user: pteroUserId,
      egg: Number(resolvedEggConfig.id),
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
      start_on_completion: true
    };
    if (syncedDockerImage) {
      minimalPayload.docker_image = syncedDockerImage;
    }
    if (syncedStartupCommand) {
      minimalPayload.startup = resolvedStartupCommand;
    }
    if (allocationId) {
      minimalPayload.allocation = { default: allocationId };
    }
    payloads.push(minimalPayload);

    let response;
    let lastError;
    for (const payload of payloads) {
      try {
        response = await appApi.post('/servers', payload);
        break;
      } catch (err) {
        lastError = err;
      }
    }

    if (!response) {
      throw lastError || new Error('Pterodactyl rejected the server payload.');
    }

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
    const ref = await resolveServerRef(req.params.id);
    const serverResponse = await appApi.get(`/servers/${encodeURIComponent(ref.id)}`);
    const attrs = serverResponse.data?.attributes || {};
    if (!(await requireOwnedServer(req.user, ref))) {
      return res.status(403).json({ success: false, error: 'Huna ruhusa ya kuona server hii.' });
    }

    const connectionDetails = await getServerConnectionDetails(ref);
    const panelUrl = process.env.PTERODACTYL_URL || '';

    res.json({
      success: true,
      access: {
        panelUrl,
        username: req.user?.username || req.user?.displayName || '',
        email: req.user?.email || '',
        password: null,
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
    const ref = await resolveServerRef(req.params.id);
    if (!(await requireOwnedServer(req.user, ref))) {
      return res.status(403).json({ success: false, error: 'Huna ruhusa ya kuona server hii.' });
    }
    const [serverResponse, resourcesResponse] = await Promise.allSettled([
      appApi.get(`/servers/${encodeURIComponent(ref.id)}`),
      (clientApiUsable && clientApi && ref.identifier)
        ? clientApi.get(`/servers/${encodeURIComponent(ref.identifier)}/resources`)
        : Promise.resolve(null)
    ]);

    if (serverResponse.status === 'rejected') {
      throw serverResponse.reason;
    }

    const attrs = serverResponse.value?.data?.attributes || {};
    const resourceAttrs = resourcesResponse.status === 'fulfilled' ? resourcesResponse.value?.data?.attributes || {} : {};
    const connectionDetails = await getServerConnectionDetails(ref);

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
        panelUrl: PTERODACTYL_URL || '',
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

// Server backups and console websocket details use the Pterodactyl Client API.
router.get('/api/servers/:id/backups', requireAuth, async (req, res) => {
  if (!clientApiUsable || !clientApi) return res.status(503).json({ success: false, error: CLIENT_KEY_REQUIRED_MESSAGE });
  try {
    const ref = await resolveServerRef(req.params.id);
    if (!(await requireOwnedServer(req.user, ref))) return res.status(403).json({ success: false, error: 'Huna ruhusa ya kuona backups za server hii.' });
    const response = await clientApi.get(`/servers/${encodeURIComponent(ref.identifier)}/backups`);
    res.json({ success: true, data: response.data?.data || [], meta: response.data?.meta || {} });
  } catch (err) {
    res.status(err.response?.status || 500).json({ success: false, error: err.response?.data?.errors?.[0]?.detail || err.message || 'Failed to load backups.' });
  }
});

router.post('/api/servers/:id/backups', requireAuth, async (req, res) => {
  if (!clientApiUsable || !clientApi) return res.status(503).json({ success: false, error: CLIENT_KEY_REQUIRED_MESSAGE });
  try {
    const ref = await resolveServerRef(req.params.id);
    if (!(await requireOwnedServer(req.user, ref))) return res.status(403).json({ success: false, error: 'Huna ruhusa ya kuunda backup ya server hii.' });
    const response = await clientApi.post(`/servers/${encodeURIComponent(ref.identifier)}/backups`, { name: String(req.body?.name || '').trim() || undefined });
    res.status(201).json({ success: true, data: response.data?.attributes || response.data?.data || {} });
  } catch (err) {
    res.status(err.response?.status || 500).json({ success: false, error: err.response?.data?.errors?.[0]?.detail || err.message || 'Failed to create backup.' });
  }
});

router.delete('/api/servers/:id/backups/:backupId', requireAuth, async (req, res) => {
  if (!clientApiUsable || !clientApi) return res.status(503).json({ success: false, error: CLIENT_KEY_REQUIRED_MESSAGE });
  try {
    const ref = await resolveServerRef(req.params.id);
    if (!(await requireOwnedServer(req.user, ref))) return res.status(403).json({ success: false, error: 'Huna ruhusa ya kufuta backup ya server hii.' });
    await clientApi.delete(`/servers/${encodeURIComponent(ref.identifier)}/backups/${encodeURIComponent(req.params.backupId)}`);
    res.json({ success: true });
  } catch (err) {
    res.status(err.response?.status || 500).json({ success: false, error: err.response?.data?.errors?.[0]?.detail || err.message || 'Failed to delete backup.' });
  }
});

router.post('/api/servers/:id/backups/:backupId/restore', requireAuth, async (req, res) => {
  if (!clientApiUsable || !clientApi) return res.status(503).json({ success: false, error: CLIENT_KEY_REQUIRED_MESSAGE });
  try {
    const ref = await resolveServerRef(req.params.id);
    if (!(await requireOwnedServer(req.user, ref))) return res.status(403).json({ success: false, error: 'Huna ruhusa ya kurestore backup ya server hii.' });
    const response = await clientApi.post(`/servers/${encodeURIComponent(ref.identifier)}/backups/${encodeURIComponent(req.params.backupId)}/restore`);
    res.json({ success: true, data: response.data?.attributes || response.data?.data || {} });
  } catch (err) {
    res.status(err.response?.status || 500).json({ success: false, error: err.response?.data?.errors?.[0]?.detail || err.message || 'Failed to restore backup.' });
  }
});

router.get('/api/servers/:id/console', requireAuth, async (req, res) => {
  if (!clientApiUsable || !clientApi) return res.status(503).json({ success: false, error: CLIENT_KEY_REQUIRED_MESSAGE });
  try {
    const ref = await resolveServerRef(req.params.id);
    if (!(await requireOwnedServer(req.user, ref))) return res.status(403).json({ success: false, error: 'Huna ruhusa ya kuona console ya server hii.' });
    const response = await clientApi.get(`/servers/${encodeURIComponent(ref.identifier)}/websocket`);
    res.json({ success: true, data: response.data?.data || {} });
  } catch (err) {
    res.status(err.response?.status || 500).json({ success: false, error: err.response?.data?.errors?.[0]?.detail || err.message || 'Failed to load console connection.' });
  }
});

// Power action (start/stop/restart) — only available via the Client API
router.post('/api/servers/:id/power/:action', requireAuth, async (req, res) => {
  const validActions = ['start', 'stop', 'restart'];
  const { action } = req.params;

  if (!validActions.includes(action)) {
    return res.status(400).json({ success: false, error: 'Invalid power action.' });
  }

  if (!clientApiUsable || !clientApi) {
    return res.status(503).json({ success: false, error: CLIENT_KEY_REQUIRED_MESSAGE });
  }

  try {
    const ref = await resolveServerRef(req.params.id);
    if (!(await requireOwnedServer(req.user, ref))) {
      return res.status(403).json({ success: false, error: 'Huna ruhusa ya kubadilisha server hii.' });
    }
    if (!ref.identifier) {
      return res.status(404).json({ success: false, error: 'Server haijapatikana kwenye panel.' });
    }
    await clientApi.post(`/servers/${encodeURIComponent(ref.identifier)}/power`, { signal: action });
    res.json({ success: true, data: { signal: action, identifier: ref.identifier } });
  } catch (err) {
    const status = err.response?.status;
    const detail = err.response?.data?.errors?.[0]?.detail || err.response?.data?.message || err.message;
    const friendly =
      status === 401 || status === 403
        ? 'Client API key haina ruhusa kwa server hii. Hakikisha ni key ya "ptlc_" yenye access ya server husika.'
        : status === 404
          ? 'Server haipo kwenye Client API. Hakikisha akaunti ya key inamiliki server hii.'
          : detail || 'Imeshindwa kubadilisha hali ya server.';
    res.status(status && status !== 500 ? status : 500).json({ success: false, error: friendly });
  }
});

// Delete server
router.delete('/api/servers/:id', requireAuth, async (req, res) => {
  if (!appApi) {
    return res.status(503).json({ success: false, error: 'Pterodactyl API is not configured.' });
  }

  try {
    const serverRef = await resolveServerRef(req.params.id);
    if (!(await requireOwnedServer(req.user, serverRef))) {
      return res.status(403).json({ success: false, error: 'Huna ruhusa ya kufuta server hii.' });
    }
    const serverResponse = await appApi.get(`/servers/${encodeURIComponent(serverRef.id)}`);
    const serverAttributes = serverResponse.data?.attributes || {};
    const expectedName = String(serverAttributes.name || serverAttributes.identifier || '').trim();
    const confirmServerName = String(req.body?.confirmServerName || '').trim();

    if (expectedName && confirmServerName !== expectedName) {
      return res.status(400).json({ success: false, error: 'Andika jina la server kwa usahihi ili kuithibitisha ufutaji.' });
    }

    const response = await appApi.delete(`/servers/${encodeURIComponent(serverRef.id)}`);
    res.json({ success: true, data: response.data });
  } catch (err) {
    const status = err.response?.status;
    const message = err.response?.data?.errors?.[0]?.detail || err.response?.data?.message || err.message || 'Failed to delete server.';
    res.status(status && status !== 500 ? status : 500).json({ success: false, error: message });
  }
});

// Create server from package
router.post('/api/servers/from-package', requireAuth, async (req, res) => {
  try {
    const { packageId, serverName, eggId, dockerImage, startupFile, startupCommand, botRepoUrl } = req.body;
    
    if (!packageId) {
      return res.status(400).json({ success: false, error: 'Package ID is required.' });
    }
    
    const serverData = await createServerFromPackage(req.user, packageId, serverName, { eggId, dockerImage, startupFile, startupCommand, botRepoUrl });

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