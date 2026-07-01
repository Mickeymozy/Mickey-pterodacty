const express = require('express');
const router = express.Router();
const { requireAuth, isAdminUser } = require('../middleware/auth');
const { createServerFromPackage, resolvePteroUser, sanitizeServer, buildServerEnvironment, buildServerPayloads, tryCreateServer, getFirstValidLocation, getFirstAvailableAllocation, fetchPanelEggOptions, fetchEggDetails, resolveEggConfig } = require('../utils/serverHelper');
const { appApi, clientApi, hasPteroConfig, hasClientConfig, clientApiUsable, CLIENT_KEY_REQUIRED_MESSAGE, DEFAULT_SERVER_PASSWORD, normalizeServerStatus, PTERODACTYL_URL } = require('../utils/pteroClient');

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
    sftpHost: host || PTERODACTYL_URL || '',
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
        sftpHost: resolvedHost || PTERODACTYL_URL || '',
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
        sftpHost: resolvedHost || PTERODACTYL_URL || '',
        sftpUser: String(id)
      };
    }
  } catch (err) {
    // fall back to the application-level attributes if the client endpoint is unavailable
  }

  return extractConnectionDetails({});
}

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
    const resolvedPteroId = await resolvePteroUser(req.user);
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
    const { name, egg, cpu, memory, disk, startupFile, startupCommand, mainFile, main_file, environment, dockerImage } = req.body;
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

    const resolvedPteroId = await resolvePteroUser(req.user);
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
        cpu: safeCpu,
        oom_disabled: false
      },
      featureLimits: {
        databases: 0,
        backups: 1,
        allocations: 1
      },
      locationId,
      allocationId,
      dockerImage,
      startupCommand
    });

    const serverResponse = await tryCreateServer(payloads);

    res.json({
      success: true,
      message: 'Server created successfully.',
      server: sanitizeServer(serverResponse.data)
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

    const connectionDetails = await getServerConnectionDetails(ref);
    const panelUrl = PTERODACTYL_URL || '';

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
    const ref = await resolveServerRef(req.params.id);
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
    const resolvedId = await resolveServerId(req.params.id);
    const response = await appApi.delete(`/servers/${encodeURIComponent(resolvedId)}`);
    res.json({ success: true, data: response.data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || 'Failed to delete server.' });
  }
});

// Create server from package
router.post('/api/servers/from-package', requireAuth, async (req, res) => {
  try {
    const { packageId, serverName, eggId, dockerImage, startupFile, startupCommand } = req.body;
    
    if (!packageId) {
      return res.status(400).json({ success: false, error: 'Package ID is required.' });
    }
    
    const serverData = await createServerFromPackage(req.user, packageId, serverName, { eggId, dockerImage, startupFile, startupCommand });

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
