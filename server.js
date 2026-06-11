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

// SonicPesa inahitaji raw body kwa ajili ya HMAC verification kwenye webhook
app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf.toString();
    }
}));
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// 1. MONGODB SCHEMAS
const UserSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, index: true },
    password: { type: String, required: true }
});
const User = mongoose.model('User', UserSchema);

const OrderSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    sonicOrderId: { type: String, unique: true, index: true },
    amount: Number,
    status: { type: String, enum: ['PENDING', 'SUCCESS', 'CANCELLED', 'REJECTED'], default: 'PENDING' },
    plan: String,
    phone: String
}, { timestamps: true });
const Order = mongoose.model('Order', OrderSchema);

const ServerSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    host: String,
    user: String,
    pass: String,
    port: { type: String, default: '22' },
    plan: String
});
const Server = mongoose.model('Server', ServerSchema);

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('⚡ Mickey Host MongoDB Connected Successfully'))
    .catch(err => console.error('❌ MongoDB Error:', err));

// Middleware ya Uthibitishaji wa Token
const verifyToken = (req, res, next) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ message: 'Umekataliwa kuingia' });
    try {
        const verified = jwt.verify(token.split(" ")[1], process.env.JWT_SECRET);
        req.user = verified;
        next();
    } catch (err) { res.status(400).json({ message: 'Token Isiyo sahihi' }); }
};

// 2. AUTHENTICATION ROUTES
app.post('/api/auth/signup', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        const exists = await User.findOne({ email });
        if (exists) return res.status(400).json({ message: 'Barua pepe hii imeshajisajili!' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ name, email, password: hashedPassword });
        await newUser.save();
        res.status(201).json({ message: 'Usajili umekamilika!' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ message: 'Barua pepe au nenosiri si sahihi!' });

        const validPass = await bcrypt.compare(password, user.password);
        if (!validPass) return res.status(400).json({ message: 'Barua pepe au nenosiri si sahihi!' });

        const token = jwt.sign({ id: user._id, name: user.name, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: { name: user.name, email: user.email } });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. SONICPESA PUSH USSD INITIALIZATION
app.post('/api/vps/create-ussd-order', verifyToken, async (req, res) => {
    const { plan, amount, phone } = req.body;
    
    // Kusafisha namba ya simu iwe kwenye mfumo wa 255xxxxxxxxx
    let formattedPhone = phone.trim().replace('+', '');
    if (formattedPhone.startsWith('0')) {
        formattedPhone = '255' + formattedPhone.substring(1);
    }

    try {
        // Kuomba Push USSD kutoka kwenye API ya SonicPesa kulingana na doc
        const sonicResponse = await axios.post('https://api.sonicpesa.com/api/v1/payment/create_order', {
            buyer_email: req.user.email,
            buyer_name: req.user.name,
            buyer_phone: formattedPhone,
            amount: parseInt(amount),
            currency: "TZS"
        }, {
            headers: {
                'X-API-KEY': process.env.SONICPESA_API_KEY,
                'Content-Type': 'application/json'
            }
        });

        if (sonicResponse.data.status === 'success') {
            const sonicData = sonicResponse.data.data;
            
            // Hifadhi oda kwenye MongoDB ikiwa PENDING
            const newOrder = new Order({
                userId: req.user.id,
                sonicOrderId: sonicData.order_id,
                amount: sonicData.amount,
                plan: plan,
                phone: formattedPhone,
                status: 'PENDING'
            });
            await newOrder.save();

            res.json({ success: true, message: sonicResponse.data.message, order_id: sonicData.order_id });
        } else {
            res.status(400).json({ success: false, message: 'SonicPesa imekataa kutengeneza oda.' });
        }
    } catch (err) {
        console.error(err.response ? err.response.data : err.message);
        res.status(500).json({ error: "Mawasiliano na SonicPesa yamefeli." });
    }
});

// 4. SONICPESA SECURE WEBHOOK (CALLBACK)
app.post('/api/vps/sonicpesa-webhook', async (req, res) => {
    const receivedSignature = req.headers['x-sonicpesa-signature'];
    
    // Thitisha usalama kwa HMAC SHA256 kama ilivyoelekezwa kwenye doc ya PHP kugeuza kwenda JS
    const expectedSignature = crypto
        .createHmac('sha256', process.env.SONICPESA_SECRET_KEY)
        .update(req.rawBody)
        .digest('hex');

    if (receivedSignature !== expectedSignature) {
        return res.status(401).send('Integriy validation failed. Invalid Signature.');
    }

    const { event, order_id, status } = req.body;

    try {
        if (event === 'payment.completed' && status === 'SUCCESS') {
            const order = await Order.findOne({ sonicOrderId: order_id });
            if (!order) return res.status(404).send('Oda haipatikani');

            // IDEMPOTENCY GUARD: Kama ilishatengenezwa, kataa kurudia kuzuia hasara ya server allocation duplicate
            if (order.status === 'SUCCESS') return res.status(200).send('Processed Already');

            order.status = 'SUCCESS';
            await order.save();

            const user = await User.findById(order.userId);

            // Washa Server kwenye Pterodactyl automatically hapa
            const tempPassword = crypto.randomBytes(4).toString('hex') + 'Mk2026!';
            const pteroPayload = {
                name: `${user.name.toLowerCase().replace(/\s+/g, '-')}-vps`,
                user: 1,
                egg: 1,
                docker_image: "quay.io/pterodactyl/core:java",
                startup: "java -Xms128M -Xmx{{SERVER_MEMORY}}M -jar {{SERVER_JARFILE}}",
                environment: { SERVER_JARFILE: "server.jar" },
                limits: { memory: 2048, swap: 0, disk: 30000, io: 500, cpu: 100 },
                allocation: { default: 1 }
            };

            const pteroRes = await axios.post(`${process.env.PTERODACTYL_URL}/api/application/servers`, pteroPayload, {
                headers: { 
                    'Authorization': `Bearer ${process.env.PTERODACTYL_API_KEY}`, 
                    'Content-Type': 'application/json' 
                }
            });

            const newServer = new Server({
                userId: user._id,
                host: process.env.PTERODACTYL_URL.replace('https://', '').replace('http://', ''),
                user: pteroRes.data.attributes.uuid.substring(0, 8),
                pass: tempPassword,
                plan: order.plan
            });
            await newServer.save();

            // Kutuma siri za Seva kwa Email ya mteja (SMTP)
            let transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST, port: process.env.SMTP_PORT, secure: true,
                auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
            });
            await transporter.sendMail({
                from: `"Mickey Host" <${process.env.SMTP_USER}>`,
                to: user.email,
                subject: "VPS Seva Yako Ipo Tayari! 🚀",
                html: `<h3>Habari ${user.name},</h3>
                       <p>Malipo yako kupitia SonicPesa yamekamilika na Seva yako ya <b>${order.plan}</b> imeundwa tayari.</p>
                       <p><b>Pterodactyl Host:</b> ${newServer.host}<br>
                       <b>Username:</b> ${newServer.user}<br>
                       <b>Nenosiri la Seva:</b> ${tempPassword}</p>`
            });
        }
        res.status(200).send('Webhook Processed Successfully');
    } catch (err) {
        console.error('Webhook processing failure:', err.message);
        res.status(500).send('Internal Automation Server Error');
    }
});

// Njia ya kuokota data za mteja kwenye dashboard yake
app.get('/api/vps/my-assets', verifyToken, async (req, res) => {
    const servers = await Server.find({ userId: req.user.id });
    const pending = await Order.find({ userId: req.user.id, status: 'PENDING' });
    res.json({ servers, pending });
});

// SPA routing fallback setup
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Mickey Host Active Cluster on Port ${PORT}`));
