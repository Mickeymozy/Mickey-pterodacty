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

// IMPORTANT: Weka hii KABLA ya express.json()
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

// ANGALIA IKIWA API KEY IPO
const checkSonicConfig = () => {
    if (!process.env.SONICPESA_API_KEY) {
        throw new Error('SONICPESA_API_KEY haipo kwenye environment variables');
    }
    if (!process.env.SONICPESA_SECRET_KEY) {
        throw new Error('SONICPESA_SECRET_KEY haipo kwenye environment variables - Hii ni muhimu kwa webhook!');
    }
};

const normalizePhone = (phone) => {
    const cleaned = String(phone || '').trim().replace(/\D/g, '');
    if (!cleaned) return '';
    if (cleaned.startsWith('255')) return cleaned;
    if (cleaned.startsWith('0')) return '255' + cleaned.slice(1);
    return cleaned;
};

// CREATE ORDER - ILIYOREKEBISHWA
app.post('/api/vps/create-ussd-order', verifyToken, async (req, res) => {
    try {
        // Angalia configuration kabla ya kuendelea
        try {
            checkSonicConfig();
        } catch (configErr) {
            return res.status(500).json({
                success: false,
                message: configErr.message + '. Weka SONICPESA_API_KEY na SONICPESA_SECRET_KEY kwenye Vercel Environment Variables.'
            });
        }

        const { plan, amount, phone } = req.body;
        const amountValue = Number(amount);

        if (!phone || !String(phone).trim()) {
            return res.status(400).json({ success: false, message: 'Tafadhali ingiza namba ya simu.' });
        }

        if (!Number.isFinite(amountValue) || amountValue <= 0) {
            return res.status(400).json({ success: false, message: 'Kiasi cha malipo si sahihi.' });
        }

        const formattedPhone = normalizePhone(phone);
        if (formattedPhone.length < 12) {
            return res.status(400).json({ success: false, message: 'Namba ya simu si sahihi. Tumia mfano wa 2556xxxxxxxx.' });
        }

        console.log(`[ORDER] Creating order for ${req.user.email}, amount: ${amountValue}, phone: ${formattedPhone}`);

        const sonicHeaders = {
            'X-API-KEY': process.env.SONICPESA_API_KEY,
            'Content-Type': 'application/json'
        };

        const sonicPayload = {
            buyer_email: req.user.email,
            buyer_name: req.user.name,
            buyer_phone: formattedPhone,
            amount: Math.round(amountValue),
            currency: 'TZS',
            callback_url: process.env.WEBHOOK_URL || 'https://your-vercel-url.vercel.app/api/vps/sonicpesa-webhook'
        };

        const sonicResponse = await axios.post(SONIC_CREATE_ORDER_URL, sonicPayload, {
            headers: sonicHeaders,
            timeout: 45000
        });

        console.log('[ORDER] SonicPesa response:', JSON.stringify(sonicResponse.data, null, 2));

        const responseData = sonicResponse.data || {};
        const sonicData = responseData.data || {};
        const orderId = sonicData.order_id || sonicData.id || null;

        if (responseData.status === 'success' || responseData.success === true) {
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
                console.log(`[ORDER] Order saved successfully: ${orderId}`);
            }

            return res.json({
                success: true,
                message: responseData.message || 'Oda imeundwa. Tafadhali thibitisha kwenye simu yako kwa kuingiza *150*00# au fungua app ya Tigo Pesa.',
                order_id: orderId
            });
        }

        // Ikiwa SonicPesa imekataa
        console.error('[ORDER] SonicPesa rejection:', responseData);
        return res.status(400).json({
            success: false,
            message: responseData.message || responseData.error || 'SonicPesa imekataa kutengeneza oda. Hakikisha namba yako ya simu ni sahihi na una akaunti ya Tigo Pesa.'
        });

    } catch (err) {
        console.error('[ORDER] Error details:', {
            message: err.message,
            status: err.response?.status,
            data: err.response?.data,
            config: err.config?.data
        });

        const primaryStatus = err.response?.status;
        const providerBody = err.response?.data;
        
        let errorMessage = '';
        let hint = '';

        if (primaryStatus === 401) {
            errorMessage = 'API key ya SonicPesa si sahihi.';
            hint = 'Angalia Vercel Environment Variables - SONICPESA_API_KEY lazima iwe sahihi.';
        } else if (primaryStatus === 403) {
            errorMessage = 'Akaunti ya SonicPesa haijaruhusiwa.';
            hint = 'Wasiliana na SonicPesa kuwezesha akaunti yako.';
        } else if (primaryStatus === 400) {
            errorMessage = providerBody?.message || 'Namba ya simu au kiasi si sahihi.';
            hint = 'Hakikisha namba ya simu ni sahihi na ina Tigo Pesa akaunti.';
        } else if (primaryStatus >= 500) {
            errorMessage = 'SonicPesa ina matatizo ya kiufundi.';
            hint = 'Jaribu tena baada ya dakika chache au wasiliana na SonicPesa.';
        } else {
            errorMessage = providerBody?.message || providerBody?.error || err.message;
            hint = 'Angalia connection yako na uhakikishe SonicPesa API inafanya kazi.';
        }

        return res.status(primaryStatus || 500).json({
            success: false,
            message: `Malipo yamefeli: ${errorMessage}`,
            hint: hint,
            details: process.env.NODE_ENV === 'development' ? providerBody : undefined
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
            timeout: 45000
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

        return res.json({ 
            success: true, 
            payment_status: paymentStatus,
            message: paymentStatus === 'SUCCESS' ? 'Malipo yamekamilika!' : 'Malipo bado hayajathibitishwa.'
        });
    } catch (err) {
        console.error('[STATUS] Error:', err.message);
        return res.status(500).json({
            success: false,
            message: 'Imeshindwa kupima hali ya malipo: ' + err.message
        });
    }
});

// WEBHOOK - ILIYOREKEBISHWA KABISA
app.post('/api/vps/sonicpesa-webhook', async (req, res) => {
    console.log('[WEBHOOK] Received webhook request');
    console.log('[WEBHOOK] Headers:', JSON.stringify(req.headers, null, 2));
    console.log('[WEBHOOK] Raw body:', req.rawBody);
    
    try {
        await connectDB();
    } catch(e) {
        console.error('[WEBHOOK] DB connection error:', e);
        return res.status(500).send("Database Error");
    }

    // Angalia iwapo secret key ipo
    if (!process.env.SONICPESA_SECRET_KEY) {
        console.error('[WEBHOOK] SONICPESA_SECRET_KEY haipo!');
        return res.status(500).send("Webhook secret not configured");
    }

    const receivedSignature = req.headers['x-sonicpesa-signature'] || req.headers['x-signature'];
    const expectedSignature = crypto
        .createHmac('sha256', process.env.SONICPESA_SECRET_KEY)
        .update(req.rawBody || JSON.stringify(req.body))
        .digest('hex');

    console.log('[WEBHOOK] Signature received:', receivedSignature);
    console.log('[WEBHOOK] Signature expected:', expectedSignature);

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
                host: process.env.PTERODACTYL_HOST || 'vps.example.com',
                user: `user_${order_id.slice(-6)}`,
                pass: tempPassword,
                plan: order.plan
            });
            await newServer.save();
            console.log(`[WEBHOOK] Server created for user ${user.email}`);

            // Send email
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
                        html: `<h2>Hongera ${user.name}!</h2>
                               <p>Malipo yako ya <b>${order.plan}</b> yamekamilika.</p>
                               <p><strong>Maelezo ya VPS:</strong></p>
                               <ul>
                                   <li>Host: ${newServer.host}</li>
                                   <li>Username: ${newServer.user}</li>
                                   <li>Password: ${tempPassword}</li>
                                   <li>Plan: ${order.plan}</li>
                               </ul>
                               <p><em>Tafadhali badilisha password yako mara baada ya kuingia kwa mara ya kwanza.</em></p>`
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

// GET ASSETS
app.get('/api/vps/my-assets', verifyToken, async (req, res) => {
    try { 
        await connectDB(); 
        let servers, pendingOrders;
        if (req.user.role === 'admin') {
            servers = await Server.find({});
            pendingOrders = await Order.find({ status: 'PENDING' });
        } else {
            servers = await Server.find({ userId: req.user.id });
            pendingOrders = await Order.find({ userId: req.user.id, status: 'PENDING' });
        }
        res.json({ success: true, servers, pending: pendingOrders });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// TEST ENDPOINT - Kuangalia kama API inafanya kazi
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        hasSonicKey: !!process.env.SONICPESA_API_KEY,
        hasSonicSecret: !!process.env.SONICPESA_SECRET_KEY,
        hasMongoUri: !!process.env.MONGO_URI
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