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