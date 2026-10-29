async function fetchPterodactylEggs(adminApi) {
  if (!adminApi) {
    throw new Error('Pterodactyl Admin API is not configured. Set PANEL_ADMIN_API_KEY to a root administrator Client API key.');
  }

  const entries = [];
  const included = [];
  const perPage = 100;

  for (let page = 1; page <= 100; page += 1) {
    const response = await adminApi.get('/eggs', {
      params: { per_page: perPage, page, include: 'variables' }
    });
    const pageEntries = response.data?.data;
    if (!Array.isArray(pageEntries)) {
      throw new Error('Pterodactyl Admin API returned an invalid eggs response.');
    }

    entries.push(...pageEntries);
    if (Array.isArray(response.data?.included)) included.push(...response.data.included);

    const totalPages = Number(response.data?.meta?.pagination?.total_pages);
    if (Number.isFinite(totalPages) && totalPages > 0) {
      if (page >= totalPages) break;
    } else if (pageEntries.length < perPage) {
      break;
    }
  }

  const includedById = new Map(included.map((item) => [`${item.type}:${item.id}`, item]));
  return entries.map((entry) => {
    const attrs = entry?.attributes || {};
    const id = Number(attrs.id ?? entry?.id);
    const relationships = entry?.relationships || attrs.relationships || {};
    const variableRefs = relationships.variables?.data || [];
    const environment = { ...(attrs.environment || {}) };

    for (const variableRef of variableRefs) {
      const variable = variableRef?.attributes || includedById.get(`${variableRef?.type}:${variableRef?.id}`)?.attributes || variableRef;
      if (variable?.env_variable && variable.default_value !== undefined && variable.default_value !== null) {
        environment[variable.env_variable] = String(variable.default_value);
      }
    }

    return {
      id,
      name: attrs.name || `Egg ${id}`,
      nestId: attrs.nest_id ?? attrs.nestId ?? attrs.nest?.id ?? null,
      nestName: attrs.nest_name || attrs.nest?.name || '',
      docker_image: attrs.docker_image || attrs.dockerImage || '',
      startup: attrs.startup || '',
      startup_command: attrs.startup_command || environment.STARTUP_CMD || '',
      environment
    };
  }).filter((egg) => Number.isFinite(egg.id) && egg.id > 0);
}

module.exports = { fetchPterodactylEggs };
