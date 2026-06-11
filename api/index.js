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

app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf.toString();
    }
}));
app.use(cors());

// Unganisha MongoDB kila hitaji (request) linapoingia kwa ajili ya Vercel Serverless
const connectDB = async () => {
    if (mongoose.connection.readyState >= 1) return;
    try {
        await mongoose.connect(process.env.MONGO_URI, {
            serverSelectionTimeoutMS: 8000 
        });
        console.log("⚡ MongoDB Connected Successfully");
    } catch (err) {
        console.error("❌ MongoDB Connection Failed:", err.message);
        throw new Error("Database connection timeout au hitilafu ya URI");
    }
};

// 1. MONGODB SCHEMAS
const User = mongoose.models.User || mongoose.model('User', new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, index: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['user', 'admin'], default: 'user' }
}));

const Order = mongoose.models.Order || mongoose.model('Order', new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    buyer_name: String,
    sonicOrderId: { type: String, unique: true, index: true },
    amount: Number,
    status: { type: String, enum: ['PENDING', 'SUCCESS', 'CANCELLED', 'REJECTED'], default: 'PENDING' },
    plan: String,
    phone: String
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

// Middleware ya Uthibitishaji
const verifyToken = (req, res, next) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ success: false, message: 'Umekataliwa kuingia. Log in tena.' });
    try {
        const verified = jwt.verify(token.split(" ")[1], process.env.JWT_SECRET);
        req.user = verified;
        next();
    } catch (err) { res.status(400).json({ success: false, message: 'Token isiyo sahihi au imekwisha muda wake.' }); }
};

// 2. AUTHENTICATION ROUTES
app.post('/api/auth/signup', async (req, res) => {
    try {
        await connectDB();
        const { name, email, password } = req.body;
        const exists = await User.findOne({ email: email.toLowerCase() });
        if (exists) return res.status(400).json({ success: false, message: 'Barua pepe hii imeshajisajili!' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const assignRole = (email.toLowerCase() === 'mickidadyhamza@gmail.com') ? 'admin' : 'user';

        const newUser = new User({ 
            name, 
            email: email.toLowerCase(), 
            password: hashedPassword,
            role: assignRole
        });
        await newUser.save();
        res.status(201).json({ success: true, message: 'Usajili umekamilika kikamilifu!' });
    } catch (err) { 
        res.status(500).json({ success: false, message: 'Server Error: ' + err.message }); 
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        await connectDB();
        const { email, password } = req.body;
        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user) return res.status(400).json({ success: false, message: 'Barua pepe au nenosiri si sahihi!' });

        const validPass = await bcrypt.compare(password, user.password);
        if (!validPass) return res.status(400).json({ success: false, message: 'Barua pepe au nenosiri si sahihi!' });

        const token = jwt.sign({ id: user._id, name: user.name, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({ success: true, token, user: { name: user.name, email: user.email, role: user.role } });
    } catch (err) { 
        res.status(500).json({ success: false, message: 'Server Error: ' + err.message }); 
    }
});

// 3. SONICPESA PUSH USSD INITIALIZATION
app.post('/api/vps/create-ussd-order', verifyToken, async (req, res) => {
    try { await connectDB(); } catch(e) { return res.status(500).json({success:false, message: e.message}); }

    const { plan, amount, phone } = req.body;
    const amountValue = Number(amount);

    if (!process.env.SONICPESA_API_KEY) {
        return res.status(500).json({
            success: false,
            message: 'SonicPesa API key haipo. Tumia Vercel env vars ili kuwezesha malipo.'
        });
    }

    if (!phone || !String(phone).trim()) {
        return res.status(400).json({ success: false, message: 'Tafadhali ingiza namba ya simu.' });
    }

    if (!Number.isFinite(amountValue) || amountValue <= 0) {
        return res.status(400).json({ success: false, message: 'Kiasi cha malipo si sahihi.' });
    }

    let formattedPhone = String(phone).trim().replace(/\+/g, '');
    if (formattedPhone.startsWith('0')) {
        formattedPhone = '255' + formattedPhone.substring(1);
    }

    const sonicHeaders = {
        'X-API-KEY': process.env.SONICPESA_API_KEY,
        'Content-Type': 'application/json'
    };

    const sonicPayload = {
        buyer_email: req.user.email,
        buyer_name: req.user.name,
        buyer_phone: formattedPhone,
        amount: Math.round(amountValue),
        currency: 'TZS'
    };

    try {
        const sonicResponse = await axios.post('https://api.sonicpesa.com/api/v1/payment/create_order', sonicPayload, {
            headers: sonicHeaders,
            timeout: 45000
        });

        if (sonicResponse.data.status === 'success') {
            const sonicData = sonicResponse.data.data;
            
            const newOrder = new Order({
                userId: req.user.id,
                buyer_name: req.user.name,
                sonicOrderId: sonicData.order_id,
                amount: sonicData.amount,
                plan: plan,
                phone: formattedPhone,
                status: 'PENDING'
            });
            await newOrder.save();

            res.json({ success: true, message: sonicResponse.data.message, order_id: sonicData.order_id });
        } else {
            res.status(400).json({ success: false, message: sonicResponse.data.message || 'SonicPesa imekataa kutengeneza oda.' });
        }
    } catch (err) {
        const primaryStatus = err.response?.status;
        const primaryMessage = err.response?.data?.message
            || err.response?.data?.error
            || err.response?.data?.detail
            || err.message;

        try {
            if (primaryStatus >= 500 || !primaryMessage) {
                const fallbackResponse = await axios.post('https://api.sonicpesa.com/api/v1/payment/create_order_simple', sonicPayload, {
                    headers: sonicHeaders,
                    timeout: 65000
                });

                if (fallbackResponse.data.status === 'success') {
                    const sonicData = fallbackResponse.data.data || fallbackResponse.data;
                    const newOrder = new Order({
                        userId: req.user.id,
                        buyer_name: req.user.name,
                        sonicOrderId: sonicData.order_id || sonicData.id || `sp-${Date.now()}`,
                        amount: Number(sonicData.amount || amountValue),
                        plan: plan,
                        phone: formattedPhone,
                        status: 'PENDING'
                    });
                    await newOrder.save();

                    return res.json({
                        success: true,
                        message: fallbackResponse.data.message || 'Oda imeundwa kwa SonicPesa.',
                        order_id: sonicData.order_id || sonicData.id
                    });
                }
            }
        } catch (fallbackErr) {
            const fallbackMessage = fallbackErr.response?.data?.message
                || fallbackErr.response?.data?.error
                || fallbackErr.response?.data?.detail
                || fallbackErr.message;

            return res.status(fallbackErr.response?.status || 500).json({
                success: false,
                message: 'Mawasiliano na SonicPesa yamefeli: ' + fallbackMessage
            });
        }

        res.status(primaryStatus || 500).json({
            success: false,
            message: 'Mawasiliano na SonicPesa yamefeli: ' + primaryMessage
        });
    }
});

// 4. SONICPESA SECURE WEBHOOK
app.post('/api/vps/sonicpesa-webhook', async (req, res) => {
    try { await connectDB(); } catch(e) { return res.status(500).send("DB Error"); }

    const receivedSignature = req.headers['x-sonicpesa-signature'];
    const expectedSignature = crypto
        .createHmac('sha256', process.env.SONICPESA_SECRET_KEY)
        .update(req.rawBody)
        .digest('hex');

    if (receivedSignature !== expectedSignature) {
        return res.status(401).send('Invalid Signature.');
    }

    const { event, order_id, status } = req.body;

    try {
        if (event === 'payment.completed' && status === 'SUCCESS') {
            const order = await Order.findOne({ sonicOrderId: order_id });
            if (!order || order.status === 'SUCCESS') return res.status(200).send('Processed Already');

            order.status = 'SUCCESS';
            await order.save();

            const user = await User.findById(order.userId);
            const tempPassword = crypto.randomBytes(4).toString('hex') + 'Mk2026!';
            
            const pteroPayload = {
                name: `${user.name.toLowerCase().replace(/\s+/g, '-')}-vps`,
                user: 1, egg: 1,
                docker_image: "quay.io/pterodactyl/core:java",
                startup: "java -Xms128M -Xmx{{SERVER_MEMORY}}M -jar {{SERVER_JARFILE}}",
                environment: { SERVER_JARFILE: "server.jar" },
                limits: { memory: 2048, swap: 0, disk: 30000, io: 500, cpu: 100 },
                allocation: { default: 1 }
            };

            const pteroRes = await axios.post(`${process.env.PTERODACTYL_URL}/api/application/servers`, pteroPayload, {
                headers: { 'Authorization': `Bearer ${process.env.PTERODACTYL_API_KEY}`, 'Content-Type': 'application/json' }
            });

            const newServer = new Server({
                userId: user._id,
                owner_name: user.name,
                host: process.env.PTERODACTYL_URL.replace('https://', '').replace('http://', ''),
                user: pteroRes.data.attributes.uuid.substring(0, 8),
                pass: tempPassword,
                plan: order.plan
            });
            await newServer.save();

            let transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST, port: process.env.SMTP_PORT, secure: true,
                auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
            });
            await transporter.sendMail({
                from: `"Mickey Host" <${process.env.SMTP_USER}>`,
                to: user.email,
                subject: "VPS Seva Yako Ipo Tayari! 🚀",
                html: `<p>Habari ${user.name}, Seva yako ya <b>${order.plan}</b> ipo tayari.</p>
                       <p>Host: ${newServer.host}<br>User: ${newServer.user}<br>Pass: ${tempPassword}</p>`
            });
        }
        res.status(200).send('OK');
    } catch (err) {
        res.status(500).send('Error');
    }
});

// Njia ya kuokota data za mteja au Admin
app.get('/api/vps/my-assets', verifyToken, async (req, res) => {
    try { 
        await connectDB(); 
        let servers, pending;
        if (req.user.role === 'admin') {
            servers = await Server.find({});
            pending = await Order.find({ status: 'PENDING' });
        } else {
            servers = await Server.find({ userId: req.user.id });
            pending = await Order.find({ userId: req.user.id, status: 'PENDING' });
        }
        res.json({ success: true, servers, pending });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// === INATOKA KWENYE /api/ NA KWENDA KWENYE FOLDER LA /public/ KUSOMA HTML ===
app.get(['/dashboard.html', '/dashboard.js', '/dashboard'], (req, res) => {
    res.sendFile(path.join(__dirname, '../public', 'dashboard.html'));
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../public', 'login.html'));
});

module.exports = app;
