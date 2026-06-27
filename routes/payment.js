/**
 * Payment & Checkout Routes
 */

const express = require('express');
const router = express.Router();
const sonicPesaService = require('../services/sonicPesaService');
const ServerPackage = require('../models/ServerPackage');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const { createServerFromPackage } = require('../utils/serverHelper');
const sendEmail = require('../utils/email');
const { requireAdmin } = require('../middleware/auth');

const authenticate = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  next();
};

async function notifyUserAboutPayment(user, transaction, packageDoc, serverData) {
  if (!user?.email) return;

  const serverName = serverData?.server?.name || serverData?.server?.identifier || 'server';
  const panelUrl = process.env.PTERODACTYL_URL || 'N/A';
  const accessDetails = serverData?.access || {};
  const password = accessDetails.password || process.env.DEFAULT_SERVER_PASSWORD || process.env.SERVER_DEFAULT_PASSWORD || 'MICKEY24@';
  const emailBody = `
    <p>Malipo yako yamekamilika na coins zimesajiliwa kwenye akaunti yako.</p>
    <p><strong>Package:</strong> ${packageDoc?.name || 'Top-up'}</p>
    <p><strong>Server:</strong> ${serverName}</p>
    <p><strong>Panel:</strong> ${panelUrl}</p>
    <p><strong>Username:</strong> ${accessDetails.username || user.username || 'N/A'}</p>
    <p><strong>Email:</strong> ${accessDetails.email || user.email || 'N/A'}</p>
    <p><strong>Password:</strong> ${password}</p>
    <p>Unaweza kuingia kwenye dashboard yako ukitumia email yako na password ya akaunti yako ili kuona server yako.</p>
  `;

  await sendEmail({
    to: user.email,
    subject: 'Payment completed successfully',
    html: emailBody,
    text: `Malipo yako yamekamilika. Server yako imeandaliwa na unaweza kuiona kwenye dashboard.`
  });
}

/**
 * Initialize payment for a package purchase
 */
router.post('/checkout', authenticate, async (req, res) => {
  try {
    const { packageId, paymentMethod, serverName, phone } = req.body;
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

    // Handle coin payment separately
    if (paymentMethod === 'coins') {
      if ((user.coins || 0) < coinsCost) {
        return res.status(400).json({
          success: false,
          message: `Insufficient coins. You need ${coinsCost} coins but have ${user.coins || 0}.`
        });
      }

      try {
        // Deduct coins
        user.coins = (user.coins || 0) - coinsCost;
        await user.save();

        // Create server from package
        const serverData = await createServerFromPackage(user, packageId, serverName);

        // Record transaction
        const transaction = new Transaction({
          userId,
          type: 'purchase',
          amount: coinsCost,
          currency: 'coins',
          packageId,
          paymentMethod: 'coins',
          status: 'completed',
          description: `Purchase of ${pkg.name} package`,
          completedAt: new Date()
        });
        await transaction.save();

        res.json({
          success: true,
          message: 'Package purchased and server created successfully!',
          data: {
            transactionId: transaction._id,
            coinsDeducted: coinsCost,
            remainingCoins: user.coins,
            package: {
              name: pkg.name,
              coins: coinsCost
            },
            server: serverData.server
          }
        });
      } catch (error) {
        // Refund coins if server creation fails
        user.coins = (user.coins || 0) + coinsCost;
        await user.save();

        console.error('Server creation error:', error.message);
        return res.status(500).json({
          success: false,
          message: error.message || 'Failed to create server. Coins refunded.'
        });
      }
    } else {
      // Handle USD payment via SonicPesa
      const transaction = new Transaction({
        userId,
        type: 'purchase',
        amount: coinsCost,
        currency: 'coins',
        packageId,
        paymentMethod: paymentMethod || 'sonicpesa',
        status: 'pending',
        description: `Purchase of ${pkg.name} package`
      });

      await transaction.save();

      const paymentData = {
        amount: Math.max(1, Math.round(usdCost)),
        currency: 'TZS',
        reference: transaction._id.toString(),
        description: `${pkg.name} Package - ${user.email}`,
        customerEmail: user.email,
        customerName: user.username,
        customerPhone: phone || user.phone || '',
        coinsAmount: coinsCost,
        metadata: {
          transactionId: transaction._id.toString(),
          packageId: packageId,
          userId: userId.toString()
        }
      };

      const paymentResult = await sonicPesaService.createPayment(paymentData);

      if (paymentResult.success) {
        transaction.zenopayTransactionId = paymentResult.orderId || paymentResult.transactionId;
        transaction.zenopayReference = paymentResult.reference;
        transaction.metadata = {
          ...(transaction.metadata || {}),
          sonicpesaOrderId: paymentResult.orderId || paymentResult.transactionId,
          paymentUrl: paymentResult.paymentUrl
        };
        await transaction.save();

        res.json({
          success: true,
          message: 'Payment initialized',
          data: {
            paymentUrl: paymentResult.paymentUrl,
            provider: 'sonicpesa',
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
    }
  } catch (error) {
    console.error('Checkout Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Verify payment and credit user with coins
 */
router.post('/topup', authenticate, async (req, res) => {
  try {
    const { coins, phone } = req.body;
    const userId = req.user._id;
    const coinAmount = Number(coins);

    if (!coinAmount || coinAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Weka kiasi halali cha coins.' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const amountTzs = Math.max(1, Math.round(coinAmount * Number(process.env.COIN_TOPUP_RATE_TZS || 250)));
    const transaction = new Transaction({
      userId,
      type: 'payment',
      amount: coinAmount,
      currency: 'coins',
      paymentMethod: 'sonicpesa',
      paymentProvider: 'sonicpesa',
      status: 'pending',
      description: `Coin top-up for ${coinAmount} coins`,
      metadata: {
        type: 'topup',
        coinsAmount: coinAmount,
        phone
      }
    });

    await transaction.save();

    const paymentData = {
      amount: amountTzs,
      currency: 'TZS',
      reference: transaction._id.toString(),
      description: `Coin top-up ${coinAmount} coins - ${user.email}`,
      customerEmail: user.email,
      customerName: user.username,
      customerPhone: phone || '',
      metadata: {
        transactionId: transaction._id.toString(),
        type: 'topup',
        coinsAmount: coinAmount,
        userId: userId.toString()
      }
    };

    const paymentResult = await sonicPesaService.createPayment(paymentData);

    if (paymentResult.success) {
      transaction.zenopayTransactionId = paymentResult.orderId || paymentResult.transactionId;
      transaction.zenopayReference = paymentResult.reference;
      transaction.metadata = {
        ...(transaction.metadata || {}),
        sonicpesaOrderId: paymentResult.orderId || paymentResult.transactionId,
        paymentUrl: paymentResult.paymentUrl
      };
      await transaction.save();

      res.json({
        success: true,
        message: 'Payment initialized',
        data: {
          paymentUrl: paymentResult.paymentUrl,
          transactionId: transaction._id,
          provider: 'sonicpesa',
          coins: coinAmount,
          amountTzs: amountTzs
        }
      });
    } else {
      transaction.status = 'failed';
      transaction.notes = paymentResult.error;
      await transaction.save();
      res.status(400).json({ success: false, message: paymentResult.error });
    }
  } catch (error) {
    console.error('Top-up Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/verify/:transactionId', authenticate, async (req, res) => {
  try {
    const { transactionId } = req.params;

    const transaction = await Transaction.findById(transactionId)
      .populate('packageId', 'name pricing billingCycle');

    if (!transaction) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    const verificationResult = await sonicPesaService.verifyPayment(
      transaction.zenopayTransactionId
    );

    if (verificationResult.success) {
      if (verificationResult.paymentStatus === 'completed' || verificationResult.paymentStatus === 'success' || verificationResult.paymentStatus === 'SUCCESS') {
        const user = await User.findById(transaction.userId);
        if (user) {
          const isTopup = transaction.metadata?.type === 'topup';
          const coinsToAdd = isTopup ? (transaction.metadata?.coinsAmount || transaction.amount || 0) : (transaction.packageId?.pricing?.coinsCost || transaction.amount || 0);
          user.coins = (user.coins || 0) + coinsToAdd;

          if (!isTopup && transaction.packageId) {
            if (!user.servers) user.servers = [];
            const { calculateExpirationDate } = require('../utils/paymentHelper');
            user.servers.push({
              packageId: transaction.packageId._id,
              purchasedAt: new Date(),
              expiresAt: calculateExpirationDate(transaction.packageId.billingCycle)
            });
          }

          await user.save();

          transaction.status = 'completed';
          transaction.completedAt = new Date();
          await transaction.save();

          if (!isTopup && transaction.packageId) {
            try {
              const serverName = transaction.metadata?.serverName || `${transaction.packageId.name}-${Date.now()}`;
              const serverData = await createServerFromPackage(user, transaction.packageId._id, serverName);
              transaction.serverId = serverData?.server?.identifier || serverData?.server?.id;
              transaction.notes = `Server created: ${serverName}`;
              await transaction.save();
              await notifyUserAboutPayment(user, transaction, transaction.packageId, serverData);
            } catch (serverError) {
              transaction.notes = transaction.notes || `Server creation failed: ${serverError.message}`;
              await transaction.save();
              console.error('Server creation after payment failed:', serverError.message);
            }
          } else {
            await notifyUserAboutPayment(user, transaction, transaction.packageId || { name: 'Coins Top-up' }, null);
          }

          res.json({
            success: true,
            message: 'Payment verified and coins credited',
            data: {
              transactionId,
              coinsAdded: coinsToAdd,
              userCoins: user.coins,
              package: transaction.packageId?.name || 'Coins Top-up'
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
 * Webhook endpoint for SonicPesa callbacks
 */
router.post('/webhook', async (req, res) => {
  try {
    const signature = req.headers['x-sonicpesa-signature'] || req.headers['signature'];
    const payload = JSON.stringify(req.body || {});

    if (signature && !sonicPesaService.validateWebhookSignature(payload, signature)) {
      return res.status(400).json({ success: false, message: 'Invalid signature' });
    }

    const reference = req.body?.reference || req.body?.order_id || req.body?.data?.reference;
    const transaction = await Transaction.findById(reference).catch(() => null);
    const fallbackTransaction = reference
      ? await Transaction.findOne({ zenopayReference: reference }).catch(() => null)
      : null;
    const targetTransaction = transaction || fallbackTransaction;

    if (!targetTransaction) {
      console.warn(`Transaction ${reference} not found`);
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    const status = String(req.body?.status || req.body?.payment_status || '').toLowerCase();
    const shouldCredit = status === 'success' || status === 'completed' || status === 'succeeded';

    if (shouldCredit) {
      const user = await User.findById(targetTransaction.userId);
      if (user) {
        const coinsToAdd = targetTransaction.amount;
        user.coins = (user.coins || 0) + coinsToAdd;
        await user.save();
      }

      targetTransaction.status = 'completed';
      targetTransaction.completedAt = new Date();
    } else if (status === 'failed' || status === 'cancelled' || status === 'rejected' || status === 'usercancelled') {
      targetTransaction.status = 'failed';
    } else {
      targetTransaction.status = 'pending';
    }

    targetTransaction.notes = targetTransaction.notes || JSON.stringify(req.body);
    await targetTransaction.save();

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
    const methods = sonicPesaService.getAvailablePaymentMethods();
    res.json({ success: true, data: methods });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/admin/all', requireAdmin, async (req, res) => {
  try {
    const transactions = await Transaction.find()
      .populate('userId', 'username email')
      .populate('packageId', 'name')
      .sort({ createdAt: -1 })
      .limit(100);

    res.json({ success: true, data: transactions });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/admin/:transactionId/approve', requireAdmin, async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.transactionId);
    if (!transaction) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    const user = await User.findById(transaction.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const coinsToAdd = transaction.amount;
    user.coins = (user.coins || 0) + coinsToAdd;
    await user.save();

    transaction.status = 'completed';
    transaction.completedAt = new Date();
    transaction.notes = transaction.notes || 'Approved manually by admin';
    await transaction.save();

    res.json({ success: true, message: 'Payment approved and coins credited', data: { coins: user.coins } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
