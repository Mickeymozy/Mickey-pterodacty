/**
 * Payment & Checkout Routes
 */

const express = require('express');
const router = express.Router();
const zenoPayService = require('../services/zenoPayService');
const ServerPackage = require('../models/ServerPackage');
const Transaction = require('../models/Transaction');
const User = require('../models/User');

const authenticate = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  next();
};

/**
 * Initialize payment for a package purchase
 */
router.post('/checkout', authenticate, async (req, res) => {
  try {
    const { packageId, paymentMethod } = req.body;
    const userId = req.user._id;

    if (!packageId) {
      return res.status(400).json({ success: false, message: 'Package ID required' });
    }

    const pkg = await ServerPackage.findById(packageId);
    if (!pkg || !pkg.isActive) {
      return res.status(404).json({ success: false, message: 'Package not found or inactive' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const coinsCost = pkg.pricing.coinsCost;
    const usdCost = pkg.pricing.usdCost;

    const transaction = new Transaction({
      userId,
      type: 'purchase',
      amount: coinsCost,
      currency: 'coins',
      packageId,
      paymentMethod: paymentMethod || 'zenopay',
      status: 'pending',
      description: `Purchase of ${pkg.name} package`
    });

    await transaction.save();

    const paymentData = {
      amount: Math.ceil(usdCost * 100),
      currency: 'USD',
      reference: transaction._id.toString(),
      description: `${pkg.name} Package - ${user.email}`,
      customerEmail: user.email,
      customerName: user.username,
      coinsAmount: coinsCost,
      metadata: {
        transactionId: transaction._id.toString(),
        packageId: packageId,
        userId: userId.toString()
      }
    };

    const paymentResult = await zenoPayService.createPayment(paymentData);

    if (paymentResult.success) {
      transaction.zenopayTransactionId = paymentResult.transactionId;
      transaction.zenopayReference = paymentResult.reference;
      await transaction.save();

      res.json({
        success: true,
        message: 'Payment initialized',
        data: {
          paymentUrl: paymentResult.paymentUrl,
          transactionId: transaction._id,
          package: {
            name: pkg.name,
            coins: coinsCost,
            usd: usdCost
          }
        }
      });
    } else {
      transaction.status = 'failed';
      transaction.notes = paymentResult.error;
      await transaction.save();

      res.status(400).json({
        success: false,
        message: paymentResult.error
      });
    }
  } catch (error) {
    console.error('Checkout Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Verify payment and credit user with coins
 */
router.get('/verify/:transactionId', authenticate, async (req, res) => {
  try {
    const { transactionId } = req.params;

    const transaction = await Transaction.findById(transactionId)
      .populate('packageId', 'name pricing billingCycle');

    if (!transaction) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    const verificationResult = await zenoPayService.verifyPayment(
      transaction.zenopayTransactionId
    );

    if (verificationResult.success) {
      if (verificationResult.paymentStatus === 'completed') {
        const user = await User.findById(transaction.userId);
        if (user) {
          const coinsToAdd = transaction.packageId.pricing.coinsCost;
          user.coins = (user.coins || 0) + coinsToAdd;

          if (!user.servers) user.servers = [];
          const { calculateExpirationDate } = require('../utils/paymentHelper');
          user.servers.push({
            packageId: transaction.packageId._id,
            purchasedAt: new Date(),
            expiresAt: calculateExpirationDate(transaction.packageId.billingCycle)
          });

          await user.save();

          transaction.status = 'completed';
          transaction.completedAt = new Date();
          await transaction.save();

          res.json({
            success: true,
            message: 'Payment verified and coins credited',
            data: {
              transactionId,
              coinsAdded: coinsToAdd,
              userCoins: user.coins,
              package: transaction.packageId.name
            }
          });
        } else {
          res.status(404).json({ success: false, message: 'User not found' });
        }
      } else if (verificationResult.paymentStatus === 'pending') {
        res.json({
          success: true,
          message: 'Payment is still pending',
          data: { status: 'pending', transactionId }
        });
      } else {
        transaction.status = 'failed';
        await transaction.save();

        res.status(400).json({
          success: false,
          message: `Payment verification failed: ${verificationResult.paymentStatus}`
        });
      }
    } else {
      res.status(400).json({
        success: false,
        message: verificationResult.error
      });
    }
  } catch (error) {
    console.error('Verify Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Webhook endpoint for ZenoPay callbacks
 */
router.post('/webhook', async (req, res) => {
  try {
    const { signature } = req.headers;

    if (!signature) {
      return res.status(400).json({ success: false, message: 'Missing signature' });
    }

    const transaction = await Transaction.findById(req.body.reference);
    if (!transaction) {
      console.warn(`Transaction ${req.body.reference} not found`);
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    if (req.body.status === 'completed') {
      const user = await User.findById(transaction.userId);
      if (user) {
        const coinsToAdd = transaction.amount;
        user.coins = (user.coins || 0) + coinsToAdd;
        await user.save();
      }

      transaction.status = 'completed';
      transaction.completedAt = new Date();
    } else if (req.body.status === 'failed') {
      transaction.status = 'failed';
    }

    await transaction.save();

    res.json({ success: true, message: 'Webhook processed' });
  } catch (error) {
    console.error('Webhook Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Get user transaction history
 */
router.get('/transactions', authenticate, async (req, res) => {
  try {
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const transactions = await Transaction.find({ userId })
      .populate('packageId', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Transaction.countDocuments({ userId });

    res.json({
      success: true,
      data: transactions,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Get payment methods
 */
router.get('/methods', (req, res) => {
  try {
    const methods = zenoPayService.getAvailablePaymentMethods();
    res.json({ success: true, data: methods });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
