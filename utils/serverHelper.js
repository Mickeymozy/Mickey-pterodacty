/**
 * Server Creation Helper - Shared logic for creating servers from packages
 */

const axios = require('axios');
const ServerPackage = require('../models/ServerPackage');

const PTERODACTYL_URL = process.env.PTERODACTYL_URL?.replace(/\/$/, '');
const PTERODACTYL_APP_API_KEY = process.env.PTERODACTYL_APP_API_KEY;

const appApi = PTERODACTYL_URL && PTERODACTYL_APP_API_KEY
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
    startup: 'java -Dterminal.jline=false -Dterminal.ansi=true -jar $SERVER_JARFILE',
    environment: {
      USER_UPLOAD: '0',
      SERVER_JARFILE: 'server.jar',
      AUTO_UPDATE: '1',
      STARTUP_CMD: 'java -jar server.jar'
    }
  }
};

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
  const startupFile = options.startupFile || options.mainFile || options.main_file;
  const startupCommand = options.startupCommand;

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

async function resolvePteroUser(user) {
  if (!appApi || !user) return null;

  const currentId = Number(user.pteroId);
  if (currentId > 0) {
    try {
      const response = await appApi.get(`/users/${currentId}`);
      if (response?.data?.attributes?.id) {
        return currentId;
      }
    } catch (err) {
      // continue
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

function sanitizeServer(server) {
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
}

/**
 * Create a server from a package configuration
 * @param {Object} user - The user object
 * @param {String} packageId - The package ID
 * @param {String} serverName - Optional custom server name
 * @returns {Promise<Object>} Created server data
 */
async function createServerFromPackage(user, packageId, serverName, options = {}) {
  if (!appApi) {
    throw new Error('Pterodactyl API is not configured.');
  }

  if (!packageId) {
    throw new Error('Package ID is required.');
  }

  const pkg = await ServerPackage.findById(packageId);
  if (!pkg) {
    throw new Error('Package not found.');
  }

  if (!pkg.serverConfig || !pkg.serverConfig.eggId) {
    throw new Error('Package does not have valid server configuration.');
  }

  const pteroUserId = await resolvePteroUser(user);
  if (!pteroUserId) {
    throw new Error('Your Pterodactyl account is not linked yet. Please register or log in again.');
  }

  const locationId = await getFirstValidLocation();
  if (!locationId) {
    throw new Error('No valid locations available.');
  }

  const allocationId = await getFirstAvailableAllocation();
  const requestedEggValue = options?.eggId ?? options?.egg ?? pkg.serverConfig?.eggId;
  const eggLookup = String(requestedEggValue || '').trim().toLowerCase();
  const aliasMap = { nodejs: '16', node: '16', python: '27', java: '28' };
  const normalizedLookup = aliasMap[eggLookup] || eggLookup;

  let resolvedEggConfig = eggConfigs[Number(normalizedLookup)] || eggConfigs[normalizedLookup];

  if (!resolvedEggConfig) {
    try {
      const eggsList = await fetchPanelEggOptions();
      resolvedEggConfig = eggsList.find((egg) => {
        const eggId = Number(egg.id);
        return eggId === Number(normalizedLookup) ||
          String(egg.name).toLowerCase() === eggLookup ||
          String(egg.key).toLowerCase() === eggLookup ||
          String(egg.id) === normalizedLookup;
      }) || null;

      if (!resolvedEggConfig) {
        resolvedEggConfig = eggsList.find((egg) => Number(egg.id) === Number(pkg.serverConfig?.eggId)) || null;
      }

      if (!resolvedEggConfig && eggsList.length === 1) {
        resolvedEggConfig = eggsList[0];
      }

      if (!resolvedEggConfig) {
        throw new Error('Egg configuration not found.');
      }
    } catch (err) {
      throw new Error('Failed to fetch egg configuration.');
    }
  }

  const name = serverName || pkg.name + '-' + Date.now();
  const memory = pkg.specifications.ram;
  const disk = pkg.specifications.disk * 1024; // Convert GB to MB
  const cpu = pkg.specifications.cpu * 100; // Convert cores to percentage

  const safeEnvironment = buildServerEnvironment(resolvedEggConfig, {
    startupFile: options.startupFile || pkg.serverConfig.startupFile,
    startupCommand: options.startupCommand || pkg.serverConfig.startupCommand,
    environment: options.environment
  });

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
      cpu: Number(cpu) || 100,
      oom_disabled: false
    },
    feature_limits: {
      databases: pkg.specifications.databases || 0,
      backups: pkg.specifications.backups || 1,
      allocations: 1
    },
    deploy: {
      locations: [locationId],
      dedicated_ip: false,
      port_range: []
    },
    start_on_completion: true
  };

  if (options.dockerImage || resolvedEggConfig.docker_image) {
    basePayload.docker_image = options.dockerImage || resolvedEggConfig.docker_image;
  }
  if (options.startupCommand || resolvedEggConfig.startup) {
    basePayload.startup = options.startupCommand || resolvedEggConfig.startup;
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
      cpu: Number(cpu) || 100,
      oom_disabled: false
    },
    feature_limits: {
      databases: pkg.specifications.databases || 0,
      backups: pkg.specifications.backups || 1,
      allocations: 1
    },
    start_on_completion: true
  };
  if (options.dockerImage || resolvedEggConfig.docker_image) {
    minimalPayload.docker_image = options.dockerImage || resolvedEggConfig.docker_image;
  }
  if (options.startupCommand || resolvedEggConfig.startup) {
    minimalPayload.startup = options.startupCommand || resolvedEggConfig.startup;
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
    const status = lastError?.response?.status;
    const detail = lastError?.response?.data?.errors?.[0]?.detail || lastError?.response?.data?.message || lastError?.message;
    throw new Error(detail || 'Pterodactyl rejected the server payload.');
  }

  return {
    success: true,
    server: sanitizeServer(response.data),
    packageId: packageId
  };
}

module.exports = {
  createServerFromPackage,
  resolvePteroUser,
  getFirstValidLocation,
  getFirstAvailableAllocation,
  fetchPanelEggOptions,
  buildServerEnvironment,
  sanitizeServer
};
