/**
 * Admin Package Management Routes
 */

const express = require('express');
const router = express.Router();
const ServerPackage = require('../models/ServerPackage');
const User = require('../models/User');

const adminOnly = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }
  next();
};

// GET all packages (public)
router.get('/packages', async (req, res) => {
  try {
    const packages = await ServerPackage.find({ isActive: true })
      .select('-createdBy')
      .lean();
    
    const formattedPackages = packages.map(pkg => ({
      _id: pkg._id,
      id: pkg._id,
      name: pkg.name,
      description: pkg.description,
      serverConfig: pkg.serverConfig,
      specifications: pkg.specifications,
      pricing: pkg.pricing,
      isPopular: pkg.isPopular,
      costSummary: {
        coins: pkg.pricing.coinsCost,
        usd: pkg.pricing.usdCost,
        billingCycle: pkg.pricing.billingCycle
      }
    }));

    res.json({ success: true, data: formattedPackages });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET single package
router.get('/packages/:id', async (req, res) => {
  try {
    const pkg = await ServerPackage.findById(req.params.id);
    if (!pkg) {
      return res.status(404).json({ success: false, message: 'Package not found' });
    }
    res.json({ success: true, data: pkg });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// CREATE new package (admin only)
router.post('/packages', adminOnly, async (req, res) => {
  try {
    const { name, description, specifications, pricing, isPopular, serverConfig } = req.body;

    if (!name || !specifications || !pricing) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: name, specifications, pricing'
      });
    }

    const { cpu, ram, disk } = specifications;
    if (!cpu || !ram || !disk) {
      return res.status(400).json({
        success: false,
        message: 'Missing specification fields: cpu, ram, disk'
      });
    }

    // Validate serverConfig
    if (!serverConfig || !serverConfig.eggId || !serverConfig.startupFile || !serverConfig.startupCommand) {
      return res.status(400).json({
        success: false,
        message: 'Missing server configuration: eggId, startupFile, startupCommand are required'
      });
    }

    const newPackage = new ServerPackage({
      name,
      description,
      serverConfig: {
        eggId: Number(serverConfig.eggId),
        eggName: serverConfig.eggName || 'Custom',
        startupFile: serverConfig.startupFile,
        startupCommand: serverConfig.startupCommand
      },
      specifications: {
        cpu: parseFloat(cpu),
        ram: parseInt(ram),
        disk: parseInt(disk),
        backups: specifications.backups || 0,
        databases: specifications.databases || 1,
        ports: specifications.ports || 1
      },
      pricing: {
        coinsCost: parseInt(pricing.coinsCost),
        usdCost: parseFloat(pricing.usdCost),
        billingCycle: pricing.billingCycle || 'monthly'
      },
      isPopular: isPopular || false,
      createdBy: req.user._id
    });

    await newPackage.save();

    res.status(201).json({
      success: true,
      message: 'Package created successfully',
      data: newPackage
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// UPDATE package (admin only)
router.put('/packages/:id', adminOnly, async (req, res) => {
  try {
    const { name, description, specifications, pricing, isActive, isPopular, serverConfig } = req.body;

    const pkg = await ServerPackage.findById(req.params.id);
    if (!pkg) {
      return res.status(404).json({ success: false, message: 'Package not found' });
    }

    if (name) pkg.name = name;
    if (description) pkg.description = description;
    if (serverConfig) {
      // Validate serverConfig if updating
      if (!serverConfig.eggId || !serverConfig.startupFile || !serverConfig.startupCommand) {
        return res.status(400).json({
          success: false,
          message: 'Invalid server configuration: eggId, startupFile, startupCommand are required'
        });
      }
      pkg.serverConfig = {
        eggId: Number(serverConfig.eggId),
        eggName: serverConfig.eggName || 'Custom',
        startupFile: serverConfig.startupFile,
        startupCommand: serverConfig.startupCommand
      };
    }
    if (specifications) {
      pkg.specifications = {
        ...pkg.specifications,
        ...specifications
      };
    }
    if (pricing) {
      pkg.pricing = {
        ...pkg.pricing,
        ...pricing
      };
    }
    if (typeof isActive === 'boolean') pkg.isActive = isActive;
    if (typeof isPopular === 'boolean') pkg.isPopular = isPopular;

    await pkg.save();

    res.json({
      success: true,
      message: 'Package updated successfully',
      data: pkg
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// DELETE package (admin only)
router.delete('/packages/:id', adminOnly, async (req, res) => {
  try {
    const pkg = await ServerPackage.findByIdAndDelete(req.params.id);
    if (!pkg) {
      return res.status(404).json({ success: false, message: 'Package not found' });
    }

    res.json({
      success: true,
      message: 'Package deleted successfully'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get admin dashboard stats
router.get('/packages/admin/stats', adminOnly, async (req, res) => {
  try {
    const totalPackages = await ServerPackage.countDocuments();
    const activePackages = await ServerPackage.countDocuments({ isActive: true });
    const popularPackages = await ServerPackage.countDocuments({ isPopular: true });

    const packages = await ServerPackage.find();
    const totalRevenuePotential = packages.reduce((sum, pkg) => sum + pkg.pricing.usdCost, 0);

    res.json({
      success: true,
      data: {
        totalPackages,
        activePackages,
        popularPackages,
        totalRevenuePotential,
        packages: packages.map(pkg => ({
          id: pkg._id,
          name: pkg.name,
          serverType: pkg.serverConfig?.eggName || 'Custom',
          cpu: pkg.specifications.cpu,
          ram: pkg.specifications.ram,
          disk: pkg.specifications.disk,
          coinsCost: pkg.pricing.coinsCost,
          usdCost: pkg.pricing.usdCost,
          isPopular: pkg.isPopular,
          isActive: pkg.isActive
        }))
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
