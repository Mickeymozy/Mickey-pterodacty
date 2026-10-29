/**
 * Server Creation Helper - Shared logic for creating servers from packages
 */

const axios = require('axios');
const ServerPackage = require('../models/ServerPackage');
const sendEmail = require('./email');

const PTERODACTYL_URL = (process.env.PANEL_URL || process.env.PTERODACTYL_URL)?.replace(/\/$/, '');
const PTERODACTYL_APP_API_KEY = process.env.PANEL_API_KEY || process.env.PTERODACTYL_APP_API_KEY;

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

function normalizeEnvironmentValue(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  return String(value);
}

/**
 * Validate a git repository URL
 * @param {String} url - The URL to validate
 * @returns {Boolean} True if valid git URL
 */
function isValidGitUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  // Match https/http git URLs and git@ SSH URLs
  const gitUrlPattern = /^(https?:\/\/[^\s]+\.git|git@[^\s]+:[^\s]+\.git|https?:\/\/[^\s]*github\.com\/[^\s]+\/[^\s]+|https?:\/\/[^\s]*gitlab\.com\/[^\s]+\/[^\s]+|https?:\/\/[^\s]*bitbucket\.org\/[^\s]+\/[^\s]+)(\/)?$/i;
  return gitUrlPattern.test(trimmed);
}

function buildStartupCommand(startupCommand, repoUrl) {
  const command = normalizeEnvironmentValue(startupCommand) || '';
  const repository = normalizeEnvironmentValue(repoUrl);
  if (!repository) return command;

  return `set -e
echo "[BOT_REPO] Starting repo initialization..."
if [ -z "$BOT_REPO_URL" ]; then
  echo "[BOT_REPO] ERROR: BOT_REPO_URL is not set"
  exit 1
elif [ -d "/home/container/.git" ]; then
  cd /home/container
  git pull --depth=1 origin main 2>&1 || git pull --depth=1 origin master 2>&1
else
  rm -rf /tmp/mickey-bot-repo
  git clone --depth=1 "$BOT_REPO_URL" /tmp/mickey-bot-repo 2>&1
  cp -a /tmp/mickey-bot-repo/. /home/container/
  rm -rf /tmp/mickey-bot-repo
fi
echo "[BOT_REPO] Initialization complete"
cd /home/container
${command}`.trim();
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

  const botRepoUrl = normalizeEnvironmentValue(options.botRepoUrl || options.repoUrl || process.env.BOT_REPO_URL);
  if (botRepoUrl) {
    // Validate git URL format
    if (!isValidGitUrl(botRepoUrl)) {
      console.warn('Warning: botRepoUrl format may be invalid:', botRepoUrl);
    }
    requestedEnvironment.BOT_REPO_URL = botRepoUrl;
    requestedEnvironment.BOT_REPO_DIR = '/home/container';
    requestedEnvironment.AUTO_UPDATE = '1';
  }

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

async function fetchPaginatedApplicationData(path) {
  const entries = [];

  for (let page = 1; page <= 100; page += 1) {
    const response = await appApi.get(path, { params: { per_page: 100, page } });
    const pageEntries = response.data?.data;
    if (!Array.isArray(pageEntries)) {
      throw new Error(`Pterodactyl returned an invalid response for ${path}.`);
    }
    entries.push(...pageEntries);

    const totalPages = Number(response.data?.meta?.pagination?.total_pages);
    if (Number.isFinite(totalPages) && totalPages > 0) {
      if (page >= totalPages) break;
    } else if (pageEntries.length < 100) {
      break;
    }
  }

  return entries;
}

async function fetchPanelEggOptions() {
  if (!appApi) return [];

  const nests = await fetchPaginatedApplicationData('/nests');
  const eggs = [];

  for (const nest of nests) {
    const nestId = nest?.attributes?.id;
    if (!nestId) continue;

    const eggEntries = await fetchPaginatedApplicationData(`/nests/${nestId}/eggs`);

    for (const entry of eggEntries) {
      const attrs = entry?.attributes || {};
      eggs.push({
        id: Number(attrs.id),
        name: attrs.name || `Egg ${attrs.id}`,
        nestName: nest?.attributes?.name || `Nest ${nestId}`,
        docker_image: attrs.docker_image || '',
        startup: attrs.startup || '',
        startup_command: attrs.environment?.STARTUP_CMD || '',
        environment: attrs.environment || {},
        nestId
      });
    }
  }

  return eggs.filter((egg) => Number.isFinite(egg.id));
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

function buildPteroLimitsFromPackage(specifications = {}) {
  const cpuValue = Number(specifications?.cpu ?? specifications?.cores ?? 0);
  const ramValue = Number(specifications?.ram ?? specifications?.memory ?? 0);
  const diskValue = Number(specifications?.disk ?? specifications?.storage ?? 0);

  const cpu = Number.isFinite(cpuValue) && cpuValue >= 0
    ? cpuValue === 0 ? 0 : Math.round(cpuValue <= 10 ? cpuValue * 100 : cpuValue)
    : 100;

  const memory = Number.isFinite(ramValue) && ramValue >= 0
    ? Math.round(ramValue)
    : 1024;

  const disk = Number.isFinite(diskValue) && diskValue >= 0
    ? (diskValue === 0 ? 0 : diskValue >= 1024 ? Math.round(diskValue) : Math.round(diskValue * 1024))
    : 2048;

  return {
    memory: memory === 0 ? 0 : Math.max(256, memory),
    swap: 0,
    disk: disk === 0 ? 0 : Math.max(1024, disk),
    io: 500,
    cpu: cpu === 0 ? 0 : Math.max(25, cpu),
    oom_disabled: false
  };
}

async function deleteServer(serverId) {
  if (!appApi) {
    throw new Error('Pterodactyl API is not configured.');
  }

  try {
    await appApi.delete(`/servers/${serverId}`);
    return true;
  } catch (err) {
    console.error('Failed to delete server:', err?.response?.data || err.message || err);
    return false;
  }
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
  const eggLookup = String(requestedEggValue ?? '').trim().toLowerCase();
  const aliasMap = { nodejs: '16', node: '16', python: '27', java: '28' };
  const normalizedLookup = aliasMap[eggLookup] || eggLookup;

  const eggsList = await fetchPanelEggOptions();
  const resolvedEggConfig = eggsList.find((egg) =>
    Number(egg.id) === Number(normalizedLookup) ||
    String(egg.name).toLowerCase() === eggLookup ||
    String(egg.id) === normalizedLookup
  );
  if (!resolvedEggConfig) {
    throw new Error('Egg iliyochaguliwa haipo tena kwenye Pterodactyl. Refresh eggs kisha chagua tena.');
  }

  const name = serverName || pkg.name + '-' + Date.now();
  const limits = buildPteroLimitsFromPackage(pkg.specifications || {});

  const preferredStartupCommand = normalizeEnvironmentValue(options.startupCommand || pkg.serverConfig.startupCommand || resolvedEggConfig.startup || 'npm start');
  const preferredDockerImage = normalizeEnvironmentValue(options.dockerImage || pkg.serverConfig.dockerImage || resolvedEggConfig.docker_image || '');

  const safeEnvironment = buildServerEnvironment(resolvedEggConfig, {
    startupFile: options.startupFile || pkg.serverConfig.startupFile,
    startupCommand: preferredStartupCommand,
    environment: options.environment,
    botRepoUrl: options.botRepoUrl || options.repoUrl
  });

  const resolvedStartupCommand = preferredStartupCommand;
  const resolvedDockerImage = preferredDockerImage;
  const botRepoUrl = options.botRepoUrl || options.repoUrl;
  if (botRepoUrl && !isValidGitUrl(botRepoUrl)) {
    throw new Error('Invalid GitHub/Git repository URL. Use a public HTTPS .git URL.');
  }
  const botRepoStartup = buildStartupCommand(resolvedStartupCommand, botRepoUrl);

  const basePayload = {
    name,
    user: pteroUserId,
    egg: Number(resolvedEggConfig.id),
    environment: safeEnvironment,
    limits,
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
    start_on_completion: true,
    startup: botRepoStartup
  };

  if (resolvedDockerImage) {
    basePayload.docker_image = resolvedDockerImage;
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
    limits,
    feature_limits: {
      databases: pkg.specifications.databases || 0,
      backups: pkg.specifications.backups || 1,
      allocations: 1
    },
    start_on_completion: true,
    startup: botRepoStartup
  };
  if (resolvedDockerImage) {
    minimalPayload.docker_image = resolvedDockerImage;
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

  const createdAttributes = response?.data?.attributes || {};
  const accessDetails = {
    panelUrl: process.env.PTERODACTYL_URL || '',
    username: user?.username || user?.displayName || user?.email || '',
    email: user?.email || '',
    password: null,
    serverName: createdAttributes.name || name,
    serverId: createdAttributes.identifier || createdAttributes.uuid || createdAttributes.id || '',
    ipAddress: '',
    port: '',
    sftpHost: process.env.PTERODACTYL_URL || '',
    sftpUser: user?.username || user?.displayName || ''
  };

  if (options.sendEmail !== false && user?.email) {
    const emailBody = `
      <p>Server yako imeundwa kikamilifu.</p>
      <p><strong>Package:</strong> ${pkg.name}</p>
      <p><strong>Server:</strong> ${accessDetails.serverName}</p>
      <p><strong>Panel:</strong> ${accessDetails.panelUrl}</p>
      <p><strong>Username:</strong> ${accessDetails.username}</p>
      <p><strong>Email:</strong> ${accessDetails.email}</p>
      <p>Password ya panel haijatumwi kwa email. Tumia password yako ya Pterodactyl au reset kupitia panel.</p>
      <p>Unaweza kuingia kwenye dashboard yako kuona server yako na taarifa za ufikiaji.</p>
    `;

    await sendEmail({
      to: user.email,
      subject: 'Server created successfully',
      html: emailBody,
      text: `Server yako imeundwa. Jina: ${accessDetails.serverName}. Panel: ${accessDetails.panelUrl}. Password haijatumwa kwa email.`
    });
  }

  return {
    success: true,
    server: sanitizeServer(response.data),
    packageId: packageId,
    access: accessDetails
  };
}

module.exports = {
  createServerFromPackage,
  buildPteroLimitsFromPackage,
  resolvePteroUser,
  getFirstValidLocation,
  getFirstAvailableAllocation,
  fetchPanelEggOptions,
  buildServerEnvironment,
  buildStartupCommand,
  sanitizeServer,
  deleteServer,
  isValidGitUrl
};
