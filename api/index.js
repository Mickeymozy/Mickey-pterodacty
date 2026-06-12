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

// IMPORTANT: Weka hii KABLA ya express.json() kwa webhook
app.use(express.raw({ type: 'application/json', verify: (req, res, buf) => {
    req.rawBody = buf.toString();
} }));

// Kisha weka express.json() kwa routes nyingine
app.use(express.json({
    verify: (req, res, buf) => {
        if (!req.rawBody) req.rawBody = buf.toString();
    }
}));

app.use(cors());

// Connect MongoDB
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

// MONGODB SCHEMAS
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
    } catch (err) { 
        res.status(400).json({ success: false, message: 'Token isiyo sahihi au imekwisha muda wake.' }); 
    }
};

// AUTHENTICATION ROUTES
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

// SONICPESA CONFIGURATION
const SONIC_CREATE_ORDER_URL = 'https://api.sonicpesa.com/api/v1/payment/create_order';
const SONIC_ORDER_STATUS_URL = 'https://api.sonicpesa.com/api/v1/payment/order_status';

const checkSonicConfig = () => {
    if (!process.env.SONICPESA_API_KEY) {
        throw new Error('SONICPESA_API_KEY haipo kwenye environment variables');
    }
    if (!process.env.SONICPESA_SECRET_KEY) {
        throw new Error('SONICPESA_SECRET_KEY haipo kwenye environment variables');
    }
};

// Function kuboresha namba ya simu
const formatPhoneNumber = (phone) => {
    if (!phone) return '';
    
    // Toa spaces, dashes, na non-digits zote
    let cleaned = String(phone).trim().replace(/\D/g, '');
    
    console.log('[FORMAT] Original:', phone, 'Cleaned:', cleaned);
    
    if (cleaned.length === 0) return '';
    
    // Kama inaanza na 0 (0657779003)
    if (cleaned.startsWith('0') && cleaned.length === 10) {
        return '255' + cleaned.substring(1);
    }
    // Kama ni namba fupi (657779003)
    else if (cleaned.length === 9) {
        return '255' + cleaned;
    }
    // Kama tayari iko format sahihi (255657779003)
    else if (cleaned.startsWith('255') && (cleaned.length === 12 || cleaned.length === 13)) {
        return cleaned;
    }
    // Kama ni namba ndefu zaidi, jaribu kurekebisha
    else if (cleaned.length > 10 && !cleaned.startsWith('255')) {
        return '255' + cleaned.slice(-9);
    }
    
    return cleaned;
};

// DEBUG ENDPOINT - Kuangalia format ya namba
app.post('/api/debug/phone', verifyToken, async (req, res) => {
    const { phone } = req.body;
    const raw = phone;
    const cleaned = String(phone || '').trim().replace(/\D/g, '');
    const formatted = formatPhoneNumber(phone);
    
    res.json({
        success: true,
        raw: raw,
        cleaned: cleaned,
        formatted: formatted,
        isValid: formatted && formatted.length >= 12 && formatted.length <= 13,
        length: formatted ? formatted.length : 0
    });
});

// CREATE ORDER - ILIYOREKEBISHWA KABISA
app.post('/api/vps/create-ussd-order', verifyToken, async (req, res) => {
    try {
        // Angalia configuration
        try {
            checkSonicConfig();
        } catch (configErr) {
            return res.status(500).json({
                success: false,
                message: configErr.message + '. Weka environment variables zote kwenye Vercel.'
            });
        }

        const { plan, amount, phone } = req.body;
        const amountValue = Number(amount);
        
        // DEBUG logging
        console.log('[ORDER] Request body:', JSON.stringify(req.body));
        console.log('[ORDER] Phone received:', phone, 'Type:', typeof phone);
        console.log('[ORDER] Plan:', plan, 'Amount:', amountValue);
        console.log('[ORDER] User:', req.user.email);

        // Validation za namba
        if (!phone) {
            return res.status(400).json({ 
                success: false, 
                message: 'Tafadhali ingiza namba yako ya simu.' 
            });
        }

        const phoneString = String(phone).trim();
        if (phoneString.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Namba ya simu haiwezi kuwa tupu.' 
            });
        }

        // Format namba
        const formattedPhone = formatPhoneNumber(phoneString);
        console.log('[ORDER] Formatted phone:', formattedPhone);

        if (!formattedPhone || formattedPhone.length < 12) {
            return res.status(400).json({ 
                success: false, 
                message: `Namba "${phoneString}" si sahihi. Tumia mfano: 0657779003 au 255657779003`,
                hint: 'Hakikisha namba ina tarakimu 9 au 10 kwa Tanzania'
            });
        }

        if (!Number.isFinite(amountValue) || amountValue <= 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Kiasi cha malipo si sahihi.' 
            });
        }

        // SonicPesa Payload
        const sonicPayload = {
            buyer_email: req.user.email,
            buyer_name: req.user.name,
            buyer_phone: formattedPhone,
            amount: Math.round(amountValue),
            currency: 'TZS',
            callback_url: process.env.WEBHOOK_URL || `${req.protocol}://${req.get('host')}/api/vps/sonicpesa-webhook`
        };

        console.log('[ORDER] SonicPayload:', JSON.stringify(sonicPayload));

        const sonicHeaders = {
            'X-API-KEY': process.env.SONICPESA_API_KEY,
            'Content-Type': 'application/json'
        };

        const sonicResponse = await axios.post(SONIC_CREATE_ORDER_URL, sonicPayload, {
            headers: sonicHeaders,
            timeout: 45000
        });

        console.log('[ORDER] SonicPesa Response:', JSON.stringify(sonicResponse.data));

        const responseData = sonicResponse.data || {};
        const sonicData = responseData.data || {};
        const orderId = sonicData.order_id || sonicData.id || responseData.order_id || null;

        if (responseData.status === 'success' || responseData.success === true || orderId) {
            if (orderId) {
                await connectDB();
                const newOrder = new Order({
                    userId: req.user.id,
                    buyer_name: req.user.name,
                    sonicOrderId: orderId,
                    amount: Number(sonicData.amount || amountValue),
                    plan: plan,
                    phone: formattedPhone,
                    status: 'PENDING'
                });
                await newOrder.save();
                console.log(`[ORDER] Order saved: ${orderId}`);
            }

            return res.json({
                success: true,
                message: 'Ombi la malipo limefumwa! Angalia simu yako, utapokea USSD push kutoka Tigo Pesa kwa namba ' + formattedPhone,
                order_id: orderId,
                phone_sent: formattedPhone
            });
        }

        // SonicPesa imekataa
        console.error('[ORDER] SonicPesa rejection:', responseData);
        return res.status(400).json({
            success: false,
            message: responseData.message || responseData.error || 'SonicPesa imekataa kutengeneza oda. Hakikisha namba yako ni sahihi.'
        });

    } catch (err) {
        console.error('[ORDER] Error:', {
            message: err.message,
            status: err.response?.status,
            data: err.response?.data
        });

        let errorMessage = 'Malipo yamefeli: ';
        let hint = '';

        if (err.response?.status === 401) {
            errorMessage += 'API key ya SonicPesa si sahihi.';
            hint = 'Angalia SONICPESA_API_KEY kwenye Vercel Environment Variables.';
        } else if (err.response?.status === 403) {
            errorMessage += 'Akaunti ya SonicPesa haijaruhusiwa.';
            hint = 'Wasiliana na SonicPesa kuwezesha akaunti yako.';
        } else if (err.response?.status === 400) {
            errorMessage += err.response?.data?.message || 'Namba ya simu au kiasi si sahihi.';
            hint = 'Hakikisha namba ya simu ni sahihi na ina Tigo Pesa akaunti.';
        } else if (err.code === 'ECONNABORTED') {
            errorMessage += 'Timeout - SonicPesa haijibu.';
            hint = 'Jaribu tena baada ya dakika chache.';
        } else {
            errorMessage += err.response?.data?.message || err.message;
            hint = 'Angalia connection yako na ujaribu tena.';
        }

        return res.status(err.response?.status || 500).json({
            success: false,
            message: errorMessage,
            hint: hint,
            phone_provided: phone
        });
    }
});

// CHECK ORDER STATUS
app.post('/api/vps/order-status', verifyToken, async (req, res) => {
    try {
        const { order_id } = req.body;
        if (!order_id) {
            return res.status(400).json({ success: false, message: 'order_id inahitajika.' });
        }

        const statusResponse = await axios.post(SONIC_ORDER_STATUS_URL, { order_id }, {
            headers: {
                'X-API-KEY': process.env.SONICPESA_API_KEY,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });

        const statusData = statusResponse.data || {};
        const paymentStatus = (statusData.status || statusData.data?.payment_status || 'PENDING').toUpperCase();

        await connectDB();
        const order = await Order.findOne({ sonicOrderId: order_id });
        if (order && order.status !== paymentStatus) {
            order.status = paymentStatus === 'SUCCESS' ? 'SUCCESS' : 
                          (paymentStatus === 'CANCELLED' || paymentStatus === 'REJECTED' ? paymentStatus : 'PENDING');
            await order.save();
            console.log(`[STATUS] Order ${order_id} updated to ${order.status}`);
        }

        let message = '';
        if (paymentStatus === 'SUCCESS') {
            message = 'Malipo yamekamilika kikamilifu! Seva yako itaundwa.';
        } else if (paymentStatus === 'PENDING') {
            message = 'Malipo bado hayajathibitishwa. Tafadhali thibitisha kwenye simu yako kwa kuingiza PIN yako.';
        } else if (paymentStatus === 'CANCELLED' || paymentStatus === 'REJECTED') {
            message = 'Malipo yameghairiwa au kukataliwa. Jaribu tena.';
        }

        return res.json({ 
            success: true, 
            payment_status: paymentStatus,
            message: message
        });
    } catch (err) {
        console.error('[STATUS] Error:', err.message);
        return res.status(500).json({
            success: false,
            message: 'Imeshindwa kupima hali ya malipo: ' + err.message
        });
    }
});

// WEBHOOK - KUSHUGHULIKIA MALIPO YANAYOKUBALIWA
app.post('/api/vps/sonicpesa-webhook', async (req, res) => {
    console.log('[WEBHOOK] Received at:', new Date().toISOString());
    console.log('[WEBHOOK] Headers:', JSON.stringify(req.headers, null, 2));
    
    try {
        await connectDB();
    } catch(e) {
        console.error('[WEBHOOK] DB error:', e);
        return res.status(500).send("Database Error");
    }

    if (!process.env.SONICPESA_SECRET_KEY) {
        console.error('[WEBHOOK] SONICPESA_SECRET_KEY missing!');
        return res.status(500).send("Webhook secret not configured");
    }

    // Verify signature
    const receivedSignature = req.headers['x-sonicpesa-signature'] || req.headers['x-signature'];
    const expectedSignature = crypto
        .createHmac('sha256', process.env.SONICPESA_SECRET_KEY)
        .update(req.rawBody || JSON.stringify(req.body))
        .digest('hex');

    console.log('[WEBHOOK] Signature match:', receivedSignature === expectedSignature);

    if (receivedSignature !== expectedSignature) {
        console.error('[WEBHOOK] Invalid signature!');
        return res.status(401).json({ error: 'Invalid Signature' });
    }

    const { event, order_id, status, transaction_id } = req.body;
    console.log(`[WEBHOOK] Event: ${event}, Order: ${order_id}, Status: ${status}`);

    if (event === 'payment.completed' && (status === 'SUCCESS' || status === 'success')) {
        try {
            const order = await Order.findOne({ sonicOrderId: order_id });
            if (!order) {
                console.error(`[WEBHOOK] Order not found: ${order_id}`);
                return res.status(404).send('Order not found');
            }

            if (order.status === 'SUCCESS') {
                console.log(`[WEBHOOK] Order ${order_id} already processed`);
                return res.status(200).send('Already Processed');
            }

            order.status = 'SUCCESS';
            await order.save();
            console.log(`[WEBHOOK] Order ${order_id} marked as SUCCESS`);

            const user = await User.findById(order.userId);
            if (!user) {
                console.error(`[WEBHOOK] User not found for order ${order_id}`);
                return res.status(200).send('Order updated but user missing');
            }

            // Create VPS Server
            const tempPassword = crypto.randomBytes(8).toString('hex');
            const newServer = new Server({
                userId: user._id,
                owner_name: user.name,
                host: process.env.PTERODACTYL_HOST || 'vps.mickeyhost.com',
                user: `vps_${order_id.slice(-6)}`,
                pass: tempPassword,
                plan: order.plan
            });
            await newServer.save();
            console.log(`[WEBHOOK] Server created for ${user.email}`);

            // Send email notification
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
                        subject: "VPS Seva Yako Ipo Tayari! 🚀",
                        html: `
                            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                                <h2 style="color: #00ffcc;">Hongera ${user.name}!</h2>
                                <p>Malipo yako ya <strong>${order.plan}</strong> yamekamilika kikamilifu.</p>
                                <div style="background: #1a1a2e; padding: 20px; border-radius: 10px; margin: 20px 0;">
                                    <h3 style="color: #00ffcc;">Maelezo ya VPS Yako:</h3>
                                    <p><strong>Host:</strong> ${newServer.host}</p>
                                    <p><strong>Username:</strong> ${newServer.user}</p>
                                    <p><strong>Password:</strong> <code style="background: #000; padding: 5px;">${tempPassword}</code></p>
                                    <p><strong>Plan:</strong> ${order.plan}</p>
                                    <p><strong>Port:</strong> ${newServer.port}</p>
                                </div>
                                <p><em>Tafadhali badilisha password yako mara baada ya kuingia kwa mara ya kwanza.</em></p>
                                <p>Asante kwa kuchagua Mickey Host!</p>
                            </div>
                        `
                    });
                    console.log(`[WEBHOOK] Email sent to ${user.email}`);
                } catch(emailErr) {
                    console.error('[WEBHOOK] Email failed:', emailErr.message);
                }
            }
        } catch (err) {
            console.error('[WEBHOOK] Processing error:', err);
            return res.status(500).send('Processing Error');
        }
    }
    
    res.status(200).send('OK');
});

// GET ASSETS - Servers na Pending Orders
app.get('/api/vps/my-assets', verifyToken, async (req, res) => {
    try { 
        await connectDB(); 
        let servers, pendingOrders;
        if (req.user.role === 'admin') {
            servers = await Server.find({}).sort({ createdAt: -1 });
            pendingOrders = await Order.find({ status: 'PENDING' }).sort({ createdAt: -1 });
        } else {
            servers = await Server.find({ userId: req.user.id }).sort({ createdAt: -1 });
            pendingOrders = await Order.find({ userId: req.user.id, status: 'PENDING' }).sort({ createdAt: -1 });
        }
        res.json({ success: true, servers, pending: pendingOrders });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// HEALTH CHECK ENDPOINT
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        hasSonicKey: !!process.env.SONICPESA_API_KEY,
        hasSonicSecret: !!process.env.SONICPESA_SECRET_KEY,
        hasMongoUri: !!process.env.MONGO_URI,
        hasJwtSecret: !!process.env.JWT_SECRET,
        environment: process.env.NODE_ENV || 'development'
    });
});

// SERVE STATIC FILES
app.get(['/dashboard.html', '/dashboard.js', '/dashboard'], (req, res) => {
    res.sendFile(path.join(__dirname, '../public', 'dashboard.html'));
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../public', 'login.html'));
});

module.exports = app;