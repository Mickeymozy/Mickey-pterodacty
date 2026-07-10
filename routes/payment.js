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
const axios = require('axios');
const PTERODACTYL_URL = process.env.PTERODACTYL_URL?.replace(/\/$/, '');
const PTERODACTYL_APP_API_KEY = process.env.PTERODACTYL_APP_API_KEY;
const appApi = PTERODACTYL_URL && PTERODACTYL_APP_API_KEY ? axios.create({ baseURL: `${PTERODACTYL_URL}/api/application`, headers: { Authorization: `Bearer ${PTERODACTYL_APP_API_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' }, timeout: 10000 }) : null;
const { requireAdmin, ADMIN_EMAILS } = require('../middleware/auth');

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
  const password = accessDetails.password || process.env.DEFAULT_SERVER_PASSWORD || process.env.SERVER_DEFAULT_PASSWORD || 'Set via panel';
  const emailBody = `
    <p>Malipo yako yamekamilika na huduma yako imeandaliwa.</p>
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

async function notifyAdminAboutPendingPayment(user, transaction, packageDoc, requestType = 'payment request') {
  const adminRecipients = ADMIN_EMAILS.filter(Boolean);
  if (!adminRecipients.length || !user?.email) return;

  const subject = `New ${requestType} pending approval`;
  const html = `
    <p>A new ${requestType} has been submitted and requires admin approval.</p>
    <p><strong>User:</strong> ${user.username || user.email}</p>
    <p><strong>Email:</strong> ${user.email}</p>
    <p><strong>Transaction:</strong> ${transaction?._id || 'N/A'}</p>
    <p><strong>Package:</strong> ${packageDoc?.name || 'N/A'}</p>
    <p>Please review it from the admin panel.</p>
  `;

  await sendEmail({
    to: adminRecipients,
    subject,
    html,
    text: `A new ${requestType} is waiting for admin approval for ${user.email}.`
  });
}

async function notifyUserAboutPendingPayment(user, transaction, packageDoc, requestType = 'payment request') {
  if (!user?.email) return;

  await sendEmail({
    to: user.email,
    subject: 'Payment request received',
    html: `<p>Maombi yako ya ${requestType} yamepokelewa.</p><p>Admin atakagua na kukubali hivi karibuni.</p><p><strong>Transaction:</strong> ${transaction?._id || 'N/A'}</p><p><strong>Package:</strong> ${packageDoc?.name || 'N/A'}</p>`,
    text: `Your ${requestType} has been received and is waiting for admin approval.`
  });
}

/**
 * Initialize payment for a package purchase
 */
router.post('/checkout', authenticate, async (req, res) => {
  try {
    const { packageId, paymentMethod, serverName, phone, proofText, eggId, dockerImage, startupFile, startupCommand } = req.body;
    const userId = req.user._id;
    const normalizedPaymentMethod = String(paymentMethod || '').toLowerCase();
    const useWalletPayment = normalizedPaymentMethod === 'wallet' || normalizedPaymentMethod === 'coins';
    const useManualPayment = normalizedPaymentMethod === 'manual';

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

    const pricing = pkg?.pricing || {};
    const coinsCost = Number(pricing.coinsCost ?? pkg?.coinsCost ?? 0);
    const usdCost = Number(pricing.usdCost ?? pkg?.usdCost ?? 0);

    if (normalizedPaymentMethod === 'sonicpesa') {
      return res.status(400).json({
        success: false,
        message: 'SonicPesa inatumika kwa kununua coins pekee. Tafadhali chagua Coins au Manual kwa server.'
      });
    }

    // Handle coin payment separately: create server first, then atomically deduct coins
    if (useWalletPayment) {
      try {
        // Create server from package first
        const serverData = await createServerFromPackage(user, packageId, serverName, { eggId, dockerImage, startupFile, startupCommand });

        // Atomically deduct coins: ensure user still has enough
        const updatedUser = await User.findOneAndUpdate(
          { _id: userId, coins: { $gte: coinsCost } },
          { $inc: { coins: -coinsCost } },
          { new: true }
        );

        if (!updatedUser) {
          // Deduction failed - attempt to remove created server as rollback
          try {
            if (appApi && serverData?.server?.id) {
              await appApi.delete(`/servers/${serverData.server.id}`);
            }
          } catch (delErr) {
            console.error('Failed to delete server after insufficient coins:', delErr?.response?.data || delErr.message || delErr);
          }

          return res.status(400).json({
            success: false,
            message: `Insufficient coins at billing time. Server removed.`
          });
        }

        // Record transaction
        const transaction = new Transaction({
          userId,
          type: 'purchase',
          amount: coinsCost,
          currency: 'coins',
          packageId,
          paymentMethod: 'wallet',
          paymentProvider: 'wallet',
          status: 'completed',
          description: `Purchase of ${pkg.name} package`,
          completedAt: new Date(),
          serverId: serverData?.server?.identifier || serverData?.server?.id
        });
        await transaction.save();

        res.json({
          success: true,
          message: 'Package purchased and server created successfully!',
          data: {
            transactionId: transaction._id,
            coinsDeducted: coinsCost,
            remainingCoins: updatedUser.coins,
            package: {
              name: pkg.name,
              coins: coinsCost
            },
            server: serverData.server
          }
        });
      } catch (error) {
        console.error('Server creation/payment error:', error.message || error);
        return res.status(500).json({
          success: false,
          message: error.message || 'Failed to create server or deduct coins.'
        });
      }
    } else if (useManualPayment) {
      const manualTransaction = new Transaction({
        userId,
        type: 'purchase',
        amount: usdCost || coinsCost,
        currency: 'USD',
        packageId,
        paymentMethod: 'manual',
        paymentProvider: 'manual',
        status: 'pending',
        description: `Purchase of ${pkg.name} package via manual payment`,
        metadata: {
          type: 'package_purchase',
          packageId: packageId,
          userId: userId.toString(),
          serverName,
          phone,
          proofText,
          paymentMethod: 'manual',
          eggId,
          dockerImage,
          startupFile,
          startupCommand,
          eggName: pkg?.serverConfig?.eggName || 'Node.js'
        }
      });

      await manualTransaction.save();

      await notifyUserAboutPendingPayment(user, manualTransaction, pkg, 'server purchase');
      await notifyAdminAboutPendingPayment(user, manualTransaction, pkg, 'server purchase');

      return res.json({
        success: true,
        message: 'Maombi yako ya server yamepokelewa. Admin atakagua malipo yako na kukubali ili server iundwe.',
        data: {
          transactionId: manualTransaction._id,
          provider: 'manual',
          package: {
            name: pkg.name,
            coins: coinsCost,
            usd: usdCost
          }
        }
      });
    } else {
      // Handle USD payment via SonicPesa
      const transaction = new Transaction({
        userId,
        type: 'purchase',
        amount: usdCost || coinsCost,
        currency: 'USD',
        packageId,
        paymentMethod: normalizedPaymentMethod || 'sonicpesa',
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
    const { coins, phone, paymentMethod = 'manual', proofText } = req.body;
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
      paymentMethod: paymentMethod === 'sonicpesa' ? 'sonicpesa' : 'manual',
      paymentProvider: paymentMethod === 'sonicpesa' ? 'sonicpesa' : 'manual',
      status: 'pending',
      description: `Coin top-up for ${coinAmount} coins`,
      metadata: {
        type: 'topup',
        coinsAmount: coinAmount,
        phone,
        proofText,
        amountTzs,
        paymentMethod: paymentMethod === 'sonicpesa' ? 'sonicpesa' : 'manual'
      }
    });

    await transaction.save();

    await notifyUserAboutPendingPayment(user, transaction, { name: 'Coins Top-up' }, 'coin top-up');
    await notifyAdminAboutPendingPayment(user, transaction, { name: 'Coins Top-up' }, 'coin top-up');

    if (paymentMethod === 'sonicpesa') {
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
      return;
    }

    res.json({
      success: true,
      message: 'Maombi yako ya kupakia coins yamepokelewa. Admin ataapprove baada ya kuthibitisha malipo yako.',
      data: {
        transactionId: transaction._id,
        coins: coinAmount,
        amountTzs: amountTzs,
        provider: 'manual'
      }
    });
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

    if (String(transaction.userId) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
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

    if (!signature) {
      console.warn('Webhook request missing signature header');
      return res.status(401).json({ success: false, message: 'Missing webhook signature' });
    }

    if (!sonicPesaService.validateWebhookSignature(payload, signature)) {
      return res.status(401).json({ success: false, message: 'Invalid webhook signature' });
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
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
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

router.get('/admin/all', authenticate, requireAdmin, async (req, res) => {
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

router.post('/admin/:transactionId/approve', authenticate, requireAdmin, async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.transactionId);
    if (!transaction) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    const user = await User.findById(transaction.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (transaction.type === 'purchase' && transaction.packageId) {
      const pkg = await ServerPackage.findById(transaction.packageId);
      const serverName = transaction.metadata?.serverName || `${pkg?.name || 'server'}-${Date.now()}`;
      const serverData = await createServerFromPackage(user, transaction.packageId, serverName, {
        eggId: transaction.metadata?.eggId,
        dockerImage: transaction.metadata?.dockerImage,
        startupFile: transaction.metadata?.startupFile,
        startupCommand: transaction.metadata?.startupCommand
      });
      transaction.serverId = serverData?.server?.identifier || serverData?.server?.id;
      transaction.notes = transaction.notes || `Server created after admin approval: ${serverName}`;
      transaction.processedBy = req.user?._id;
      transaction.status = 'completed';
      transaction.completedAt = new Date();
      await transaction.save();
      await notifyUserAboutPayment(user, transaction, pkg, serverData);

      return res.json({ success: true, message: 'Payment approved and server created', data: { server: serverData?.server } });
    }

    const coinsToAdd = transaction.metadata?.coinsAmount || transaction.amount || 0;
    user.coins = (user.coins || 0) + Number(coinsToAdd);
    await user.save();

    transaction.status = 'completed';
    transaction.completedAt = new Date();
    transaction.notes = transaction.notes || 'Approved manually by admin';
    transaction.processedBy = req.user?._id;
    await transaction.save();

    await notifyUserAboutPayment(user, transaction, { name: 'Coins Top-up' }, null);

    res.json({ success: true, message: 'Payment approved and coins credited', data: { coins: user.coins } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
