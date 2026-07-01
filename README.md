# Pterodactyl Dashboard & Payment System

Complete web-based dashboard system for Pterodactyl panel with integrated payment processing, user authentication, and admin controls.

## 🎯 Quick Links

- 📖 **[Quick Start Guide](QUICK_START.md)** - Get running in 5 minutes
- 📚 **[Admin System Guide](ADMIN_SYSTEM_GUIDE.md)** - Complete feature documentation
- 💰 **[Payment System Docs](PAYMENT_SYSTEM.md)** - Payment flow & API reference

## ✨ Features

### 👤 User Dashboard
- ✅ Browse server packages with specifications
- ✅ View pricing in coins and USD
- ✅ Purchase servers with ZenoPay integration
- ✅ Transaction history tracking
- ✅ Coin balance display
- ✅ Account verification & password reset

### ⚙️ Admin Panel
- ✅ Create/edit/delete server packages
- ✅ Set CPU, RAM, disk, backups, databases specifications
- ✅ Manage all users
- ✅ Adjust user coin balances
- ✅ View system statistics (users, revenue, transactions)
- ✅ User deletion & management

### 🔐 Authentication
- ✅ Email-based registration with verification
- ✅ Strong password complexity validation (8+ chars, mixed case, numbers, special chars)
- ✅ Admin auto-detection by email (mickidadyhamza@gmail.com)
- ✅ GitHub OAuth login
- ✅ Password reset via email link
- ✅ Session-based authentication

### 💳 Payment System
- ✅ ZenoPay payment gateway integration
- ✅ Multiple payment methods (cards, mobile money, bank transfer)
- ✅ Coin-based and USD pricing
- ✅ Automatic coin credit after successful payment
- ✅ Transaction audit trail & history
- ✅ HMAC-SHA256 webhook signature validation

### 📧 Email System
- ✅ SMTP configuration (Gmail, SendGrid, etc.)
- ✅ Account verification codes (6 digits)
- ✅ Password reset links with token expiry
- ✅ HTML email templates
- ✅ Fallback for disabled SMTP

## 🚀 Getting Started

### 1. Prerequisites
```bash
Node.js v18+
MongoDB (local or cloud)
SMTP service (Gmail, SendGrid, etc.)
ZenoPay API credentials
```

### 2. Installation
```bash
# Clone repository
git clone <repo-url>
cd project

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your settings
```

### 3. Start Server
```bash
npm start
# Server running on http://localhost:3000
```

### 4. Create Admin Account
1. Go to http://localhost:3000/login.html
2. Click "Sajili" (Register)
3. Use email: **mickidadyhamza@gmail.com**
4. Create password with: uppercase, lowercase, number, special char
5. Verify email
6. Login → Access admin panel at `/admin.html`

## 📁 Project Structure

```
project/
├── public/                    # Frontend pages
│   ├── login.html             # Login/Register/Reset
│   ├── dashboard.html         # User main dashboard
│   ├── dashboard-packages.html # User shop (packages)
│   ├── admin-control.html     # Admin control panel
│   └── admin-packages.html    # Admin package manager
├── routes/
│   ├── auth.js                # Authentication
│   ├── packages.js            # Package CRUD
│   ├── payment.js             # Payment processing
│   ├── user.js                # User profile & admin
│   └── api.js                 # Pterodactyl API
├── models/
│   ├── User.js                # User schema (extended with coins)
│   ├── ServerPackage.js       # Package schema
│   └── Transaction.js         # Transaction tracking
├── services/
│   └── zenoPayService.js      # ZenoPay API wrapper
├── middleware/
│   ├── auth.js                # Authentication middleware
│   └── registrationValidator.js # Password validation
├── utils/
│   ├── passwordValidator.js   # Password complexity check
│   ├── paymentHelper.js       # Payment calculations
│   └── email.js               # Email sending (SMTP)
├── config/
│   ├── database.js            # MongoDB connection
│   ├── passport.js            # Passport strategies
│   └── passport.json          # OAuth callbacks
└── server.js                  # Express app setup
```

## 🔗 API Endpoints

### Authentication
- `POST /auth/login` - User login
- `POST /auth/register` - User registration
- `GET /logout` - User logout
- `GET /auth/password-requirements` - Password rules

### User Profile
- `GET /api/user/profile` - Current user info
- `GET /api/user/users` - All users (admin)
- `POST /api/user/users/:id/coins` - Adjust coins (admin)
- `DELETE /api/user/users/:id` - Delete user (admin)
- `GET /api/user/admin/stats` - System stats (admin)

### Packages
- `GET /api/packages` - List packages
- `POST /api/packages` - Create (admin)
- `PUT /api/packages/:id` - Update (admin)
- `DELETE /api/packages/:id` - Delete (admin)
- `GET /api/packages/admin/stats` - Stats (admin)

### Payments
- `POST /api/payment/checkout` - Start payment
- `GET /api/payment/verify/:id` - Verify payment
- `POST /api/payment/webhook` - ZenoPay webhook
- `GET /api/payment/transactions` - User history
- `GET /api/payment/methods` - Payment methods

## 🔧 Configuration

### .env Template
```env
# Database
MONGODB_URI=mongodb://localhost:27017/database

# SMTP Email
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# ZenoPay
ZENOPAY_API_KEY=your-api-key
ZENOPAY_MERCHANT_ID=your-merchant-id
ZENOPAY_WEBHOOK_SECRET=your-webhook-secret

# Application
APP_URL=http://localhost:3000
NODE_ENV=development
SESSION_SECRET=random-secret-string
JWT_SECRET=random-jwt-secret
```

See [QUICK_START.md](QUICK_START.md) for detailed SMTP/ZenoPay setup.

## 📖 Documentation

| Document | Purpose |
|----------|---------|
| [QUICK_START.md](QUICK_START.md) | 5-minute setup & configuration |
| [ADMIN_SYSTEM_GUIDE.md](ADMIN_SYSTEM_GUIDE.md) | Complete feature guide & workflows |
| [PAYMENT_SYSTEM.md](PAYMENT_SYSTEM.md) | Payment API & integration details |

## 🧪 Testing

### Test Admin Features
1. Register with email: `mickidadyhamza@gmail.com`
2. Go to `/admin.html`
3. Create test package
4. View statistics

### Test User Purchase
1. Register with different email
2. Go to `/dashboard/packages`
3. Click Purchase on any package
4. Complete ZenoPay payment
5. Coins credited automatically

### Test Email
1. Register account
2. Check email for verification code
3. Verify in app
4. Test password reset link

## 🔒 Security Features

- ✅ Passport.js authentication with sessions
- ✅ bcryptjs password hashing
- ✅ Password complexity validation (8+ chars, mixed case, numbers, special)
- ✅ HMAC-SHA256 webhook signature validation
- ✅ Role-based access control (admin/user)
- ✅ Email-based admin detection
- ✅ NoSQL injection prevention (express-mongo-sanitize)
- ✅ Rate limiting on auth endpoints (express-rate-limit)
- ✅ Security headers (helmet)
- ✅ Server ownership verification (IDOR protection)

## 📊 Admin Capabilities

### Dashboard Statistics
- Total users & admins count
- Total distributed coins
- Server packages count
- Transaction volume
- USD revenue tracking

### User Management
- View all users with roles
- Adjust coin balances with audit trail
- Delete user accounts
- View user registration dates

### Package Management
- Create packages with full specifications
- Set CPU (0.5+), RAM (256+), disk (1+) requirements
- Configure backups, databases, ports
- Set pricing in coins & USD
- Mark packages as popular
- View package statistics

## 🌐 Responsive Design

All pages are fully responsive:
- ✅ Desktop (1920px+)
- ✅ Tablet (768px+)
- ✅ Mobile (375px+)

## 🚀 Production Deployment

### Pre-Deployment Checklist
- [ ] Update all secrets in .env
- [ ] Set NODE_ENV=production
- [ ] Enable HTTPS/SSL
- [ ] Configure production database
- [ ] Set up production SMTP
- [ ] Test with live ZenoPay credentials
- [ ] Update APP_URL to live domain

### Deploy Options
```bash
# PM2
pm2 start server.js --name "pterodactyl"
pm2 save && pm2 startup

# Docker
docker build -t pterodactyl .
docker run -p 3000:3000 --env-file .env pterodactyl

# Railway, Vercel, Render - Check render.yaml
```

## 🤝 Contributing

Contributions welcome! Areas for enhancement:
- [ ] Two-factor authentication
- [ ] Advanced analytics
- [ ] Email template customization
- [ ] API rate limiting
- [ ] Activity audit logs
- [ ] Auto server provisioning

## 📜 License

See LICENSE file

## 📞 Support

For issues & questions: