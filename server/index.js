require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs-extra");
const cookieParser = require("cookie-parser");
const connectDB = require("./config/database");
const scenarioRoutes = require("./routes/scenarios");
const categoryRoutes = require("./routes/categories");
const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const originalDownloadService = require("./services/originalDownloadService");
const scenarioService = require("./services/scenarioService");
const { errorHandler, notFoundHandler } = require("./middleware/errorHandler");

const app = express();
const PORT = process.env.PORT || 3001;

// Connect to MongoDB
connectDB()
  .then(async (connection) => {
    if (connection) {
      // Sync existing file system scenarios to database silently
      setTimeout(async () => {
        try {
          await scenarioService.syncFileSystemToDatabase();
        } catch (error) {
          console.error("Sync error:", error.message);
        }
      }, 1000);
    }
  })
  .catch((error) => {
    console.error("Database setup failed:", error.message);
  });

// Middleware
// app.use(
//   cors({
//     // origin: [
//     //   "http://localhost:3000", // Frontend development server
//     //   "http://127.0.0.1:3000", // Alternative localhost
//     //   "http://localhost:5173", // Vite default port (backup)
//     // ],
//     origin: "*",
//     // credentials: true,
//     methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
//     allowedHeaders: ["Content-Type", "Authorization", "Accept", "Range"],
//     exposedHeaders: ["Content-Length", "Content-Range"],
//   }),
// );

app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://localhost:5173",
       "https://hlsjs.video-dev.org",
    ], // Explicit origins for credentials
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD"],
    allowedHeaders: ["Content-Type", "Authorization", "Accept", "Range", "Cookie"],
    exposedHeaders: ["Content-Length", "Content-Range", "Accept-Ranges"],
    credentials: true,
    maxAge: 86400,
  }),
);

app.use(cookieParser());

app.options("*", cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Ensure hls, dash, vmap, vast, mp4, gif, and vod directories exist
const hlsDir = path.join(__dirname, "hls");
const dashDir = path.join(__dirname, "dash");
const vmapDir = path.join(__dirname, "vmap");
const vastDir = path.join(__dirname, "vast");
const mp4Dir = path.join(__dirname, "mp4");
const gifDir = path.join(__dirname, "gif");
const vodDir = path.join(__dirname, "vod");
const vodHlsDir = path.join(__dirname, "vod/hls");
fs.ensureDirSync(hlsDir);
fs.ensureDirSync(dashDir);
fs.ensureDirSync(vmapDir);
fs.ensureDirSync(vastDir);
fs.ensureDirSync(mp4Dir);
fs.ensureDirSync(gifDir);
fs.ensureDirSync(vodDir);
fs.ensureDirSync(vodHlsDir);

// Routes
app.use("/api/scenarios", scenarioRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);

// Serve static files for HLS content
// Handle OPTIONS preflight for HLS
app.options("/hls/*", (req, res) => {
  const allowedOrigins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ];
  const origin = req.headers.origin;
  
  // For static files, we don't know if cookies are enabled, so use permissive CORS
  // The /api/scenarios/:id/player/* route will handle cookie-specific CORS
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type, Cookie");
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type");
  }
  
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.status(204).end();
});

app.use(
  "/hls",
  (req, res, next) => {
    if (req.path.endsWith(".ts") || req.path.endsWith("master-local.m3u8")) {
      delete req.headers["if-none-match"];
      delete req.headers["if-modified-since"];
    }
    next();
  },
  express.static(hlsDir, {
    setHeaders: (res, path, stat, req) => {
      if (path.endsWith(".m3u8")) {
        res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
        res.setHeader("Cache-Control", "no-cache");
      } else if (path.endsWith(".ts")) {
        res.setHeader("Content-Type", "video/mp2t");
      }
      
      // Handle CORS properly for credentials
      const allowedOrigins = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
      ];
      const origin = req.headers.origin;
      
      if (allowedOrigins.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Credentials", "true");
      } else {
        res.setHeader("Access-Control-Allow-Origin", "*");
      }
      
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    },
  }),
);

// Serve static files for DASH content
// Handle OPTIONS preflight for DASH
app.options("/dash/*", (req, res) => {
  const allowedOrigins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ];
  const origin = req.headers.origin;
  
  // For static files, use permissive CORS
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type, Cookie");
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type");
  }
  
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.status(204).end();
});

app.use(
  "/dash",
  (req, res, next) => {
    // Remove conditional headers to force 200 status for .mpd and .m4s files
    if (req.path.endsWith(".mpd") || req.path.endsWith(".m4s")) {
      delete req.headers["if-none-match"];
      delete req.headers["if-modified-since"];
    }
    next();
  },
  express.static(dashDir, {
    setHeaders: (res, path, stat, req) => {
      if (path.endsWith(".mpd")) {
        res.setHeader("Content-Type", "application/dash+xml");
        res.setHeader("Cache-Control", "no-cache");
      } else if (path.endsWith(".m4s")) {
        res.setHeader("Content-Type", "video/mp4");
      }
      
      // Handle CORS properly for credentials
      const allowedOrigins = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
      ];
      const origin = req.headers.origin;
      
      if (allowedOrigins.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Credentials", "true");
      } else {
        res.setHeader("Access-Control-Allow-Origin", "*");
      }
      
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    },
  }),
);

// Health check
app.get("/api/health", (req, res) => {
  const activeDownloads = originalDownloadService.getActiveDownloads();
  const mongoose = require("mongoose");

  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    activeDownloads: activeDownloads.length,
    hlsDir,
    database: {
      connected: mongoose.connection.readyState === 1,
      status: mongoose.connection.readyState,
    },
    version: "1.0.0",
  });
});

// 404 handler
app.use(notFoundHandler);

// Error handling middleware
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`HLS QA Tool server running on port ${PORT}`);
  console.log(`HLS directory: ${hlsDir}`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
});

module.exports = app;
