const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI;

    // Skip connection if no URI is provided or empty
    if (!mongoURI || mongoURI.trim() === "") {
      console.log("Running without database");
      return null;
    }

    // Disable command buffering so we fail fast if connection is lost
    mongoose.set("bufferCommands", false);

    const conn = await mongoose.connect(mongoURI, {
      serverSelectionTimeoutMS: 5000, // Reduced from 10000 for faster feedback
      socketTimeoutMS: 45000,
    });

    console.log("Database connected successfully");

    // Handle connection events silently
    mongoose.connection.on("error", (err) => {
      console.error("Database connection error:", err.message);
    });

    mongoose.connection.on("disconnected", () => {
      console.log("Database disconnected");
    });

    // Graceful shutdown
    process.on("SIGINT", async () => {
      try {
        await mongoose.connection.close();
        process.exit(0);
      } catch (err) {
        console.error("Error during shutdown:", err.message);
        process.exit(1);
      }
    });

    return conn;
  } catch (error) {
    console.log("Database connection failed - using file system only");
    return null;
  }
};

module.exports = connectDB;
