/**
 * HLS QA Tool Configuration
 */

const path = require("path");

const config = {
  // Server configuration
  server: {
    port: process.env.PORT || 3001,
    host: process.env.HOST || "localhost",
    baseUrl: process.env.SERVER_BASE_URL || "http://127.0.0.1:3001",
    cors: {
      origin: process.env.CORS_ORIGIN || "http://localhost:3000",
      credentials: true,
    },
  },

  // Client configuration
  client: {
    port: 3000,
    apiBaseUrl: process.env.VITE_API_BASE_URL || "http://localhost:3001",
  },

  // Storage configuration
  storage: {
    hlsDir: path.resolve(process.env.HLS_DIR || path.join(__dirname, "hls")),
    dashDir: path.resolve(process.env.DASH_DIR || path.join(__dirname, "dash")),
    mp4Dir: path.resolve(process.env.MP4_DIR || path.join(__dirname, "mp4")),
    maxScenarioSizeMB: parseInt(process.env.MAX_SCENARIO_SIZE_MB) || 1000,
  },

  // Download configuration
  download: {
    timeoutMs: parseInt(process.env.DOWNLOAD_TIMEOUT_MS) || 30000,
    maxConcurrentDownloads: parseInt(process.env.MAX_CONCURRENT_DOWNLOADS) || 5,
    retryAttempts: parseInt(process.env.SEGMENT_RETRY_ATTEMPTS) || 3,
    intervalMs: 10000, // Download check interval
    userAgent: "HLS-QA-Tool/1.0",
  },

  // HLS configuration
  hls: {
    defaultSegmentCount: parseInt(process.env.DEFAULT_SEGMENT_COUNT) || 6,
    maxProfileCount: parseInt(process.env.MAX_PROFILE_COUNT) || 10,
    supportedExtensions: [".ts", ".m4s", ".mp4"],
    manifestExtensions: [".m3u8"],
  },
};

module.exports = config;
