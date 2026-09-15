const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const router = express.Router();
const User = require('../models/User');
const ServerPackage = require('../models/ServerPackage');
const Transaction = require('../models/Transaction');
const sendEmail = require('../utils/email');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { writeAuditLog } = require('../utils/auditLog');
const AuditLog = require('../models/AuditLog');
const LoginActivity = require('../models/LoginActivity');

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

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function fetchPteroUsers() {
  if (!appApi) return [];
  const results = [];
  let page = 1;
  const perPage = 100;
  const maxPages = 20;

  while (page <= maxPages) {
    const response = await appApi.get(`/users?page=${page}&per_page=${perPage}`);
    const users = response.data?.data || [];
    if (!users.length) break;

    users.forEach((entry) => {
      const attrs = entry?.attributes || {};
      if (attrs.email && emailRegex.test(attrs.email)) {
        results.push({
          id: attrs.id,
          username: attrs.username,
          email: attrs.email,
          firstName: attrs.first_name || '',
          lastName: attrs.last_name || ''
        });
      }
    });

    if (users.length < perPage) break;
    page += 1;
  }

  return results;
}

function generateSyncPassword() {
  return `${crypto.randomBytes(18).toString('base64url')}Aa1!`;
}

router.post('/users/sync', requireAuth, requireAdmin, async (req, res) => {
  if (!appApi) return res.status(503).json({ success: false, message: 'Pterodactyl API is not configured.' });

  const summary = { panelUsers: 0, websiteUsers: 0, linked: 0, createdOnPanel: 0, createdOnWebsite: 0, errors: [] };
  try {
    const [panelUsers, websiteUsers] = await Promise.all([
      fetchPteroUsers(),
      User.find().select('+password username email firstName lastName displayName pteroId role isAdmin').lean()
    ]);
    summary.panelUsers = panelUsers.length;
    summary.websiteUsers = websiteUsers.length;

    const byId = new Map(websiteUsers.filter((user) => user.pteroId).map((user) => [String(user.pteroId), user]));
    const byEmail = new Map(websiteUsers.map((user) => [String(user.email || '').toLowerCase(), user]));
    const byUsername = new Map(websiteUsers.map((user) => [String(user.username || '').toLowerCase(), user]));
    const linkedWebsiteIds = new Set();

    for (const panelUser of panelUsers) {
      let local = byId.get(String(panelUser.id)) || byEmail.get(String(panelUser.email || '').toLowerCase()) || byUsername.get(String(panelUser.username || '').toLowerCase());
      if (local) {
        const update = {};
        if (Number(local.pteroId) !== Number(panelUser.id)) update.pteroId = Number(panelUser.id);
        if (!local.email && panelUser.email) update.email = panelUser.email.toLowerCase();
        if (Object.keys(update).length) await User.updateOne({ _id: local._id }, { $set: update });
        linkedWebsiteIds.add(String(local._id));
        summary.linked += 1;
        continue;
      }

      try {
        const email = String(panelUser.email || `${panelUser.username}@panel.local`).toLowerCase();
        const created = await new User({
          pteroId: Number(panelUser.id),
          username: String(panelUser.username || `paneluser${panelUser.id}`).toLowerCase(),
          email,
          password: generateSyncPassword(),
          firstName: panelUser.firstName || 'Panel',
          lastName: panelUser.lastName || 'User',
          displayName: panelUser.username || email,
          isEmailVerified: true
        }).save();
        linkedWebsiteIds.add(String(created._id));
        summary.createdOnWebsite += 1;
      } catch (error) {
        summary.errors.push(`Panel user ${panelUser.username || panelUser.id}: ${error.message}`);
      }
    }

    for (const local of websiteUsers) {
      if (local.pteroId || linkedWebsiteIds.has(String(local._id))) continue;
      const existingPanel = panelUsers.find((panelUser) => String(panelUser.email || '').toLowerCase() === String(local.email || '').toLowerCase() || String(panelUser.username || '').toLowerCase() === String(local.username || '').toLowerCase());
      if (existingPanel) {
        await User.updateOne({ _id: local._id }, { $set: { pteroId: Number(existingPanel.id) } });
        summary.linked += 1;
        continue;
      }

      try {
        const response = await appApi.post('/users', {
          username: local.username,
          email: local.email,
          first_name: local.firstName || local.displayName || local.username,
          last_name: local.lastName || 'User',
          password: generateSyncPassword(),
          language: 'en'
        });
        const attrs = response.data?.attributes || {};
        await User.updateOne({ _id: local._id }, { $set: { pteroId: Number(attrs.id) } });
        summary.createdOnPanel += 1;
      } catch (error) {
        summary.errors.push(`Website user ${local.username || local.email}: ${error.response?.data?.errors?.[0]?.detail || error.message}`);
      }
    }

    await writeAuditLog(req, 'users.synchronized', null, summary);
    res.json({ success: true, message: 'Users wa panel na website wamesync.', data: summary });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'User sync imeshindikana.', data: summary });
  }
});

// Get user profile and stats
router.get('/profile', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({
      success: true,
      data: {
        id: user._id,
        username: user.username,
        email: user.email,
        displayName: user.displayName,
        coins: user.coins,
        isAdmin: user.isAdmin,
        role: user.role,
        servers: user.servers || [],
        isEmailVerified: user.isEmailVerified,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({ success: false, message: 'Error fetching profile' });
  }
});

router.get('/security/activity', requireAuth, async (req, res) => {
  const activity = await LoginActivity.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(20).lean();
  res.json({ success: true, data: activity });
});

// Admin: Get all users
router.get('/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const users = await User.find().select('-password').limit(100);
    res.json({ success: true, data: users });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching users' });
  }
});

router.get('/users/admin/all', requireAuth, requireAdmin, async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 }).limit(200);
    res.json({ success: true, data: users });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching users' });
  }
});

router.get('/users/pterodactyl', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!appApi) {
      return res.json({ success: true, data: [] });
    }
    const users = await fetchPteroUsers();
    res.json({ success: true, data: users });
  } catch (error) {
    console.error('Error fetching Pterodactyl users:', error.message || error);
    res.status(500).json({ success: false, message: 'Error fetching Pterodactyl users' });
  }
});

// Admin: Get user by ID
router.get('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching user' });
  }
});

// Admin: Update user coins (IMEREKEBISHWA)
router.put('/users/:id/coins', requireAuth, requireAdmin, async (req, res) => {
  try {
    let { amount, reason } = req.body;
    
    // Hakikisha amount ipo na ni namba halali
    amount = Number(amount);
    if (isNaN(amount) || amount === 0) {
      return res.status(400).json({ success: false, message: 'Weka kiasi halali cha coins (Kisio kisichokuwa 0)' });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Kuzuia coins zisiende kuwa hasi (Negative)
    if (user.coins + amount < 0) {
      return res.status(400).json({ 
        success: false, 
        message: `Huwezi kupunguza coins kufikia hasi. Salio la sasa ni coins ${user.coins}` 
      });
    }

    const oldCoins = user.coins;
    user.coins += amount;
    await user.save();

    // Log transaction
    const transaction = new Transaction({
      userId: user._id,
      type: 'admin_adjustment',
      amount: Math.abs(amount),
      currency: 'coins',
      status: 'completed',
      paymentMethod: 'admin',
      description: reason || 'Admin adjustment',
      processedBy: req.user._id,
      completedAt: new Date()
    });
    await transaction.save();
    await writeAuditLog(req, 'user.coins_adjusted', { type: 'User', id: user._id }, {
      amount,
      oldCoins,
      newCoins: user.coins,
      reason: reason || 'Admin adjustment'
    });

    res.json({
      success: true,
      message: `Coins updated: ${oldCoins} → ${user.coins}`,
      data: { coins: user.coins }
    });
  } catch (error) {
    console.error('Error updating coins:', error);
    res.status(500).json({ success: false, message: 'Error updating coins' });
  }
});

router.get('/admin/audit-logs', requireAuth, requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const logs = await AuditLog.find()
      .populate('actor', 'username email')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    res.json({ success: true, data: logs });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching audit logs' });
  }
});

// Admin: Send email using configured SMTP
router.post('/admin/send-email', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { to, subject, message, allUsers, pteroAllUsers, bcc } = req.body;
    if (!subject || !message) {
      return res.status(400).json({ success: false, message: 'Subject and message are required.' });
    }

    const recipients = [];
    const normalizeList = (value) => {
      return String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    };

    if (allUsers) {
      const all = await User.find({ email: { $exists: true, $ne: '' } }).select('email');
      all.forEach((user) => {
        if (user.email && emailRegex.test(user.email)) {
          recipients.push(user.email);
        }
      });
    }

    if (pteroAllUsers) {
      if (!appApi) {
        return res.status(503).json({ success: false, message: 'Pterodactyl API is not configured.' });
      }
      const panelUsers = await fetchPteroUsers();
      panelUsers.forEach((user) => {
        if (user.email && emailRegex.test(user.email)) {
          recipients.push(user.email);
        }
      });
    }

    const toList = normalizeList(to);
    const bccList = normalizeList(bcc);

    for (const email of toList) {
      if (!emailRegex.test(email)) {
        return res.status(400).json({ success: false, message: `Invalid recipient email: ${email}` });
      }
      recipients.push(email);
    }

    if (!recipients.length) {
      return res.status(400).json({ success: false, message: 'No recipient email address was provided.' });
    }

    const sendOptions = {
      to: Array.from(new Set(recipients)).join(', '),
      subject,
      html: `<div>${String(message).replace(/\n/g, '<br/>')}</div>`,
      text: String(message)
    };

    if (bccList.length) {
      const invalidBcc = bccList.find((email) => !emailRegex.test(email));
      if (invalidBcc) {
        return res.status(400).json({ success: false, message: `Invalid BCC email: ${invalidBcc}` });
      }
      sendOptions.bcc = Array.from(new Set(bccList)).join(', ');
    }

    const sent = await sendEmail(sendOptions);
    if (!sent) {
      return res.status(500).json({ success: false, message: 'Email could not be sent. Check SMTP configuration.' });
    }

    res.json({ success: true, message: 'Email sent successfully.' });
  } catch (error) {
    console.error('Error sending admin email:', error);
    res.status(500).json({ success: false, message: 'Error sending email' });
  }
});

// Admin: Delete user
router.delete('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.json({ success: true, message: 'User deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error deleting user' });
  }
});

// Admin: Dashboard statistics
router.get('/admin/stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalAdmins = await User.countDocuments({ $or: [{ role: 'admin' }, { isAdmin: true }] });
    const totalCoinsDistributed = await User.aggregate([{ $group: { _id: null, total: { $sum: '$coins' } } }]);
    const totalTransactions = await Transaction.countDocuments();
    const totalPackages = await ServerPackage.countDocuments();
    const activePackages = await ServerPackage.countDocuments({ isActive: true });

    const coinRateTzs = Number(process.env.COIN_TOPUP_RATE_TZS || 250);
    const now = new Date();
    const monthAgo = new Date(now);
    monthAgo.setDate(monthAgo.getDate() - 30);

    const revenueData = await Transaction.aggregate([
      { $match: { status: 'completed' } },
      {
        $group: {
          _id: null,
          totalUsd: { $sum: { $cond: [{ $eq: ['$currency', 'USD'] }, '$amount', 0] } },
          totalCoins: { $sum: { $cond: [{ $eq: ['$currency', 'coins'] }, '$amount', 0] } }
        }
      }
    ]);

    const monthlyRevenueData = await Transaction.aggregate([
      { $match: { status: 'completed', createdAt: { $gte: monthAgo } } },
      {
        $group: {
          _id: null,
          totalUsd: { $sum: { $cond: [{ $eq: ['$currency', 'USD'] }, '$amount', 0] } },
          totalCoins: { $sum: { $cond: [{ $eq: ['$currency', 'coins'] }, '$amount', 0] } }
        }
      }
    ]);

    const totalCoins = revenueData[0]?.totalCoins || 0;
    const totalUsd = revenueData[0]?.totalUsd || 0;
    const totalRevenueFromCoinsTzs = totalCoins * coinRateTzs;
    const monthlyCoins = monthlyRevenueData[0]?.totalCoins || 0;
    const monthlyUsd = monthlyRevenueData[0]?.totalUsd || 0;
    const monthlyRevenueTzs = monthlyCoins * coinRateTzs;

    res.json({
      success: true,
      data: {
        totalUsers,
        totalAdmins,
        totalCoinsDistributed: totalCoinsDistributed[0]?.total || 0,
        totalTransactions,
        totalPackages,
        activePackages,
        totalRevenueUsd: totalUsd,
        totalRevenueFromCoinsTzs,
        monthlyRevenueUsd: monthlyUsd,
        monthlyRevenueTzs,
        smtpConfigured: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)
      }
    });
  } catch (error) {
    console.error('Error fetching admin stats:', error);
    res.status(500).json({ success: false, message: 'Error fetching stats' });
  }
});

module.exports = router;
