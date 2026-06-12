const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

// ==================== CONFIG & MIDDLEWARE ====================
app.use(cors());

// Ukamataji wa rawBody kwa ajili ya usalama wa Webhook
app.use(express.json({
    verify: (req, res, buf) => { req.rawBody = buf.toString(); }
}));

const connectDB = async () => {
    if (mongoose.connection.readyState >= 1) return;
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log("⚡ DB Connected!");
    } catch (err) {
        console.error("❌ DB Error:", err.message);
    }
};

// ==================== DATABASE MODELS ====================
const User = mongoose.models.User || mongoose.model('User', new mongoose.Schema({
    name: { type: String, required: true }, // Lazima iwepo
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    balance: { type: Number, default: 50000 } // Salio la kuanzia (50,000 TZS)
}, { timestamps: true }));

const Order = mongoose.models.Order || mongoose.model('Order', new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    buyer_name: String,
    amount: Number,
    status: { type: String, enum: ['PENDING', 'SUCCESS', 'REJECTED'], default: 'PENDING' },
    plan: String,
    phone: String,
    sonicOrderId: String
}, { timestamps: true }));

const Server = mongoose.models.Server || mongoose.model('Server', new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    owner_name: String,
    host: String,
    user: String,
    pass: String,
    plan: String
}, { timestamps: true }));

const Transaction = mongoose.models.Transaction || mongoose.model('Transaction', new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    type: { type: String, enum: ['credit', 'debit', 'purchase'] },
    amount: Number,
    description: String,
    reference: String,
    balance_before: Number,
    balance_after: Number
}, { timestamps: true }));

// ==================== AUTH HELPERS ====================
const verifyToken = (req, res, next) => {
    const token = req.headers['authorization']?.split(" ")[1];
    if (!token) return res.status(401).json({ success: false, msg: 'Login kwanza!' });
    try {
        // Tunahifadhi data zote muhimu kwenye req.user kutoka kwenye token
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch (err) { res.status(401).json({ success: false, msg: 'Session imeisha' }); }
};

const isAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, msg: 'Huna ruhusa (Admin only)' });
    next();
};

// Sehemu ya kusafisha kiasi cha pesa
const normalizeAmount = (value) => {
    const cleaned = String(value ?? '').replace(/,/g, '').trim();
    if (!cleaned) return 0;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
};

// ==================== SONICPESA WEBHOOK ====================
app.post('/api/webhook/sonicpesa', async (req, res) => {
    try {
        await connectDB();
        const { order_id, status } = req.body;
        
        console.log(`📩 Webhook recvd: ID ${order_id} - Status ${status}`);

        const order = await Order.findOne({ sonicOrderId: order_id });
        if (!order) return res.status(404).send('Order not found');

        if (order.status === 'SUCCESS') return res.status(200).send('Already Processed');

        if (status === 'SUCCESS') {
            order.status = 'SUCCESS';
            await order.save();

            const user = await User.findById(order.userId);
            if (user) {
                const b4 = user.balance;
                user.balance += Number(order.amount);
                await user.save();

                await Transaction.create({
                    userId: user._id,
                    type: 'credit',
                    amount: order.amount,
                    description: 'Salio (Auto-Webhook)',
                    reference: order_id,
                    balance_before: b4,
                    balance_after: user.balance
                });
            }
        } else if (['FAILED', 'CANCELLED'].includes(status)) {
            order.status = 'REJECTED';
            await order.save();
        }

        res.status(200).send('OK');
    } catch (err) {
        console.error("Webhook Error:", err.message);
        res.status(500).send('Error');
    }
});

// ==================== AUTH ROUTES ====================
app.post('/api/auth/signup', async (req, res) => {
    try {
        await connectDB();
        const { name, email, password } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ success: false, msg: 'Jaza nafasi zote (Jina, Email, Password)' });
        }

        const exists = await User.findOne({ email: email.toLowerCase() });
        if (exists) return res.status(400).json({ success: false, msg: 'Email tayari ipo!' });

        const hashed = await bcrypt.hash(password, 10);
        
        // Hapa jina linawekwa vizuri kabisa
        await User.create({ 
            name, 
            email: email.toLowerCase(), 
            password: hashed,
            balance: 50000 
        });

        res.status(201).json({ success: true, msg: 'Acc imeundwa! Umepewa 50,000 TZS' });
    } catch (err) { 
        res.status(500).json({ success: false, msg: err.message }); 
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        await connectDB();
        const { email, password } = req.body;

        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(400).json({ success: false, msg: 'Barua pepe au Nenosiri si sahihi' });
        }

        // MUHIMU: Tunatunza name na email pia kwenye token
        const token = jwt.sign(
            { id: user._id, name: user.name, email: user.email, role: user.role }, 
            process.env.JWT_SECRET, 
            { expiresIn: '7d' }
        );

        res.json({ success: true, token, user: { name: user.name, email: user.email, role: user.role, balance: user.balance } });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

// ==================== USER DATA ROUTES ====================
app.get('/api/user/balance', verifyToken, async (req, res) => {
    try {
        await connectDB();
        const user = await User.findById(req.user.id);
        res.json({ success: true, balance: user?.balance || 0 });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

app.get('/api/user/transactions', verifyToken, async (req, res) => {
    try {
        await connectDB();
        const transactions = await Transaction.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(20);
        res.json({ success: true, transactions });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

// ==================== STK PUSH (SONICPESA) ====================
app.post('/api/pay/stk-push', verifyToken, async (req, res) => {
    try {
        await connectDB();
        const { amount, phone, plan } = req.body;
        const amountValue = normalizeAmount(amount);

        if (amountValue <= 0) return res.status(400).json({ success: false, msg: 'Kiasi hakiko sahihi' });

        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ success: false, msg: 'Mtumiaji hayupo' });

        // Piga API ya SonicPesa kutengeneza oda
        const response = await axios.post('https://api.sonicpesa.com/api/v1/payment/create_order', {
            amount: amountValue,
            buyer_phone: phone,
            buyer_name: user.name || 'Mteja',
            buyer_email: user.email || 'info@mickeyhost.com',
            currency: 'TZS',
            callback_url: "https://mickey-pterodacty.vercel.app/api/webhook/sonicpesa"
        }, {
            headers: { 
                'Content-Type': 'application/json',
                'X-API-KEY': process.env.SONICPESA_API_KEY 
            },
            timeout: 30000
        });

        const sonicId = response.data?.data?.order_id || response.data?.order_id;
        if (!sonicId) return res.status(502).json({ success: false, msg: 'SonicPesa haikutoa Order ID' });

        await Order.create({
            userId: user._id,
            buyer_name: user.name,
            amount: amountValue,
            plan: plan || 'Salio',
            phone: phone || 'N/A',
            sonicOrderId: sonicId,
            status: 'PENDING'
        });

        res.json({ success: true, msg: 'Weka PIN kwenye simu...', sonicId });
    } catch (err) { 
        console.error('❌ STK Error:', err.response?.data || err.message);
        res.status(500).json({ success: false, msg: 'Imeshindikana kutuma ombi la STK.' }); 
    }
});

// ==================== PURCHASE WITH BALANCE (FIXED!) ====================
app.post('/api/vps/purchase-with-balance', verifyToken, async (req, res) => {
    try {
        await connectDB();
        const { plan, amount, phone } = req.body;
        const amountValue = normalizeAmount(amount);
        
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ success: false, msg: 'Mtumiaji hayupo' });
        
        if (user.balance < amountValue) {
            return res.status(400).json({ 
                success: false, 
                msg: `Salio halitoshi! Una TZS ${user.balance.toLocaleString()}. VPS inagharimu TZS ${amountValue.toLocaleString()}.`
            });
        }
        
        // 1. Kata Salio
        const balanceBefore = user.balance;
        user.balance -= amountValue;
        await user.save(); // Hapa haitaleta error ya name tena kwa sababu user ametolewa DB na ana jina tayari
        
        // 2. Rekodi Transaction
        await Transaction.create({
            userId: user._id,
            type: 'purchase',
            amount: amountValue,
            description: `Ununuzi wa VPS - Plan: ${plan}`,
            reference: `VPS_${Date.now()}`,
            balance_before: balanceBefore,
            balance_after: user.balance
        });
        
        // 3. Rekodi Order ya ununuzi
        await Order.create({
            userId: user._id,
            buyer_name: user.name,
            amount: amountValue,
            plan: plan,
            phone: phone || 'N/A',
            status: 'SUCCESS'
        });
        
        // 4. Tengeneza Server mpya
        const tempPassword = crypto.randomBytes(8).toString('hex');
        const newServer = await Server.create({
            userId: user._id,
            owner_name: user.name,
            host: process.env.PTERODACTYL_HOST || 'vps.mickeyhost.com',
            user: `vps_${Date.now().toString().slice(-6)}`,
            pass: tempPassword,
            plan: plan
        });
        
        res.json({ 
            success: true, 
            msg: `Umefanikiwa kununua VPS ya ${plan}!`,
            newBalance: user.balance,
            server: newServer
        });
    } catch (err) {
        console.error('❌ Purchase Error:', err);
        res.status(500).json({ success: false, msg: 'Kuna tatizo lilitokea wakati wa ununuzi.' });
    }
});

// ==================== ADMIN ROUTES ====================
app.post('/api/admin/add-balance', verifyToken, isAdmin, async (req, res) => {
    try {
        const { targetUserId, amount, description } = req.body;
        const user = await User.findById(targetUserId);
        if (!user) return res.status(404).json({ msg: 'User hayupo' });

        const b4 = user.balance;
        user.balance += Number(amount);
        await user.save();

        await Transaction.create({
            userId: user._id,
            type: 'credit',
            amount: Number(amount),
            description: description || 'Salio kuongezwa na Admin',
            balance_before: b4,
            balance_after: user.balance
        });

        res.json({ success: true, msg: 'Salio limeongezwa kikamilifu!' });
    } catch (err) { res.status(500).json({ msg: err.message }); }
});

// Assets Fetching Route
app.get('/api/vps/my-assets', verifyToken, async (req, res) => {
    try { 
        await connectDB(); 
        let servers, pendingOrders;
        const user = await User.findById(req.user.id);
        
        if (req.user.role === 'admin') {
            servers = await Server.find({}).sort({ createdAt: -1 });
            pendingOrders = await Order.find({ status: 'PENDING' }).sort({ createdAt: -1 });
        } else {
            servers = await Server.find({ userId: req.user.id }).sort({ createdAt: -1 });
            pendingOrders = await Order.find({ userId: req.user.id, status: 'PENDING' }).sort({ createdAt: -1 });
        }
        
        res.json({ 
            success: true, 
            servers, 
            pending: pendingOrders,
            balance: user?.balance || 0,
            user: { name: user?.name, email: user?.email, role: user?.role }
        });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', link: 'https://mickey-pterodacty.vercel.app' });
});

// Serve static frontend files
const publicPath = path.join(__dirname, '../public');
app.use(express.static(publicPath));

app.get('*', (req, res) => {
    res.sendFile(path.join(publicPath, 'login.html'));
});

// ==================== SERVER START ====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server inakimbia kwenye PORT ${PORT}`));

module.exports = app;