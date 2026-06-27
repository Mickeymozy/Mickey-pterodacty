/**
 * Server Package Model
 */

const mongoose = require('mongoose');

const serverPackageSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Package name is required'],
    trim: true,
    unique: true
  },
  description: {
    type: String,
    trim: true
  },
  
  specifications: {
    cpu: {
      type: Number,
      required: [true, 'CPU cores required'],
      min: [0.5, 'CPU must be at least 0.5 cores']
    },
    ram: {
      type: Number,
      required: [true, 'RAM is required'],
      min: [256, 'RAM must be at least 256MB']
    },
    disk: {
      type: Number,
      required: [true, 'Disk space is required'],
      min: [1, 'Disk must be at least 1GB']
    },
    backups: {
      type: Number,
      default: 0,
      min: 0
    },
    databases: {
      type: Number,
      default: 1,
      min: 1
    },
    ports: {
      type: Number,
      default: 1,
      min: 1
    }
  },

  // Server Configuration
  serverConfig: {
    eggId: {
      type: Number,
      required: [true, 'Server type (egg) is required']
    },
    eggName: {
      type: String,
      required: [true, 'Server type name is required']
    },
    startupFile: {
      type: String,
      required: [true, 'Startup file is required'],
      trim: true
    },
    startupCommand: {
      type: String,
      required: [true, 'Startup command is required'],
      trim: true
    }
  },

  pricing: {
    coinsCost: {
      type: Number,
      required: [true, 'Coin cost is required'],
      min: [0, 'Coin cost cannot be negative']
    },
    usdCost: {
      type: Number,
      required: [true, 'USD cost is required'],
      min: [0, 'USD cost cannot be negative']
    },
    billingCycle: {
      type: String,
      enum: ['hourly', 'daily', 'monthly', 'yearly'],
      default: 'monthly'
    }
  },

  isActive: {
    type: Boolean,
    default: true
  },
  isPopular: {
    type: Boolean,
    default: false
  },
  
  maxServersPerUser: {
    type: Number,
    default: 10
  },

  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
});

serverPackageSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

serverPackageSchema.methods.getSpecifications = function() {
  return {
    cpu: `${this.specifications.cpu} Core(s)`,
    ram: `${this.specifications.ram}MB`,
    disk: `${this.specifications.disk}GB`,
    backups: `${this.specifications.backups} Backup(s)`,
    databases: `${this.specifications.databases} Database(s)`,
    ports: `${this.specifications.ports} Port(s)`
  };
};

serverPackageSchema.methods.canUserPurchase = function(userCoins) {
  return userCoins >= this.pricing.coinsCost;
};

module.exports = mongoose.model('ServerPackage', serverPackageSchema);
