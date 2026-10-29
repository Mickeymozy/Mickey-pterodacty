async function fetchPaginatedApplicationData(api, endpoint, params = {}) {
  if (!api) throw new Error('Pterodactyl Application API is not configured.');

  const entries = [];
  const perPage = 100;

  for (let page = 1; page <= 100; page += 1) {
    const response = await api.get(endpoint, {
      params: { ...params, per_page: perPage, page }
    });
    const pageEntries = response.data?.data;
    if (!Array.isArray(pageEntries)) {
      throw new Error('Pterodactyl Application API returned an invalid response.');
    }

    entries.push(...pageEntries);
    const totalPages = Number(response.data?.meta?.pagination?.total_pages);
    if (Number.isFinite(totalPages) && totalPages > 0) {
      if (page >= totalPages) break;
    } else if (pageEntries.length < perPage) {
      break;
    }
  }

  return entries;
}

module.exports = { fetchPaginatedApplicationData };