const mongoose = require('mongoose');

const connectDB = async () => {
  if (!process.env.MONGODB_URI) {
    console.warn('⚠️ MONGODB_URI is not set. Skipping DB connection.');
    return null;
  }

  if (mongoose.connection.readyState >= 1) {
    return mongoose.connection;
  }

  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000
    });

    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);

    try {
      const users = conn.connection.db.collection('users');
      await users.updateMany({ pteroId: { $lte: 0 } }, { $unset: { pteroId: '' } });
      await users.createIndex({ username: 1 }, { unique: true });
      await users.createIndex({ email: 1 }, { unique: true });
      const indexes = await users.listIndexes().toArray();
      const pteroIndex = indexes.find((index) => index.key?.pteroId === 1);
      if (pteroIndex && JSON.stringify(pteroIndex.partialFilterExpression || {}) !== JSON.stringify({ pteroId: { $type: 'number', $gt: 0 } })) {
        await users.dropIndex(pteroIndex.name);
      }
      await users.createIndex({ pteroId: 1 }, { unique: true, partialFilterExpression: { pteroId: { $type: 'number', $gt: 0 } } });
    } catch (indexErr) {
      console.warn('⚠️ Could not migrate Pterodactyl user index:', indexErr.message);
    }

    try {
      await conn.connection.db.collection('transactions').dropIndex('transactionRef_1');
      console.log('✅ Removed legacy transactionRef index from MongoDB');
    } catch (indexErr) {
      if (indexErr?.code !== 26) {
        console.warn('⚠️ Could not remove legacy transaction index:', indexErr.message);
      }
    }

    return conn;
  } catch (err) {
    console.error(`❌ MongoDB Error: ${err.message}`);
    return null;
  }
};

module.exports = connectDB;