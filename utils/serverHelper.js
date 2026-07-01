/**
 * Server Creation Helper - Shared logic for creating servers from packages
 */

const ServerPackage = require('../models/ServerPackage');
const {
  appApi,
  eggConfigs,
  EGG_ALIAS_MAP,
  normalizeServerStatus
} = require('./pteroClient');

function normalizeEnvironmentValue(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  return String(value);
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

  const requestedEnvironment = {};
  Object.entries(baseEnvironment).forEach(([key, value]) => {
    const normalizedValue = normalizeEnvironmentValue(value);
    if (normalizedValue !== undefined) {
      requestedEnvironment[key] = normalizedValue;
    }
  });

  const providedEnvironment = options.environment || {};
  Object.entries(providedEnvironment).forEach(([key, value]) => {
    const normalizedValue = normalizeEnvironmentValue(value);
    if (normalizedValue !== undefined) {
      requestedEnvironment[key] = normalizedValue;
    }
  });

  const eggId = Number(resolvedEggConfig.id);
  const startupFile = normalizeEnvironmentValue(options.startupFile || options.mainFile || options.main_file);
  const startupCommand = normalizeEnvironmentValue(options.startupCommand);

  if (startupFile) {
    if (eggId === 16) {
      requestedEnvironment.MAIN_FILE = startupFile;
    } else if (eggId === 27) {
      requestedEnvironment.PY_FILE = startupFile;
    } else if (eggId === 28) {
      requestedEnvironment.SERVER_JARFILE = startupFile;
      requestedEnvironment.JARFILE = startupFile;
    } else if (!requestedEnvironment.MAIN_FILE && !requestedEnvironment.PY_FILE && !requestedEnvironment.SERVER_JARFILE && !requestedEnvironment.JARFILE) {
      requestedEnvironment.MAIN_FILE = startupFile;
    }
  } else if (eggId === 16 && !requestedEnvironment.MAIN_FILE) {
    requestedEnvironment.MAIN_FILE = 'index.js';
  } else if (eggId === 27 && !requestedEnvironment.PY_FILE) {
    requestedEnvironment.PY_FILE = 'main.py';
  } else if (eggId === 28 && !requestedEnvironment.SERVER_JARFILE && !requestedEnvironment.JARFILE) {
    requestedEnvironment.SERVER_JARFILE = 'server.jar';
    requestedEnvironment.JARFILE = 'server.jar';
  }

  if (startupCommand) {
    requestedEnvironment.STARTUP_CMD = startupCommand;
  } else if (eggId === 16 && !requestedEnvironment.STARTUP_CMD) {
    requestedEnvironment.STARTUP_CMD = 'npm start';
  } else if (eggId === 27 && !requestedEnvironment.STARTUP_CMD) {
    requestedEnvironment.STARTUP_CMD = 'python3 main.py';
  } else if (eggId === 28 && !requestedEnvironment.STARTUP_CMD) {
    requestedEnvironment.STARTUP_CMD = 'java -jar server.jar';
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
  const normalized = EGG_ALIAS_MAP[lookup] || lookup;
  const numericValue = Number(normalized);
  const configKey = Number.isFinite(numericValue) ? numericValue : normalized;

  if (eggConfigs[configKey]) {
    return eggConfigs[configKey];
  }

  const panelEggOptions = await fetchPanelEggOptions();
  return panelEggOptions.find((egg) => Number(egg.id) === Number(configKey)) || null;
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

function sanitizeServer(server, resourceAttrs = {}, user = null, connectionDetails = null) {
  const attrs = server?.attributes || {};
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
    ipAddress: connectionDetails?.ipAddress || '',
    port: connectionDetails?.port || '',
    sftpHost: connectionDetails?.sftpHost || '',
    sftpUser: user?.username || user?.displayName || connectionDetails?.sftpUser || ''
  };
}

/**
 * Build an array of server creation payloads to try in order (with fallbacks).
 */
function buildServerPayloads({ name, pteroUserId, eggConfig, environment, limits, featureLimits, locationId, allocationId, dockerImage, startupCommand }) {
  const basePayload = {
    name,
    user: pteroUserId,
    egg: Number(eggConfig.id),
    environment,
    limits,
    feature_limits: featureLimits,
    deploy: {
      locations: [locationId],
      dedicated_ip: false,
      port_range: []
    },
    start_on_completion: true
  };

  if (dockerImage || eggConfig.docker_image) {
    basePayload.docker_image = dockerImage || eggConfig.docker_image;
  }
  if (startupCommand || eggConfig.startup) {
    basePayload.startup = startupCommand || eggConfig.startup;
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
    egg: Number(eggConfig.id),
    environment,
    limits,
    feature_limits: featureLimits,
    start_on_completion: true
  };
  if (dockerImage || eggConfig.docker_image) {
    minimalPayload.docker_image = dockerImage || eggConfig.docker_image;
  }
  if (startupCommand || eggConfig.startup) {
    minimalPayload.startup = startupCommand || eggConfig.startup;
  }
  if (allocationId) {
    minimalPayload.allocation = { default: allocationId };
  }
  payloads.push(minimalPayload);

  return payloads;
}

/**
 * Try creating a server on the panel using multiple payload variants.
 * Returns the API response or throws the last error.
 */
async function tryCreateServer(payloads) {
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

  return response;
}

/**
 * Create a server from a package configuration
 * @param {Object} user - The user object
 * @param {String} packageId - The package ID
 * @param {String} serverName - Optional custom server name
 * @param {Object} options - Optional overrides (eggId, dockerImage, startupFile, startupCommand, environment)
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
  const resolvedEggConfig = await resolveEggConfig(requestedEggValue);

  if (!resolvedEggConfig) {
    throw new Error('Egg configuration not found.');
  }

  const name = serverName || pkg.name + '-' + Date.now();
  const memory = pkg.specifications.ram;
  const disk = pkg.specifications.disk * 1024;
  const cpu = pkg.specifications.cpu * 100;

  const safeEnvironment = buildServerEnvironment(resolvedEggConfig, {
    startupFile: options.startupFile || pkg.serverConfig.startupFile,
    startupCommand: options.startupCommand || pkg.serverConfig.startupCommand,
    environment: options.environment
  });

  const payloads = buildServerPayloads({
    name,
    pteroUserId,
    eggConfig: resolvedEggConfig,
    environment: safeEnvironment,
    limits: {
      memory: Number(memory) || 1024,
      swap: 0,
      disk: Number(disk) || 2048,
      io: 500,
      cpu: Number(cpu) || 100,
      oom_disabled: false
    },
    featureLimits: {
      databases: pkg.specifications.databases || 0,
      backups: pkg.specifications.backups || 1,
      allocations: 1
    },
    locationId,
    allocationId,
    dockerImage: options.dockerImage,
    startupCommand: options.startupCommand
  });

  const response = await tryCreateServer(payloads);

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
  fetchEggDetails,
  resolveEggConfig,
  buildServerEnvironment,
  buildServerPayloads,
  tryCreateServer,
  sanitizeServer,
  getDefaultStartupFile,
  getDefaultStartupCommand
};
