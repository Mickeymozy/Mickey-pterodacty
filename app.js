const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const servers = [
  { id: 1, name: 'Galaxy Nexus', plan: 'Dedicated-8', location: 'Frankfurt', status: 'Online', cpu: '8 vCore', ram: '32 GB', disk: '1 TB NVMe', uptime: '99.98%', traffic: '240 GB', next_backup: '06:30 UTC', badge: 'bg-emerald-500/10 text-emerald-300' },
  { id: 2, name: 'Megalodon', plan: 'Game-4', location: 'Singapore', status: 'Scaling', cpu: '4 vCore', ram: '8 GB', disk: '160 GB SSD', uptime: '99.94%', traffic: '92 GB', next_backup: '09:15 UTC', badge: 'bg-amber-500/10 text-amber-200' },
  { id: 3, name: 'Aegis Panel', plan: 'Panel Pro', location: 'New York', status: 'Maintenance', cpu: '2 vCore', ram: '4 GB', disk: '80 GB SSD', uptime: '99.80%', traffic: '18 GB', next_backup: '13:00 UTC', badge: 'bg-sky-500/10 text-sky-200' }
];

const invoices = [
  { id: 'INV-2048', amount: '$42.00', status: 'Paid', due: '2026-06-19', type: 'Monthly hosting' },
  { id: 'INV-2047', amount: '$18.50', status: 'Pending', due: '2026-06-12', type: 'Backup add-on' },
  { id: 'INV-2046', amount: '$120.00', status: 'Overdue', due: '2026-05-28', type: 'Dedicated burst' }
];

const tickets = [
  { id: '#T-201', subject: 'Auto-scaling not triggering', priority: 'High', status: 'In Progress', updated: '12 min ago' },
  { id: '#T-198', subject: 'Reset panel admin password', priority: 'Medium', status: 'Open', updated: '1 hr ago' },
  { id: '#T-194', subject: 'Billing invoice PDF request', priority: 'Low', status: 'Resolved', updated: 'Yesterday' }
];

const dashboardMetrics = {
  revenue: '$24,910',
  activeServers: 9,
  pendingTickets: 4,
  uptime: '99.97%'
};

app.get('/', (req, res) => {
  res.render('index', {
    title: 'Client Area Dashboard',
    page: 'dashboard',
    metrics: dashboardMetrics,
    servers,
    invoices,
    tickets
  });
});

app.get('/servers', (req, res) => {
  res.render('servers', { title: 'Server Fleet', page: 'servers', servers });
});

app.get('/billing', (req, res) => {
  res.render('billing', { title: 'Billing & Invoices', page: 'billing', invoices, metrics: dashboardMetrics });
});

app.get('/support', (req, res) => {
  res.render('support', { title: 'Support Center', page: 'support', tickets });
});

app.get('/settings', (req, res) => {
  res.render('settings', { title: 'Account Settings', page: 'settings' });
});

app.get('/api/dashboard-summary', (req, res) => {
  res.json({
    metrics: dashboardMetrics,
    servers,
    invoices,
    tickets
  });
});

app.post('/api/servers/:id/reboot', (req, res) => {
  const server = servers.find((item) => item.id === Number(req.params.id));

  if (!server) {
    return res.status(404).json({ success: false, message: 'Server not found.' });
  }

  if (server.status === 'Maintenance') {
    return res.status(409).json({ success: false, message: 'Server is under maintenance and cannot reboot.' });
  }

  return res.json({
    success: true,
    message: `${server.name} reboot command queued successfully.`,
    serverId: server.id,
    status: 'Queued'
  });
});

app.get('/health', (req, res) => {
  res.json({ ok: true, status: 'healthy', timestamp: new Date().toISOString() });
});

app.use((req, res) => {
  res.status(404).render('404', { title: 'Page not found' });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).render('500', { title: 'Server Error', message: err.message || 'Unexpected failure.' });
});

app.listen(PORT, () => {
  console.log(`Pterodactyl Client Area running on http://localhost:${PORT}`);
});
