function normalizePanelBaseUrl(value) {
  return String(value || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/api(?:\/(?:application|client))?$/i, '')
    .replace(/\/+$/, '');
}

module.exports = { normalizePanelBaseUrl };
