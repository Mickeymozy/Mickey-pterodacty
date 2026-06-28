const express = require('express');
const router = express.Router();
const User = require('../models/User');
const ServerPackage = require('../models/ServerPackage');
const Transaction = require('../models/Transaction');
const { requireAuth, requireAdmin } = require('../middleware/auth');

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

    // Revenue from completed transactions
    const revenueData = await Transaction.aggregate([
      { $match: { status: 'completed', currency: 'USD' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    res.json({
      success: true,
      data: {
        totalUsers,
        totalAdmins,
        totalCoinsDistributed: totalCoinsDistributed[0]?.total || 0,
        totalTransactions,
        totalPackages,
        activePackages,
        totalRevenue: revenueData[0]?.total || 0
      }
    });
  } catch (error) {
    console.error('Error fetching admin stats:', error);
    res.status(500).json({ success: false, message: 'Error fetching stats' });
  }
});

module.exports = router;
