const User = require('../models/User');
const { getPanelProvider } = require('../utils/panelProvider');

async function suspendExpiredServers() {
  const now = new Date();
  const users = await User.find({ 'servers.expiresAt': { $lte: now }, 'servers.serverId': { $exists: true } });
  let suspended = 0;

  for (const user of users) {
    let changed = false;
    for (const server of user.servers || []) {
      if (!server.serverId || server.suspendedAt || !server.expiresAt || server.expiresAt > now) continue;
      try {
        await getPanelProvider().suspendServer(server.serverId);
        server.suspendedAt = now;
        changed = true;
        suspended += 1;
      } catch (error) {
        console.error(`Failed to suspend expired server ${server.serverId}:`, error.message);
      }
    }
    if (changed) await user.save();
  }

  return suspended;
}

function startBillingAutomation() {
  if (process.env.BILLING_AUTOMATION_ENABLED === 'false') return null;
  const intervalMs = Math.max(60_000, Number(process.env.BILLING_AUTOMATION_INTERVAL_MS || 900_000));
  const timer = setInterval(() => suspendExpiredServers().catch((error) => console.error('Billing automation failed:', error.message)), intervalMs);
  timer.unref?.();
  suspendExpiredServers().catch((error) => console.error('Initial billing automation failed:', error.message));
  return timer;
}

module.exports = { suspendExpiredServers, startBillingAutomation };
