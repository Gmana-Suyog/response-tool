const express = require("express");
const router = express.Router();
const User = require("../models/User");
const { authenticate, authorizeAdmin } = require("../middleware/auth");

// Get all users (Admin only)
router.get("/", authenticate, authorizeAdmin, async (req, res) => {
    try {
        const users = await User.find({}, "-password -refreshTokens");
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update user (Admin only)
router.put("/:id", authenticate, authorizeAdmin, async (req, res) => {
    try {
        const { fullName, role } = req.body;
        const user = await User.findById(req.params.id);

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        if (fullName) user.fullName = fullName;
        if (role) user.role = role;

        await user.save();
        res.json({
            message: "User updated successfully",
            user: { id: user._id, fullName: user.fullName, role: user.role },
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete user (Admin only)
router.delete("/:id", authenticate, authorizeAdmin, async (req, res) => {
    try {
        const user = await User.findByIdAndDelete(req.params.id);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }
        res.json({ message: "User deleted successfully" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
