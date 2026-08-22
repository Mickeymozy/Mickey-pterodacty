/**
 * Payment & Checkout Routes
 */

const express = require('express');
const router = express.Router();
const palmPesaService = require('../services/palmPesaService');
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
  const emailBody = `
    <p>Malipo yako yamekamilika na huduma yako imeandaliwa.</p>
    <p><strong>Package:</strong> ${packageDoc?.name || 'Top-up'}</p>
    <p><strong>Server:</strong> ${serverName}</p>
    <p><strong>Panel:</strong> ${panelUrl}</p>
    <p><strong>Username:</strong> ${accessDetails.username || user.username || 'N/A'}</p>
    <p><strong>Email:</strong> ${accessDetails.email || user.email || 'N/A'}</p>
    <p>Password haijatumwi kwa email kwa usalama. Tumia password yako ya Pterodactyl au reset kupitia panel.</p>
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
    const { packageId, paymentMethod, serverName, phone, proofText, eggId, dockerImage, startupFile, startupCommand, botRepoUrl } = req.body;
    const userId = req.user._id;
    const normalizedPaymentMethod = String(paymentMethod || '').toLowerCase();
    const useWalletPayment = normalizedPaymentMethod === 'wallet' || normalizedPaymentMethod === 'coins';
    const usePalmPesaPayment = normalizedPaymentMethod === 'palmpesa';

    if (normalizedPaymentMethod === 'manual') {
      return res.status(400).json({ success: false, message: 'Manual payment option has been removed. Use PalmPesa or Coins (wallet) instead.' });
    }

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

    // Reserve coins before provisioning so an insufficient balance cannot create an orphan server.
    if (useWalletPayment) {
      const updatedUser = await User.findOneAndUpdate(
        { _id: userId, coins: { $gte: coinsCost } },
        { $inc: { coins: -coinsCost } },
        { new: true }
      );

      if (!updatedUser) {
        return res.status(400).json({ success: false, message: 'Insufficient coins to create this server.' });
      }

      try {
        const serverData = await createServerFromPackage(user, packageId, serverName, { eggId, dockerImage, startupFile, startupCommand, botRepoUrl, sendEmail: false });

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

        await notifyUserAboutPayment(user, transaction, pkg, serverData);

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
        await User.updateOne({ _id: userId }, { $inc: { coins: coinsCost } });
        console.error('Server creation/payment error:', error.message || error);
        return res.status(500).json({
          success: false,
          message: error.message || 'Failed to create server or deduct coins.'
        });
      }
    } else if (usePalmPesaPayment) {
      const transaction = new Transaction({
        userId,
        type: 'purchase',
        amount: usdCost || coinsCost,
        currency: 'USD',
        packageId,
        paymentMethod: 'palmpesa',
        paymentProvider: 'palmpesa',
        status: 'pending',
        description: `Purchase of ${pkg.name} package`,
        metadata: {
          serverName: serverName || `${pkg.name}-${Date.now()}`,
          eggId: eggId,
          dockerImage: dockerImage,
          startupFile: startupFile,
          startupCommand: startupCommand,
          botRepoUrl: botRepoUrl,
          phone: phone,
          proofText: proofText
        }
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

      const paymentResult = await palmPesaService.createPayment({
        user_id: process.env.PALMPESA_USER_ID,
        vendor: process.env.PALMPESA_VENDOR,
        order_id: transaction._id.toString(),
        customerEmail: paymentData.customerEmail,
        customerName: paymentData.customerName,
        customerPhone: paymentData.customerPhone,
        amount: paymentData.amount,
        currency: 'TZS',
        redirectUrl: process.env.PALMPESA_REDIRECT_URL || process.env.APP_URL,
        cancelUrl: process.env.PALMPESA_CANCEL_URL || `${process.env.APP_URL || ''}/cancel`,
        webhookUrl: process.env.PALMPESA_WEBHOOK_URL || `${process.env.APP_URL || ''}/api/payment/webhook`,
        description: paymentData.description,
        metadata: paymentData.metadata
      });

      if (paymentResult.success) {
        transaction.zenopayTransactionId = paymentResult.orderId || paymentResult.transactionId;
        transaction.zenopayReference = paymentResult.reference;
        transaction.metadata = {
          ...(transaction.metadata || {}),
          palmpesaOrderId: paymentResult.orderId || paymentResult.transactionId,
          paymentUrl: paymentResult.paymentUrl,
          paymentMessage: paymentResult.paymentMessage || paymentResult.raw?.message || 'Please follow the prompt on your phone.',
          paymentInitiated: true,
          paymentEndpoint: paymentResult.endpoint || 'palmpesa',
          paymentDetails: paymentResult.details || null
        };
        await transaction.save();

        return res.json({
          success: true,
          message: 'Payment initiated via PalmPesa. Please complete the USSD/mobile prompt and wait for confirmation.',
          data: {
            paymentUrl: paymentResult.paymentUrl,
            paymentMessage: paymentResult.paymentMessage || paymentResult.raw?.message || 'Please follow the prompt on your phone.',
            provider: 'palmpesa',
            transactionId: transaction._id,
            package: {
              name: pkg.name,
              coins: coinsCost,
              usd: usdCost
            },
            paymentInitiated: true,
            gatewayDetails: paymentResult.details || null
          }
        });
      }

      transaction.status = 'failed';
      transaction.notes = paymentResult.error;
      await transaction.save();

      console.error('PalmPesa checkout payment creation failed:', paymentResult);
      return res.status(400).json({
        success: false,
        message: paymentResult.error || 'Failed to initialize PalmPesa payment',
        data: {
          transactionId: transaction._id,
          provider: 'palmpesa',
          gatewayError: paymentResult.error,
          gatewayDetails: paymentResult.details || null
        }
      });
    } else {
      const transaction = new Transaction({
        userId,
        type: 'purchase',
        amount: usdCost || coinsCost,
        currency: 'USD',
        packageId,
        paymentMethod: normalizedPaymentMethod || 'palmpesa',
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

      const paymentResult = await palmPesaService.createPayment({
        user_id: process.env.PALMPESA_USER_ID,
        vendor: process.env.PALMPESA_VENDOR,
        order_id: transaction._id.toString(),
        customerEmail: paymentData.customerEmail,
        customerName: paymentData.customerName,
        customerPhone: paymentData.customerPhone,
        amount: paymentData.amount,
        currency: 'TZS',
        redirectUrl: process.env.PALMPESA_REDIRECT_URL || process.env.APP_URL,
        cancelUrl: process.env.PALMPESA_CANCEL_URL || `${process.env.APP_URL || ''}/cancel`,
        webhookUrl: process.env.PALMPESA_WEBHOOK_URL || `${process.env.APP_URL || ''}/api/payment/webhook`,
        description: paymentData.description,
        metadata: paymentData.metadata
      });

      if (paymentResult.success) {
        transaction.zenopayTransactionId = paymentResult.orderId || paymentResult.transactionId;
        transaction.zenopayReference = paymentResult.reference;
        transaction.metadata = {
          ...(transaction.metadata || {}),
          palmpesaOrderId: paymentResult.orderId || paymentResult.transactionId,
          paymentUrl: paymentResult.paymentUrl
        };
        await transaction.save();

        res.json({
          success: true,
          message: 'Payment initialized',
          data: {
            paymentUrl: paymentResult.paymentUrl,
            provider: 'palmpesa',
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
    const { coins, phone, paymentMethod = 'palmpesa', proofText } = req.body;
    const userId = req.user._id;
    const coinAmount = Number(coins);
    const normalizedPaymentMethod = String(paymentMethod || '').toLowerCase();
    const usePalmPesa = normalizedPaymentMethod === 'palmpesa' || normalizedPaymentMethod === 'review' ? normalizedPaymentMethod === 'palmpesa' : false;
    const useAdminReview = !usePalmPesa;

    if (!coinAmount || coinAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Weka kiasi halali cha coins.' });
    }

    if (usePalmPesa) {
      const configCheck = {
        hasToken: !!process.env.PALMPESA_API_TOKEN,
        hasUserId: !!process.env.PALMPESA_USER_ID,
        hasVendor: !!process.env.PALMPESA_VENDOR,
        token: process.env.PALMPESA_API_TOKEN ? 'set' : 'NOT SET',
        userId: process.env.PALMPESA_USER_ID ? 'set' : 'NOT SET',
        vendor: process.env.PALMPESA_VENDOR ? 'set' : 'NOT SET'
      };
      console.log('PalmPesa config check:', configCheck);
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
      paymentMethod: usePalmPesa ? 'palmpesa' : 'admin',
      paymentProvider: usePalmPesa ? 'palmpesa' : 'admin',
      status: 'pending',
      description: `Coin top-up for ${coinAmount} coins`,
      metadata: {
        type: 'topup',
        coinsAmount: coinAmount,
        phone,
        proofText,
        amountTzs,
        paymentMethod: usePalmPesa ? 'palmpesa' : 'admin'
      }
    });

    await transaction.save();

    if (usePalmPesa) {
      const paymentData = {
        amount: amountTzs,
        currency: 'TZS',
        reference: transaction._id.toString(),
        description: `Coin top-up ${coinAmount} coins - ${user.email}`,
        customerEmail: user.email,
        customerName: user.username,
        customerPhone: phone || user.phone || '',
        metadata: {
          transactionId: transaction._id.toString(),
          type: 'topup',
          coinsAmount: coinAmount,
          userId: userId.toString()
        }
      };

      const paymentResult = await palmPesaService.createPayment({
        user_id: process.env.PALMPESA_USER_ID,
        vendor: process.env.PALMPESA_VENDOR,
        order_id: transaction._id.toString(),
        customerEmail: paymentData.customerEmail,
        customerName: paymentData.customerName,
        customerPhone: paymentData.customerPhone,
        amount: paymentData.amount,
        currency: 'TZS',
        redirectUrl: process.env.PALMPESA_REDIRECT_URL || process.env.APP_URL,
        cancelUrl: process.env.PALMPESA_CANCEL_URL || `${process.env.APP_URL || ''}/cancel`,
        webhookUrl: process.env.PALMPESA_WEBHOOK_URL || `${process.env.APP_URL || ''}/api/payment/webhook`,
        description: paymentData.description,
        metadata: paymentData.metadata
      });

      if (paymentResult.success) {
        transaction.zenopayTransactionId = paymentResult.orderId || paymentResult.transactionId;
        transaction.zenopayReference = paymentResult.reference;
        transaction.metadata = {
          ...(transaction.metadata || {}),
          palmpesaOrderId: paymentResult.orderId || paymentResult.transactionId,
          paymentUrl: paymentResult.paymentUrl,
          paymentInitiated: true,
          paymentEndpoint: paymentResult.endpoint || 'palmpesa'
        };
        await transaction.save();

        return res.json({
          success: true,
          message: 'Payment initiated via PalmPesa. Please complete the USSD/mobile prompt and wait for confirmation.',
          data: {
            paymentUrl: paymentResult.paymentUrl,
            paymentMessage: paymentResult.paymentMessage || paymentResult.raw?.message || 'Please follow the prompt on your phone.',
            transactionId: transaction._id,
            provider: 'palmpesa',
            coins: coinAmount,
            amountTzs: amountTzs,
            orderId: paymentResult.orderId || paymentResult.transactionId,
            paymentInitiated: true
          }
        });
      }

      const errorMsg = paymentResult.error || 'Failed to initialize PalmPesa payment';
      console.error('PalmPesa payment creation failed:', {
        error: errorMsg,
        paymentResult,
        requestPayload: {
          order_id: transaction._id.toString(),
          amount: amountTzs,
          phone: phone,
          customerEmail: user.email
        }
      });

      transaction.status = 'pending';
      transaction.notes = `PalmPesa unavailable: ${errorMsg}`;
      transaction.metadata = {
        ...(transaction.metadata || {}),
        gatewayError: errorMsg,
        gatewayDetails: paymentResult.details || null,
        fallbackMode: 'manual-review',
        paymentInstructions: `Tafadhali lipa kwa PalmPesa kwa kutumia namba ${phone || user.phone || 'iliyowekwa'} na uandike transaction ${transaction._id}`
      };
      await transaction.save();

      return res.json({
        success: false,
        message: `PalmPesa haikuweza kuanzisha malipo ya kweli kwa sasa. Tafadhali jaribu tena baadaye. (${errorMsg})`,
        data: {
          transactionId: transaction._id,
          coins: coinAmount,
          amountTzs: amountTzs,
          provider: 'palmpesa',
          fallback: true,
          gatewayError: errorMsg,
          gatewayDetails: paymentResult.details || null,
          paymentInstructions: `Tafadhali lipa kwa PalmPesa kwa kutumia namba ${phone || user.phone || 'iliyowekwa'} na uandike transaction ${transaction._id}`
        }
      });
    }

    return res.json({
      success: true,
      message: 'Maombi yako ya kupakia coins yamepokelewa. Admin ataapprove baada ya kuthibitisha malipo yako.',
      data: {
        transactionId: transaction._id,
        coins: coinAmount,
        amountTzs: amountTzs,
        provider: 'admin'
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
      return res.status(403).json({ success: false, message: 'Huna ruhusa ya transaction hii.' });
    }
    if (transaction.status === 'completed') {
      return res.json({ success: true, message: 'Payment already verified', data: { status: 'completed', transactionId } });
    }

    const verificationResult = await palmPesaService.verifyPayment(
      transaction.zenopayTransactionId
    );

    if (verificationResult.success) {
      if (verificationResult.paymentStatus === 'completed' || verificationResult.paymentStatus === 'success' || verificationResult.paymentStatus === 'SUCCESS') {
          const user = await User.findById(transaction.userId);
        if (user) {
          const isTopup = transaction.metadata?.type === 'topup';
            const isGeneric = transaction.type === 'generic' || transaction.metadata?.type === 'generic';
            const coinsToAdd = isGeneric ? 0 : isTopup ? (transaction.metadata?.coinsAmount || transaction.amount || 0) : (transaction.packageId?.pricing?.coinsCost || transaction.amount || 0);
            if (!isGeneric) {
              user.coins = (user.coins || 0) + coinsToAdd;
            }

          if (!isGeneric && !isTopup && transaction.packageId) {
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

          if (!isGeneric && !isTopup && transaction.packageId) {
            try {
              const serverName = transaction.metadata?.serverName || `${transaction.packageId.name}-${Date.now()}`;
              const serverData = await createServerFromPackage(user, transaction.packageId._id, serverName, {
                sendEmail: false,
                eggId: transaction.metadata?.eggId,
                dockerImage: transaction.metadata?.dockerImage,
                startupFile: transaction.metadata?.startupFile,
                startupCommand: transaction.metadata?.startupCommand,
                botRepoUrl: transaction.metadata?.botRepoUrl
              });
              transaction.serverId = serverData?.server?.identifier || serverData?.server?.id;
              transaction.notes = `Server created: ${serverName}`;
              await transaction.save();
              await notifyUserAboutPayment(user, transaction, transaction.packageId, serverData);
            } catch (serverError) {
              transaction.notes = transaction.notes || `Server creation failed: ${serverError.message}`;
              await transaction.save();
              console.error('Server creation after payment failed:', serverError.message);
            }
          } else if (isGeneric) {
            await notifyUserAboutPendingPayment(user, transaction, { name: transaction.description }, 'generic payment');
          } else {
            await notifyUserAboutPayment(user, transaction, transaction.packageId || { name: 'Coins Top-up' }, null);
          }

          res.json({
            success: true,
            message: isGeneric ? 'Payment verified successfully' : 'Payment verified and coins credited',
            data: {
              status: 'completed',
              transactionId,
              coinsAdded: coinsToAdd,
              userCoins: user.coins,
              package: isGeneric ? 'Generic Payment' : transaction.packageId?.name || 'Coins Top-up'
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
 * Generic payment endpoint - process payments without server/coin purchase
 * For any payment purpose (donations, fees, etc.)
 */
router.post('/generic', authenticate, async (req, res) => {
  try {
    const { amount, description, paymentMethod = 'palmpesa', phone } = req.body;
    const userId = req.user._id;

    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Valid amount required' });
    }

    if (!description || String(description).trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Description required' });
    }

    const normalizedPaymentMethod = String(paymentMethod || '').toLowerCase();
    const usePalmPesa = normalizedPaymentMethod === 'palmpesa';
    const useAdmin = normalizedPaymentMethod === 'admin' || normalizedPaymentMethod === 'review';

    if (!usePalmPesa && !useAdmin) {
      return res.status(400).json({ success: false, message: 'Unsupported payment method. Use palmpesa or admin.' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const amountTzs = Math.max(1, Math.round(Number(amount)));

    const transaction = new Transaction({
      userId,
      type: 'generic',
      amount: amountTzs,
      currency: 'TZS',
      paymentMethod: usePalmPesa ? 'palmpesa' : useAdmin ? 'admin' : 'other',
      paymentProvider: usePalmPesa ? 'palmpesa' : useAdmin ? 'admin' : 'other',
      status: 'pending',
      description: String(description).trim(),
      metadata: {
        type: 'generic',
        amountTzs: amountTzs,
        phone: phone || '',
        purpose: String(description).trim()
      }
    });

    await transaction.save();

    if (usePalmPesa) {
      const paymentData = {
        amount: amountTzs,
        currency: 'TZS',
        reference: transaction._id.toString(),
        description: `${String(description).trim()} - ${user.email}`,
        customerEmail: user.email,
        customerName: user.username,
        customerPhone: phone || user.phone || '',
        metadata: {
          transactionId: transaction._id.toString(),
          type: 'generic',
          userId: userId.toString()
        }
      };

      const paymentResult = await palmPesaService.createPayment({
        user_id: process.env.PALMPESA_USER_ID,
        vendor: process.env.PALMPESA_VENDOR,
        order_id: transaction._id.toString(),
        customerEmail: paymentData.customerEmail,
        customerName: paymentData.customerName,
        customerPhone: paymentData.customerPhone,
        amount: paymentData.amount,
        currency: 'TZS',
        redirectUrl: process.env.PALMPESA_REDIRECT_URL || process.env.APP_URL,
        cancelUrl: process.env.PALMPESA_CANCEL_URL || `${process.env.APP_URL || ''}/cancel`,
        webhookUrl: process.env.PALMPESA_WEBHOOK_URL || `${process.env.APP_URL || ''}/api/payment/webhook`,
        description: paymentData.description,
        metadata: paymentData.metadata
      });

      if (paymentResult.success) {
        transaction.zenopayTransactionId = paymentResult.orderId || paymentResult.transactionId;
        transaction.zenopayReference = paymentResult.reference;
        transaction.metadata = {
          ...(transaction.metadata || {}),
          palmpesaOrderId: paymentResult.orderId || paymentResult.transactionId,
          paymentUrl: paymentResult.paymentUrl,
          paymentMessage: paymentResult.paymentMessage || paymentResult.raw?.message || 'Please follow the prompt on your phone.',
          paymentInitiated: true,
          paymentEndpoint: paymentResult.endpoint || 'palmpesa'
        };
        await transaction.save();

        return res.json({
          success: true,
          message: 'Generic payment initiated via PalmPesa. Please complete the USSD/mobile prompt and wait for confirmation.',
          data: {
            paymentUrl: paymentResult.paymentUrl,
            paymentMessage: paymentResult.paymentMessage || paymentResult.raw?.message || 'Please follow the prompt on your phone.',
            transactionId: transaction._id,
            provider: 'palmpesa',
            amount: amountTzs,
            currency: 'TZS',
            description: String(description).trim(),
            paymentInitiated: true
          }
        });
      }

      const errorMsg = paymentResult.error || 'Failed to initialize PalmPesa payment';
      console.error('PalmPesa generic payment creation failed:', {
        error: errorMsg,
        paymentResult,
        requestPayload: {
          order_id: transaction._id.toString(),
          amount: amountTzs,
          phone: phone,
          customerEmail: user.email
        }
      });

      transaction.status = 'pending';
      transaction.notes = `PalmPesa unavailable: ${errorMsg}`;
      transaction.metadata = {
        ...(transaction.metadata || {}),
        gatewayError: errorMsg,
        gatewayDetails: paymentResult.details || null,
        fallbackMode: 'manual-review',
        paymentInstructions: `Tafadhali lipa kwa PalmPesa kwa kutumia namba ${phone || user.phone || 'iliyowekwa'} na uandike transaction ${transaction._id}`
      };
      await transaction.save();

      return res.json({
        success: false,
        message: `PalmPesa haikuweza kuanzisha malipo ya kweli kwa sasa. Tafadhali jaribu tena baadaye. (${errorMsg})`,
        data: {
          transactionId: transaction._id,
          amount: amountTzs,
          currency: 'TZS',
          provider: 'palmpesa',
          fallback: true,
          gatewayError: errorMsg,
          gatewayDetails: paymentResult.details || null,
          paymentInstructions: `Tafadhali lipa kwa PalmPesa kwa kutumia namba ${phone || user.phone || 'iliyowekwa'} na uandike transaction ${transaction._id}`
        }
      });
    }

    // Admin review mode
    return res.json({
      success: true,
      message: 'Generic payment request received. Admin ataapprove baada ya kuthibitisha malipo yako.',
      data: {
        transactionId: transaction._id,
        amount: amountTzs,
        currency: 'TZS',
        provider: 'admin',
        description: String(description).trim()
      }
    });
  } catch (error) {
    console.error('Generic Payment Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Webhook endpoint for PalmPesa callbacks
 */
router.post('/webhook', async (req, res) => {
  try {
    const signature = req.headers['x-palmpesa-signature'] || req.headers['x-signature'] || req.headers['signature'];
    const payload = JSON.stringify(req.body || {});

    // PalmPesa service validator currently accepts webhooks by default
    if (signature && !palmPesaService.validateWebhookSignature(payload, signature)) {
      return res.status(400).json({ success: false, message: 'Invalid signature' });
    }

    const reference = req.body?.reference || req.body?.order_id || req.body?.data?.reference || req.body?.orderId;
    const transaction = await Transaction.findById(reference).catch(() => null);
    const fallbackTransaction = reference
      ? await Transaction.findOne({ zenopayReference: reference }).catch(() => null)
      : null;
    const targetTransaction = transaction || fallbackTransaction;

    if (!targetTransaction) {
      console.warn(`Transaction ${reference} not found`);
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    const status = String(req.body?.status || req.body?.payment_status || req.body?.paymentStatus || '').toLowerCase();
    const shouldCredit = status === 'success' || status === 'completed' || status === 'succeeded';

    if (shouldCredit) {
      const user = await User.findById(targetTransaction.userId);
      if (user) {
        // For generic payments, just mark complete; no coins/server creation
        if (targetTransaction.type === 'generic') {
          // Send simple payment confirmation email
          await sendEmail({
            to: user.email,
            subject: 'Payment completed successfully',
            html: `<p>Your payment for "${targetTransaction.description}" (Tsh ${targetTransaction.amount}) has been completed successfully.</p><p>Transaction ID: ${targetTransaction._id}</p>`,
            text: `Your payment for "${targetTransaction.description}" has been completed.`
          }).catch(err => console.error('Failed to send generic payment email:', err));
        } else {
          // For coin/server payments, add coins
          const coinsToAdd = targetTransaction.amount;
          user.coins = (user.coins || 0) + coinsToAdd;
          await user.save();

          const packageDoc = targetTransaction.packageId
            ? await ServerPackage.findById(targetTransaction.packageId).catch(() => null)
            : null;

          await notifyUserAboutPayment(user, targetTransaction, packageDoc || { name: 'Coins Top-up' }, null);
        }
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
    const methods = palmPesaService.getAvailablePaymentMethods();
    res.json({ success: true, data: methods });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/debug/config', (req, res) => {
  const config = {
    palmpesaConfigured: {
      apiToken: !!process.env.PALMPESA_API_TOKEN,
      userId: !!process.env.PALMPESA_USER_ID,
      baseUrl: process.env.PALMPESA_BASE_URL || 'not set',
      vendor: process.env.PALMPESA_VENDOR || 'not set',
      webhookUrl: process.env.PALMPESA_WEBHOOK_URL || 'not set'
    },
    coinTopupRate: process.env.COIN_TOPUP_RATE_TZS || 'not set',
    appUrl: process.env.APP_URL || 'not set'
  };
  res.json({ success: true, data: config });
});

router.post('/debug/test-payment', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const testPayload = {
      user_id: process.env.PALMPESA_USER_ID,
      vendor: process.env.PALMPESA_VENDOR,
      order_id: `TEST-${Date.now()}`,
      customerEmail: user.email,
      customerName: user.username,
      customerPhone: '255744000000',
      amount: 1000,
      currency: 'TZS',
      webhookUrl: process.env.PALMPESA_WEBHOOK_URL || `${process.env.APP_URL || ''}/api/payment/webhook`,
      description: 'Test payment to verify PalmPesa configuration',
      address: 'Dar es Salaam',
      postcode: '00000'
    };

    console.log('Testing PalmPesa with payload:', testPayload);
    const result = await palmPesaService.createPayment(testPayload);
    
    res.json({
      success: true,
      message: 'Test payment result',
      data: {
        result,
        payload: testPayload,
        configStatus: {
          hasApiToken: !!process.env.PALMPESA_API_TOKEN,
          hasUserId: !!process.env.PALMPESA_USER_ID,
          hasVendor: !!process.env.PALMPESA_VENDOR,
          hasWebhook: !!process.env.PALMPESA_WEBHOOK_URL
        }
      }
    });
  } catch (err) {
    console.error('Test payment error:', err);
    res.status(500).json({ success: false, message: err.message });
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

// Summary of payments grouped by provider and external total
router.get('/admin/summary', requireAdmin, async (req, res) => {
  try {
    const pipeline = [
      { $match: { status: { $in: ['completed', 'pending', 'failed'] } } },
      { $group: { _id: '$paymentProvider', totalAmount: { $sum: '$amount' }, count: { $sum: 1 } } }
    ];

    const byProvider = await Transaction.aggregate(pipeline).exec();

    // Separate count for generic payments
    const genericCount = await Transaction.countDocuments({ type: 'generic', status: { $in: ['completed', 'pending', 'failed'] } });
    const genericTotal = await Transaction.aggregate([
      { $match: { type: 'generic', status: { $in: ['completed', 'pending', 'failed'] } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]).then(result => result[0]?.total || 0);

    let externalTotal = 0;
    byProvider.forEach((p) => {
      const provider = p._id || 'unknown';
      if (provider !== 'admin') {
        externalTotal += Number(p.totalAmount || 0);
      }
    });

    // Add generic payments to external total if they're from external providers
    externalTotal += Number(genericTotal || 0);

    res.json({ success: true, data: { byProvider, externalTotal, genericCount, genericTotal } });
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

    // Handle generic payments - just mark as completed
    if (transaction.type === 'generic') {
      transaction.status = 'completed';
      transaction.completedAt = new Date();
      transaction.notes = transaction.notes || 'Approved manually by admin';
      transaction.processedBy = req.user?._id;
      await transaction.save();

      await sendEmail({
        to: user.email,
        subject: 'Payment approved and completed',
        html: `<p>Your payment for "${transaction.description}" (Tsh ${transaction.amount}) has been approved and completed by admin.</p><p>Transaction ID: ${transaction._id}</p>`,
        text: `Your payment for "${transaction.description}" has been approved.`
      }).catch(err => console.error('Failed to send approval email:', err));

      return res.json({
        success: true,
        message: 'Generic payment approved',
        data: { transactionId: transaction._id, status: 'completed' }
      });
    }

    // Handle server/coin purchase payments
    if (transaction.type === 'purchase' && transaction.packageId) {
      const pkg = await ServerPackage.findById(transaction.packageId);
      const serverName = transaction.metadata?.serverName || `${pkg?.name || 'server'}-${Date.now()}`;
      const serverData = await createServerFromPackage(user, transaction.packageId, serverName, {
        sendEmail: false,
        eggId: transaction.metadata?.eggId,
        dockerImage: transaction.metadata?.dockerImage,
        startupFile: transaction.metadata?.startupFile,
        startupCommand: transaction.metadata?.startupCommand,
        botRepoUrl: transaction.metadata?.botRepoUrl
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

    // Handle coin top-up
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
