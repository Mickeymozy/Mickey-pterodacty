const express = require('express');
const axios = require('axios');
const router = express.Router();
const User = require('../models/User');
const ServerPackage = require('../models/ServerPackage');
const Transaction = require('../models/Transaction');
const sendEmail = require('../utils/email');
const { requireAuth, requireAdmin } = require('../middleware/auth');

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
          email: attrs.email
        });
      }
    });

    if (users.length < perPage) break;
    page += 1;
  }

  return results;
}

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
