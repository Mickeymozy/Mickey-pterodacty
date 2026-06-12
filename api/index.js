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

// ==================== MIDDLEWARE CONFIG ====================
app.use(cors());

// Toleo hili linachanganya express.json na ukamataji wa rawBody vizuri bila kuharibu req.body
app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf.toString();
    }
}));

const connectDB = async () => {
    if (mongoose.connection.readyState >= 1) return;
    try {
        await mongoose.connect(process.env.MONGO_URI, {
            serverSelectionTimeoutMS: 8000 
        });
        console.log("⚡ MongoDB Connected");
    } catch (err) {
        console.error("❌ DB Error:", err.message);
    }
};

// ==================== SCHEMAS ====================
const User = mongoose.models.User || mongoose.model('User', new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    balance: { type: Number, default: 50000 }
}, { timestamps: true }));

const Order = mongoose.models.Order || mongoose.model('Order', new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    buyer_name: String,
    amount: Number,
    status: { type: String, enum: ['PENDING', 'SUCCESS', 'CANCELLED', 'REJECTED'], default: 'PENDING' },
    plan: String,
    phone: String,
    sonicOrderId: String,
    paymentMethod: { type: String, default: 'SonicPesa' }
}, { timestamps: true }));

const Server = mongoose.models.Server || mongoose.model('Server', new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    owner_name: String,
    host: String,
    user: String,
    pass: String,
    port: { type: String, default: '22' },
    plan: String
}));

const Transaction = mongoose.models.Transaction || mongoose.model('Transaction', new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    type: { type: String, enum: ['credit', 'debit', 'purchase'] },
    amount: Number,
    description: String,
    reference: String,
    balance_before: Number,
    balance_after: Number
}, { timestamps: true }));

// ==================== MIDDLEWARES ====================
const verifyToken = (req, res, next) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ success: false, message: 'Token missing' });
    try {
        const verified = jwt.verify(token.split(" ")[1], process.env.JWT_SECRET);
        req.user = verified;
        next();
    } catch (err) { 
        res.status(401).json({ success: false, message: 'Invalid token' }); 
    }
};

// Middleware ya kuzuia wasio ma-admin
const verifyAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ success: false, message: 'Access denied. Admins only.' });
    }
};

const SONICPESA_BASE_URL = (process.env.SONICPESA_BASE_URL || 'https://api.sonicpesa.com/api/v1').replace(/\/+$/, '');

const normalizeAmount = (value) => {
    const cleaned = String(value ?? '').replace(/,/g, '').trim();
    if (!cleaned) return 0;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
};

const createSonicPesaOrder = async (payload) => {
    const apiKey = process.env.SONICPESA_API_KEY;
    if (!apiKey) throw new Error('SONICPESA_API_KEY is not configured');

    return axios.post(`${SONICPESA_BASE_URL}/payment/create_order`, payload, {
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
        timeout: 60000
    });
};

const checkSonicPesaOrderStatus = async (orderId) => {
    const apiKey = process.env.SONICPESA_API_KEY;
    if (!apiKey) throw new Error('SONICPESA_API_KEY is not configured');

    return axios.post(`${SONICPESA_BASE_URL}/payment/order_status`, { order_id: orderId }, {
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
        timeout: 60000
    });
};

// ==================== AUTH ROUTES ====================
app.post('/api/auth/signup', async (req, res) => {
    try {
        await connectDB();
        const { name, email, password } = req.body;
        
        if (!name || !email || !password) {
            return res.status(400).json({ success: false, message: 'Fill all fields' });
        }
        
        const exists = await User.findOne({ email: email.toLowerCase() });
        if (exists) return res.status(400).json({ success: false, message: 'Email already exists' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ 
            name, 
            email: email.toLowerCase(), 
            password: hashedPassword,
            balance: 50000 
        });
        await newUser.save();
        
        res.status(201).json({ success: true, message: 'Account created! Balance: 50,000 TZS' });
    } catch (err) { 
        res.status(500).json({ success: false, message: err.message }); 
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        await connectDB();
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Tafadhali ingiza barua pepe na nenosiri.' });
        }

        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user) return res.status(400).json({ success: false, message: 'Invalid credentials' });

        const validPass = await bcrypt.compare(password, user.password);
        if (!validPass) return res.status(400).json({ success: false, message: 'Invalid credentials' });

        const token = jwt.sign({ id: user._id, name: user.name, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({ success: true, token, user: { name: user.name, email: user.email, role: user.role, balance: user.balance } });
    } catch (err) { 
        res.status(500).json({ success: false, message: err.message }); 
    }
});

// ==================== BALANCE & PURCHASE ROUTES ====================
app.get('/api/user/balance', verifyToken, async (req, res) => {
    try {
        await connectDB();
        const user = await User.findById(req.user.id);
        res.json({ success: true, balance: user.balance });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/user/transactions', verifyToken, async (req, res) => {
    try {
        await connectDB();
        const transactions = await Transaction.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(20);
        res.json({ success: true, transactions });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/vps/create-ussd-order', verifyToken, async (req, res) => {
    try {
        await connectDB();
        const { plan, amount, phone } = req.body;

        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        const amountValue = normalizeAmount(amount);
        if (amountValue <= 0) return res.status(400).json({ success: false, message: 'Kiasi cha malipo si sahihi.' });

        const sonicResponse = await createSonicPesaOrder({
            buyer_email: user.email,
            buyer_name: user.name,
            buyer_phone: phone,
            amount: amountValue,
            currency: 'TZS'
        });

        const providerOrderId = sonicResponse?.data?.data?.order_id || sonicResponse?.data?.order_id || null;
        if (!providerOrderId) {
            return res.status(502).json({ success: false, message: 'SonicPesa hakuweza kutoa nambari ya oda.' });
        }

        const order = await Order.create({
            userId: user._id,
            buyer_name: user.name,
            amount: amountValue,
            plan: plan || 'Kujaza Salio',
            phone: phone || 'N/A',
            status: 'PENDING',
            sonicOrderId: providerOrderId,
            paymentMethod: 'SonicPesa'
        });

        res.json({
            success: true,
            message: 'Ombi la STK limeundwa. Weka PIN kwenye simu yako kukamilisha.',
            order,
            sonicOrderId: providerOrderId
        });
    } catch (err) {
        console.error('USSD order error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/vps/check-order-status', verifyToken, async (req, res) => {
    try {
        await connectDB();
        const { orderId } = req.body;

        if (!orderId) return res.status(400).json({ success: false, message: 'orderId inahitajika.' });

        const order = await Order.findOne({ sonicOrderId: orderId, userId: req.user.id });
        if (!order) return res.status(404).json({ success: false, message: 'Oda haikupatikana.' });

        // Ulinzi: Kama oda ishakamilika (SUCCESS), usirudie kuongeza salio
        if (order.status === 'SUCCESS') {
            const user = await User.findById(req.user.id);
            return res.json({ success: true, message: 'Oda tayari ilishalipwa.', status: 'SUCCESS', newBalance: user.balance });
        }

        const statusResponse = await checkSonicPesaOrderStatus(orderId);
        const paymentStatus = statusResponse?.data?.data?.payment_status || statusResponse?.data?.payment_status || 'PENDING';

        if (paymentStatus === 'SUCCESS') {
            order.status = 'SUCCESS';
            await order.save();

            const user = await User.findById(req.user.id);
            const balanceBefore = user.balance;
            user.balance += Number(order.amount || 0);
            await user.save();

            await new Transaction({
                userId: user._id,
                type: 'credit',
                amount: Number(order.amount || 0),
                description: 'Kujaza salio kupitia SonicPesa',
                reference: orderId,
                balance_before: balanceBefore,
                balance_after: user.balance
            }).save();

            return res.json({ success: true, message: 'Salio lako limeongezeka.', status: 'SUCCESS', newBalance: user.balance });
        } else if (paymentStatus === 'FAILED' || paymentStatus === 'CANCELLED' || paymentStatus === 'REJECTED') {
            order.status = 'REJECTED';
            await order.save();
        }

        res.json({ success: true, status: order.status, order });
    } catch (err) {
        console.error('Order status error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/vps/purchase-with-balance', verifyToken, async (req, res) => {
    try {
        await connectDB();
        const { plan, amount, phone } = req.body;
        const amountValue = normalizeAmount(amount);
        
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        
        if (user.balance < amountValue) {
            return res.status(400).json({ 
                success: false, 
                message: `Salio lako ni ${user.balance.toLocaleString()} TZS pekee. Unahitaji ${amountValue.toLocaleString()} TZS.`
            });
        }
        
        const balanceBefore = user.balance;
        user.balance -= amountValue;
        await user.save();
        
        await new Transaction({
            userId: user._id,
            type: 'purchase',
            amount: amountValue,
            description: `Ununuzi wa ${plan} VPS`,
            reference: `VPS_${Date.now()}`,
            balance_before: balanceBefore,
            balance_after: user.balance
        }).save();
        
        await new Order({
            userId: user._id,
            buyer_name: user.name,
            amount: amountValue,
            plan: plan,
            phone: phone || 'N/A',
            status: 'SUCCESS'
        }).save();
        
        const tempPassword = crypto.randomBytes(8).toString('hex');
        const newServer = new Server({
            userId: user._id,
            owner_name: user.name,
            host: process.env.PTERODACTYL_HOST || 'vps.mickeyhost.com',
            user: `vps_${Date.now().toString().slice(-6)}`,
            pass: tempPassword,
            plan: plan
        });
        await newServer.save();
        
        if (process.env.SMTP_HOST && process.env.SMTP_USER) {
            try {
                let transporter = nodemailer.createTransport({
                    host: process.env.SMTP_HOST, 
                    port: parseInt(process.env.SMTP_PORT) || 465, 
                    secure: true,
                    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
                });
                await transporter.sendMail({
                    from: `"Mickey Host" <${process.env.SMTP_USER}>`,
                    to: user.email,
                    subject: "VPS Purchase Confirmation",
                    html: `<h2>Hongera ${user.name}!</h2><p>Umenunua ${plan} VPS kwa ${amountValue.toLocaleString()} TZS.</p>`
                });
            } catch(e) { console.error('Email error:', e); }
        }
        
        res.json({ 
            success: true, 
            message: `Umefanikiwa kununua ${plan} VPS!`,
            newBalance: user.balance,
            server: newServer
        });
    } catch (err) {
        console.error('Purchase error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// USALAMA: Sasa ipo locked kwa ajili ya Admin tu (Manual adjustment)
app.post('/api/user/add-balance', verifyToken, verifyAdmin, async (req, res) => {
    try {
        await connectDB();
        const { amount, description, userId } = req.body;
        const amountValue = Number(amount);

        if (!Number.isFinite(amountValue) || amountValue <= 0) {
            return res.status(400).json({ success: false, message: 'Kiasi cha salio si sahihi' });
        }

        if (!userId) return res.status(400).json({ success: false, message: 'userId inahitajika' });

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ success: false, message: 'Mtumiaji hayupo' });

        const balanceBefore = user.balance;
        user.balance += amountValue;
        await user.save();

        await new Transaction({
            userId: user._id,
            type: 'credit',
            amount: amountValue,
            description: description || 'Salio kuongezwa na Admin',
            balance_before: balanceBefore,
            balance_after: user.balance
        }).save();

        res.json({ success: true, newBalance: user.balance, message: `Salio la mtumiaji limeongezeka kwa ${amountValue.toLocaleString()} TZS.` });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

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
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        hasMongoUri: !!process.env.MONGO_URI,
        hasJwtSecret: !!process.env.JWT_SECRET
    });
});

const publicPath = path.join(__dirname, '../public');
app.use(express.static(publicPath));

app.get('*', (req, res) => {
    res.sendFile(path.join(publicPath, 'login.html'));
});

module.exports = app;