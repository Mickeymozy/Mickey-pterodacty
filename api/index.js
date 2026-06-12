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
        console.log("⚡ DB Imeunganishwa");
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
    balance: { type: Number, default: 0 }
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
    type: { type: String, enum: ['credit', 'debit'] },
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

// ==================== SONICPESA WEBHOOK (LINK YAKO) ====================
/**
 * URL HII: https://mickey-vps.vercel.app/api/webhook/sonicpesa
 * Isajili kwenye Dashboard ya SonicPesa
 */
app.post('/api/webhook/sonicpesa', async (req, res) => {
    try {
        await connectDB();
        const { order_id, status, amount } = req.body;
        
        console.log(`📩 Webhook imepokelewa: ID ${order_id} - Status ${status}`);

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

// ==================== USER ROUTES ====================
app.post('/api/auth/signup', async (req, res) => {
    try {
        await connectDB();
        const { name, email, password } = req.body;
        const hashed = await bcrypt.hash(password, 10);
        const user = await User.create({ name, email: email.toLowerCase(), password: hashed });
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
        const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({ success: true, token, balance: user.balance });
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
            callback_url: "https://mickey-vps.vercel.app/api/webhook/sonicpesa" 
        }, {
            headers: { 'X-API-KEY': process.env.SONICPESA_API_KEY }
        });

        const sonicId = response.data.data.order_id;

        const order = await Order.create({
            userId: req.user.id,
            amount,
            plan: plan || 'Salio',
            sonicOrderId: sonicId,
            status: 'PENDING'
        });

        res.json({ success: true, msg: 'Weka PIN kwenye simu...', sonicId });
    } catch (err) { res.status(500).json({ success: false, msg: 'SonicPesa Error' }); }
});

// ==================== ADMIN ROUTES ====================
app.post('/api/admin/add-balance', verifyToken, isAdmin, async (req, res) => {
    try {
        const { targetUserId, amount } = req.body;
        const user = await User.findById(targetUserId);
        if (!user) return res.status(404).json({ msg: 'User hayupo' });

        user.balance += Number(amount);
        await user.save();
        res.json({ success: true, msg: 'Salio limeongezwa!' });
    } catch (err) { res.status(500).json({ msg: err.message }); }
});

// ==================== SERVER START ====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server ipo PORT ${PORT}`));