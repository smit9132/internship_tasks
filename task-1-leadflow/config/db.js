const mongoose = require('mongoose');

async function connectDB() {
  const { MONGODB_URI } = process.env;

  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI is not configured.');
  }

  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB.');
  } catch (error) {
    console.error(
      `MongoDB connection failed (${error.name}). Check that MongoDB is running and MONGODB_URI is correct.`,
    );
    throw error;
  }
}

module.exports = connectDB;
