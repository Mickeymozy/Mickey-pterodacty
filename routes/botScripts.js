const express = require('express');
const axios = require('axios');
const BotScript = require('../models/BotScript');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { writeAuditLog } = require('../utils/auditLog');

const router = express.Router();

function validUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

router.get('/', requireAuth, async (req, res) => {
  const scripts = await BotScript.find({ isActive: true }).select('-zipUrl -createdBy').sort({ createdAt: -1 }).lean();
  const owned = await Transaction.find({ userId: req.user._id, type: 'purchase', status: 'completed', 'metadata.kind': 'bot-script' }).select('metadata.botScriptId').lean();
  const ownedIds = new Set(owned.map((item) => String(item.metadata?.botScriptId)));
  res.json({ success: true, data: scripts.map((script) => ({ ...script, purchased: ownedIds.has(String(script._id)) })) });
});

router.post('/:id/purchase', requireAuth, async (req, res) => {
  const script = await BotScript.findOne({ _id: req.params.id, isActive: true });
  if (!script) return res.status(404).json({ success: false, message: 'Bot script not found' });

  const existing = await Transaction.findOne({ userId: req.user._id, type: 'purchase', status: 'completed', 'metadata.kind': 'bot-script', 'metadata.botScriptId': script._id });
  if (existing) return res.json({ success: true, message: 'Script tayari imenunuliwa.', data: { downloadUrl: `/api/bot-scripts/${script._id}/download` } });

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
  res.json({ success: true, message: 'Script imenunuliwa.', data: { remainingCoins: user.coins, downloadUrl: `/api/bot-scripts/${script._id}/download` } });
});

router.get('/:id/download', requireAuth, async (req, res) => {
  const script = await BotScript.findOne({ _id: req.params.id, isActive: true });
  if (!script) return res.status(404).json({ success: false, message: 'Bot script not found' });
  const paid = await Transaction.exists({ userId: req.user._id, type: 'purchase', status: 'completed', 'metadata.kind': 'bot-script', 'metadata.botScriptId': script._id });
  if (!paid) return res.status(403).json({ success: false, message: 'Lipia script kwanza ili ku-download.' });
  if (!validUrl(script.zipUrl)) return res.status(500).json({ success: false, message: 'Download link ya script si sahihi.' });

  const upstream = await axios.get(script.zipUrl, { responseType: 'stream', timeout: 30000, maxContentLength: 100 * 1024 * 1024 });
  const safeName = script.title.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'bot-script';
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}.zip"`);
  upstream.data.pipe(res);
});

router.get('/admin/all', requireAdmin, async (req, res) => {
  res.json({ success: true, data: await BotScript.find().sort({ createdAt: -1 }).lean() });
});

router.post('/admin', requireAdmin, async (req, res) => {
  const { title, description, previewImageUrl, zipUrl, priceCoins } = req.body;
  if (!title || !description || !validUrl(zipUrl) || !Number.isInteger(Number(priceCoins)) || Number(priceCoins) < 1) {
    return res.status(400).json({ success: false, message: 'Weka title, description, HTTPS ZIP URL na bei ya coins iliyo sahihi.' });
  }
  if (previewImageUrl && !validUrl(previewImageUrl)) return res.status(400).json({ success: false, message: 'Preview URL lazima iwe HTTPS.' });
  const script = await new BotScript({ title, description, previewImageUrl, zipUrl, priceCoins: Number(priceCoins), createdBy: req.user._id }).save();
  await writeAuditLog(req, 'bot_script.created', { type: 'BotScript', id: script._id }, { title: script.title });
  res.status(201).json({ success: true, data: script });
});

router.put('/admin/:id', requireAdmin, async (req, res) => {
  const { title, description, previewImageUrl, zipUrl, priceCoins, isActive } = req.body;
  const script = await BotScript.findById(req.params.id);
  if (!script) return res.status(404).json({ success: false, message: 'Bot script not found' });
  if (title) script.title = title;
  if (description) script.description = description;
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