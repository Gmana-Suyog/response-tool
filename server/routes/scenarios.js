const express = require("express");
const router = express.Router();
const scenarioController = require("../controllers/scenarioController");
const { authenticate } = require("../middleware/auth");

// Routes without :id parameter (must come first)
// GET /api/scenarios - List all scenarios
router.get("/", scenarioController.getAllScenarios);

// POST /api/scenarios - Create new scenario
router.post("/", scenarioController.createScenario);

// POST /api/scenarios/detect-audio - Detect audio variants from manifest URL
router.post("/detect-audio", scenarioController.detectAudioVariants);

// Routes with :id parameter and specific paths (must come before generic /:id route)
// GET /api/scenarios/:id/history - Get change history
router.get("/:id/history", scenarioController.getChangeHistory);

// GET /api/scenarios/:id/changes - Get changes logs
router.get("/:id/changes", scenarioController.getChanges);

// GET /api/scenarios/:id/download-zip - Download ZIP file
router.get("/:id/download-zip", scenarioController.downloadZip);

// GET /api/scenarios/:id/segment-map - Get segment mapping
router.get("/:id/segment-map", scenarioController.getSegmentMap);

// GET /api/scenarios/:id/download-stats - Get download statistics
router.get("/:id/download-stats", scenarioController.getDownloadStats);

// GET /api/scenarios/:id/manifest-stats - Get manifest request statistics
router.get("/:id/manifest-stats", scenarioController.getManifestStats);

// GET /api/scenarios/:id/manifest-map - Get manifest filename mappings
router.get("/:id/manifest-map", scenarioController.getManifestMap);

// GET /api/scenarios/:id/manifest-mapping - Get manifest mapping for a profile
router.get("/:id/manifest-mapping", scenarioController.getManifestMapping);

// GET /api/scenarios/:id/manifest-mapping-stats - Get manifest mapping statistics
router.get(
  "/:id/manifest-mapping-stats",
  scenarioController.getManifestMappingStats,
);

// GET /api/scenarios/:id/folder-structure - Get folder structure of scenario
router.get(
  "/:id/folder-structure",
  scenarioController.getScenarioFolderStructure,
);

// GET /api/scenarios/:id/dash-folder-structure - Get DASH folder structure
router.get(
  "/:id/dash-folder-structure",
  scenarioController.getDashFolderStructure,
);

// GET /api/scenarios/:id/dash-manifest-content - Get DASH manifest content
router.get(
  "/:id/dash-manifest-content",
  authenticate,
  scenarioController.getDashManifestContent,
);

// GET /api/scenarios/:id/manifest-content - Get content of a manifest file
router.get(
  "/:id/manifest-content",
  authenticate,
  scenarioController.getManifestContent,
);

// OPTIONS /api/scenarios/:id/player/* - Handle preflight for player requests
router.options("/:id/player/*", scenarioController.serveHLSContent);

// GET /api/scenarios/:id/player - Serve HLS content for player
router.get("/:id/player/*", scenarioController.serveHLSContent);

// GET /api/scenarios/:id/live-stream/status - Get live stream status
router.get("/:id/live-stream/status", scenarioController.getLiveStreamStatus);

// GET /api/scenarios/:id/live-stream/request-count - Get live stream request count
router.get(
  "/:id/live-stream/request-count",
  scenarioController.getLiveStreamRequestCount,
);

// DASH Livestream routes
// GET /api/scenarios/:id/dash-live-stream/status - Get DASH live stream status
router.get(
  "/:id/dash-live-stream/status",
  scenarioController.getDashLiveStreamStatus,
);

// GET /api/scenarios/:id/dash-live-stream/request-count - Get DASH live stream request count
router.get(
  "/:id/dash-live-stream/request-count",
  scenarioController.getDashLiveStreamRequestCount,
);

// GET /api/scenarios/:id/dash-live-stream/manifest.mpd - Serve DASH live manifest
router.get(
  "/:id/dash-live-stream/manifest.mpd",
  scenarioController.serveDashLiveManifest,
);

// GET /api/scenarios/:id/dash-live-stream/media/* - Serve DASH live media files
router.get(
  "/:id/dash-live-stream/media/*",
  scenarioController.serveDashLiveMedia,
);

// GET /api/scenarios/:id/vmap-vast - Serve VMAP/VAST XML files (scenario-based, random selection)
router.get("/:id/vmap-vast", (req, res) =>
  scenarioController.serveVmapVastContent(req, res),
);

// GET /api/scenarios/:id/vmap-vast/* - Serve VMAP/VAST XML files (specific file or random)
router.get("/:id/vmap-vast/*", (req, res) =>
  scenarioController.serveVmapVastContent(req, res),
);

// GET /api/scenarios/:id/mp4 - Serve MP4 files (scenario-based, random selection)
router.get("/:id/mp4", (req, res) =>
  scenarioController.serveMp4Content(req, res),
);

// GET /api/scenarios/:id/mp4/* - Serve MP4 files (specific file or random)
router.get("/:id/mp4/*", (req, res) =>
  scenarioController.serveMp4Content(req, res),
);

// POST routes with specific paths
// POST /api/scenarios/:id/clone - Clone scenario
router.post("/:id/clone", scenarioController.cloneScenario);

// POST /api/scenarios/:id/download - Start download for profile
router.post("/:id/download", scenarioController.startDownload);

// POST /api/scenarios/:id/other-url-download - Start download for VMAP/VAST URLs
router.post(
  "/:id/other-url-download",
  scenarioController.startOtherUrlDownload,
);

// GET /api/scenarios/:id/other-url-mapping - Get URL mapping for VMAP/VAST
router.get("/:id/other-url-mapping", scenarioController.getOtherUrlMapping);

// POST /api/scenarios/:id/stop - Stop download and zip
router.post("/:id/stop", scenarioController.stopDownload);

// POST /api/scenarios/:id/reset-manifest-counter - Reset manifest request counter
router.post(
  "/:id/reset-manifest-counter",
  scenarioController.resetManifestCounter,
);

// POST /api/scenarios/:id/rewrite-master - Rewrite master manifest with options
router.post("/:id/rewrite-master", scenarioController.rewriteMasterManifest);

// POST /api/scenarios/:id/live-stream/init - Initialize live stream
router.post("/:id/live-stream/init", scenarioController.initializeLiveStream);

// POST /api/scenarios/:id/live-stream/reset - Reset live stream
router.post("/:id/live-stream/reset", scenarioController.resetLiveStream);

// POST /api/scenarios/:id/live-stream/timing - Set live stream timing
router.post("/:id/live-stream/timing", scenarioController.setLiveStreamTiming);

// POST /api/scenarios/:id/live-stream/request-count - Set live stream request count
router.post(
  "/:id/live-stream/request-count",
  scenarioController.setLiveStreamRequestCount,
);

// POST /api/scenarios/:id/cookie-validation - Toggle cookie validation
router.post("/:id/cookie-validation", scenarioController.toggleCookieValidation);

// DASH Livestream POST routes
// POST /api/scenarios/:id/dash-live-stream/init - Initialize DASH live stream
router.post(
  "/:id/dash-live-stream/init",
  scenarioController.initializeDashLiveStream,
);

// POST /api/scenarios/:id/dash-live-stream/reset - Reset DASH live stream
router.post(
  "/:id/dash-live-stream/reset",
  scenarioController.resetDashLiveStream,
);

// POST /api/scenarios/:id/dash-live-stream/request-count - Set DASH live stream request count
router.post(
  "/:id/dash-live-stream/request-count",
  scenarioController.setDashLiveStreamRequestCount,
);

// POST /api/scenarios/:id/manifest-config - Update delay/status for a manifest
router.post("/:id/manifest-config", scenarioController.updateManifestConfig);

// POST /api/scenarios/:id/manifest-config/all-profiles - Update delay/status for a manifest across all profiles
router.post(
  "/:id/manifest-config/all-profiles",
  scenarioController.updateManifestConfigAllProfiles,
);

// POST /api/scenarios/:id/manifest-config/reset - Reset delay/status for a manifest
router.post(
  "/:id/manifest-config/reset",
  scenarioController.resetManifestConfig,
);

// POST /api/scenarios/:id/manifest-config/reset-all - Reset all manifests for all profiles
router.post(
  "/:id/manifest-config/reset-all",
  scenarioController.resetAllManifestConfig,
);

// POST /api/scenarios/:id/manifest-content - Save manifest content
router.post(
  "/:id/manifest-content",
  authenticate,
  scenarioController.saveManifestContent,
);

// POST /api/scenarios/:id/dash-manifest-content - Save DASH manifest content
router.post(
  "/:id/dash-manifest-content",
  authenticate,
  scenarioController.saveDashManifestContent,
);

// POST /api/scenarios/:id/manifest-reset - Reset manifest content
router.post(
  "/:id/manifest-reset",
  authenticate,
  scenarioController.resetManifestContent,
);

// POST /api/scenarios/:id/dash-manifest-reset - Reset DASH manifest content
router.post(
  "/:id/dash-manifest-reset",
  authenticate,
  scenarioController.resetDashManifestContent,
);

// POST /api/scenarios/:id/vmap-vast-content - Save VMAP/VAST file content
router.post(
  "/:id/vmap-vast-content",
  authenticate,
  scenarioController.saveVmapVastContent,
);

// POST /api/scenarios/:id/vmap-vast-reset - Reset VMAP/VAST file content
router.post(
  "/:id/vmap-vast-reset",
  authenticate,
  scenarioController.resetVmapVastContent,
);

// GET /api/scenarios/:id/vmap-vast-content - Get VMAP/VAST file content
router.get(
  "/:id/vmap-vast-content",
  authenticate,
  scenarioController.getVmapVastContent,
);

// GET /api/scenarios/:id/vmap-vast-mapping - Get VMAP/VAST file mapping
router.get("/:id/vmap-vast-mapping", scenarioController.getVmapVastMapping);

// GET /api/scenarios/:id/mp4-mapping - Get MP4 file mapping
router.get("/:id/mp4-mapping", scenarioController.getMp4Mapping);

// POST /api/scenarios/:id/mp4-config - Update MP4 configuration
router.post("/:id/mp4-config", scenarioController.updateMp4Config);

// GET /api/scenarios/:id/gif - Serve GIF files (scenario-based, random selection)
router.get("/:id/gif", (req, res) =>
  scenarioController.serveGifContent(req, res),
);

// GET /api/scenarios/:id/gif/* - Serve GIF files (specific file or random)
router.get("/:id/gif/*", (req, res) =>
  scenarioController.serveGifContent(req, res),
);

// GET /api/scenarios/:id/gif-mapping - Get GIF file mapping
router.get("/:id/gif-mapping", scenarioController.getGifMapping);

// POST /api/scenarios/:id/gif-config - Update GIF configuration
router.post("/:id/gif-config", scenarioController.updateGifConfig);

// POST /api/scenarios/:id/config-copy - Copy configuration entry for VMAP/VAST/MP4/GIF
router.post("/:id/config-copy", scenarioController.copyConfigEntry);

// DELETE /api/scenarios/:id/config-remove - Remove configuration entry for VMAP/VAST/MP4/GIF
router.delete("/:id/config-remove", scenarioController.removeConfigEntry);

// Generic routes (must come last)
// GET /api/scenarios/:id - Get scenario details
router.get("/:id", scenarioController.getScenario);

// DELETE /api/scenarios/:id - Delete scenario
router.delete("/:id", scenarioController.deleteScenario);

module.exports = router;
