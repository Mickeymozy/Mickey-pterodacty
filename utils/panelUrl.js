function normalizePanelBaseUrl(value) {
  return String(value || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/api(?:\/(?:application|client|admin))?$/i, '')
    .replace(/\/+$/, '');
}

module.exports = { normalizePanelBaseUrl };
