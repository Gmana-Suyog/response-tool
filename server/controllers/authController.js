const jwt = require("jsonwebtoken");
const User = require("../models/User");

const getTokenExpiry = (expiryString) => {
  const match = expiryString.match(/^(\d+)([smhd])$/);
  if (!match) return 3600000; // Default 1 hour in ms

  const value = parseInt(match[1]);
  const unit = match[2];

  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return value * multipliers[unit];
};

const generateTokens = (userId, userRole, userFullName) => {
  const accessTokenExpiry = process.env.JWT_ACCESS_TOKEN_EXPIRY || "1h";
  const refreshTokenExpiry = process.env.JWT_REFRESH_TOKEN_EXPIRY || "7d";

  const accessToken = jwt.sign(
    { id: userId, role: userRole, fullName: userFullName },
    process.env.JWT_SECRET || "fallback_secret",
    { expiresIn: accessTokenExpiry },
  );
  const refreshToken = jwt.sign(
    { id: userId },
    process.env.REFRESH_TOKEN_SECRET || "fallback_refresh_secret",
    { expiresIn: refreshTokenExpiry },
  );

  return {
    accessToken,
    refreshToken,
    accessTokenExpiryMs: getTokenExpiry(accessTokenExpiry),
    refreshTokenExpiryMs: getTokenExpiry(refreshTokenExpiry),
  };
};

const signup = async (req, res) => {
  try {
    const { fullName, password } = req.body;

    let existingUser;
    try {
      existingUser = await User.findOne({ fullName });
    } catch (dbError) {
      console.error("Signup DB Error:", dbError.message);
      return res.status(503).json({
        error: "Database service unavailable. Please try again later.",
      });
    }

    if (existingUser) {
      return res.status(400).json({ error: "Full Name already in use" });
    }

    const user = new User({ fullName, password });
    await user.save();

    const {
      accessToken,
      refreshToken,
      accessTokenExpiryMs,
      refreshTokenExpiryMs,
    } = generateTokens(user._id, user.role, user.fullName);

    // Store refresh token
    user.refreshTokens.push({
      token: refreshToken,
      expiresAt: new Date(Date.now() + refreshTokenExpiryMs),
    });
    await user.save();

    // Set cookies
    res.cookie("accessToken", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Lax",
      maxAge: accessTokenExpiryMs,
    });

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Lax",
      maxAge: refreshTokenExpiryMs,
    });

    res.status(201).json({
      message: "User created successfully",
      user: { id: user._id, fullName: user.fullName, role: user.role },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const login = async (req, res) => {
  try {
    const { fullName, password } = req.body;

    let user;
    try {
      user = await User.findOne({ fullName });
    } catch (dbError) {
      console.error("Login DB Error:", dbError.message);
      return res.status(503).json({
        error: "Database service unavailable. Please try again later.",
      });
    }

    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ error: "Invalid Full Name or password" });
    }

    const {
      accessToken,
      refreshToken,
      accessTokenExpiryMs,
      refreshTokenExpiryMs,
    } = generateTokens(user._id, user.role, user.fullName);

    // Store refresh token
    user.refreshTokens.push({
      token: refreshToken,
      expiresAt: new Date(Date.now() + refreshTokenExpiryMs),
    });

    // Prune old/expired refresh tokens
    user.refreshTokens = user.refreshTokens.filter(
      (rt) => rt.expiresAt > new Date(),
    );

    await user.save();

    // Set cookies
    res.cookie("accessToken", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Lax",
      maxAge: accessTokenExpiryMs,
    });

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Lax",
      maxAge: refreshTokenExpiryMs,
    });

    res.json({
      user: { id: user._id, fullName: user.fullName, role: user.role },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const refresh = async (req, res) => {
  try {
    const refreshToken = req.body.refreshToken || req.cookies.refreshToken;
    if (!refreshToken) {
      return res.status(401).json({ error: "Refresh token required" });
    }

    const decoded = jwt.verify(
      refreshToken,
      process.env.REFRESH_TOKEN_SECRET || "fallback_refresh_secret",
    );

    const user = await User.findOne({
      _id: decoded.id,
      "refreshTokens.token": refreshToken,
    });

    if (!user) {
      return res.status(401).json({ error: "Invalid refresh token" });
    }

    const tokens = generateTokens(user._id, user.role, user.fullName);

    // Update the refresh token in the list
    const tokenIndex = user.refreshTokens.findIndex(
      (rt) => rt.token === refreshToken,
    );
    user.refreshTokens[tokenIndex].token = tokens.refreshToken;
    user.refreshTokens[tokenIndex].expiresAt = new Date(
      Date.now() + tokens.refreshTokenExpiryMs,
    );

    await user.save();

    // Set cookies
    res.cookie("accessToken", tokens.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Lax",
      maxAge: tokens.accessTokenExpiryMs,
    });

    res.cookie("refreshToken", tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Lax",
      maxAge: tokens.refreshTokenExpiryMs,
    });

    res.json({
      message: "Tokens refreshed successfully",
      user: { id: user._id, fullName: user.fullName, role: user.role },
    });
  } catch (error) {
    res.status(401).json({ error: "Invalid refresh token" });
  }
};

const logout = async (req, res) => {
  try {
    const refreshToken = req.body.refreshToken || req.cookies.refreshToken;
    const user = await User.findById(req.user._id);

    if (user) {
      user.refreshTokens = user.refreshTokens.filter(
        (rt) => rt.token !== refreshToken,
      );
      await user.save();
    }

    res.clearCookie("accessToken");
    res.clearCookie("refreshToken");
    res.json({ message: "Logged out successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = { signup, login, refresh, logout };
