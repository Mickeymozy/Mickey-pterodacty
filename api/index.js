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

// Tunatumia verify kukamata rawBody kwa ajili ya usalama wa Webhook baadae
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
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    balance: { type: Number, default: 50000 } // Salio la kuanzia (50,000 TZS)
}, { timestamps: true }));

const Order = mongoose.models.Order || mongoose.model('Order', new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    amount: Number,
    status: { type: String, enum: ['PENDING', 'SUCCESS', 'REJECTED'], default: 'PENDING' },
    plan: String,
    sonicOrderId: String
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
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch (err) { res.status(401).json({ success: false, msg: 'Session imeisha' }); }
};

const isAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, msg: 'Huna ruhusa (Admin only)' });
    next();
};

// ==================== SONICPESA WEBHOOK (LINK YAKO SAHIHI) ====================
/**
 * URL HII: https://mickey-pterodacty.vercel.app/api/webhook/sonicpesa
 * Isajili kwenye Dashboard ya SonicPesa
 */
app.post('/api/webhook/sonicpesa', async (req, res) => {
    try {
        await connectDB();
        const { order_id, status, amount } = req.body;
        
        console.log(`📩 Webhook recvd: ID ${order_id} - Status ${status}`);

        const order = await Order.findOne({ sonicOrderId: order_id });
        if (!order) return res.status(404).json({ success: false, msg: 'Oda haipo' });

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
                console.log(`⚡ Salio la ${user.name} limeongezeka auto!`);
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
        const hashed = await bcrypt.hash(password, 10);
        await User.create({ name, email: email.toLowerCase(), password: hashed });
        res.status(201).json({ success: true, msg: 'Acc imeundwa!' });
    } catch (err) { res.status(400).json({ success: false, msg: 'Email tayari ipo' }); }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        await connectDB();
        const user = await User.findOne({ email: req.body.email.toLowerCase() });
        if (!user || !(await bcrypt.compare(req.body.password, user.password))) {
            return res.status(400).json({ success: false, msg: 'Login failed' });
        }
        const token = jwt.sign({ id: user._id, name: user.name, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({ success: true, token, user: { name: user.name, email: user.email, role: user.role, balance: user.balance } });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

// ==================== USER DATA ROUTES ====================
app.get('/api/user/balance', verifyToken, async (req, res) => {
    try {
        await connectDB();
        const user = await User.findById(req.user.id);
        res.json({ success: true, balance: user.balance });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

app.get('/api/user/transactions', verifyToken, async (req, res) => {
    try {
        await connectDB();
        const transactions = await Transaction.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(20);
        res.json({ success: true, transactions });
    } catch (err) { res.status(500).json({ success: false, msg: err.message }); }
});

// ==================== PAYMENT ROUTES ====================
app.post('/api/pay/stk-push', verifyToken, async (req, res) => {
    try {
        await connectDB();
        const { amount, phone, plan } = req.body;

        // Piga API ya SonicPesa kutengeneza oda
        const response = await axios.post('https://api.sonicpesa.com/api/v1/payment/create_order', {
            amount,
            buyer_phone: phone,
            buyer_email: req.user.email,
            callback_url: "https://mickey-pterodacty.vercel.app/api/webhook/sonicpesa" // Link yako mpya sahihi
        }, {
            headers: { 'X-API-KEY': process.env.SONICPESA_API_KEY }
        });

        const sonicId = response.data?.data?.order_id || response.data?.order_id;
        if (!sonicId) return res.status(502).json({ success: false, msg: 'SonicPesa order failed' });

        await Order.create({
            userId: req.user.id,
            amount,
            plan: plan || 'Salio',
            sonicOrderId: sonicId,
            status: 'PENDING'
        });

        res.json({ success: true, msg: 'Weka PIN kwenye simu...', sonicId });
    } catch (err) { 
        console.error('STK Error:', err.message);
        res.status(500).json({ success: false, msg: 'SonicPesa Error' }); 
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

        res.json({ success: true, msg: 'Salio limeongezwa!' });
    } catch (err) { res.status(500).json({ msg: err.message }); }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', link: 'https://mickey-pterodacty.vercel.app' });
});

// Serve static files (Frontend dashboard, nk.)
const publicPath = path.join(__dirname, '../public');
app.use(express.static(publicPath));

app.get('*', (req, res) => {
    res.sendFile(path.join(publicPath, 'login.html'));
});

// ==================== SERVER START ====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server up kwenye PORT ${PORT}`));

module.exports = app;