const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const BotScript = require('../models/BotScript');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { writeAuditLog } = require('../utils/auditLog');
const palmPesaService = require('../services/palmPesaService');
const sendEmail = require('../utils/email');

const router = express.Router();

function validUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

const downloadSecret = process.env.DOWNLOAD_LINK_SECRET || process.env.SESSION_SECRET || 'development-download-secret';
const createDownloadToken = (userId, scriptId, expiresAt) => {
  const payload = `${userId}.${scriptId}.${expiresAt}`;
  const signature = crypto.createHmac('sha256', downloadSecret).update(payload).digest('hex');
  return Buffer.from(`${payload}.${signature}`).toString('base64url');
};
const readDownloadToken = (token) => {
  try {
    const decoded = Buffer.from(String(token), 'base64url').toString();
    const [userId, scriptId, expiresAt, signature] = decoded.split('.');
    const payload = `${userId}.${scriptId}.${expiresAt}`;
    const expected = crypto.createHmac('sha256', downloadSecret).update(payload).digest('hex');
    if (!userId || !scriptId || !expiresAt || !signature || Number(expiresAt) < Date.now() || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    return { userId, scriptId };
  } catch (_) {
    return null;
  }
};

const downloadLinkFor = (userId, scriptId) => {
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
  return `${process.env.APP_URL || ''}/api/bot-scripts/download/${createDownloadToken(userId, scriptId, expiresAt)}`;
};

router.get('/', requireAuth, async (req, res) => {
  const query = String(req.query.q || '').trim();
  const category = String(req.query.category || '').trim();
  const filter = { isActive: true };
  if (category) filter.category = category;
  if (query) filter.$or = [{ title: { $regex: query, $options: 'i' } }, { description: { $regex: query, $options: 'i' } }, { tags: { $regex: query, $options: 'i' } }];
  const scripts = await BotScript.find(filter).select('-zipUrl -createdBy').sort({ createdAt: -1 }).lean();
  const owned = await Transaction.find({ userId: req.user._id, type: 'purchase', status: 'completed', 'metadata.kind': 'bot-script' }).select('metadata.botScriptId').lean();
  const ownedIds = new Set(owned.map((item) => String(item.metadata?.botScriptId)));
  res.json({ success: true, data: scripts.map((script) => ({ ...script, purchased: ownedIds.has(String(script._id)) })) });
});

router.get('/categories', requireAuth, async (req, res) => {
  res.json({ success: true, data: await BotScript.distinct('category', { isActive: true }) });
});

router.get('/mine', requireAuth, async (req, res) => {
  const purchases = await Transaction.find({ userId: req.user._id, type: 'purchase', status: 'completed', 'metadata.kind': 'bot-script' }).sort({ createdAt: -1 }).lean();
  const ids = purchases.map((purchase) => purchase.metadata?.botScriptId).filter(Boolean);
  const scripts = await BotScript.find({ _id: { $in: ids } }).select('-zipUrl').lean();
  res.json({ success: true, data: scripts.map((script) => ({ ...script, purchasedAt: purchases.find((purchase) => String(purchase.metadata.botScriptId) === String(script._id))?.completedAt })) });
});

router.post('/:id/purchase', requireAuth, async (req, res) => {
  const script = await BotScript.findOne({ _id: req.params.id, isActive: true });
  if (!script) return res.status(404).json({ success: false, message: 'Bot script not found' });

  const existing = await Transaction.findOne({ userId: req.user._id, type: 'purchase', status: 'completed', 'metadata.kind': 'bot-script', 'metadata.botScriptId': script._id });
  if (existing) return res.json({ success: true, message: 'Script tayari imenunuliwa.', data: { downloadUrl: downloadLinkFor(req.user._id, script._id) } });

  const paymentMethod = String(req.body.paymentMethod || 'palmpesa').toLowerCase();
  if (paymentMethod === 'wallet' || paymentMethod === 'coins') {
    return purchaseWithWallet(req, res, script);
  }
  if (paymentMethod !== 'palmpesa') return res.status(400).json({ success: false, message: 'Chagua PalmPesa au Coins.' });

  const transaction = await new Transaction({
    userId: req.user._id,
    type: 'purchase',
    amount: Math.max(1, Math.round(script.priceCoins * Number(process.env.COIN_TOPUP_RATE_TZS || 250))),
    currency: 'TZS',
    paymentMethod: 'palmpesa',
    paymentProvider: 'palmpesa',
    status: 'pending',
    description: `Bot script: ${script.title}`,
    metadata: { kind: 'bot-script', botScriptId: script._id, title: script.title, coinsPrice: script.priceCoins, phone: req.body.phone || '', downloadUrl: downloadLinkFor(req.user._id, script._id) }
  }).save();
  const paymentResult = await palmPesaService.createPayment({
    user_id: process.env.PALMPESA_USER_ID,
    vendor: process.env.PALMPESA_VENDOR,
    order_id: transaction._id.toString(),
    customerEmail: req.user.email,
    customerName: req.user.username,
    customerPhone: req.body.phone || req.user.phone || '',
    amount: transaction.amount,
    currency: 'TZS',
    redirectUrl: process.env.PALMPESA_REDIRECT_URL || process.env.APP_URL,
    cancelUrl: process.env.PALMPESA_CANCEL_URL || `${process.env.APP_URL || ''}/cancel`,
    webhookUrl: process.env.PALMPESA_WEBHOOK_URL || `${process.env.APP_URL || ''}/api/payment/webhook`,
    description: `Bot script ${script.title} - ${req.user.email}`
  });
  if (!paymentResult.success) {
    transaction.status = 'failed'; transaction.notes = paymentResult.error; await transaction.save();
    return res.status(400).json({ success: false, message: paymentResult.error || 'PalmPesa imeshindikana kuanzisha malipo.' });
  }
  transaction.zenopayTransactionId = paymentResult.orderId || paymentResult.transactionId;
  transaction.zenopayReference = paymentResult.reference;
  transaction.metadata = { ...transaction.metadata, paymentUrl: paymentResult.paymentUrl, palmpesaOrderId: transaction.zenopayTransactionId };
  await transaction.save();
  res.json({ success: true, message: 'Malipo ya PalmPesa yameanzishwa.', data: { transactionId: transaction._id, paymentUrl: paymentResult.paymentUrl, paymentInitiated: true } });
});

async function purchaseWithWallet(req, res, script) {

  const user = await User.findOneAndUpdate(
    { _id: req.user._id, coins: { $gte: script.priceCoins } },
    { $inc: { coins: -script.priceCoins } },
    { new: true }
  );
  if (!user) return res.status(400).json({ success: false, message: 'Coins hazitoshi kununua script hii.' });

  try {
    await new Transaction({
      userId: user._id,
      type: 'purchase',
      amount: script.priceCoins,
      currency: 'coins',
      paymentMethod: 'wallet',
      paymentProvider: 'wallet',
      status: 'completed',
      description: `Bot script: ${script.title}`,
      completedAt: new Date(),
      metadata: { kind: 'bot-script', botScriptId: script._id, title: script.title }
    }).save();
  } catch (error) {
    await User.updateOne({ _id: user._id }, { $inc: { coins: script.priceCoins } });
    throw error;
  }

  await writeAuditLog(req, 'bot_script.purchased', { type: 'BotScript', id: script._id }, { priceCoins: script.priceCoins });
  const downloadUrl = downloadLinkFor(user._id, script._id);
  await sendEmail({ to: user.email, subject: `Bot script yako iko tayari: ${script.title}`, text: `Umenunua ${script.title}. Download link yako itaisha baada ya saa 24: ${downloadUrl}`, html: `<h1 style="margin:0 0 16px; color:#173638;">Bot script iko tayari</h1><p>Umenunua <strong>${script.title}</strong> kwa coins ${script.priceCoins}.</p><p><a href="${downloadUrl}" style="display:inline-block; padding:13px 20px; border-radius:9px; background:#0f766e; color:#fff; font-weight:700; text-decoration:none;">Download ZIP</a></p><p style="color:#718083; font-size:13px;">Link hii itaisha baada ya saa 24.</p>` });
  res.json({ success: true, message: 'Script imenunuliwa.', data: { remainingCoins: user.coins, downloadUrl } });
}

async function streamDownload(req, res, scriptId, userId) {
  const script = await BotScript.findById(scriptId);
  if (!script) return res.status(404).json({ success: false, message: 'Bot script not found' });
  const paid = await Transaction.exists({ userId: userId, type: 'purchase', status: 'completed', 'metadata.kind': 'bot-script', 'metadata.botScriptId': script._id });
  if (!paid) return res.status(403).json({ success: false, message: 'Lipia script kwanza ili ku-download.' });
  if (!validUrl(script.zipUrl)) return res.status(500).json({ success: false, message: 'Download link ya script si sahihi.' });

  const upstream = await axios.get(script.zipUrl, { responseType: 'stream', timeout: 30000, maxContentLength: 100 * 1024 * 1024 });
  const safeName = script.title.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'bot-script';
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}.zip"`);
  upstream.data.pipe(res);
}

router.get('/:id/download', requireAuth, async (req, res) => res.redirect(downloadLinkFor(req.user._id, req.params.id)));
router.get('/download/:token', async (req, res) => {
  const tokenData = readDownloadToken(req.params.token);
  if (!tokenData) return res.status(403).json({ success: false, message: 'Download link imeisha au si sahihi.' });
  return streamDownload(req, res, tokenData.scriptId, tokenData.userId);
});

router.post('/:id/rating', requireAuth, async (req, res) => {
  const rating = Number(req.body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ success: false, message: 'Rating lazima iwe kati ya 1 na 5.' });
  const script = await BotScript.findById(req.params.id);
  const paid = await Transaction.exists({ userId: req.user._id, type: 'purchase', status: 'completed', 'metadata.kind': 'bot-script', 'metadata.botScriptId': script?._id });
  if (!script || !paid) return res.status(403).json({ success: false, message: 'Nunua script kwanza ili ku-rate.' });
  script.ratingAverage = ((script.ratingAverage * script.ratingCount) + rating) / (script.ratingCount + 1);
  script.ratingCount += 1;
  await script.save();
  res.json({ success: true, data: { ratingAverage: script.ratingAverage, ratingCount: script.ratingCount } });
});

router.get('/admin/all', requireAdmin, async (req, res) => {
  res.json({ success: true, data: await BotScript.find().sort({ createdAt: -1 }).lean() });
});

router.get('/admin/analytics', requireAdmin, async (req, res) => {
  const [scripts, sales, revenue, categories] = await Promise.all([
    BotScript.countDocuments(),
    Transaction.countDocuments({ type: 'purchase', status: 'completed', 'metadata.kind': 'bot-script' }),
    Transaction.aggregate([{ $match: { type: 'purchase', status: 'completed', 'metadata.kind': 'bot-script' } }, { $group: { _id: null, coins: { $sum: '$metadata.coinsPrice' }, tzs: { $sum: '$amount' } } }]),
    BotScript.aggregate([{ $group: { _id: '$category', scripts: { $sum: 1 }, sales: { $sum: 0 } } }, { $sort: { scripts: -1 } }])
  ]);
  res.json({ success: true, data: { scripts, sales, revenue: revenue[0] || { coins: 0, tzs: 0 }, categories } });
});

router.post('/admin', requireAdmin, async (req, res) => {
  const { title, description, category = 'General', tags = [], previewImageUrl, zipUrl, priceCoins } = req.body;
  if (!title || !description || !validUrl(zipUrl) || !Number.isInteger(Number(priceCoins)) || Number(priceCoins) < 1) {
    return res.status(400).json({ success: false, message: 'Weka title, description, HTTPS ZIP URL na bei ya coins iliyo sahihi.' });
  }
  if (previewImageUrl && !validUrl(previewImageUrl)) return res.status(400).json({ success: false, message: 'Preview URL lazima iwe HTTPS.' });
  const script = await new BotScript({ title, description, category, tags, previewImageUrl, zipUrl, priceCoins: Number(priceCoins), createdBy: req.user._id }).save();
  await writeAuditLog(req, 'bot_script.created', { type: 'BotScript', id: script._id }, { title: script.title });
  res.status(201).json({ success: true, data: script });
});

router.put('/admin/:id', requireAdmin, async (req, res) => {
  const { title, description, category, tags, previewImageUrl, zipUrl, priceCoins, isActive } = req.body;
  const script = await BotScript.findById(req.params.id);
  if (!script) return res.status(404).json({ success: false, message: 'Bot script not found' });
  if (title) script.title = title;
  if (description) script.description = description;
  if (category) script.category = category;
  if (Array.isArray(tags)) script.tags = tags;
  if (previewImageUrl !== undefined) script.previewImageUrl = previewImageUrl;
  if (zipUrl) script.zipUrl = zipUrl;
  if (priceCoins !== undefined) script.priceCoins = Number(priceCoins);
  if (typeof isActive === 'boolean') script.isActive = isActive;
  if (!validUrl(script.zipUrl) || (script.previewImageUrl && !validUrl(script.previewImageUrl)) || !Number.isInteger(script.priceCoins) || script.priceCoins < 1) return res.status(400).json({ success: false, message: 'Script data si sahihi.' });
  await script.save();
  res.json({ success: true, data: script });
});

router.delete('/admin/:id', requireAdmin, async (req, res) => {
  const script = await BotScript.findByIdAndDelete(req.params.id);
  if (!script) return res.status(404).json({ success: false, message: 'Bot script not found' });
  res.json({ success: true, message: 'Bot script imefutwa.' });
});

module.exports = router;