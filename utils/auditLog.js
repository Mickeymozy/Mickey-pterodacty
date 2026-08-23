const AuditLog = require('../models/AuditLog');

async function writeAuditLog(req, action, target = {}, details = {}) {
  if (!req?.user?._id) return;

  try {
    await AuditLog.create({
      actor: req.user._id,
      action,
      targetType: target.type,
      targetId: target.id ? String(target.id) : undefined,
      details,
      ip: req.ip,
      userAgent: req.get('user-agent') || ''
    });
  } catch (error) {
    console.error('Audit log failed:', error.message);
  }
}

module.exports = { writeAuditLog };
