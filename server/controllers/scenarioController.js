const fs = require("fs-extra");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const originalDownloadService = require("../services/originalDownloadService");
const dashDownloadService = require("../services/dashDownloadService");
const otherUrlDownloadService = require("../services/otherUrlDownloadService");
const vodHlsDownloadService = require("../services/vodHlsDownloadService");
const manifestService = require("../services/manifestService");
const masterRewriter = require("../services/rewriteMaster");
const scenarioService = require("../services/scenarioService");
const archiver = require("archiver");
// Removed ManifestConfiguration model - configurations now stored in manifestMap.json

const HLS_DIR = path.join(__dirname, "../hls");
const DASH_DIR = path.join(__dirname, "../dash");
const VOD_HLS_DIR = path.join(__dirname, "../vod/hls");

// Module-level variable for VMAP/VAST repeat state tracking
const vmapVastRepeatStates = new Map();

// Module-level variable for MP4 repeat state tracking
const mp4RepeatStates = new Map();

// Helper function to create ZIP in background
function createZipInBackground(
  scenarioId,
  scenarioPath,
  zipPath,
  baseDir = HLS_DIR,
) {
  const output = fs.createWriteStream(zipPath);
  const archive = archiver("zip", { zlib: { level: 9 } });

  output.on("close", () => {
    console.log(
      `Scenario ${scenarioId} zipped: ${archive.pointer()} total bytes`,
    );
    console.log(`ZIP file created at: ${zipPath}`);
  });

  archive.on("error", (err) => {
    console.error(`Error creating ZIP for scenario ${scenarioId}:`, err);
  });

  output.on("error", (err) => {
    console.error(`Output stream error for scenario ${scenarioId}:`, err);
  });

  archive.pipe(output);

  // Add main scenario folder (rewritten files)
  console.log(`Adding main scenario folder to ZIP: ${scenarioId}`);
  archive.directory(scenarioPath, scenarioId);

  // Add original scenario folder if it exists
  const originalScenarioPath = path.join(baseDir, `${scenarioId}_original`);

  console.log(`Checking for original folder at: ${originalScenarioPath}`);

  if (fs.existsSync(originalScenarioPath)) {
    console.log(`Adding original folder to ZIP: ${scenarioId}_original`);
    console.log(`Original folder path: ${originalScenarioPath}`);
    archive.directory(originalScenarioPath, `${scenarioId}_original`);
  } else {
    console.log(`Original folder not found, skipping: ${scenarioId}_original`);
    console.log(`Checked path: ${originalScenarioPath}`);
  }

  // Finalize the archive
  archive.finalize();
}

// Synchronous ZIP creation function for on-demand downloads
function createZipSynchronously(
  scenarioId,
  scenarioPath,
  zipPath,
  baseDir = HLS_DIR,
) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => {
      console.log(
        `Scenario ${scenarioId} zipped synchronously: ${archive.pointer()} total bytes`,
      );
      resolve();
    });

    archive.on("error", (err) => {
      console.error(
        `Error creating ZIP synchronously for scenario ${scenarioId}:`,
        err,
      );
      reject(err);
    });

    output.on("error", (err) => {
      console.error(`Output stream error for scenario ${scenarioId}:`, err);
      reject(err);
    });

    archive.pipe(output);

    // Add main scenario folder (rewritten files)
    console.log(`Adding main scenario folder to ZIP: ${scenarioId}`);
    archive.directory(scenarioPath, scenarioId);

    // Add original scenario folder if it exists
    const originalScenarioPath = path.join(baseDir, `${scenarioId}_original`);

    console.log(`Checking for original folder at: ${originalScenarioPath}`);

    if (fs.existsSync(originalScenarioPath)) {
      console.log(`Adding original folder to ZIP: ${scenarioId}_original`);
      archive.directory(originalScenarioPath, `${scenarioId}_original`);
    } else {
      console.log(
        `Original folder not found, skipping: ${scenarioId}_original`,
      );
    }

    // Finalize the archive
    archive.finalize();
  });
}

async function createProfileFolders(scenarioId) {
  try {
    const scenarioPath = path.join(HLS_DIR, scenarioId);
    const masterManifestPath = path.join(scenarioPath, "master/master.m3u8");

    if (!(await fs.pathExists(masterManifestPath))) {
      console.log("Master manifest not found, cannot create profile folders");
      return;
    }

    const masterContent = await fs.readFile(masterManifestPath, "utf8");
    const profiles = manifestService.parseProfilesFromMaster(masterContent);

    console.log(`Creating ${profiles.length} profile folders`);

    // Create a folder for each profile
    for (const profile of profiles) {
      const profileDir = path.join(
        scenarioPath,
        "profiles",
        String(profile.index),
      );
      await fs.ensureDir(profileDir);
      console.log(`Created profile folder: ${profile.index}`);
    }

    // Update scenario with profile information
    await scenarioService.updateScenario(scenarioId, {
      profiles: profiles,
      profileCount: profiles.length,
    });

    console.log(`Successfully created ${profiles.length} profile folders`);
  } catch (error) {
    console.error("Error creating profile folders:", error);
    // Don't throw error as this is not critical for basic functionality
  }
}

class ScenarioController {
  async getAllScenarios(req, res) {
    try {
      console.log("Controller.getAllScenarios called");
      const scenarios = await scenarioService.getAllScenarios();
      console.log("Service returned scenarios:", scenarios);
      res.json(scenarios);
    } catch (error) {
      console.error("Error in getAllScenarios:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async createScenario(req, res) {
    console.log("createScenario called with body:", req.body);
    try {
      const {
        name,
        description,
        sourceManifestUrl,
        type,
        playbackType,
        belongsToCustomer,
        specialNotes,
        category,
        approveVersion,
        debug,
        selectedAudioVariant,
        requestHeaders,
        addCookie,
      } = req.body;

      // Validate required fields based on type
      if (!name) {
        console.log("Validation failed: missing name");
        return res.status(400).json({ error: "Name is required" });
      }

      // Source manifest URL is only required for HLS, DASH, and other streaming types
      if (
        type !== "VMAP" &&
        type !== "VAST" &&
        type !== "MP4" &&
        type !== "GIF" &&
        !sourceManifestUrl
      ) {
        console.log(
          "Validation failed: missing sourceManifestUrl for type:",
          type,
        );
        return res
          .status(400)
          .json({ error: "Source manifest URL is required for this type" });
      }

      const scenarioId = name.replace(/[^a-zA-Z0-9-_]/g, "_");

      // Determine base directory based on type
      let baseDir;
      if (type === "DASH") {
        baseDir = DASH_DIR;
      } else if (type === "VMAP") {
        baseDir = path.join(__dirname, "../vmap");
      } else if (type === "VAST") {
        baseDir = path.join(__dirname, "../vast");
      } else if (type === "MP4") {
        baseDir = path.join(__dirname, "../mp4");
      } else if (type === "GIF") {
        baseDir = path.join(__dirname, "../gif");
      } else {
        baseDir = HLS_DIR;
      }

      const scenarioPath = path.join(baseDir, scenarioId);

      console.log("Creating scenario with ID:", scenarioId);
      console.log("Scenario type:", type);
      console.log("Scenario path:", scenarioPath);
      console.log("Selected audio variant:", selectedAudioVariant);
      console.log("Request headers:", requestHeaders);
      console.log("Add Cookie:", addCookie);

      // Create scenario using the service (it will handle existence check)
      const scenario = await scenarioService.createScenario({
        name,
        description,
        sourceManifestUrl,
        type,
        playbackType,
        belongsToCustomer,
        specialNotes,
        category,
        approveVersion,
        debug,
        selectedAudioVariant,
        requestHeaders,
        addCookie,
      });

      // Only fetch master manifest for HLS (not for DASH, VMAP, VAST, MP4, or GIF)
      if (
        type !== "DASH" &&
        type !== "VMAP" &&
        type !== "VAST" &&
        type !== "MP4" &&
        type !== "GIF"
      ) {
        // Fetch and save master manifest for HLS
        console.log("Fetching master manifest for HLS...");
        try {
          // Convert request headers array to object
          const headersObject = {};
          if (requestHeaders && Array.isArray(requestHeaders)) {
            requestHeaders.forEach((header) => {
              if (header.name && header.value) {
                headersObject[header.name] = header.value;
              }
            });
          }
          console.log("Converted headers object:", headersObject);
          console.log("Headers object keys:", Object.keys(headersObject));
          console.log("Headers object values:", Object.values(headersObject));

          await manifestService.fetchAndSaveMasterManifest(
            scenarioId,
            sourceManifestUrl,
            selectedAudioVariant,
            headersObject,
            playbackType,
          );

          // Create profile folders based on master manifest
          console.log("Creating profile folders based on master manifest...");
          await createProfileFolders(scenarioId);

          console.log(
            "HLS scenario created successfully - ready for manual download",
          );
        } catch (manifestError) {
          console.error("Failed to fetch manifest:", manifestError.message);

          // Create a placeholder manifest so the scenario can still be created
          const placeholderManifest = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=640x360
placeholder.m3u8`;

          const masterPath = path.join(scenarioPath, "master/master.m3u8");
          await fs.writeFile(masterPath, placeholderManifest);

          console.log("Created placeholder manifest due to fetch failure");

          // Update scenario to indicate manifest fetch failed
          await scenarioService.updateScenario(scenarioId, {
            manifestFetchError: manifestError.message,
            isPlaceholder: true,
          });
        }
      } else if (type === "DASH") {
        console.log("DASH scenario created successfully - ready for download");
      } else if (type === "VMAP" || type === "VAST") {
        console.log(
          `${type} scenario created successfully - ready for URL downloads`,
        );
      } else if (type === "MP4") {
        console.log(
          "MP4 scenario created successfully - ready for URL downloads",
        );
      } else if (type === "GIF") {
        console.log(
          "GIF scenario created successfully - ready for URL downloads",
        );
      }

      console.log("Scenario created successfully:", scenario);
      res.json(scenario);
    } catch (error) {
      console.error("Error in createScenario:", error);

      // Handle specific error cases
      if (error.message === "Scenario already exists") {
        return res.status(409).json({ error: "Scenario already exists" });
      }

      res.status(500).json({ error: error.message });
    }
  }

  async getScenario(req, res) {
    try {
      const { id } = req.params;
      console.log("Getting scenario with ID:", id);

      const scenario = await scenarioService.getScenarioById(id);
      console.log("Scenario service returned:", scenario);

      if (!scenario) {
        console.log("Scenario not found:", id);
        return res.status(404).json({ error: "Scenario not found" });
      }

      console.log("Returning scenario:", scenario);
      res.json(scenario);
    } catch (error) {
      console.error("Error in getScenario:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async cloneScenario(req, res) {
    try {
      const { id } = req.params;
      const { name, description } = req.body;

      if (!name) {
        return res.status(400).json({ error: "Name is required" });
      }

      const newScenarioId = name.replace(/[^a-zA-Z0-9-_]/g, "_");

      // Check HLS directory first
      let sourceScenarioPath = path.join(HLS_DIR, id);
      let baseDir = HLS_DIR;
      let scenarioType = "HLS";

      // If not found in HLS, check DASH directory
      if (!(await fs.pathExists(sourceScenarioPath))) {
        sourceScenarioPath = path.join(DASH_DIR, id);
        baseDir = DASH_DIR;
        scenarioType = "DASH";
      }

      if (!(await fs.pathExists(sourceScenarioPath))) {
        return res.status(404).json({ error: "Source scenario not found" });
      }

      const newScenarioPath = path.join(baseDir, newScenarioId);

      if (await fs.pathExists(newScenarioPath)) {
        return res
          .status(409)
          .json({ error: "Scenario with this name already exists" });
      }

      // Get source scenario details
      const sourceDetailsPath = path.join(sourceScenarioPath, "details.json");
      const sourceDetails = await fs.readJson(sourceDetailsPath);

      // Copy entire scenario folder
      await fs.copy(sourceScenarioPath, newScenarioPath);
      console.log(`Cloned ${scenarioType} scenario: ${id} → ${newScenarioId}`);

      // Also copy the original scenario folder if it exists
      const sourceOriginalPath = path.join(baseDir, `${id}_original`);
      const newOriginalPath = path.join(baseDir, `${newScenarioId}_original`);

      if (await fs.pathExists(sourceOriginalPath)) {
        await fs.copy(sourceOriginalPath, newOriginalPath);
        console.log(
          `Cloned original folder: ${id}_original → ${newScenarioId}_original`,
        );
      } else {
        console.log(`Original folder not found, skipping: ${id}_original`);
      }

      // Update details for the cloned scenario
      const newDetails = {
        ...sourceDetails,
        name,
        description: description || sourceDetails.description,
        createdAt: new Date().toISOString(),
        downloadStatus: "idle",
        currentProfile: undefined,
      };

      // Regenerate cookie value if the source scenario has cookies enabled
      if (
        newDetails.addCookie === "YES" &&
        newDetails.type === "HLS" &&
        newDetails.playbackType === "Live"
      ) {
        newDetails.cookieValue = null;
        console.log(
          `Generated new cookie value for cloned scenario ${newScenarioId}: ${newDetails.cookieValue}`,
        );
      }

      const newDetailsPath = path.join(newScenarioPath, "details.json");
      await fs.writeJson(newDetailsPath, newDetails, { spaces: 2 });

      // Save to database using scenarioService
      const isDbConnected = await scenarioService.checkDatabaseConnection();
      if (isDbConnected) {
        try {
          const Scenario = require("../models/Scenario");
          const scenario = new Scenario({
            scenarioId: newScenarioId,
            ...newDetails,
            scenarioPath: newScenarioPath,
          });
          await scenario.save();
          console.log("Cloned scenario saved to database:", newScenarioId);
        } catch (error) {
          console.error("Error saving cloned scenario to database:", error);
          // Continue with file system only
        }
      }

      res.json({ id: newScenarioId, ...newDetails });
    } catch (error) {
      console.error("Error in cloneScenario:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async deleteScenario(req, res) {
    try {
      const { id } = req.params;

      console.log("Deleting scenario:", id);

      // Delete from database and file system using scenarioService
      await scenarioService.deleteScenario(id);

      console.log("Scenario deleted successfully:", id);
      res.json({ message: "Scenario deleted successfully" });
    } catch (error) {
      console.error("Error in deleteScenario:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async startDownload(req, res) {
    try {
      const { id } = req.params;
      const {
        profileNumber,
        maxSegmentsPerFetch,
        maxSegmentsToDownload,
        maxAudioSegmentsToDownload,
      } = req.body;

      // Get scenario to check type
      const scenario = await scenarioService.getScenarioById(id);
      if (!scenario) {
        return res.status(404).json({ error: "Scenario not found" });
      }

      // Validate maxSegmentsPerFetch
      const segmentLimit = maxSegmentsPerFetch || 6;
      if (segmentLimit < 1 || segmentLimit > 50) {
        return res.status(400).json({
          error: "maxSegmentsPerFetch must be between 1 and 50",
        });
      }

      let result;

      if (scenario.type === "DASH") {
        // DASH download - no profile number needed
        result = await dashDownloadService.startDashDownload(id, {
          maxSegmentsPerFetch: segmentLimit,
        });
      } else if (scenario.type === "HLS" && scenario.playbackType === "VOD") {
        // VOD HLS download - downloads from lowest bitrate profile only
        // Validate maxSegmentsToDownload if provided
        if (
          maxSegmentsToDownload !== undefined &&
          maxSegmentsToDownload !== null
        ) {
          if (maxSegmentsToDownload < 1) {
            return res.status(400).json({
              error: "maxSegmentsToDownload must be at least 1",
            });
          }
        }

        // Validate maxAudioSegmentsToDownload if provided
        if (
          maxAudioSegmentsToDownload !== undefined &&
          maxAudioSegmentsToDownload !== null
        ) {
          if (maxAudioSegmentsToDownload < 1) {
            return res.status(400).json({
              error: "maxAudioSegmentsToDownload must be at least 1",
            });
          }
        }

        result = await vodHlsDownloadService.startVodHlsDownload(id, {
          maxSegmentsToDownload: maxSegmentsToDownload || null,
          maxAudioSegmentsToDownload: maxAudioSegmentsToDownload || null,
        });
      } else {
        // HLS Live download
        if (profileNumber === undefined) {
          return res
            .status(400)
            .json({ error: "Profile number is required for HLS Live" });
        }

        // Validate maxSegmentsToDownload if provided
        if (
          maxSegmentsToDownload !== undefined &&
          maxSegmentsToDownload !== null
        ) {
          if (maxSegmentsToDownload < 1) {
            return res.status(400).json({
              error: "maxSegmentsToDownload must be at least 1",
            });
          }
        }

        result = await originalDownloadService.startOriginalDownload(
          id,
          profileNumber,
          {
            maxSegmentsPerFetch: segmentLimit,
            maxSegmentsToDownload: maxSegmentsToDownload || null,
          },
        );
      }

      // Update scenario status in database
      await scenarioService.updateScenario(id, {
        downloadStatus: "downloading",
        currentProfile:
          scenario.type === "DASH"
            ? 0
            : scenario.playbackType === "VOD"
              ? 0
              : profileNumber,
        maxSegmentsPerFetch: segmentLimit,
        maxSegmentsToDownload: maxSegmentsToDownload || null,
        maxAudioSegmentsToDownload: maxAudioSegmentsToDownload || null,
      });

      res.json(result);
    } catch (error) {
      console.error("Error in startDownload:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async stopDownload(req, res) {
    try {
      const { id } = req.params;

      // Get scenario to check type
      const scenario = await scenarioService.getScenarioById(id);
      if (!scenario) {
        return res.status(404).json({ error: "Scenario not found" });
      }

      // Update scenario status in database to "stopping" immediately
      await scenarioService.updateScenario(id, {
        downloadStatus: "stopping",
      });

      // Run the long-running stop and rewrite process in the background
      (async () => {
        try {
          console.log(
            `[STOP-BACKGROUND] Starting background stop for scenario ${id}`,
          );

          if (scenario.type === "DASH") {
            // DASH stop
            await dashDownloadService.stopDashDownload(id);
          } else if (
            scenario.type === "HLS" &&
            scenario.playbackType === "VOD"
          ) {
            // VOD HLS stop
            await vodHlsDownloadService.stopVodHlsDownload(id);
          } else {
            // HLS Live stop - performs graceful shutdown, waits for downloads, and handles rewriting
            await originalDownloadService.stopOriginalDownload(id);
          }

          // Update final scenario status in database
          await scenarioService.updateScenario(id, {
            downloadStatus: "stopped",
          });

          // Create ZIP file in the background (non-blocking) - skip for VOD for now
          if (scenario.playbackType !== "VOD") {
            const baseDir = scenario.type === "DASH" ? DASH_DIR : HLS_DIR;
            const scenarioPath = path.join(baseDir, id);
            const zipPath = path.join(baseDir, `${id}.zip`);

            if (scenario.type === "DASH") {
              createZipInBackground(id, scenarioPath, zipPath, baseDir);
            } else {
              createZipInBackground(id, scenarioPath, zipPath);
            }
          }

          console.log(
            `[STOP-BACKGROUND] Background stop completed for scenario ${id}`,
          );
        } catch (error) {
          console.error(
            `[STOP-BACKGROUND] Error in background stop for scenario ${id}:`,
            error,
          );

          // Revert status to stopped or error so user can try again if it failed
          try {
            await scenarioService.updateScenario(id, {
              downloadStatus: "stopped",
            });
          } catch (dbError) {
            console.error(
              `[STOP-BACKGROUND] Failed to reset status for scenario ${id}:`,
              dbError,
            );
          }
        }
      })();

      // Return immediately to prevent frontend timeout
      res.json({
        message:
          "Stop process initiated. The download is shutting down gracefully in the background.",
        status: "stopping",
      });
    } catch (error) {
      console.error("Error in stopDownload:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async downloadZip(req, res) {
    try {
      const { id } = req.params;

      // Get scenario to check type
      const scenario = await scenarioService.getScenarioById(id);
      if (!scenario) {
        return res.status(404).json({ error: "Scenario not found" });
      }

      const baseDir = scenario.type === "DASH" ? DASH_DIR : HLS_DIR;
      const zipPath = path.join(baseDir, `${id}.zip`);
      const scenarioPath = path.join(baseDir, id);

      // Check if scenario exists
      if (!(await fs.pathExists(scenarioPath))) {
        return res.status(404).json({ error: "Scenario not found" });
      }

      // If ZIP doesn't exist, create it synchronously
      if (!(await fs.pathExists(zipPath))) {
        console.log(`ZIP file not found, creating it now for scenario: ${id}`);

        try {
          await createZipSynchronously(id, scenarioPath, zipPath, baseDir);
          console.log(`ZIP file created successfully: ${zipPath}`);
        } catch (zipError) {
          console.error(`Failed to create ZIP file:`, zipError);
          return res.status(500).json({
            error: "Failed to create ZIP file",
            details: zipError.message,
          });
        }
      }

      // Verify ZIP file exists after creation
      if (!(await fs.pathExists(zipPath))) {
        return res.status(500).json({
          error:
            "ZIP file creation failed - file does not exist after creation",
        });
      }

      // Set headers for file download
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${id}.zip"`);
      res.setHeader("Access-Control-Allow-Origin", "*");

      // Stream the file
      res.sendFile(zipPath);
    } catch (error) {
      console.error("Error in downloadZip:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async serveHLSContent(req, res) {
    try {
      const { id } = req.params;
      const filePath = req.params[0]; // Everything after /player/
      const decodedFilePath = decodeURIComponent(filePath); // Decode URL-encoded characters

      // Handle OPTIONS preflight request immediately
      if (req.method === "OPTIONS") {
        // Get scenario to check cookie status for proper CORS handling
        const scenario = await scenarioService.getScenarioById(id);
        if (!scenario) {
          return res.status(404).json({ error: "Scenario not found" });
        }

        const cookieService = require("../services/cookieService");
        const isCookieEnabled = await cookieService.isCookieEnabled(id);

        const allowedOrigins = [
          "http://localhost:3000",
          "http://127.0.0.1:3000",
          "http://localhost:5173",
          "http://127.0.0.1:5173",
        ];
        const origin = req.headers.origin;

        if (isCookieEnabled) {
          // Cookie-enabled: use specific origin with credentials
          if (allowedOrigins.includes(origin)) {
            res.setHeader("Access-Control-Allow-Origin", origin);
            res.setHeader("Access-Control-Allow-Credentials", "true");
            res.setHeader(
              "Access-Control-Allow-Headers",
              "Range, Content-Type, Cookie",
            );
          } else {
            res.setHeader("Access-Control-Allow-Origin", origin || "*");
            res.setHeader("Access-Control-Allow-Credentials", "true");
            res.setHeader(
              "Access-Control-Allow-Headers",
              "Range, Content-Type, Cookie",
            );
          }
        } else {
          // Non-cookie: if origin is in allowed list, use specific origin (for axios withCredentials)
          if (allowedOrigins.includes(origin)) {
            res.setHeader("Access-Control-Allow-Origin", origin);
            res.setHeader("Access-Control-Allow-Credentials", "true");
            res.setHeader(
              "Access-Control-Allow-Headers",
              "Range, Content-Type, Cookie",
            );
          } else {
            // Unknown origin, use wildcard
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader(
              "Access-Control-Allow-Headers",
              "Range, Content-Type",
            );
          }
        }

        res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        res.setHeader(
          "Access-Control-Expose-Headers",
          "Content-Length, Content-Range",
        );
        res.setHeader("Access-Control-Max-Age", "86400");
        return res.status(204).end();
      }

      // Get scenario to determine if it's VOD or Live
      const scenario = await scenarioService.getScenarioById(id);
      if (!scenario) {
        return res.status(404).json({ error: "Scenario not found" });
      }

      // Determine base directory based on playback type
      const baseDir = scenario.playbackType === "VOD" ? VOD_HLS_DIR : HLS_DIR;

      // Cookie handling for HLS Live scenarios
      const cookieService = require("../services/cookieService");
      const isCookieEnabled = await cookieService.isCookieEnabled(id);
      const isMasterRequest =
        decodedFilePath === "master/master-local.m3u8" ||
        decodedFilePath === "master/master.m3u8";

      // Set CORS headers based on cookie requirement
      const allowedOrigins = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
      ];
      const origin = req.headers.origin;

      // Check if request has credentials (cookies)
      const hasCredentials = req.headers.cookie || req.headers.authorization;

      if (isCookieEnabled) {
        // For cookie-enabled scenarios, use specific origins and enable credentials
        if (allowedOrigins.includes(origin)) {
          res.setHeader("Access-Control-Allow-Origin", origin);
          res.setHeader("Access-Control-Allow-Credentials", "true");
        } else {
          // If origin is not in allowed list but cookies are enabled, still set CORS but no credentials
          console.log(`[Cookie-${id}] Origin ${origin} not in allowed list`);
          res.setHeader("Access-Control-Allow-Origin", origin || "*");
          res.setHeader("Access-Control-Allow-Credentials", "true");
        }
        res.setHeader(
          "Access-Control-Allow-Headers",
          "Range, Content-Type, Cookie",
        );
      } else {
        // For non-cookie scenarios
        // If browser is sending credentials (due to axios defaults), we must use specific origin
        if (hasCredentials && allowedOrigins.includes(origin)) {
          res.setHeader("Access-Control-Allow-Origin", origin);
          res.setHeader("Access-Control-Allow-Credentials", "true");
          res.setHeader(
            "Access-Control-Allow-Headers",
            "Range, Content-Type, Cookie",
          );
        } else if (origin && allowedOrigins.includes(origin)) {
          // Origin is present and allowed, use specific origin for better compatibility
          res.setHeader("Access-Control-Allow-Origin", origin);
          res.setHeader("Access-Control-Allow-Credentials", "true");
          res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type");
        } else {
          // Fallback to wildcard for unknown origins
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type");
        }
      }

      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader(
        "Access-Control-Expose-Headers",
        "Content-Length, Content-Range",
      );
      res.setHeader("Cache-Control", "no-cache");

      // Handle master manifest request - set cookie if enabled
      if (isCookieEnabled && isMasterRequest) {
        const sessionCookie = cookieService.generateSessionCookie(id);

        res.setHeader(
          "Set-Cookie",
          `sessionId=${sessionCookie}; Path=/; HttpOnly; SameSite=None; Secure;`,
        );

        console.log(
          `[Cookie-${id}] Set new session cookie on master manifest request: ${sessionCookie}`,
        );
        console.log(
          `[Cookie-${id}] Total active sesssions: ${cookieService.getSessionCount(id)}`,
        );
      }

      // Validate cookie for non-master requests if cookie is enabled AND validation is enabled
      if (isCookieEnabled && !isMasterRequest) {
        const isCookieValidationEnabled =
          await cookieService.isCookieValidationEnabled(id);

        console.log(
          `[Cookie-${id}] Cookie enabled: ${isCookieEnabled}, Validation enabled: ${isCookieValidationEnabled}`,
        );

        if (isCookieValidationEnabled) {
          const cookieHeader = req.headers.cookie;
          const sessionId = cookieService.parseCookie(cookieHeader);

          if (!sessionId) {
            console.log(
              `[Cookie-${id}] Request rejected - no cookie header found`,
            );
            return res.status(401).json({
              error: "Cookie required",
              message:
                "Please request the master manifest first to obtain a session cookie",
            });
          }

          // Validate that this session exists and is valid
          if (!cookieService.isValidSession(id, sessionId)) {
            console.log(
              `[Cookie-${id}] Request rejected - invalid or expired session: ${sessionId}`,
            );
            return res.status(401).json({
              error: "Invalid session",
              message:
                "The provided session cookie is invalid or has expired. Please request the master manifest again.",
            });
          }

          console.log(
            `[Cookie-${id}] Request validated with session: ${sessionId}`,
          );
        } else {
          console.log(
            `[Cookie-${id}] Cookie validation disabled - allowing request without validation`,
          );
        }
      }

      // Check if this is a playlist request
      const playlistMatch = decodedFilePath.match(
        /^profiles\/(\d+)\/playlist\.m3u8$/,
      );

      if (playlistMatch) {
        const profileNumber = parseInt(playlistMatch[1]);

        // Check if VOD or Live
        if (scenario.playbackType === "VOD") {
          // VOD playback - serve static playlist with configurations
          const vodHlsPlaybackService = require("../services/vodHlsPlaybackService");

          try {
            const result = await vodHlsPlaybackService.getVodProfilePlaylist(
              id,
              profileNumber,
            );

            const content =
              result.content !== undefined ? result.content : result;
            const status = result.status !== undefined ? result.status : 200;

            res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
            res.setHeader("Cache-Control", "no-cache");

            // Maintain CORS headers set earlier
            if (!res.getHeader("Access-Control-Allow-Origin")) {
              res.setHeader("Access-Control-Allow-Origin", "*");
            }

            res.status(status).send(content);
            return;
          } catch (error) {
            console.error("Error serving VOD playlist:", error);
            return res.status(404).json({ error: "VOD playlist not found" });
          }
        } else {
          // Live streaming content
          const liveStreamService = require("../services/liveStreamService");

          try {
            const result = await liveStreamService.getLivePlaylist(
              id,
              profileNumber,
            );

            const content =
              result.content !== undefined ? result.content : result;
            const status = result.status !== undefined ? result.status : 200;

            res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
            res.setHeader(
              "Cache-Control",
              "no-cache, no-store, must-revalidate",
            );
            res.setHeader("Pragma", "no-cache");
            res.setHeader("Expires", "0");

            // Maintain CORS headers set earlier
            if (!res.getHeader("Access-Control-Allow-Origin")) {
              res.setHeader("Access-Control-Allow-Origin", "*");
            }

            res.status(status).send(content);
            return;
          } catch (error) {
            console.error("Error serving playlist:", error);
            return res.status(404).json({ error: "Playlist not found" });
          }
        }
      }

      // Check if this is an audio manifest request
      const audioMatch = decodedFilePath.match(
        /^audio\/([^\/]+)\/audio\.m3u8$/,
      );

      if (audioMatch) {
        const audioVariant = audioMatch[1]; // e.g., "eng a1", "eng a2", "eng a3"

        // Check if VOD or Live
        if (scenario.playbackType === "VOD") {
          // VOD playback - serve static audio playlist with configurations
          const vodHlsPlaybackService = require("../services/vodHlsPlaybackService");

          try {
            const result = await vodHlsPlaybackService.getVodAudioPlaylist(
              id,
              audioVariant,
            );

            const content =
              result.content !== undefined ? result.content : result;
            const status = result.status !== undefined ? result.status : 200;

            res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
            res.setHeader("Cache-Control", "no-cache");

            // Maintain CORS headers set earlier
            if (!res.getHeader("Access-Control-Allow-Origin")) {
              res.setHeader("Access-Control-Allow-Origin", "*");
            }

            res.status(status).send(content);
            return;
          } catch (error) {
            console.error("Error serving VOD audio playlist:", error);
            return res
              .status(404)
              .json({ error: "VOD audio playlist not found" });
          }
        } else {
          // Live streaming audio content
          const liveStreamService = require("../services/liveStreamService");

          try {
            const result = await liveStreamService.getLiveAudioPlaylist(
              id,
              audioVariant,
            );

            const content =
              result.content !== undefined ? result.content : result;
            const status = result.status !== undefined ? result.status : 200;

            res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
            res.setHeader(
              "Cache-Control",
              "no-cache, no-store, must-revalidate",
            );
            res.setHeader("Pragma", "no-cache");
            res.setHeader("Expires", "0");

            // Maintain CORS headers set earlier
            if (!res.getHeader("Access-Control-Allow-Origin")) {
              res.setHeader("Access-Control-Allow-Origin", "*");
            }

            res.status(status).send(content);
            return;
          } catch (error) {
            console.error("Error serving audio playlist:", error);
            return res.status(404).json({ error: "Audio playlist not found" });
          }
        }
      }

      // Check if this is a full playlist request (all segments)
      const fullPlaylistMatch = decodedFilePath.match(
        /^profiles\/(\d+)\/full\.m3u8$/,
      );

      if (fullPlaylistMatch) {
        const profileNumber = parseInt(fullPlaylistMatch[1]);
        const liveStreamService = require("../services/liveStreamService");

        try {
          const manifestContent = await liveStreamService.getFullPlaylist(
            id,
            profileNumber,
          );

          res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
          res.setHeader("Cache-Control", "no-cache");

          // Maintain CORS headers set earlier
          if (!res.getHeader("Access-Control-Allow-Origin")) {
            res.setHeader("Access-Control-Allow-Origin", "*");
          }

          res.send(manifestContent);
          return;
        } catch (error) {
          console.error("Error serving full playlist:", error);
          return res.status(404).json({ error: "Full playlist not found" });
        }
      }

      // Check if this is a profile manifest request with pointer swapping
      const profileManifestMatch = decodedFilePath.match(
        /^profiles\/(\d+)\/profileManifest\.m3u8$/,
      );

      if (profileManifestMatch) {
        const profileNumber = parseInt(profileManifestMatch[1]);
        const manifestRequestTracker = require("../services/manifestRequestTracker");

        try {
          // Get the current request count to look up configuration
          const requestCount =
            manifestRequestTracker.getCurrentRequestCount(id, profileNumber) +
            1;

          // Lookup configuration from manifestMap.json
          const manifestMapPath = path.join(HLS_DIR, id, "manifestMap.json");
          let delay = 0;
          let status = 200;

          if (await fs.pathExists(manifestMapPath)) {
            const manifestMap = await fs.readJson(manifestMapPath);
            const profileMap =
              manifestMap.profile && manifestMap.profile[String(profileNumber)];

            if (profileMap) {
              const mapping = Object.values(profileMap).find(
                (m) => m.manifestNumber === requestCount,
              );
              if (mapping) {
                delay = (mapping.delay || 0) * 1000;
                status = mapping.status || 200;
              }
            }
          }

          const manifestContent =
            await manifestRequestTracker.serveProfileManifest(
              id,
              profileNumber,
              true, // Use pointer swapping
            );

          setTimeout(() => {
            res.status(status);
            res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
            res.setHeader(
              "Cache-Control",
              "no-cache, no-store, must-revalidate",
            );
            res.setHeader("Pragma", "no-cache");
            res.setHeader("Expires", "0");

            // Maintain CORS headers set earlier
            if (!res.getHeader("Access-Control-Allow-Origin")) {
              res.setHeader("Access-Control-Allow-Origin", "*");
            }

            res.send(manifestContent);
          }, delay);
          return;
        } catch (error) {
          console.error("Error serving profile manifest:", error);
          return res.status(404).json({ error: "Profile manifest not found" });
        }
      }

      // Standard file serving for other requests
      const scenarioPath = path.join(baseDir, id);
      let requestedFile = path.join(scenarioPath, decodedFilePath);

      // For VOD scenarios, serve segments directly without dynamic renaming
      if (scenario.playbackType === "VOD" && requestedFile.endsWith(".ts")) {
        const segmentName = path.basename(requestedFile);
        const mediaType = decodedFilePath.includes("/audio/")
          ? "audio"
          : "video";

        // Serve segment directly from media directory
        const mediaDir = path.join(scenarioPath, "media", mediaType);
        const segmentPath = path.join(mediaDir, segmentName);

        if (!(await fs.pathExists(segmentPath))) {
          return res.status(404).json({ error: "Segment not found" });
        }

        console.log(`[VOD] Serving segment: ${segmentName}`);
        requestedFile = segmentPath;
      }

      if (!(await fs.pathExists(requestedFile))) {
        return res.status(404).json({ error: "File not found" });
      }

      // Force 200 status by removing conditional headers from request for segments, playlists, and master manifest
      if (requestedFile.endsWith(".ts") || requestedFile.endsWith(".m3u8")) {
        delete req.headers["if-none-match"];
        delete req.headers["if-modified-since"];
      }

      // Set appropriate headers for HLS content
      if (decodedFilePath.endsWith(".m3u8")) {
        res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
        res.setHeader("Cache-Control", "no-cache");
      } else if (requestedFile.endsWith(".ts")) {
        res.setHeader("Content-Type", "video/mp2t");
      }

      // Maintain CORS headers set earlier
      if (!res.getHeader("Access-Control-Allow-Origin")) {
        res.setHeader("Access-Control-Allow-Origin", "*");
      }

      res.sendFile(requestedFile);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getSegmentMap(req, res) {
    try {
      const { id } = req.params;

      // Force 200 status by removing conditional headers
      delete req.headers["if-none-match"];
      delete req.headers["if-modified-since"];

      // Get scenario to determine type
      const scenario = await scenarioService.getScenarioById(id);
      if (!scenario) {
        return res.status(404).json({ error: "Scenario not found" });
      }

      let baseDir;
      if (scenario.type === "DASH") {
        baseDir = DASH_DIR;
      } else if (scenario.playbackType === "VOD") {
        baseDir = VOD_HLS_DIR;
      } else {
        baseDir = HLS_DIR;
      }

      const segmentMapPath = path.join(baseDir, id, "segmentMap.json");

      if (!(await fs.pathExists(segmentMapPath))) {
        // Return empty object if file doesn't exist yet
        return res.status(200).json({});
      }

      const segmentMap = await fs.readJson(segmentMapPath);

      // Set headers to prevent caching
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");

      res.status(200).json(segmentMap);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getDownloadStats(req, res) {
    try {
      const { id } = req.params;
      const activeDownloads = originalDownloadService.getActiveDownloads();
      const stats = activeDownloads.find(
        (download) => download.scenarioId === id,
      );

      if (!stats) {
        return res.status(404).json({
          error: "No active download found",
          scenarioId: id,
          status: "idle",
        });
      }

      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getManifestStats(req, res) {
    try {
      const { id } = req.params;
      const manifestRequestTracker = require("../services/manifestRequestTracker");

      const stats = manifestRequestTracker.getStats(id);
      res.json({
        scenarioId: id,
        requestCounts: stats,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getManifestMap(req, res) {
    try {
      const { id } = req.params;

      // Force 200 status by removing conditional headers
      delete req.headers["if-none-match"];
      delete req.headers["if-modified-since"];

      // Get scenario to determine type
      const scenario = await scenarioService.getScenarioById(id);
      if (!scenario) {
        return res.status(404).json({ error: "Scenario not found" });
      }

      // Handle VMAP/VAST scenarios - return urlMapping.json
      if (scenario.type === "VMAP" || scenario.type === "VAST") {
        const baseDir =
          scenario.type === "VMAP"
            ? path.join(__dirname, "../vmap")
            : path.join(__dirname, "../vast");
        const urlMappingPath = path.join(baseDir, id, "urlMapping.json");

        if (!(await fs.pathExists(urlMappingPath))) {
          // Return empty structure if file doesn't exist yet
          return res.status(200).json({});
        }

        const urlMapping = await fs.readJson(urlMappingPath);

        // Set headers to prevent caching
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");

        return res.status(200).json(urlMapping);
      }

      // Original HLS/DASH logic
      let baseDir;
      if (scenario.type === "DASH") {
        baseDir = DASH_DIR;
      } else if (scenario.playbackType === "VOD") {
        baseDir = VOD_HLS_DIR;
      } else {
        baseDir = HLS_DIR;
      }

      const manifestMapPath = path.join(baseDir, id, "manifestMap.json");

      if (!(await fs.pathExists(manifestMapPath))) {
        // Return empty structure if file doesn't exist yet
        return res.status(200).json({
          profile: {},
          audio: {},
        });
      }

      const manifestMap = await fs.readJson(manifestMapPath);

      // Set headers to prevent caching
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");

      res.status(200).json(manifestMap);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async resetManifestCounter(req, res) {
    try {
      const { id } = req.params;
      const { profileNumber } = req.body;
      const manifestRequestTracker = require("../services/manifestRequestTracker");

      if (profileNumber !== undefined) {
        manifestRequestTracker.resetRequestCount(id, profileNumber);
        res.json({
          message: `Reset counter for profile ${profileNumber}`,
          scenarioId: id,
          profileNumber,
        });
      } else {
        manifestRequestTracker.resetScenario(id);
        res.json({
          message: "Reset all counters for scenario",
          scenarioId: id,
        });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async rewriteMasterManifest(req, res) {
    try {
      const { id } = req.params;
      const { useProfileManifest } = req.body;
      const masterRewriter = require("../services/rewriteMaster");

      await masterRewriter.rewriteMasterForScenario(
        id,
        useProfileManifest || false,
      );

      res.json({
        message: "Master manifest rewritten successfully",
        scenarioId: id,
        mode: useProfileManifest ? "pointer-swapping" : "static",
      });
    } catch (error) {
      console.error("Error rewriting master manifest:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async getManifestMapping(req, res) {
    try {
      const { id } = req.params;
      const { profileNumber } = req.query;
      const segmentIdentityService = require("../services/segmentIdentityService");
      const scenarioPath = path.join(HLS_DIR, id);

      if (!profileNumber) {
        return res.status(400).json({ error: "Profile number is required" });
      }

      const manifestMapping = await segmentIdentityService.loadManifestMapping(
        scenarioPath,
        parseInt(profileNumber),
      );

      res.json(manifestMapping);
    } catch (error) {
      console.error("Error getting manifest mapping:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async getManifestMappingStats(req, res) {
    try {
      const { id } = req.params;
      const segmentIdentityService = require("../services/segmentIdentityService");
      const scenarioPath = path.join(HLS_DIR, id);

      // Get stats for all profiles
      const details = await fs.readJson(
        path.join(scenarioPath, "details.json"),
      );
      const profileCount = details.profileCount || 5;
      const stats = {};

      for (let i = 0; i < profileCount; i++) {
        try {
          stats[`profile${i}`] =
            await segmentIdentityService.getManifestMappingStats(
              scenarioPath,
              i,
            );
        } catch (error) {
          stats[`profile${i}`] = { error: error.message };
        }
      }

      res.json({
        scenarioId: id,
        profileStats: stats,
      });
    } catch (error) {
      console.error("Error getting manifest mapping stats:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async initializeLiveStream(req, res) {
    try {
      const { id } = req.params;
      const { profileNumber } = req.body;
      const liveStreamService = require("../services/liveStreamService");

      const streamState = await liveStreamService.initializeLiveStream(
        id,
        profileNumber || 0,
      );

      res.json({
        message: "Live stream initialized successfully",
        scenarioId: id,
        profileNumber: profileNumber || 0,
        totalSegments: streamState.totalSegments,
        segmentDuration: streamState.segmentDuration,
        windowSize: streamState.windowSize,
      });
    } catch (error) {
      console.error("Error initializing live stream:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async getLiveStreamStatus(req, res) {
    try {
      const { id } = req.params;
      const { profileNumber } = req.query;
      const liveStreamService = require("../services/liveStreamService");

      const status = liveStreamService.getStreamStatus(
        id,
        parseInt(profileNumber) || 0,
      );

      res.json(status);
    } catch (error) {
      console.error("Error getting live stream status:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async resetLiveStream(req, res) {
    try {
      const { id } = req.params;
      const { profileNumber, resetAll } = req.body;
      const liveStreamService = require("../services/liveStreamService");

      if (resetAll) {
        // Reset all profiles for the scenario
        liveStreamService.resetScenarioStreams(id);
        res.json({
          message: "All live streams reset successfully for scenario",
          scenarioId: id,
          resetAll: true,
        });
      } else {
        // Reset specific profile
        liveStreamService.resetLiveStream(id, profileNumber || 0);
        res.json({
          message: "Live stream reset successfully",
          scenarioId: id,
          profileNumber: profileNumber || 0,
        });
      }
    } catch (error) {
      console.error("Error resetting live stream:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async setLiveStreamTiming(req, res) {
    try {
      const { id } = req.params;
      const { profileNumber, segmentDuration, windowSize } = req.body;
      const liveStreamService = require("../services/liveStreamService");

      liveStreamService.setStreamTiming(
        id,
        profileNumber || 0,
        segmentDuration || 6000,
        windowSize || 10,
      );

      res.json({
        message: "Live stream timing updated successfully",
        scenarioId: id,
        profileNumber: profileNumber || 0,
        segmentDuration: segmentDuration || 6000,
        windowSize: windowSize || 10,
      });
    } catch (error) {
      console.error("Error setting live stream timing:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async getLiveStreamRequestCount(req, res) {
    try {
      const { id } = req.params;
      const { profileNumber } = req.query;
      const liveStreamService = require("../services/liveStreamService");

      const requestCount = liveStreamService.getRequestCount(
        id,
        parseInt(profileNumber) || 0,
      );

      res.json({
        scenarioId: id,
        profileNumber: parseInt(profileNumber) || 0,
        requestCount,
      });
    } catch (error) {
      console.error("Error getting live stream request count:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async setLiveStreamRequestCount(req, res) {
    try {
      const { id } = req.params;
      const { profileNumber, requestCount } = req.body;
      const liveStreamService = require("../services/liveStreamService");

      liveStreamService.setRequestCount(
        id,
        profileNumber || 0,
        requestCount || 0,
      );

      res.json({
        message: "Live stream request count updated successfully",
        scenarioId: id,
        profileNumber: profileNumber || 0,
        requestCount: requestCount || 0,
      });
    } catch (error) {
      console.error("Error setting live stream request count:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async updateManifestConfig(req, res) {
    try {
      const { id } = req.params;
      const {
        manifestKey,
        sectionKey,
        delay,
        delayPercentage,
        status,
        statusPercentage,
        repeat,
        repeatPercentage,
      } = req.body;

      // Get scenario to determine type
      const scenario = await scenarioService.getScenarioById(id);
      if (!scenario) {
        return res.status(404).json({ error: "Scenario not found" });
      }

      // Handle VMAP/VAST/MP4 scenarios differently
      if (
        scenario.type === "VMAP" ||
        scenario.type === "VAST" ||
        scenario.type === "MP4"
      ) {
        let baseDir;
        if (scenario.type === "VMAP") {
          baseDir = path.join(__dirname, "../vmap");
        } else if (scenario.type === "VAST") {
          baseDir = path.join(__dirname, "../vast");
        } else if (scenario.type === "MP4") {
          baseDir = path.join(__dirname, "../mp4");
        }

        const urlMappingPath = path.join(baseDir, id, "urlMapping.json");

        if (!(await fs.pathExists(urlMappingPath))) {
          return res.status(404).json({ error: "URL mapping not found" });
        }

        const urlMapping = await fs.readJson(urlMappingPath);

        if (urlMapping[manifestKey]) {
          urlMapping[manifestKey].delay = parseFloat(delay) || 0;
          urlMapping[manifestKey].delayPercentage =
            parseInt(delayPercentage) !== undefined
              ? parseInt(delayPercentage)
              : 100;
          urlMapping[manifestKey].statusCode = parseInt(status) || 200;
          urlMapping[manifestKey].statusPercentage =
            parseInt(statusPercentage) !== undefined
              ? parseInt(statusPercentage)
              : 100;
          urlMapping[manifestKey].isEdited = true;

          await fs.writeJson(urlMappingPath, urlMapping, { spaces: 2 });

          console.log(
            `[${scenario.type}-${id}] Updated configuration for ${manifestKey}:`,
            {
              delay: urlMapping[manifestKey].delay,
              delayPercentage: urlMapping[manifestKey].delayPercentage,
              statusCode: urlMapping[manifestKey].statusCode,
              statusPercentage: urlMapping[manifestKey].statusPercentage,
            },
          );

          return res.json({
            message: "Config updated",
            config: urlMapping[manifestKey],
          });
        }

        return res.status(404).json({ error: "File not found in mapping" });
      }

      // Original HLS/DASH logic
      let baseDir;
      if (scenario.type === "DASH") {
        baseDir = DASH_DIR;
      } else if (scenario.playbackType === "VOD") {
        baseDir = VOD_HLS_DIR;
      } else {
        baseDir = HLS_DIR;
      }

      const manifestMapPath = path.join(baseDir, id, "manifestMap.json");

      if (!(await fs.pathExists(manifestMapPath))) {
        return res.status(404).json({ error: "Manifest map not found" });
      }

      const manifestMap = await fs.readJson(manifestMapPath);

      // Navigate to the correct section (profile or audio)
      const sectionParts = sectionKey.split(".");
      let target = manifestMap;
      for (const part of sectionParts) {
        if (!target[part]) target[part] = {};
        target = target[part];
      }

      if (target[manifestKey]) {
        target[manifestKey].delay = parseFloat(delay) || 0;
        target[manifestKey].delayPercentage =
          parseInt(delayPercentage) !== undefined
            ? parseInt(delayPercentage)
            : 100;
        target[manifestKey].status = parseInt(status) || 200;
        target[manifestKey].statusPercentage =
          parseInt(statusPercentage) !== undefined
            ? parseInt(statusPercentage)
            : 100;
        target[manifestKey].repeat = parseInt(repeat) || 0;
        target[manifestKey].repeatPercentage =
          parseInt(repeatPercentage) !== undefined
            ? parseInt(repeatPercentage)
            : 100;
        target[manifestKey].isEdited = true;

        // For DASH scenarios, also set isConfigEdited flag
        if (scenario.type === "DASH") {
          target[manifestKey].isConfigEdited = true;
        }

        await fs.writeJson(manifestMapPath, manifestMap, { spaces: 2 });
        return res.json({
          message: "Config updated",
          config: target[manifestKey],
        });
      }

      res.status(404).json({ error: "Manifest not found in map" });
    } catch (error) {
      console.error("Error updating manifest config:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async updateManifestConfigAllProfiles(req, res) {
    try {
      const { id } = req.params;
      const {
        manifestKey,
        sectionKey,
        delay,
        delayPercentage,
        status,
        statusPercentage,
        repeat,
        repeatPercentage,
      } = req.body;

      // Get scenario to determine type
      const scenario = await scenarioService.getScenarioById(id);
      if (!scenario) {
        return res.status(404).json({ error: "Scenario not found" });
      }

      // Determine base directory based on type and playback type
      let baseDir;
      if (scenario.type === "DASH") {
        baseDir = DASH_DIR;
      } else if (scenario.playbackType === "VOD") {
        baseDir = VOD_HLS_DIR;
      } else {
        baseDir = HLS_DIR;
      }

      const manifestMapPath = path.join(baseDir, id, "manifestMap.json");

      if (!(await fs.pathExists(manifestMapPath))) {
        return res.status(404).json({ error: "Manifest map not found" });
      }

      const manifestMap = await fs.readJson(manifestMapPath);

      // Find the source manifest to get its timestamp
      const sectionParts = sectionKey.split(".");
      let sourceTarget = manifestMap;
      for (const part of sectionParts) {
        sourceTarget = sourceTarget[part] || {};
      }

      const sourceManifest = sourceTarget[manifestKey];
      if (!sourceManifest) {
        return res.status(404).json({ error: "Source manifest not found" });
      }

      const targetManifestNumber = sourceManifest.manifestNumber;
      const delayValue = parseFloat(delay) || 0;
      const delayPercentageValue =
        parseInt(delayPercentage) !== undefined
          ? parseInt(delayPercentage)
          : 100;
      const statusValue = parseInt(status) || 200;
      const statusPercentageValue =
        parseInt(statusPercentage) !== undefined
          ? parseInt(statusPercentage)
          : 100;
      const repeatValue = parseInt(repeat) || 0;
      const repeatPercentageValue =
        parseInt(repeatPercentage) !== undefined
          ? parseInt(repeatPercentage)
          : 100;

      // Determine if this is a video or audio update based on sectionKey
      const isVideoUpdate = sectionKey.startsWith("profile.");
      const isAudioUpdate = sectionKey.startsWith("audio.");

      // Update all matching video manifests by manifestNumber (only if video update)
      if (isVideoUpdate && manifestMap.profile) {
        Object.keys(manifestMap.profile).forEach((profile) => {
          Object.keys(manifestMap.profile[profile]).forEach((key) => {
            if (
              manifestMap.profile[profile][key].manifestNumber ===
              targetManifestNumber
            ) {
              manifestMap.profile[profile][key].delay = delayValue;
              manifestMap.profile[profile][key].delayPercentage =
                delayPercentageValue;
              manifestMap.profile[profile][key].status = statusValue;
              manifestMap.profile[profile][key].statusPercentage =
                statusPercentageValue;
              manifestMap.profile[profile][key].repeat = repeatValue;
              manifestMap.profile[profile][key].repeatPercentage =
                repeatPercentageValue;
              manifestMap.profile[profile][key].isEditedForAll = true;
              manifestMap.profile[profile][key].isEdited = true;

              // For DASH scenarios, also set isConfigEdited flag
              if (scenario.type === "DASH") {
                manifestMap.profile[profile][key].isConfigEdited = true;
              }
            }
          });
        });
      }

      // Update all matching audio manifests by manifestNumber (only if audio update)
      if (isAudioUpdate && manifestMap.audio) {
        Object.keys(manifestMap.audio).forEach((variant) => {
          Object.keys(manifestMap.audio[variant]).forEach((key) => {
            if (
              manifestMap.audio[variant][key].manifestNumber ===
              targetManifestNumber
            ) {
              manifestMap.audio[variant][key].delay = delayValue;
              manifestMap.audio[variant][key].delayPercentage =
                delayPercentageValue;
              manifestMap.audio[variant][key].status = statusValue;
              manifestMap.audio[variant][key].statusPercentage =
                statusPercentageValue;
              manifestMap.audio[variant][key].repeat = repeatValue;
              manifestMap.audio[variant][key].repeatPercentage =
                repeatPercentageValue;
              manifestMap.audio[variant][key].isEditedForAll = true;
              manifestMap.audio[variant][key].isEdited = true;

              // For DASH scenarios, also set isConfigEdited flag
              if (scenario.type === "DASH") {
                manifestMap.audio[variant][key].isConfigEdited = true;
              }
            }
          });
        });
      }

      await fs.writeJson(manifestMapPath, manifestMap, { spaces: 2 });
      res.json({ message: "Config updated for all profiles" });
    } catch (error) {
      console.error("Error updating manifest config for all profiles:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async resetManifestConfig(req, res) {
    try {
      const { id } = req.params;
      const { manifestKey, sectionKey, allProfiles } = req.body;

      // Get scenario to determine type
      const scenario = await scenarioService.getScenarioById(id);
      if (!scenario) {
        return res.status(404).json({ error: "Scenario not found" });
      }

      // Handle VMAP/VAST/MP4 scenarios differently
      if (
        scenario.type === "VMAP" ||
        scenario.type === "VAST" ||
        scenario.type === "MP4"
      ) {
        let baseDir;
        if (scenario.type === "VMAP") {
          baseDir = path.join(__dirname, "../vmap");
        } else if (scenario.type === "VAST") {
          baseDir = path.join(__dirname, "../vast");
        } else if (scenario.type === "MP4") {
          baseDir = path.join(__dirname, "../mp4");
        }

        const urlMappingPath = path.join(baseDir, id, "urlMapping.json");

        if (!(await fs.pathExists(urlMappingPath))) {
          return res.status(404).json({ error: "URL mapping not found" });
        }

        const urlMapping = await fs.readJson(urlMappingPath);

        if (urlMapping[manifestKey]) {
          urlMapping[manifestKey].delay = 0;
          urlMapping[manifestKey].delayPercentage = 100;
          urlMapping[manifestKey].statusCode = 200;
          urlMapping[manifestKey].statusPercentage = 100;
          urlMapping[manifestKey].isEdited = false;

          await fs.writeJson(urlMappingPath, urlMapping, { spaces: 2 });

          console.log(
            `[${scenario.type}-${id}] Reset configuration for ${manifestKey}`,
          );

          return res.json({ message: "Config reset" });
        }

        return res.status(404).json({ error: "File not found in mapping" });
      }

      // Original HLS/DASH logic
      let baseDir;
      if (scenario.type === "DASH") {
        baseDir = DASH_DIR;
      } else if (scenario.playbackType === "VOD") {
        baseDir = VOD_HLS_DIR;
      } else {
        baseDir = HLS_DIR;
      }

      const manifestMapPath = path.join(baseDir, id, "manifestMap.json");

      if (!(await fs.pathExists(manifestMapPath))) {
        return res.status(404).json({ error: "Manifest map not found" });
      }

      const manifestMap = await fs.readJson(manifestMapPath);

      if (allProfiles) {
        // Find target manifestNumber first
        const sectionParts = sectionKey.split(".");
        let sourceTarget = manifestMap;
        for (const part of sectionParts) {
          sourceTarget = sourceTarget[part] || {};
        }
        const sourceManifest = sourceTarget[manifestKey];
        if (!sourceManifest) {
          return res.status(404).json({ error: "Manifest not found" });
        }
        const targetManifestNumber = sourceManifest.manifestNumber;

        // Determine if this is a video or audio reset based on sectionKey
        const isVideoReset = sectionKey.startsWith("profile.");
        const isAudioReset = sectionKey.startsWith("audio.");

        // Reset across all video profiles by manifestNumber (only if video reset)
        if (isVideoReset && manifestMap.profile) {
          Object.keys(manifestMap.profile).forEach((profile) => {
            Object.keys(manifestMap.profile[profile]).forEach((key) => {
              if (
                manifestMap.profile[profile][key].manifestNumber ===
                targetManifestNumber
              ) {
                manifestMap.profile[profile][key].delay = 0;
                manifestMap.profile[profile][key].delayPercentage = 100;
                manifestMap.profile[profile][key].status = 200;
                manifestMap.profile[profile][key].statusPercentage = 100;
                manifestMap.profile[profile][key].repeat = 0;
                manifestMap.profile[profile][key].repeatPercentage = 100;
                manifestMap.profile[profile][key].isEditedForAll = false;
                manifestMap.profile[profile][key].isEdited = false;

                // For DASH scenarios, also reset isConfigEdited flag
                if (scenario.type === "DASH") {
                  manifestMap.profile[profile][key].isConfigEdited = false;
                }
              }
            });
          });
        }
        // Reset across all audio variants by manifestNumber (only if audio reset)
        if (isAudioReset && manifestMap.audio) {
          Object.keys(manifestMap.audio).forEach((variant) => {
            Object.keys(manifestMap.audio[variant]).forEach((key) => {
              if (
                manifestMap.audio[variant][key].manifestNumber ===
                targetManifestNumber
              ) {
                manifestMap.audio[variant][key].delay = 0;
                manifestMap.audio[variant][key].delayPercentage = 100;
                manifestMap.audio[variant][key].status = 200;
                manifestMap.audio[variant][key].statusPercentage = 100;
                manifestMap.audio[variant][key].repeat = 0;
                manifestMap.audio[variant][key].repeatPercentage = 100;
                manifestMap.audio[variant][key].isEditedForAll = false;
                manifestMap.audio[variant][key].isEdited = false;

                // For DASH scenarios, also reset isConfigEdited flag
                if (scenario.type === "DASH") {
                  manifestMap.audio[variant][key].isConfigEdited = false;
                }
              }
            });
          });
        }
      } else {
        // Reset single manifest
        const sectionParts = sectionKey.split(".");
        let target = manifestMap;
        for (const part of sectionParts) {
          if (!target[part]) target[part] = {};
          target = target[part];
        }

        if (target[manifestKey]) {
          target[manifestKey].delay = 0;
          target[manifestKey].delayPercentage = 100;
          target[manifestKey].status = 200;
          target[manifestKey].statusPercentage = 100;
          target[manifestKey].repeat = 0;
          target[manifestKey].repeatPercentage = 100;
          target[manifestKey].isEdited = false;

          // For DASH scenarios, also reset isConfigEdited flag
          if (scenario.type === "DASH") {
            target[manifestKey].isConfigEdited = false;
          }
        }
      }

      await fs.writeJson(manifestMapPath, manifestMap, { spaces: 2 });
      res.json({ message: "Config reset" });
    } catch (error) {
      console.error("Error resetting manifest config:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async resetAllManifestConfig(req, res) {
    try {
      const { id } = req.params;
      const { type } = req.body; // 'delay', 'status', or undefined for both

      // Get scenario to determine type
      const scenario = await scenarioService.getScenarioById(id);
      if (!scenario) {
        return res.status(404).json({ error: "Scenario not found" });
      }

      // Handle VMAP/VAST/MP4 scenarios differently
      if (
        scenario.type === "VMAP" ||
        scenario.type === "VAST" ||
        scenario.type === "MP4"
      ) {
        let baseDir;
        if (scenario.type === "VMAP") {
          baseDir = path.join(__dirname, "../vmap");
        } else if (scenario.type === "VAST") {
          baseDir = path.join(__dirname, "../vast");
        } else if (scenario.type === "MP4") {
          baseDir = path.join(__dirname, "../mp4");
        }

        const urlMappingPath = path.join(baseDir, id, "urlMapping.json");

        if (!(await fs.pathExists(urlMappingPath))) {
          return res.status(404).json({ error: "URL mapping not found" });
        }

        const urlMapping = await fs.readJson(urlMappingPath);

        // Reset all files in urlMapping
        for (const key of Object.keys(urlMapping)) {
          if (urlMapping[key].filename) {
            if (type === "delay") {
              urlMapping[key].delay = 0;
              urlMapping[key].delayPercentage = 100;
            } else if (type === "status") {
              urlMapping[key].statusCode = 200;
              urlMapping[key].statusPercentage = 100;
            } else {
              urlMapping[key].delay = 0;
              urlMapping[key].delayPercentage = 100;
              urlMapping[key].statusCode = 200;
              urlMapping[key].statusPercentage = 100;
            }
            urlMapping[key].isEdited = false;
          }
        }

        await fs.writeJson(urlMappingPath, urlMapping, { spaces: 2 });

        console.log(`[${scenario.type}-${id}] Reset all configurations`);

        return res.json({ message: "All configs reset" });
      }

      // Original HLS/DASH logic
      let baseDir;
      if (scenario.type === "DASH") {
        baseDir = DASH_DIR;
      } else if (scenario.playbackType === "VOD") {
        baseDir = VOD_HLS_DIR;
      } else {
        baseDir = HLS_DIR;
      }

      const manifestMapPath = path.join(baseDir, id, "manifestMap.json");

      if (!(await fs.pathExists(manifestMapPath))) {
        return res.status(404).json({ error: "Manifest map not found" });
      }

      const manifestMap = await fs.readJson(manifestMapPath);

      const resetObj = async (obj, key, typeKey, identifier, subDir) => {
        if (!obj) return;

        // 1. Restore file on disk (only for HLS)
        if (scenario.type !== "DASH") {
          try {
            const targetFilePath = `${subDir}/${identifier}/${obj.rewrittenFilename}`;
            const fullTargetPath = path.join(baseDir, id, targetFilePath);
            await originalDownloadService.rewriteSingleManifest(
              id,
              key,
              typeKey,
              identifier,
              fullTargetPath,
            );
          } catch (err) {
            console.warn(
              `Failed to restore manifest file ${key}:`,
              err.message,
            );
          }
        }

        // 2. Reset metadata
        if (type === "delay") {
          obj.delay = 0;
          obj.delayPercentage = 100;
        } else if (type === "status") {
          obj.status = 200;
          obj.statusPercentage = 100;
        } else if (type === "repeat") {
          obj.repeat = 0;
          obj.repeatPercentage = 100;
        } else {
          obj.delay = 0;
          obj.delayPercentage = 100;
          obj.status = 200;
          obj.statusPercentage = 100;
          obj.repeat = 0;
          obj.repeatPercentage = 100;
        }
        obj.isEdited = false;
        obj.isEditedForAll = false;

        // For DASH scenarios, also reset isConfigEdited flag
        if (scenario.type === "DASH") {
          obj.isConfigEdited = false;
        }
      };

      // Reset video profiles
      if (manifestMap.profile) {
        for (const profile of Object.keys(manifestMap.profile)) {
          for (const key of Object.keys(manifestMap.profile[profile])) {
            const subDir = scenario.type === "DASH" ? "manifests" : "profiles";
            await resetObj(
              manifestMap.profile[profile][key],
              key,
              "video",
              profile,
              subDir,
            );
          }
        }
      }

      // Reset audio variants
      if (manifestMap.audio) {
        for (const variant of Object.keys(manifestMap.audio)) {
          for (const key of Object.keys(manifestMap.audio[variant])) {
            await resetObj(
              manifestMap.audio[variant][key],
              key,
              "audio",
              variant,
              "audio",
            );
          }
        }
      }

      // Clear changes.json
      const changesPath = path.join(baseDir, id, "changes.json");
      if (await fs.pathExists(changesPath)) {
        await fs.writeJson(changesPath, [], { spaces: 2 });
      }

      await fs.writeJson(manifestMapPath, manifestMap, { spaces: 2 });
      res.json({ message: "All configs reset and manifests restored" });
    } catch (error) {
      console.error("Error resetting all manifest configs:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async detectAudioVariants(req, res) {
    try {
      const { manifestUrl, requestHeaders } = req.body;

      if (!manifestUrl) {
        return res.status(400).json({ error: "Manifest URL is required" });
      }

      console.log("=== DETECT AUDIO VARIANTS DEBUG ===");
      console.log("Manifest URL:", manifestUrl);
      console.log("Request headers received:", requestHeaders);
      console.log("Request headers type:", typeof requestHeaders);
      console.log(
        "Request headers keys:",
        requestHeaders ? Object.keys(requestHeaders) : "null",
      );

      // Use the manifestService that's already imported at the top
      const audioInfo = await manifestService.detectAudioVariantsFromUrl(
        manifestUrl,
        requestHeaders || {},
      );

      console.log("Audio info result:", audioInfo);
      res.json(audioInfo);
    } catch (error) {
      console.error("Error detecting audio variants:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async getScenarioFolderStructure(req, res) {
    try {
      const { id } = req.params;
      const scenarioPath = path.join(HLS_DIR, id);

      if (!(await fs.pathExists(scenarioPath))) {
        return res.status(404).json({ error: "Scenario directory not found" });
      }

      const getStructure = async (dir, relativeDir = "") => {
        const items = await fs.readdir(dir);
        const structure = [];

        for (const item of items) {
          const fullPath = path.join(dir, item);
          const stats = await fs.stat(fullPath);
          const relPath = path.join(relativeDir, item).replace(/\\/g, "/");

          if (stats.isDirectory()) {
            structure.push({
              name: item,
              type: "directory",
              path: relPath,
              children: await getStructure(fullPath, relPath),
            });
          } else {
            structure.push({
              name: item,
              type: "file",
              path: relPath,
              size: stats.size,
            });
          }
        }
        return structure;
      };

      const structure = await getStructure(scenarioPath);
      res.json(structure);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getManifestContent(req, res) {
    try {
      const { id } = req.params;
      const { filePath, isOriginal } = req.query;

      if (!filePath) {
        return res.status(400).json({ error: "File path is required" });
      }

      // Get scenario to determine base directory
      const scenario = await scenarioService.getScenarioById(id);
      if (!scenario) {
        return res.status(404).json({ error: "Scenario not found" });
      }

      let baseDir = HLS_DIR;
      if (scenario.playbackType === "VOD") {
        baseDir = VOD_HLS_DIR;
      }

      let fullPath;
      if (isOriginal === "true") {
        // For VOD, need to look up the actual original filename from manifestRecord.json
        if (scenario.playbackType === "VOD") {
          const originalScenarioPath = path.join(baseDir, `${id}_original`);
          const manifestRecordPath = path.join(
            originalScenarioPath,
            "manifestRecord.json",
          );

          if (!(await fs.pathExists(manifestRecordPath))) {
            return res
              .status(404)
              .json({ error: "manifestRecord.json not found" });
          }

          const manifestRecord = await fs.readJson(manifestRecordPath);

          // Parse the filePath to determine type and identifier
          // filePath format: "profiles/0/playlist.m3u8" or "audio/variant/audio.m3u8"
          const pathParts = filePath.split("/");
          const isVideo = pathParts[0] === "profiles";
          const identifier = pathParts[1];

          const section = isVideo
            ? manifestRecord.profile
            : manifestRecord.audio;

          // Find the original filename
          let actualOriginalFilename = null;
          let sourceIdentifier = identifier;

          if (section && section[identifier]) {
            const manifestFiles = Object.keys(section[identifier]);
            if (manifestFiles.length > 0) {
              actualOriginalFilename = manifestFiles[0];
            }
          }

          // Fallback: For VOD video, use profile 0 if the requested profile doesn't exist
          if (
            !actualOriginalFilename &&
            isVideo &&
            identifier !== "0" &&
            section &&
            section["0"]
          ) {
            sourceIdentifier = "0";
            const manifestFiles = Object.keys(section["0"]);
            if (manifestFiles.length > 0) {
              actualOriginalFilename = manifestFiles[0];
            }
          }

          if (!actualOriginalFilename) {
            return res.status(404).json({
              error: `Original manifest not found for ${pathParts[0]} ${identifier}`,
            });
          }

          // Build the path with the actual original filename
          fullPath = path.join(
            originalScenarioPath,
            pathParts[0],
            sourceIdentifier,
            actualOriginalFilename,
          );
        } else {
          // For Live HLS, use the filePath as-is
          fullPath = path.join(baseDir, `${id}_original`, filePath);
        }
      } else {
        fullPath = path.join(baseDir, id, filePath);
      }

      if (!(await fs.pathExists(fullPath))) {
        return res.status(404).json({ error: "File not found" });
      }

      const content = await fs.readFile(fullPath, "utf8");
      res.json({ content });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async saveManifestContent(req, res) {
    try {
      const { id } = req.params;
      const {
        filePath,
        content,
        saveForAll,
        manifestKey,
        sectionKey,
        profileNumber,
      } = req.body;
      const user = req.user?.fullName || "Unknown User"; // Auth middleware adds user to req

      if (!filePath || content === undefined) {
        return res
          .status(400)
          .json({ error: "File path and content are required" });
      }

      // Get scenario to determine base directory
      const scenario = await scenarioService.getScenarioById(id);
      if (!scenario) {
        return res.status(404).json({ error: "Scenario not found" });
      }

      let baseDir = HLS_DIR;
      if (scenario.playbackType === "VOD") {
        baseDir = VOD_HLS_DIR;
      }

      const scenarioPath = path.join(baseDir, id);
      const mainFilePath = path.join(scenarioPath, filePath);
      const manifestMapPath = path.join(scenarioPath, "manifestMap.json");
      const changesPath = path.join(scenarioPath, "changes.json");

      if (!(await fs.pathExists(mainFilePath))) {
        return res.status(404).json({ error: "File not found" });
      }

      // 1. Save locally
      await fs.writeFile(mainFilePath, content);

      const manifestMap = await fs.readJson(manifestMapPath);
      let changes = [];
      if (await fs.pathExists(changesPath)) {
        changes = await fs.readJson(changesPath);
      }

      const videoProfiles = [];
      const audioProfiles = [];
      const sectionParts = sectionKey.split(".");
      let sourceTarget = manifestMap;
      for (const part of sectionParts) {
        sourceTarget = sourceTarget[part] || {};
      }
      const sourceManifest = sourceTarget[manifestKey];
      if (!sourceManifest) {
        return res.status(404).json({ error: "Source manifest not found" });
      }
      const targetManifestNumber = sourceManifest.manifestNumber;

      if (saveForAll) {
        // Find all matching manifests across profiles by manifestNumber
        if (filePath.includes("profiles/")) {
          const profileDirs = await fs.readdir(
            path.join(scenarioPath, "profiles"),
          );
          for (const p of profileDirs) {
            if (!manifestMap.profile || !manifestMap.profile[p]) continue;

            // Find manifest in this profile with same manifestNumber
            const profileManifests = manifestMap.profile[p];
            const matchingKey = Object.keys(profileManifests).find(
              (key) =>
                profileManifests[key].manifestNumber === targetManifestNumber,
            );

            if (matchingKey) {
              const m = profileManifests[matchingKey];
              const pPath = path.join(
                scenarioPath,
                "profiles",
                p,
                m.rewrittenFilename,
              );
              await fs.writeFile(pPath, content);
              videoProfiles.push(parseInt(p));

              // Update manifestMap - use isContentEdited for file edits
              m.isContentEdited = true;
              m.isContentEditedForAll = true;
            }
          }
        } else if (filePath.includes("audio/")) {
          const audioDirs = await fs.readdir(path.join(scenarioPath, "audio"));
          for (const a of audioDirs) {
            if (!manifestMap.audio || !manifestMap.audio[a]) continue;

            // Find manifest in this variant with same manifestNumber
            const audioManifests = manifestMap.audio[a];
            const matchingKey = Object.keys(audioManifests).find(
              (key) =>
                audioManifests[key].manifestNumber === targetManifestNumber,
            );

            if (matchingKey) {
              const m = audioManifests[matchingKey];
              const aPath = path.join(
                scenarioPath,
                "audio",
                a,
                m.rewrittenFilename,
              );
              await fs.writeFile(aPath, content);
              audioProfiles.push(a);

              // Update manifestMap - use isContentEdited for file edits
              m.isContentEdited = true;
              m.isContentEditedForAll = true;
            }
          }
        }
      } else {
        // Single profile update - use isContentEdited for file edits
        sourceManifest.isContentEdited = true;
        sourceManifest.isContentEditedForAll = false;

        if (filePath.includes("profiles/")) {
          videoProfiles.push(profileNumber);
        } else if (filePath.includes("audio/")) {
          audioProfiles.push(profileNumber);
        }
      }

      // 2. Log change
      const manifestInfo = sourceManifest;

      const changeEntry = {
        manifestNumber: manifestInfo?.manifestNumber,
        filename: path.basename(filePath),
        originalfile: manifestKey,
        timestamp: new Date().toISOString(),
        User: user,
        isEdited: !saveForAll,
        isEditedAll: saveForAll,
        profiles: {
          videoProfiles,
          audioProfiles,
        },
      };
      changes.push(changeEntry);

      await fs.writeJson(manifestMapPath, manifestMap, { spaces: 2 });
      await fs.writeJson(changesPath, changes, { spaces: 2 });

      res.json({
        message: "Manifest saved successfully",
        isEdited: true,
        isEditedAll: saveForAll,
      });
    } catch (error) {
      console.error("Save manifest error:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async resetManifestContent(req, res) {
    try {
      const { id } = req.params;
      const { filePath, manifestKey, sectionKey, resetForAll } = req.body;

      if (!filePath || !manifestKey || !sectionKey) {
        return res.status(400).json({ error: "Missing required parameters" });
      }

      // Get scenario to determine type
      const scenario = await scenarioService.getScenarioById(id);
      if (!scenario) {
        return res.status(404).json({ error: "Scenario not found" });
      }

      let baseDir;
      if (scenario.type === "DASH") {
        baseDir = DASH_DIR;
      } else if (scenario.playbackType === "VOD") {
        baseDir = VOD_HLS_DIR;
      } else {
        baseDir = HLS_DIR;
      }

      const scenarioPath = path.join(baseDir, id);
      const manifestMapPath = path.join(scenarioPath, "manifestMap.json");
      const manifestMap = await fs.readJson(manifestMapPath);

      const sectionParts = sectionKey.split(".");
      const typeKey = sectionParts[0] === "profile" ? "video" : "audio";

      let sourceTarget = manifestMap;
      for (const part of sectionParts) {
        sourceTarget = sourceTarget[part] || {};
      }
      const sourceManifest = sourceTarget[manifestKey];
      if (!sourceManifest) {
        return res.status(404).json({ error: "Manifest not found" });
      }

      const resetAction = async (targetFilePath, targetIdentifier) => {
        const fullTargetPath = path.join(baseDir, id, targetFilePath);

        // For DASH, copy from original folder
        if (scenario.type === "DASH") {
          const originalPath = path.join(
            baseDir,
            `${id}_original`,
            targetFilePath,
          );
          if (await fs.pathExists(originalPath)) {
            await fs.copy(originalPath, fullTargetPath);
          }
        } else if (scenario.playbackType === "VOD") {
          // For VOD HLS, use VOD rewrite service
          const vodRewriteService = require("../services/vodRewriteService");
          await vodRewriteService.rewriteSingleVodManifest(
            id,
            manifestKey,
            typeKey,
            targetIdentifier,
            fullTargetPath,
          );
        } else {
          // For Live HLS, use original download service
          await originalDownloadService.rewriteSingleManifest(
            id,
            manifestKey,
            typeKey,
            targetIdentifier,
            fullTargetPath,
          );
        }
      };

      if (resetForAll) {
        // Use already declared sectionParts and sourceManifest logic
        const targetManifestNumber = sourceManifest.manifestNumber;

        // Determine subdirectory based on scenario type
        const videoSubDir = scenario.type === "DASH" ? "manifests" : "profiles";
        const audioSubDir = "audio";

        // Reset for all profiles if video, or all audio variants if audio
        if (typeKey === "video" && manifestMap.profile) {
          for (const p of Object.keys(manifestMap.profile)) {
            const profileManifests = manifestMap.profile[p];
            const matchingKey = Object.keys(profileManifests).find(
              (key) =>
                profileManifests[key].manifestNumber === targetManifestNumber,
            );

            if (matchingKey) {
              const m = profileManifests[matchingKey];
              await resetAction(
                `${videoSubDir}/${p}/${m.rewrittenFilename}`,
                p,
              );
              m.isContentEdited = false;
              m.isContentEditedForAll = false;
            }
          }
        } else if (typeKey === "audio" && manifestMap.audio) {
          for (const a of Object.keys(manifestMap.audio)) {
            const audioManifests = manifestMap.audio[a];
            const matchingKey = Object.keys(audioManifests).find(
              (key) =>
                audioManifests[key].manifestNumber === targetManifestNumber,
            );

            if (matchingKey) {
              const m = audioManifests[matchingKey];
              await resetAction(
                `${audioSubDir}/${a}/${m.rewrittenFilename}`,
                a,
              );
              m.isContentEdited = false;
              m.isContentEditedForAll = false;
            }
          }
        }
      } else {
        const identifier = sectionParts[1];
        await resetAction(filePath, identifier);
        let target = manifestMap;
        for (const part of sectionParts) target = target[part] || {};
        if (target[manifestKey]) {
          target[manifestKey].isContentEdited = false;
          target[manifestKey].isContentEditedForAll = false;
        }
      }

      await fs.writeJson(manifestMapPath, manifestMap, { spaces: 2 });
      res.json({ message: "Manifest reset successful" });
    } catch (error) {
      console.error("Reset manifest content error:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async getChanges(req, res) {
    try {
      const { id } = req.params;
      const changesPath = path.join(HLS_DIR, id, "changes.json");
      if (await fs.pathExists(changesPath)) {
        const changes = await fs.readJson(changesPath);
        return res.json(changes);
      }
      res.json([]);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getChangeHistory(req, res) {
    try {
      const { id } = req.params;

      // Get scenario to determine type and base directory
      const scenario = await scenarioService.getScenarioById(id);
      if (!scenario) {
        return res.status(404).json({ error: "Scenario not found" });
      }

      let baseDir;
      if (scenario.type === "DASH") {
        baseDir = DASH_DIR;
      } else if (scenario.type === "VMAP") {
        baseDir = path.join(__dirname, "../vmap");
      } else if (scenario.type === "VAST") {
        baseDir = path.join(__dirname, "../vast");
      } else {
        baseDir = HLS_DIR;
      }

      const changesPath = path.join(baseDir, id, "changes.json");

      if (await fs.pathExists(changesPath)) {
        const changesData = await fs.readJson(changesPath);

        // Handle both array format and object format
        let changes = [];
        if (Array.isArray(changesData)) {
          // Direct array format
          changes = changesData;
        } else if (changesData.changes && Array.isArray(changesData.changes)) {
          // Object with changes property
          changes = changesData.changes;
        }

        // Sort by timestamp (newest first)
        changes.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        return res.json({ changes });
      }

      // Return empty array if file doesn't exist
      res.json({ changes: [] });
    } catch (error) {
      console.error("Error fetching change history:", error);
      res.status(500).json({ error: error.message });
    }
  }

  // DASH Livestream Methods
  async initializeDashLiveStream(req, res) {
    try {
      const { id } = req.params;
      const { profileNumber } = req.body;
      const dashLiveStreamService = require("../services/dashLiveStreamService");

      const streamState = await dashLiveStreamService.initializeLiveStream(
        id,
        profileNumber || 0,
      );

      res.json({
        message: "DASH live stream initialized successfully",
        scenarioId: id,
        profileNumber: profileNumber || 0,
        totalManifests: streamState.totalManifests,
        minBufferTime: streamState.minBufferTime,
      });
    } catch (error) {
      console.error("Error initializing DASH live stream:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async getDashLiveStreamStatus(req, res) {
    try {
      const { id } = req.params;
      const { profileNumber } = req.query;
      const dashLiveStreamService = require("../services/dashLiveStreamService");

      const status = dashLiveStreamService.getLiveStreamStatus(
        id,
        parseInt(profileNumber) || 0,
      );

      res.json(status);
    } catch (error) {
      console.error("Error getting DASH live stream status:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async resetDashLiveStream(req, res) {
    try {
      const { id } = req.params;
      const { profileNumber } = req.body;
      const dashLiveStreamService = require("../services/dashLiveStreamService");

      await dashLiveStreamService.resetLiveStream(id, profileNumber || 0);

      res.json({
        message: "DASH live stream reset successfully",
        scenarioId: id,
        profileNumber: profileNumber || 0,
      });
    } catch (error) {
      console.error("Error resetting DASH live stream:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async getDashLiveStreamRequestCount(req, res) {
    try {
      const { id } = req.params;
      const { profileNumber } = req.query;
      const dashLiveStreamService = require("../services/dashLiveStreamService");

      const requestCount = dashLiveStreamService.getRequestCount(
        id,
        parseInt(profileNumber) || 0,
      );

      res.json({
        scenarioId: id,
        profileNumber: parseInt(profileNumber) || 0,
        requestCount,
      });
    } catch (error) {
      console.error("Error getting DASH live stream request count:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async setDashLiveStreamRequestCount(req, res) {
    try {
      const { id } = req.params;
      const { profileNumber, requestCount } = req.body;
      const dashLiveStreamService = require("../services/dashLiveStreamService");

      dashLiveStreamService.setRequestCount(
        id,
        profileNumber || 0,
        requestCount || 0,
      );

      res.json({
        message: "DASH live stream request count updated",
        scenarioId: id,
        profileNumber: profileNumber || 0,
        requestCount: requestCount || 0,
      });
    } catch (error) {
      console.error("Error setting DASH live stream request count:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async serveDashLiveManifest(req, res) {
    try {
      const { id } = req.params;
      const { profileNumber } = req.query;
      const dashLiveStreamService = require("../services/dashLiveStreamService");

      console.log(
        `[DASH-LIVE-MANIFEST] Request for scenario: ${id}, profileNumber: ${profileNumber}`,
      );

      const result = await dashLiveStreamService.getLiveManifest(
        id,
        parseInt(profileNumber) || 0,
      );

      // Log a snippet of the manifest to verify BaseURL
      const baseUrlMatch = result.content.match(/<BaseURL>([^<]+)<\/BaseURL>/);
      if (baseUrlMatch) {
        console.log(
          `[DASH-LIVE-MANIFEST] BaseURL in manifest: ${baseUrlMatch[1]}`,
        );
      }

      res.status(result.statusCode);
      res.setHeader("Content-Type", "application/dash+xml");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.send(result.content);
    } catch (error) {
      console.error("Error serving DASH live manifest:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async serveDashLiveMedia(req, res) {
    try {
      const { id } = req.params;
      const mediaPath = req.params[0];

      console.log(
        `[DASH-LIVE-MEDIA] Request for scenario: ${id}, mediaPath: ${mediaPath}`,
      );

      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type");
      res.setHeader(
        "Access-Control-Expose-Headers",
        "Content-Length, Content-Range",
      );
      res.setHeader("Cache-Control", "no-cache");

      const scenarioPath = path.join(DASH_DIR, id);
      const requestedFile = path.join(scenarioPath, "media", mediaPath);

      console.log(`[DASH-LIVE-MEDIA] Full file path: ${requestedFile}`);
      console.log(
        `[DASH-LIVE-MEDIA] File exists: ${await fs.pathExists(requestedFile)}`,
      );

      if (!(await fs.pathExists(requestedFile))) {
        console.error(`[DASH-LIVE-MEDIA] File not found: ${requestedFile}`);
        return res.status(404).json({ error: "Media file not found" });
      }

      // Remove conditional headers to force 200 status
      delete req.headers["if-none-match"];
      delete req.headers["if-modified-since"];

      // Set appropriate content type
      if (requestedFile.endsWith(".m4s")) {
        res.setHeader("Content-Type", "video/mp4");
      }

      console.log(`[DASH-LIVE-MEDIA] Serving file: ${requestedFile}`);
      res.sendFile(requestedFile);
    } catch (error) {
      console.error("Error serving DASH live media:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async getDashFolderStructure(req, res) {
    try {
      const { id } = req.params;
      const scenarioPath = path.join(DASH_DIR, id);

      if (!(await fs.pathExists(scenarioPath))) {
        return res.status(404).json({ error: "Scenario not found" });
      }

      const structure = {
        manifests: [],
        media: {
          video: [],
          audio: [],
        },
      };

      // Get manifests
      const manifestsDir = path.join(scenarioPath, "manifests");
      if (await fs.pathExists(manifestsDir)) {
        const files = await fs.readdir(manifestsDir);
        structure.manifests = files
          .filter((f) => f.endsWith(".mpd"))
          .sort((a, b) => {
            const timestampA = parseInt(a.split("-")[0]);
            const timestampB = parseInt(b.split("-")[0]);
            return timestampA - timestampB;
          });
      }

      // Get video segments
      const videoDir = path.join(scenarioPath, "media/video");
      if (await fs.pathExists(videoDir)) {
        const videoDirs = await fs.readdir(videoDir);
        for (const dir of videoDirs) {
          const dirPath = path.join(videoDir, dir);
          const stat = await fs.stat(dirPath);
          if (stat.isDirectory()) {
            const files = await fs.readdir(dirPath);
            structure.media.video.push({
              profile: dir,
              files: files.filter(
                (f) => f.endsWith(".m4s") || f.endsWith(".mp4"),
              ),
            });
          }
        }
      }

      // Get audio segments
      const audioDir = path.join(scenarioPath, "media/audio");
      if (await fs.pathExists(audioDir)) {
        const audioDirs = await fs.readdir(audioDir);
        for (const dir of audioDirs) {
          const dirPath = path.join(audioDir, dir);
          const stat = await fs.stat(dirPath);
          if (stat.isDirectory()) {
            const files = await fs.readdir(dirPath);
            structure.media.audio.push({
              profile: dir,
              files: files.filter(
                (f) => f.endsWith(".m4s") || f.endsWith(".mp4"),
              ),
            });
          }
        }
      }

      res.json(structure);
    } catch (error) {
      console.error("Error getting DASH folder structure:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async getDashManifestContent(req, res) {
    try {
      const { id } = req.params;
      const { filePath, isOriginal } = req.query;

      if (!filePath) {
        return res.status(400).json({ error: "File path is required" });
      }

      let fullPath;
      if (isOriginal === "true") {
        fullPath = path.join(DASH_DIR, `${id}_original`, filePath);
      } else {
        fullPath = path.join(DASH_DIR, id, filePath);
      }

      if (!(await fs.pathExists(fullPath))) {
        return res.status(404).json({ error: "File not found" });
      }

      const content = await fs.readFile(fullPath, "utf8");
      res.json({ content });
    } catch (error) {
      console.error("Error getting DASH manifest content:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async saveDashManifestContent(req, res) {
    try {
      const { id } = req.params;
      const { filePath, content, manifestKey } = req.body;
      const user = req.user?.fullName || "Unknown User";

      if (!filePath || content === undefined) {
        return res
          .status(400)
          .json({ error: "File path and content are required" });
      }

      const scenarioPath = path.join(DASH_DIR, id);
      const mainFilePath = path.join(scenarioPath, filePath);
      const manifestMapPath = path.join(scenarioPath, "manifestMap.json");
      const changesPath = path.join(scenarioPath, "changes.json");

      if (!(await fs.pathExists(mainFilePath))) {
        return res.status(404).json({ error: "File not found" });
      }

      // Save the manifest content
      await fs.writeFile(mainFilePath, content);

      // Update manifestMap
      let manifestMap = { profile: { 0: {} } };
      if (await fs.pathExists(manifestMapPath)) {
        manifestMap = await fs.readJson(manifestMapPath);
      }

      // Mark as edited in manifestMap - use isContentEdited for file edits
      if (
        manifestMap.profile &&
        manifestMap.profile["0"] &&
        manifestMap.profile["0"][manifestKey]
      ) {
        manifestMap.profile["0"][manifestKey].isContentEdited = true;
      }

      await fs.writeJson(manifestMapPath, manifestMap, { spaces: 2 });

      // Log change
      let changes = [];
      if (await fs.pathExists(changesPath)) {
        changes = await fs.readJson(changesPath);
      }

      const changeEntry = {
        manifestNumber:
          manifestMap.profile?.["0"]?.[manifestKey]?.manifestNumber,
        filename: path.basename(filePath),
        originalfile: manifestKey,
        timestamp: new Date().toISOString(),
        User: user,
        isEdited: true,
        type: "DASH",
      };
      changes.push(changeEntry);

      await fs.writeJson(changesPath, changes, { spaces: 2 });

      res.json({ message: "DASH manifest saved successfully", isEdited: true });
    } catch (error) {
      console.error("Error saving DASH manifest content:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async resetDashManifestContent(req, res) {
    try {
      const { id } = req.params;
      const { filePath, manifestKey } = req.body;

      if (!filePath || !manifestKey) {
        return res.status(400).json({ error: "Missing required parameters" });
      }

      const scenarioPath = path.join(DASH_DIR, id);
      const originalScenarioPath = path.join(DASH_DIR, `${id}_original`);
      const originalFilePath = path.join(originalScenarioPath, filePath);
      const mainFilePath = path.join(scenarioPath, filePath);
      const manifestMapPath = path.join(scenarioPath, "manifestMap.json");

      if (!(await fs.pathExists(originalFilePath))) {
        return res.status(404).json({ error: "Original manifest not found" });
      }

      // Copy original content back
      await fs.copy(originalFilePath, mainFilePath);

      // Update manifestMap - use isContentEdited for file edits
      if (await fs.pathExists(manifestMapPath)) {
        const manifestMap = await fs.readJson(manifestMapPath);
        if (
          manifestMap.profile &&
          manifestMap.profile["0"] &&
          manifestMap.profile["0"][manifestKey]
        ) {
          manifestMap.profile["0"][manifestKey].isContentEdited = false;
        }
        await fs.writeJson(manifestMapPath, manifestMap, { spaces: 2 });
      }

      res.json({ message: "DASH manifest reset successful" });
    } catch (error) {
      console.error("Error resetting DASH manifest content:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async startOtherUrlDownload(req, res) {
    try {
      const { id } = req.params;
      const { sourceUrls } = req.body;

      if (
        !sourceUrls ||
        !Array.isArray(sourceUrls) ||
        sourceUrls.length === 0
      ) {
        return res.status(400).json({ error: "Source URLs array is required" });
      }

      const scenario = await scenarioService.getScenarioById(id);
      if (!scenario) {
        return res.status(404).json({ error: "Scenario not found" });
      }

      if (
        scenario.type !== "VMAP" &&
        scenario.type !== "VAST" &&
        scenario.type !== "MP4" &&
        scenario.type !== "GIF"
      ) {
        return res.status(400).json({
          error: "This endpoint is only for VMAP/VAST/MP4/GIF scenarios",
        });
      }

      const otherUrlDownloadService = require("../services/otherUrlDownloadService");
      const result = await otherUrlDownloadService.downloadFromUrls(
        id,
        scenario.type,
        sourceUrls,
      );

      await scenarioService.updateScenario(id, {
        downloadStatus: "completed",
        downloadedAt: new Date().toISOString(),
      });

      res.json(result);
    } catch (error) {
      console.error("Error in startOtherUrlDownload:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async getOtherUrlMapping(req, res) {
    try {
      const { id } = req.params;

      const scenario = await scenarioService.getScenarioById(id);
      if (!scenario) {
        return res.status(404).json({ error: "Scenario not found" });
      }

      if (
        scenario.type !== "VMAP" &&
        scenario.type !== "VAST" &&
        scenario.type !== "MP4" &&
        scenario.type !== "GIF"
      ) {
        return res.status(400).json({
          error: "This endpoint is only for VMAP/VAST/MP4/GIF scenarios",
        });
      }

      const otherUrlDownloadService = require("../services/otherUrlDownloadService");
      const mapping = await otherUrlDownloadService.getUrlMapping(
        id,
        scenario.type,
      );

      // Return empty object if mapping doesn't exist yet (scenario not downloaded)
      res.json(mapping || {});
    } catch (error) {
      console.error("Error in getOtherUrlMapping:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async serveVmapVastContent(req, res) {
    try {
      // Force 200 status by removing conditional headers
      delete req.headers["if-none-match"];
      delete req.headers["if-modified-since"];

      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");

      const { id } = req.params;
      const filePath = req.params[0] || ""; // Everything after /vmap-vast/ (may be empty)
      const indexParam = req.query.index; // Get index from query string

      const scenario = await scenarioService.getScenarioById(id);
      if (!scenario) {
        return res.status(404).json({ error: "Scenario not found" });
      }

      if (scenario.type !== "VMAP" && scenario.type !== "VAST") {
        return res
          .status(400)
          .json({ error: "This endpoint is only for VMAP/VAST scenarios" });
      }

      const baseDir =
        scenario.type === "VMAP"
          ? path.join(__dirname, "../vmap")
          : path.join(__dirname, "../vast");
      const scenarioDir = path.join(baseDir, id);

      // Read URL mapping to get configurations
      const mappingPath = path.join(scenarioDir, "urlMapping.json");

      if (!(await fs.pathExists(mappingPath))) {
        return res.status(404).json({ error: "No files downloaded yet" });
      }

      const urlMapping = await fs.readJson(mappingPath);

      // Check if index parameter is provided
      if (indexParam) {
        const index = parseInt(indexParam);

        if (isNaN(index) || index < 1) {
          return res.status(400).json({
            error: "Invalid index parameter. Must be a positive integer.",
          });
        }

        // Find the specific configuration by index
        // Index refers to the configuration number (1, 2, 3, etc.)
        // We need to find url_X_copy_Y where Y matches the index
        let selectedEntry = null;
        let selectedKey = null;

        // First, collect all configurations across all files
        const allConfigs = [];
        Object.entries(urlMapping).forEach(([key, entry]) => {
          if (entry.filename && !entry.error) {
            // Check if this is the base entry (url_1, url_2, etc.)
            if (key.match(/^url_\d+$/) && !key.includes("_copy_")) {
              allConfigs.push({ key, entry, configIndex: 1 });
            }
            // Check if this is a copy entry (url_1_copy_1, url_1_copy_2, etc.)
            const copyMatch = key.match(/^url_\d+_copy_(\d+)$/);
            if (copyMatch) {
              const copyIndex = parseInt(copyMatch[1]) + 1; // +1 because copy_1 is actually config index 2
              allConfigs.push({ key, entry, configIndex: copyIndex });
            }
          }
        });

        // Find the configuration with the matching index
        const matchingConfig = allConfigs.find((c) => c.configIndex === index);

        if (!matchingConfig) {
          return res
            .status(404)
            .json({ error: `No configuration found with index ${index}` });
        }

        selectedKey = matchingConfig.key;
        selectedEntry = matchingConfig.entry;

        const fullPath = path.join(scenarioDir, selectedEntry.filename);

        // Check if file exists
        if (!(await fs.pathExists(fullPath))) {
          return res.status(404).json({ error: "Selected file not found" });
        }

        console.log(
          `[${scenario.type}] Serving file with config index ${index} (${selectedKey}): ${selectedEntry.filename}`,
        );

        // Apply configuration logic
        await this.applyVmapVastConfiguration(
          res,
          fullPath,
          selectedEntry,
          selectedEntry.filename,
        );
        return;
      }

      // Check if this is a direct file request or scenario-based request
      if (filePath && filePath.trim() !== "" && filePath.endsWith(".xml")) {
        // Direct file request - serve the specific file with configuration
        const fullPath = path.join(scenarioDir, filePath);

        // Security check - ensure the path is within the scenario directory
        if (!fullPath.startsWith(scenarioDir)) {
          return res.status(403).json({ error: "Access denied" });
        }

        // Check if file exists
        if (!(await fs.pathExists(fullPath))) {
          return res.status(404).json({ error: "File not found" });
        }

        // Find configuration for this file
        const fileEntry = Object.values(urlMapping).find(
          (entry) => entry.filename === filePath,
        );

        if (fileEntry) {
          // Apply configuration logic
          await this.applyVmapVastConfiguration(
            res,
            fullPath,
            fileEntry,
            filePath,
          );
        } else {
          // No configuration found, serve normally
          const content = await fs.readFile(fullPath, "utf-8");
          res.setHeader("Content-Type", "application/xml");
          res.send(content);
        }
      } else {
        // Scenario-based request - randomly select from all configurations
        const allConfigs = Object.entries(urlMapping).filter(
          ([key, entry]) => entry.filename && !entry.error,
        );

        if (allConfigs.length === 0) {
          return res.status(404).json({ error: "No valid files available" });
        }

        // Randomly select a configuration
        const randomIndex = Math.floor(Math.random() * allConfigs.length);
        const [selectedKey, selectedEntry] = allConfigs[randomIndex];

        console.log(
          `[${scenario.type}] Randomly selected configuration ${selectedKey}: ${selectedEntry.filename}`,
        );

        const fullPath = path.join(scenarioDir, selectedEntry.filename);

        // Check if file exists
        if (!(await fs.pathExists(fullPath))) {
          return res.status(404).json({ error: "Selected file not found" });
        }

        // Apply configuration logic
        await this.applyVmapVastConfiguration(
          res,
          fullPath,
          selectedEntry,
          selectedEntry.filename,
        );
      }
    } catch (error) {
      console.error("Error serving VMAP/VAST content:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async serveMp4Content(req, res) {
    try {
      // Force 200 status by removing conditional headers
      delete req.headers["if-none-match"];
      delete req.headers["if-modified-since"];

      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range");
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");

      const { id } = req.params;
      const filePath = req.params[0] || ""; // Everything after /mp4/ (may be empty)
      const indexParam = req.query.index; // Get index from query string

      const scenario = await scenarioService.getScenarioById(id);
      if (!scenario) {
        return res.status(404).json({ error: "Scenario not found" });
      }

      if (scenario.type !== "MP4") {
        return res
          .status(400)
          .json({ error: "This endpoint is only for MP4 scenarios" });
      }

      const baseDir = path.join(__dirname, "../mp4");
      const scenarioDir = path.join(baseDir, id);

      // Read URL mapping to get configurations
      const mappingPath = path.join(scenarioDir, "urlMapping.json");

      if (!(await fs.pathExists(mappingPath))) {
        return res.status(404).json({ error: "No files downloaded yet" });
      }

      const urlMapping = await fs.readJson(mappingPath);

      // Check if index parameter is provided
      if (indexParam) {
        const index = parseInt(indexParam);

        if (isNaN(index) || index < 1) {
          return res.status(400).json({
            error: "Invalid index parameter. Must be a positive integer.",
          });
        }

        // Find the entry with the specified index by searching through all entries
        let selectedEntry = null;
        let selectedKey = null;

        for (const [key, entry] of Object.entries(urlMapping)) {
          if (entry.index === index && entry.filename && !entry.error) {
            selectedEntry = entry;
            selectedKey = key;
            break;
          }
        }

        if (!selectedEntry) {
          return res
            .status(404)
            .json({ error: `No file found with index ${index}` });
        }

        const fullPath = path.join(scenarioDir, selectedEntry.filename);

        // Check if file exists
        if (!(await fs.pathExists(fullPath))) {
          return res.status(404).json({ error: "Selected file not found" });
        }

        console.log(
          `[MP4] Serving file by index ${index} (${selectedKey}): ${selectedEntry.filename}`,
        );

        // Apply configuration logic
        await this.applyMp4Configuration(
          res,
          fullPath,
          selectedEntry,
          selectedEntry.filename,
          req,
        );
        return;
      }

      // Check if this is a direct file request or scenario-based request
      if (filePath && filePath.trim() !== "" && filePath.endsWith(".mp4")) {
        // Direct file request - serve the specific file with configuration
        const fullPath = path.join(scenarioDir, filePath);

        // Security check - ensure the path is within the scenario directory
        if (!fullPath.startsWith(scenarioDir)) {
          return res.status(403).json({ error: "Access denied" });
        }

        // Check if file exists
        if (!(await fs.pathExists(fullPath))) {
          return res.status(404).json({ error: "File not found" });
        }

        // Find configuration for this file
        const fileEntry = Object.values(urlMapping).find(
          (entry) => entry.filename === filePath,
        );

        if (fileEntry) {
          // Apply configuration logic
          await this.applyMp4Configuration(
            res,
            fullPath,
            fileEntry,
            filePath,
            req,
          );
        } else {
          // No configuration found, serve normally
          await this.serveMp4File(res, fullPath, req);
        }
      } else {
        // Scenario-based request - serve files based on logic with configuration
        // Get all successfully downloaded files
        const downloadedEntries = Object.entries(urlMapping).filter(
          ([key, entry]) => entry.filename && !entry.error,
        );

        if (downloadedEntries.length === 0) {
          return res.status(404).json({ error: "No valid files available" });
        }

        let selectedEntry;
        let selectedKey;

        if (downloadedEntries.length === 1) {
          // Only one file - serve it directly
          [selectedKey, selectedEntry] = downloadedEntries[0];
          console.log(`[MP4] Serving single file: ${selectedEntry.filename}`);
        } else {
          // Multiple files - serve randomly
          const randomIndex = Math.floor(
            Math.random() * downloadedEntries.length,
          );
          [selectedKey, selectedEntry] = downloadedEntries[randomIndex];
          console.log(
            `[MP4] Randomly selected file ${randomIndex + 1}/${downloadedEntries.length}: ${selectedEntry.filename}`,
          );
        }

        const fullPath = path.join(scenarioDir, selectedEntry.filename);

        // Check if file exists
        if (!(await fs.pathExists(fullPath))) {
          return res.status(404).json({ error: "Selected file not found" });
        }

        // Apply configuration logic
        await this.applyMp4Configuration(
          res,
          fullPath,
          selectedEntry,
          selectedEntry.filename,
          req,
        );
      }
    } catch (error) {
      console.error("Error serving MP4 content:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async applyMp4Configuration(res, fullPath, config, filename, req) {
    // Use module-level repeat state tracking
    const stateKey = `${fullPath}`;
    let repeatState = mp4RepeatStates.get(stateKey);

    if (!repeatState) {
      repeatState = { count: 0 };
      mp4RepeatStates.set(stateKey, repeatState);
    }

    // Increment count for this delivery
    repeatState.count++;

    // Check repeat logic with percentage
    if (config.repeat > 0 && config.repeatPercentage > 0) {
      const randomValue = Math.random() * 100;
      if (randomValue < config.repeatPercentage) {
        // Repeat is triggered by percentage
        if (repeatState.count > config.repeat) {
          // Exceeded repeat limit, reset and continue
          repeatState.count = 1;
          console.log(
            `[MP4] File ${filename} repeat completed (delivered ${config.repeat} times), resetting`,
          );
        } else {
          console.log(
            `[MP4] Delivering file ${filename} (${repeatState.count}/${config.repeat})`,
          );
        }
      } else {
        // Percentage check failed, reset count
        repeatState.count = 1;
      }
    } else {
      // No repeat configured or percentage is 0, reset count
      repeatState.count = 1;
    }

    // Apply delay with percentage-based logic
    if (config.delay > 0 && config.delayPercentage > 0) {
      const randomValue = Math.random() * 100;
      if (randomValue < config.delayPercentage) {
        console.log(
          `[MP4] Applying ${config.delay}s delay to file ${filename} (${config.delayPercentage}% chance)`,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, config.delay * 1000),
        );
      }
    }

    // Determine status code with percentage-based logic
    let statusCode = 200;
    if (
      config.statusCode &&
      config.statusCode !== 200 &&
      config.statusPercentage > 0
    ) {
      const randomValue = Math.random() * 100;
      if (randomValue < config.statusPercentage) {
        statusCode = config.statusCode;
        console.log(
          `[MP4] Applying status code ${statusCode} to file ${filename} (${config.statusPercentage}% chance)`,
        );
      }
    }

    // Serve the MP4 file with the determined status code
    if (statusCode !== 200) {
      return res.status(statusCode).json({ error: `HTTP ${statusCode}` });
    }

    await this.serveMp4File(res, fullPath, req, filename);
  }

  async serveMp4File(res, fullPath, req, filename = null) {
    try {
      const stat = await fs.stat(fullPath);
      const fileSize = stat.size;
      const range = req.headers.range;

      if (range) {
        // Handle range requests for video streaming
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = end - start + 1;
        const file = fs.createReadStream(fullPath, { start, end });
        const head = {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunksize,
          "Content-Type": "video/mp4",
        };

        if (filename) {
          head["X-Served-File"] = filename;
        }

        res.writeHead(206, head);
        file.pipe(res);
      } else {
        // Serve the entire file
        const head = {
          "Content-Length": fileSize,
          "Content-Type": "video/mp4",
          "Accept-Ranges": "bytes",
        };

        if (filename) {
          head["X-Served-File"] = filename;
        }

        res.writeHead(200, head);
        fs.createReadStream(fullPath).pipe(res);
      }
    } catch (error) {
      console.error("Error serving MP4 file:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async applyVmapVastConfiguration(res, fullPath, config, filename) {
    // Use module-level repeat state tracking
    const stateKey = `${fullPath}`;
    let repeatState = vmapVastRepeatStates.get(stateKey);

    if (!repeatState) {
      repeatState = { count: 0 };
      vmapVastRepeatStates.set(stateKey, repeatState);
    }

    // Increment count for this delivery
    repeatState.count++;

    // Check repeat logic with percentage
    if (config.repeat > 0 && config.repeatPercentage > 0) {
      const randomValue = Math.random() * 100;
      if (randomValue < config.repeatPercentage) {
        // Repeat is triggered by percentage
        if (repeatState.count > config.repeat) {
          // Exceeded repeat limit, reset and continue
          repeatState.count = 1;
          console.log(
            `[VMAP/VAST] File ${filename} repeat completed (delivered ${config.repeat} times), resetting`,
          );
        } else {
          console.log(
            `[VMAP/VAST] Delivering file ${filename} (${repeatState.count}/${config.repeat})`,
          );
        }
      } else {
        // Percentage check failed, reset count
        repeatState.count = 1;
      }
    } else {
      // No repeat configured or percentage is 0, reset count
      repeatState.count = 1;
    }

    // Apply delay with percentage-based logic
    if (config.delay > 0 && config.delayPercentage > 0) {
      const randomValue = Math.random() * 100;
      if (randomValue < config.delayPercentage) {
        console.log(
          `[VMAP/VAST] Applying ${config.delay}s delay to file ${filename} (${config.delayPercentage}% chance)`,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, config.delay * 1000),
        );
      }
    }

    // Determine status code with percentage-based logic
    let statusCode = 200;
    if (
      config.statusCode &&
      config.statusCode !== 200 &&
      config.statusPercentage > 0
    ) {
      const randomValue = Math.random() * 100;
      if (randomValue < config.statusPercentage) {
        statusCode = config.statusCode;
        console.log(
          `[VMAP/VAST] Applying status code ${statusCode} to file ${filename} (${config.statusPercentage}% chance)`,
        );
      }
    }

    // Read and serve the XML file
    const content = await fs.readFile(fullPath, "utf-8");

    res.status(statusCode);
    res.setHeader("Content-Type", "application/xml");
    res.setHeader("X-Served-File", filename);
    res.send(content);
  }

  // Get VMAP/VAST file mapping for Edit tab
  async getVmapVastMapping(req, res) {
    try {
      const { id } = req.params;

      const scenario = await scenarioService.getScenarioById(id);
      if (!scenario) {
        return res.status(404).json({ error: "Scenario not found" });
      }

      if (scenario.type !== "VMAP" && scenario.type !== "VAST") {
        return res
          .status(400)
          .json({ error: "This endpoint is only for VMAP/VAST scenarios" });
      }

      const baseDir =
        scenario.type === "VMAP"
          ? path.join(__dirname, "../vmap")
          : path.join(__dirname, "../vast");
      const scenarioDir = path.join(baseDir, id);
      const mappingPath = path.join(scenarioDir, "urlMapping.json");

      if (!(await fs.pathExists(mappingPath))) {
        return res.json({});
      }

      const urlMapping = await fs.readJson(mappingPath);

      // Transform the mapping to include edit status from changes.json
      const changesPath = path.join(scenarioDir, "changes.json");
      let changes = [];
      if (await fs.pathExists(changesPath)) {
        changes = await fs.readJson(changesPath);
      }

      // Build a map of edited files
      const editedFiles = {};
      changes.forEach((change) => {
        if (change.filename) {
          editedFiles[change.filename] = {
            isContentEdited: true,
            lastEditedAt: change.timestamp,
            lastEditedBy: change.User,
          };
        }
      });

      // Enhance urlMapping with edit status
      const enhancedMapping = {};
      Object.entries(urlMapping).forEach(([key, value]) => {
        enhancedMapping[key] = {
          ...value,
          ...(editedFiles[value.filename] || {}),
        };
      });

      res.json(enhancedMapping);
    } catch (error) {
      console.error("Error getting VMAP/VAST mapping:", error);
      res.status(500).json({ error: error.message });
    }
  }
  async getMp4Mapping(req, res) {
    try {
      const { id } = req.params;

      const scenario = await scenarioService.getScenarioById(id);
      if (!scenario) {
        return res.status(404).json({ error: "Scenario not found" });
      }

      if (scenario.type !== "MP4") {
        return res
          .status(400)
          .json({ error: "This endpoint is only for MP4 scenarios" });
      }

      const urlMapping = await otherUrlDownloadService.getUrlMapping(id, "MP4");

      if (!urlMapping) {
        return res.status(404).json({ error: "No URL mapping found" });
      }

      res.json(urlMapping);
    } catch (error) {
      console.error("Error getting MP4 mapping:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async updateMp4Config(req, res) {
    try {
      const { id } = req.params;
      const { urlKey, delay, delayPercentage, statusCode, statusPercentage } =
        req.body;

      const scenario = await scenarioService.getScenarioById(id);
      if (!scenario) {
        return res.status(404).json({ error: "Scenario not found" });
      }

      if (scenario.type !== "MP4") {
        return res
          .status(400)
          .json({ error: "This endpoint is only for MP4 scenarios" });
      }

      const baseDir = path.join(__dirname, "../mp4");
      const scenarioDir = path.join(baseDir, id);
      const mappingPath = path.join(scenarioDir, "urlMapping.json");

      if (!(await fs.pathExists(mappingPath))) {
        return res.status(404).json({ error: "No URL mapping found" });
      }

      const urlMapping = await fs.readJson(mappingPath);

      if (!urlMapping[urlKey]) {
        return res.status(404).json({ error: "URL key not found" });
      }

      // Update configuration
      urlMapping[urlKey].delay = delay || 0;
      urlMapping[urlKey].delayPercentage = delayPercentage || 100;
      urlMapping[urlKey].statusCode = statusCode || 200;
      urlMapping[urlKey].statusPercentage = statusPercentage || 100;

      // Set isEdited flag based on whether values differ from defaults
      const isDefault =
        urlMapping[urlKey].delay === 0 &&
        urlMapping[urlKey].delayPercentage === 100 &&
        urlMapping[urlKey].statusCode === 200 &&
        urlMapping[urlKey].statusPercentage === 100;

      urlMapping[urlKey].isEdited = !isDefault;

      await fs.writeJson(mappingPath, urlMapping, { spaces: 2 });

      console.log(`[MP4-${id}] Updated configuration for ${urlKey}:`, {
        delay,
        delayPercentage,
        statusCode,
        statusPercentage,
      });

      res.json({ success: true, urlMapping });
    } catch (error) {
      console.error("Error updating MP4 config:", error);
      res.status(500).json({ error: error.message });
    }
  }

  // Get VMAP/VAST file content for editing
  async getVmapVastContent(req, res) {
    try {
      const { id } = req.params;
      const { filename } = req.query;

      if (!filename) {
        return res.status(400).json({ error: "Filename is required" });
      }

      const scenario = await scenarioService.getScenarioById(id);
      if (!scenario) {
        return res.status(404).json({ error: "Scenario not found" });
      }

      if (scenario.type !== "VMAP" && scenario.type !== "VAST") {
        return res
          .status(400)
          .json({ error: "This endpoint is only for VMAP/VAST scenarios" });
      }

      const baseDir =
        scenario.type === "VMAP"
          ? path.join(__dirname, "../vmap")
          : path.join(__dirname, "../vast");
      const scenarioDir = path.join(baseDir, id);
      const filePath = path.join(scenarioDir, filename);

      // Security check
      if (!filePath.startsWith(scenarioDir)) {
        return res.status(403).json({ error: "Access denied" });
      }

      if (!(await fs.pathExists(filePath))) {
        return res.status(404).json({ error: "File not found" });
      }

      const content = await fs.readFile(filePath, "utf-8");

      // Also get the original file if it exists
      const originalDir = path.join(baseDir, `${id}_original`);
      const originalFilePath = path.join(originalDir, filename);
      let originalContent = null;

      if (await fs.pathExists(originalFilePath)) {
        originalContent = await fs.readFile(originalFilePath, "utf-8");
      }

      res.json({
        content,
        originalContent,
        filename,
      });
    } catch (error) {
      console.error("Error getting VMAP/VAST content:", error);
      res.status(500).json({ error: error.message });
    }
  }

  // Save VMAP/VAST file content
  async saveVmapVastContent(req, res) {
    try {
      const { id } = req.params;
      const { filename, content } = req.body;
      const user = req.user?.fullName || "Unknown";

      if (!filename || !content) {
        return res
          .status(400)
          .json({ error: "Filename and content are required" });
      }

      const scenario = await scenarioService.getScenarioById(id);
      if (!scenario) {
        return res.status(404).json({ error: "Scenario not found" });
      }

      if (scenario.type !== "VMAP" && scenario.type !== "VAST") {
        return res
          .status(400)
          .json({ error: "This endpoint is only for VMAP/VAST scenarios" });
      }

      const baseDir =
        scenario.type === "VMAP"
          ? path.join(__dirname, "../vmap")
          : path.join(__dirname, "../vast");
      const scenarioDir = path.join(baseDir, id);
      const filePath = path.join(scenarioDir, filename);
      const changesPath = path.join(scenarioDir, "changes.json");

      // Security check
      if (!filePath.startsWith(scenarioDir)) {
        return res.status(403).json({ error: "Access denied" });
      }

      if (!(await fs.pathExists(filePath))) {
        return res.status(404).json({ error: "File not found" });
      }

      // Save the file
      await fs.writeFile(filePath, content, "utf-8");

      // Update changes.json
      let changes = [];
      if (await fs.pathExists(changesPath)) {
        changes = await fs.readJson(changesPath);
      }

      const changeEntry = {
        filename,
        timestamp: new Date().toISOString(),
        User: user,
        isEdited: true,
        type: scenario.type,
      };

      changes.push(changeEntry);
      await fs.writeJson(changesPath, changes, { spaces: 2 });

      res.json({
        message: "File saved successfully",
        isEdited: true,
      });
    } catch (error) {
      console.error("Error saving VMAP/VAST content:", error);
      res.status(500).json({ error: error.message });
    }
  }

  // Reset VMAP/VAST file content to original
  async resetVmapVastContent(req, res) {
    try {
      const { id } = req.params;
      const { filename } = req.body;
      const user = req.user?.fullName || "Unknown";

      if (!filename) {
        return res.status(400).json({ error: "Filename is required" });
      }

      const scenario = await scenarioService.getScenarioById(id);
      if (!scenario) {
        return res.status(404).json({ error: "Scenario not found" });
      }

      if (scenario.type !== "VMAP" && scenario.type !== "VAST") {
        return res
          .status(400)
          .json({ error: "This endpoint is only for VMAP/VAST scenarios" });
      }

      const baseDir =
        scenario.type === "VMAP"
          ? path.join(__dirname, "../vmap")
          : path.join(__dirname, "../vast");
      const scenarioDir = path.join(baseDir, id);
      const filePath = path.join(scenarioDir, filename);
      const changesPath = path.join(scenarioDir, "changes.json");
      const mappingPath = path.join(scenarioDir, "urlMapping.json");

      // Security check
      if (!filePath.startsWith(scenarioDir)) {
        return res.status(403).json({ error: "Access denied" });
      }

      if (!(await fs.pathExists(filePath))) {
        return res.status(404).json({ error: "File not found" });
      }

      // Get original content from urlMapping.json
      if (!(await fs.pathExists(mappingPath))) {
        return res.status(404).json({ error: "URL mapping not found" });
      }

      const urlMapping = await fs.readJson(mappingPath);

      // Find the mapping entry for this filename
      let originalContent = null;
      for (const key in urlMapping) {
        if (urlMapping[key].filename === filename) {
          originalContent = urlMapping[key].originalContent;
          break;
        }
      }

      if (!originalContent) {
        return res
          .status(404)
          .json({ error: "Original content not found in mapping" });
      }

      // Write original content back to file
      await fs.writeFile(filePath, originalContent, "utf-8");

      // Update changes.json
      let changes = [];
      if (await fs.pathExists(changesPath)) {
        changes = await fs.readJson(changesPath);
      }

      const changeEntry = {
        filename,
        timestamp: new Date().toISOString(),
        User: user,
        isEdited: false,
        isReset: true,
        type: scenario.type,
      };

      changes.push(changeEntry);
      await fs.writeJson(changesPath, changes, { spaces: 2 });

      res.json({
        message: "File reset successfully",
        isEdited: false,
      });
    } catch (error) {
      console.error("Error resetting VMAP/VAST content:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async getMp4Mapping(req, res) {
    try {
      const { id } = req.params;

      const scenario = await scenarioService.getScenarioById(id);
      if (!scenario) {
        return res.status(404).json({ error: "Scenario not found" });
      }

      if (scenario.type !== "MP4") {
        return res
          .status(400)
          .json({ error: "This endpoint is only for MP4 scenarios" });
      }

      const urlMapping = await otherUrlDownloadService.getUrlMapping(id, "MP4");

      if (!urlMapping) {
        return res.status(404).json({ error: "No URL mapping found" });
      }

      res.json(urlMapping);
    } catch (error) {
      console.error("Error getting MP4 mapping:", error);
      res.status(500).json({ error: error.message });
    }
  }

  // GIF Methods
  async serveGifContent(req, res) {
    try {
      delete req.headers["if-none-match"];
      delete req.headers["if-modified-since"];

      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range");
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");

      const { id } = req.params;
      const filePath = req.params[0] || "";
      const indexParam = req.query.index; // Get index from query string

      const scenario = await scenarioService.getScenarioById(id);
      if (!scenario) {
        return res.status(404).json({ error: "Scenario not found" });
      }

      if (scenario.type !== "GIF") {
        return res
          .status(400)
          .json({ error: "This endpoint is only for GIF scenarios" });
      }

      const baseDir = path.join(__dirname, "../gif");
      const scenarioDir = path.join(baseDir, id);
      const mappingPath = path.join(scenarioDir, "urlMapping.json");

      if (!(await fs.pathExists(mappingPath))) {
        return res.status(404).json({ error: "No files downloaded yet" });
      }

      const urlMapping = await fs.readJson(mappingPath);

      // Check if index parameter is provided
      if (indexParam) {
        const index = parseInt(indexParam);

        if (isNaN(index) || index < 1) {
          return res.status(400).json({
            error: "Invalid index parameter. Must be a positive integer.",
          });
        }

        // Find the entry with the specified index
        const entryKey = `url_${index}`;
        const selectedEntry = urlMapping[entryKey];

        if (!selectedEntry) {
          return res
            .status(404)
            .json({ error: `No file found with index ${index}` });
        }

        if (!selectedEntry.filename || selectedEntry.error) {
          return res.status(404).json({
            error: `File with index ${index} failed to download: ${selectedEntry.error || "Unknown error"}`,
          });
        }

        const fullPath = path.join(scenarioDir, selectedEntry.filename);

        // Check if file exists
        if (!(await fs.pathExists(fullPath))) {
          return res.status(404).json({ error: "Selected file not found" });
        }

        console.log(
          `[GIF] Serving file by index ${index}: ${selectedEntry.filename}`,
        );

        // Apply configuration logic
        await this.applyGifConfiguration(
          res,
          fullPath,
          selectedEntry,
          selectedEntry.filename,
        );
        return;
      }

      if (filePath && filePath.trim() !== "" && filePath.endsWith(".gif")) {
        const fullPath = path.join(scenarioDir, filePath);

        if (!fullPath.startsWith(scenarioDir)) {
          return res.status(403).json({ error: "Access denied" });
        }

        if (!(await fs.pathExists(fullPath))) {
          return res.status(404).json({ error: "File not found" });
        }

        const fileEntry = Object.values(urlMapping).find(
          (entry) => entry.filename === filePath,
        );

        if (fileEntry) {
          await this.applyGifConfiguration(res, fullPath, fileEntry, filePath);
        } else {
          await this.serveGifFile(res, fullPath);
        }
      } else {
        const downloadedEntries = Object.entries(urlMapping).filter(
          ([key, entry]) => entry.filename && !entry.error,
        );

        if (downloadedEntries.length === 0) {
          return res.status(404).json({ error: "No valid files available" });
        }

        let selectedEntry;
        if (downloadedEntries.length === 1) {
          [, selectedEntry] = downloadedEntries[0];
          console.log(`[GIF] Serving single file: ${selectedEntry.filename}`);
        } else {
          const randomIndex = Math.floor(
            Math.random() * downloadedEntries.length,
          );
          [, selectedEntry] = downloadedEntries[randomIndex];
          console.log(
            `[GIF] Randomly selected file ${randomIndex + 1}/${downloadedEntries.length}: ${selectedEntry.filename}`,
          );
        }

        const fullPath = path.join(scenarioDir, selectedEntry.filename);

        if (!(await fs.pathExists(fullPath))) {
          return res.status(404).json({ error: "Selected file not found" });
        }

        await this.applyGifConfiguration(
          res,
          fullPath,
          selectedEntry,
          selectedEntry.filename,
        );
      }
    } catch (error) {
      console.error("Error serving GIF content:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async applyGifConfiguration(res, fullPath, config, filename) {
    if (config.delay > 0 && config.delayPercentage > 0) {
      const randomValue = Math.random() * 100;
      if (randomValue < config.delayPercentage) {
        console.log(
          `[GIF] Applying ${config.delay}s delay to file ${filename} (${config.delayPercentage}% chance)`,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, config.delay * 1000),
        );
      }
    }

    let statusCode = 200;
    if (
      config.statusCode &&
      config.statusCode !== 200 &&
      config.statusPercentage > 0
    ) {
      const randomValue = Math.random() * 100;
      if (randomValue < config.statusPercentage) {
        statusCode = config.statusCode;
        console.log(
          `[GIF] Applying status code ${statusCode} to file ${filename} (${config.statusPercentage}% chance)`,
        );
      }
    }

    if (statusCode !== 200) {
      return res.status(statusCode).json({ error: `HTTP ${statusCode}` });
    }

    await this.serveGifFile(res, fullPath, filename);
  }

  async serveGifFile(res, fullPath, filename = null) {
    try {
      const stat = await fs.stat(fullPath);
      const fileSize = stat.size;

      const head = {
        "Content-Length": fileSize,
        "Content-Type": "image/gif",
      };

      if (filename) {
        head["X-Served-File"] = filename;
      }

      res.writeHead(200, head);
      fs.createReadStream(fullPath).pipe(res);
    } catch (error) {
      console.error("Error serving GIF file:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async getGifMapping(req, res) {
    try {
      const { id } = req.params;

      const scenario = await scenarioService.getScenarioById(id);
      if (!scenario) {
        return res.status(404).json({ error: "Scenario not found" });
      }

      if (scenario.type !== "GIF") {
        return res
          .status(400)
          .json({ error: "This endpoint is only for GIF scenarios" });
      }

      const urlMapping = await otherUrlDownloadService.getUrlMapping(id, "GIF");

      if (!urlMapping) {
        return res.status(404).json({ error: "No URL mapping found" });
      }

      res.json(urlMapping);
    } catch (error) {
      console.error("Error getting GIF mapping:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async updateGifConfig(req, res) {
    try {
      const { id } = req.params;
      const { urlKey, delay, delayPercentage, statusCode, statusPercentage } =
        req.body;

      const scenario = await scenarioService.getScenarioById(id);
      if (!scenario) {
        return res.status(404).json({ error: "Scenario not found" });
      }

      if (scenario.type !== "GIF") {
        return res
          .status(400)
          .json({ error: "This endpoint is only for GIF scenarios" });
      }

      const baseDir = path.join(__dirname, "../gif");
      const scenarioDir = path.join(baseDir, id);
      const mappingPath = path.join(scenarioDir, "urlMapping.json");

      if (!(await fs.pathExists(mappingPath))) {
        return res.status(404).json({ error: "No URL mapping found" });
      }

      const urlMapping = await fs.readJson(mappingPath);

      if (!urlMapping[urlKey]) {
        return res.status(404).json({ error: "URL key not found" });
      }

      urlMapping[urlKey].delay = delay || 0;
      urlMapping[urlKey].delayPercentage = delayPercentage || 100;
      urlMapping[urlKey].statusCode = statusCode || 200;
      urlMapping[urlKey].statusPercentage = statusPercentage || 100;

      // Set isEdited flag based on whether values differ from defaults
      const isDefault =
        urlMapping[urlKey].delay === 0 &&
        urlMapping[urlKey].delayPercentage === 100 &&
        urlMapping[urlKey].statusCode === 200 &&
        urlMapping[urlKey].statusPercentage === 100;

      urlMapping[urlKey].isEdited = !isDefault;

      await fs.writeJson(mappingPath, urlMapping, { spaces: 2 });

      console.log(`[GIF-${id}] Updated configuration for ${urlKey}:`, {
        delay,
        delayPercentage,
        statusCode,
        statusPercentage,
      });

      res.json({ success: true, urlMapping });
    } catch (error) {
      console.error("Error updating GIF config:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async copyConfigEntry(req, res) {
    try {
      const { id } = req.params;
      const { configKey } = req.body;

      if (!configKey) {
        return res.status(400).json({ error: "configKey is required" });
      }

      const scenario = await scenarioService.getScenarioById(id);
      if (!scenario) {
        return res.status(404).json({ error: "Scenario not found" });
      }

      if (!["VMAP", "VAST", "MP4", "GIF"].includes(scenario.type)) {
        return res.status(400).json({
          error: "This endpoint is only for VMAP/VAST/MP4/GIF scenarios",
        });
      }

      let baseDir;
      if (scenario.type === "VMAP") {
        baseDir = path.join(__dirname, "../vmap");
      } else if (scenario.type === "VAST") {
        baseDir = path.join(__dirname, "../vast");
      } else if (scenario.type === "MP4") {
        baseDir = path.join(__dirname, "../mp4");
      } else if (scenario.type === "GIF") {
        baseDir = path.join(__dirname, "../gif");
      }

      const mappingPath = path.join(baseDir, id, "urlMapping.json");

      if (!(await fs.pathExists(mappingPath))) {
        return res.status(404).json({ error: "URL mapping not found" });
      }

      const urlMapping = await fs.readJson(mappingPath);

      if (!urlMapping[configKey]) {
        return res.status(404).json({ error: "Configuration not found" });
      }

      const sourceConfig = urlMapping[configKey];

      // Calculate the maximum copy number for this base key
      const allKeys = Object.keys(urlMapping);
      const baseKey = configKey.split("_copy_")[0];

      const maxCopyIndex = Math.max(
        ...allKeys.map((key) => {
          if (key === baseKey) return 0; // Base entry has no copy number
          const match = key.match(/^url_(\d+)_copy_(\d+)$/);
          if (match && key.startsWith(baseKey + "_copy_")) {
            return parseInt(match[2]);
          }
          return 0;
        }),
        0,
      );

      const newCopyIndex = maxCopyIndex + 1;
      const newKey = `${baseKey}_copy_${newCopyIndex}`;

      // Calculate the configuration index (sequential: 1, 2, 3, etc.)
      // Count all configurations (base + copies) to determine the next index
      const allConfigIndices = [];
      Object.entries(urlMapping).forEach(([key, entry]) => {
        if (key.match(/^url_\d+$/) && !key.includes("_copy_")) {
          allConfigIndices.push(1); // Base entry is always index 1
        }
        const copyMatch = key.match(/^url_\d+_copy_(\d+)$/);
        if (copyMatch) {
          allConfigIndices.push(parseInt(copyMatch[1]) + 1); // copy_1 = index 2, copy_2 = index 3, etc.
        }
      });

      const maxConfigIndex =
        allConfigIndices.length > 0 ? Math.max(...allConfigIndices) : 0;
      const newConfigIndex = maxConfigIndex + 1;

      urlMapping[newKey] = {
        ...sourceConfig,
        index: newConfigIndex,
        delay: 0,
        delayPercentage: 100,
        statusCode: 200,
        statusPercentage: 100,
        isCopy: true,
        originalKey: baseKey,
      };

      await fs.writeJson(mappingPath, urlMapping, { spaces: 2 });

      console.log(
        `[${scenario.type}-${id}] Created copy configuration: ${newKey}`,
      );

      res.json({
        success: true,
        newKey,
        config: urlMapping[newKey],
        urlMapping,
      });
    } catch (error) {
      console.error("Error copying config entry:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async removeConfigEntry(req, res) {
    try {
      const { id } = req.params;
      const { configKey } = req.body;

      if (!configKey) {
        return res.status(400).json({ error: "configKey is required" });
      }

      const scenario = await scenarioService.getScenarioById(id);
      if (!scenario) {
        return res.status(404).json({ error: "Scenario not found" });
      }

      if (!["VMAP", "VAST", "MP4", "GIF"].includes(scenario.type)) {
        return res.status(400).json({
          error: "This endpoint is only for VMAP/VAST/MP4/GIF scenarios",
        });
      }

      if (!configKey.includes("_copy_")) {
        return res.status(400).json({
          error:
            "Cannot remove original configuration. Only copies can be removed.",
        });
      }

      let baseDir;
      if (scenario.type === "VMAP") {
        baseDir = path.join(__dirname, "../vmap");
      } else if (scenario.type === "VAST") {
        baseDir = path.join(__dirname, "../vast");
      } else if (scenario.type === "MP4") {
        baseDir = path.join(__dirname, "../mp4");
      } else if (scenario.type === "GIF") {
        baseDir = path.join(__dirname, "../gif");
      }

      const mappingPath = path.join(baseDir, id, "urlMapping.json");

      if (!(await fs.pathExists(mappingPath))) {
        return res.status(404).json({ error: "URL mapping not found" });
      }

      const urlMapping = await fs.readJson(mappingPath);

      if (!urlMapping[configKey]) {
        return res.status(404).json({ error: "Configuration not found" });
      }

      delete urlMapping[configKey];

      await fs.writeJson(mappingPath, urlMapping, { spaces: 2 });

      console.log(
        `[${scenario.type}-${id}] Removed configuration: ${configKey}`,
      );

      res.json({
        success: true,
        removedKey: configKey,
        urlMapping,
      });
    } catch (error) {
      console.error("Error removing config entry:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async toggleCookieValidation(req, res) {
    try {
      const { id } = req.params;
      const { enabled } = req.body;

      console.log(
        `[Cookie-${id}] Toggle cookie validation called with enabled: ${enabled}`,
      );

      if (typeof enabled !== "boolean") {
        return res
          .status(400)
          .json({ error: "enabled must be a boolean value" });
      }

      const scenario = await scenarioService.getScenarioById(id);
      if (!scenario) {
        return res.status(404).json({ error: "Scenario not found" });
      }

      console.log(
        `[Cookie-${id}] Current scenario cookieValidationEnabled: ${scenario.cookieValidationEnabled}`,
      );

      // Only allow toggling for HLS Live scenarios with cookies enabled
      if (
        scenario.type !== "HLS" ||
        scenario.playbackType !== "Live" ||
        scenario.addCookie !== "YES"
      ) {
        return res.status(400).json({
          error:
            "Cookie validation can only be toggled for HLS Live scenarios with cookies enabled",
        });
      }

      await scenarioService.updateScenario(id, {
        cookieValidationEnabled: enabled,
      });

      console.log(
        `[Cookie-${id}] Cookie validation ${enabled ? "enabled" : "disabled"} - updated in database`,
      );

      // Verify the update
      const updatedScenario = await scenarioService.getScenarioById(id);
      console.log(
        `[Cookie-${id}] Verified cookieValidationEnabled after update: ${updatedScenario.cookieValidationEnabled}`,
      );

      res.json({
        message: `Cookie validation ${enabled ? "enabled" : "disabled"} successfully`,
        cookieValidationEnabled: enabled,
      });
    } catch (error) {
      console.error("Error toggling cookie validation:", error);
      res.status(500).json({ error: error.message });
    }
  }
}

module.exports = new ScenarioController();
