require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/User");
const connectDB = require("../config/database");

const seedAdmin = async () => {
    try {
        await connectDB();

        const adminFullName = process.env.ADMIN_FULL_NAME || "Admin User";
        const adminPassword = process.env.ADMIN_PASSWORD || "admin123";

        const existingAdmin = await User.findOne({ fullName: adminFullName });
        if (existingAdmin) {
            console.log("Admin user already exists, updating password...");
            existingAdmin.password = adminPassword;
            await existingAdmin.save();
            process.exit(0);
        }

        const admin = new User({
            fullName: adminFullName,
            password: adminPassword,
            role: "admin",
        });

        await admin.save();
        console.log("Admin user created successfully");
        console.log(`Full Name: ${adminFullName}`);
        console.log(`Password: ${adminPassword}`);
        process.exit(0);
    } catch (error) {
        console.error("Error seeding admin:", error.message);
        process.exit(1);
    }
};

seedAdmin();
