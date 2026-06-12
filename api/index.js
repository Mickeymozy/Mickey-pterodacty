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

// Middleware order - MUHIMU
app.use(express.raw({ type: 'application/json', verify: (req, res, buf) => {
    req.rawBody = buf.toString();
} }));

app.use(express.json({
    verify: (req, res, buf) => {
        if (!req.rawBody) req.rawBody = buf.toString();
    }
}));

app.use(cors());

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
    balance: { type: Number, default: 50000 } // SALIO LA MWANZO 50,000 TZS
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

// ==================== MIDDLEWARE ====================
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
            balance: 50000 // Salio la kuanzia
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
        
        // AUTO LOGIN KWA MAJARIBIO - Ikiwa hakuna email/password, tumia demo user
        if (!email || !password) {
            // Tafuta au unda demo user
            let demoUser = await User.findOne({ email: 'demo@mickeyhost.com' });
            if (!demoUser) {
                demoUser = new User({
                    name: 'Demo User',
                    email: 'demo@mickeyhost.com',
                    password: await bcrypt.hash('demo123', 10),
                    balance: 50000
                });
                await demoUser.save();
            }
            
            const token = jwt.sign({ id: demoUser._id, name: demoUser.name, email: demoUser.email, role: demoUser.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
            return res.json({ success: true, token, user: { name: demoUser.name, email: demoUser.email, role: demoUser.role, balance: demoUser.balance } });
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
// Kupata salio la mteja
app.get('/api/user/balance', verifyToken, async (req, res) => {
    try {
        await connectDB();
        const user = await User.findById(req.user.id);
        res.json({ success: true, balance: user.balance });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Historia ya transactions
app.get('/api/user/transactions', verifyToken, async (req, res) => {
    try {
        await connectDB();
        const transactions = await Transaction.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(20);
        res.json({ success: true, transactions });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Unda oda ya malipo ya SonicPesa / USSD push
app.post('/api/vps/create-ussd-order', verifyToken, async (req, res) => {
    try {
        await connectDB();
        const { plan, amount, phone } = req.body;

        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const amountValue = Number(amount || 0);
        const sonicOrderId = `SONIC-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;

        const order = await Order.create({
            userId: user._id,
            buyer_name: user.name,
            amount: amountValue,
            plan: plan || 'VPS',
            phone: phone || 'N/A',
            status: 'PENDING',
            sonicOrderId,
            paymentMethod: 'SonicPesa'
        });

        res.json({
            success: true,
            message: 'Oda ya malipo imeundwa. Tuma PIN yako ya USSD ili kukamilisha malipo yako.',
            order,
            sonicOrderId
        });
    } catch (err) {
        console.error('USSD order error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Kununua VPS kwa kutumia salio
app.post('/api/vps/purchase-with-balance', verifyToken, async (req, res) => {
    try {
        await connectDB();
        const { plan, amount, phone } = req.body;
        const amountValue = Number(amount);
        
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        
        // Angalia kama ana salio la kutosha
        if (user.balance < amountValue) {
            return res.status(400).json({ 
                success: false, 
                message: `Salio lako ni ${user.balance.toLocaleString()} TZS pekee. Unahitaji ${amountValue.toLocaleString()} TZS.`,
                currentBalance: user.balance,
                required: amountValue,
                shortfall: amountValue - user.balance
            });
        }
        
        // Kata salio
        const balanceBefore = user.balance;
        user.balance = user.balance - amountValue;
        await user.save();
        
        // Rekodi transaction
        const transaction = new Transaction({
            userId: user._id,
            type: 'purchase',
            amount: amountValue,
            description: `Ununuzi wa ${plan} VPS`,
            reference: `VPS_${Date.now()}`,
            balance_before: balanceBefore,
            balance_after: user.balance
        });
        await transaction.save();
        
        // Rekodi order
        const newOrder = new Order({
            userId: user._id,
            buyer_name: user.name,
            amount: amountValue,
            plan: plan,
            phone: phone || 'N/A',
            status: 'SUCCESS'
        });
        await newOrder.save();
        
        // Unda server (demo)
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
        
        // Tuma email (optional)
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
                    html: `<h2>Hongera ${user.name}!</h2><p>Umenunua ${plan} VPS kwa ${amountValue.toLocaleString()} TZS.</p><p>Salio lako sasa: ${user.balance.toLocaleString()} TZS</p>`
                });
            } catch(e) { console.error('Email error:', e); }
        }
        
        res.json({ 
            success: true, 
            message: `Umefanikiwa kununua ${plan} VPS! Salio lako sasa: ${user.balance.toLocaleString()} TZS`,
            newBalance: user.balance,
            server: newServer
        });
        
    } catch (err) {
        console.error('Purchase error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Ongeza salio kwa mtumiaji (mteja anaweza kujaza salio wake mwenyewe)
app.post('/api/user/add-balance', verifyToken, async (req, res) => {
    try {
        await connectDB();
        const { amount, description, userId } = req.body;
        const amountValue = Number(amount);

        if (!Number.isFinite(amountValue) || amountValue <= 0) {
            return res.status(400).json({ success: false, message: 'Kiasi cha salio si sahihi' });
        }

        const targetUserId = req.user.role === 'admin' && userId ? userId : req.user.id;
        const user = await User.findById(targetUserId);

        if (!user) {
            return res.status(404).json({ success: false, message: 'Mtumiaji hayupo' });
        }

        const balanceBefore = user.balance;
        user.balance = user.balance + amountValue;
        await user.save();

        const transaction = new Transaction({
            userId: user._id,
            type: 'credit',
            amount: amountValue,
            description: description || 'Kujaza salio kupitia mfumo wa web',
            balance_before: balanceBefore,
            balance_after: user.balance
        });
        await transaction.save();

        res.json({ success: true, newBalance: user.balance, message: `Salio lako limeongezeka kwa ${amountValue.toLocaleString()} TZS.` });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Get user assets (servers & pending)
app.get('/api/vps/my-assets', verifyToken, async (req, res) => {
    try { 
        await connectDB(); 
        let servers, pendingOrders, user;
        
        user = await User.findById(req.user.id);
        
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

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        hasMongoUri: !!process.env.MONGO_URI,
        hasJwtSecret: !!process.env.JWT_SECRET
    });
});

// Serve static files
const publicPath = path.join(__dirname, '../public');
app.use(express.static(publicPath));

app.get('*', (req, res) => {
    res.sendFile(path.join(publicPath, 'login.html'));
});

module.exports = app;