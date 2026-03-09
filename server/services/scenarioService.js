const fs = require("fs-extra");
const path = require("path");
const Scenario = require("../models/Scenario");

const HLS_DIR = path.join(__dirname, "../hls");
const DASH_DIR = path.join(__dirname, "../dash");
const VMAP_DIR = path.join(__dirname, "../vmap");
const VAST_DIR = path.join(__dirname, "../vast");
const MP4_DIR = path.join(__dirname, "../mp4");
const GIF_DIR = path.join(__dirname, "../gif");
const VOD_HLS_DIR = path.join(__dirname, "../vod/hls");

class ScenarioService {
  constructor() {
    this.useDatabase = true;
  }

  // Check if MongoDB is available
  async checkDatabaseConnection() {
    try {
      if (!this.useDatabase) return false;

      const mongoose = require("mongoose");
      return mongoose.connection.readyState === 1;
    } catch (error) {
      console.warn("Database not available, falling back to file system");
      this.useDatabase = false;
      return false;
    }
  }

  // Get all scenarios
  async getAllScenarios() {
    console.log("ScenarioService.getAllScenarios called");
    const isDbConnected = await this.checkDatabaseConnection();
    console.log("Database connected:", isDbConnected);

    if (isDbConnected) {
      try {
        console.log("Fetching scenarios from database...");
        const scenarios = await Scenario.find().sort({ createdAt: -1 });
        console.log("Database scenarios found:", scenarios.length);

        const result = scenarios.map((scenario) => ({
          id: scenario.scenarioId,
          ...scenario.toJSON(),
          createdAt: scenario.createdAt,
        }));
        console.log("Returning from database:", result);
        return result;
      } catch (error) {
        console.error("Error fetching scenarios from database:", error);
        // Fall back to file system
      }
    }

    // File system fallback
    console.log("Falling back to file system...");
    return this.getAllScenariosFromFS();
  }

  // Get all scenarios from file system (fallback)
  async getAllScenariosFromFS() {
    const scenarios = [];

    try {
      // Check HLS directory
      if (await fs.pathExists(HLS_DIR)) {
        const hlsDirs = await fs.readdir(HLS_DIR);

        for (const dir of hlsDirs) {
          const scenarioPath = path.join(HLS_DIR, dir);
          const detailsPath = path.join(scenarioPath, "details.json");

          if (await fs.pathExists(detailsPath)) {
            const details = await fs.readJson(detailsPath);
            scenarios.push({
              id: dir,
              ...details,
              createdAt: (await fs.stat(scenarioPath)).birthtime,
            });
          }
        }
      }

      // Check VOD HLS directory
      if (await fs.pathExists(VOD_HLS_DIR)) {
        const vodHlsDirs = await fs.readdir(VOD_HLS_DIR);

        for (const dir of vodHlsDirs) {
          const scenarioPath = path.join(VOD_HLS_DIR, dir);
          const detailsPath = path.join(scenarioPath, "details.json");

          if (await fs.pathExists(detailsPath)) {
            const details = await fs.readJson(detailsPath);
            scenarios.push({
              id: dir,
              ...details,
              createdAt: (await fs.stat(scenarioPath)).birthtime,
            });
          }
        }
      }

      // Check DASH directory
      if (await fs.pathExists(DASH_DIR)) {
        const dashDirs = await fs.readdir(DASH_DIR);

        for (const dir of dashDirs) {
          const scenarioPath = path.join(DASH_DIR, dir);
          const detailsPath = path.join(scenarioPath, "details.json");

          if (await fs.pathExists(detailsPath)) {
            const details = await fs.readJson(detailsPath);
            scenarios.push({
              id: dir,
              ...details,
              createdAt: (await fs.stat(scenarioPath)).birthtime,
            });
          }
        }
      }

      // Check VMAP directory
      if (await fs.pathExists(VMAP_DIR)) {
        const vmapDirs = await fs.readdir(VMAP_DIR);

        for (const dir of vmapDirs) {
          const scenarioPath = path.join(VMAP_DIR, dir);
          const detailsPath = path.join(scenarioPath, "details.json");

          if (await fs.pathExists(detailsPath)) {
            const details = await fs.readJson(detailsPath);
            scenarios.push({
              id: dir,
              ...details,
              createdAt: (await fs.stat(scenarioPath)).birthtime,
            });
          }
        }
      }

      // Check VAST directory
      if (await fs.pathExists(VAST_DIR)) {
        const vastDirs = await fs.readdir(VAST_DIR);

        for (const dir of vastDirs) {
          const scenarioPath = path.join(VAST_DIR, dir);
          const detailsPath = path.join(scenarioPath, "details.json");

          if (await fs.pathExists(detailsPath)) {
            const details = await fs.readJson(detailsPath);
            scenarios.push({
              id: dir,
              ...details,
              createdAt: (await fs.stat(scenarioPath)).birthtime,
            });
          }
        }
      }

      // Check MP4 directory
      if (await fs.pathExists(MP4_DIR)) {
        const mp4Dirs = await fs.readdir(MP4_DIR);

        for (const dir of mp4Dirs) {
          const scenarioPath = path.join(MP4_DIR, dir);
          const detailsPath = path.join(scenarioPath, "details.json");

          if (await fs.pathExists(detailsPath)) {
            const details = await fs.readJson(detailsPath);
            scenarios.push({
              id: dir,
              ...details,
              createdAt: (await fs.stat(scenarioPath)).birthtime,
            });
          }
        }
      }

      // Check GIF directory
      if (await fs.pathExists(GIF_DIR)) {
        const gifDirs = await fs.readdir(GIF_DIR);

        for (const dir of gifDirs) {
          const scenarioPath = path.join(GIF_DIR, dir);
          const detailsPath = path.join(scenarioPath, "details.json");

          if (await fs.pathExists(detailsPath)) {
            const details = await fs.readJson(detailsPath);
            scenarios.push({
              id: dir,
              ...details,
              createdAt: (await fs.stat(scenarioPath)).birthtime,
            });
          }
        }
      }
    } catch (error) {
      console.error("Error reading scenarios from file system:", error);
    }

    return scenarios;
  }

  // Get scenario by ID
  async getScenarioById(scenarioId) {
    console.log("ScenarioService.getScenarioById called with:", scenarioId);
    const isDbConnected = await this.checkDatabaseConnection();
    console.log("Database connected:", isDbConnected);

    if (isDbConnected) {
      try {
        console.log("Trying to fetch from database...");
        const scenario = await Scenario.findOne({ scenarioId });
        console.log("Database result:", scenario);

        if (scenario) {
          // Determine base directory based on type
          const baseDir = scenario.type === "DASH" ? DASH_DIR : HLS_DIR;

          // Also get segment count from file system
          const segmentMapPath = path.join(
            baseDir,
            scenarioId,
            "segmentMap.json",
          );
          let segmentCount = 0;

          if (await fs.pathExists(segmentMapPath)) {
            const segmentMap = await fs.readJson(segmentMapPath);
            segmentCount = Object.keys(segmentMap).length;
          }

          const result = {
            id: scenario.scenarioId,
            ...scenario.toJSON(),
            segmentCount,
          };
          console.log("Returning from database:", result);
          return result;
        }
      } catch (error) {
        console.error("Error fetching scenario from database:", error);
        // Fall back to file system
      }
    }

    // File system fallback
    console.log("Falling back to file system...");
    return this.getScenarioByIdFromFS(scenarioId);
  }

  // Get scenario from file system (fallback)
  async getScenarioByIdFromFS(scenarioId) {
    console.log("getScenarioByIdFromFS called with:", scenarioId);

    // Try HLS directory first
    try {
      let scenarioPath = path.join(HLS_DIR, scenarioId);
      let detailsPath = path.join(scenarioPath, "details.json");

      console.log("Checking HLS path:", detailsPath);

      // If not found in HLS, try VOD HLS
      if (!(await fs.pathExists(detailsPath))) {
        console.log("Not found in HLS, checking VOD HLS...");
        scenarioPath = path.join(VOD_HLS_DIR, scenarioId);
        detailsPath = path.join(scenarioPath, "details.json");
        console.log("Checking VOD HLS path:", detailsPath);
      }

      // If not found in VOD HLS, try DASH
      if (!(await fs.pathExists(detailsPath))) {
        console.log("Not found in VOD HLS, checking DASH...");
        scenarioPath = path.join(DASH_DIR, scenarioId);
        detailsPath = path.join(scenarioPath, "details.json");
        console.log("Checking DASH path:", detailsPath);
      }

      // If not found in DASH, try VMAP
      if (!(await fs.pathExists(detailsPath))) {
        console.log("Not found in DASH, checking VMAP...");
        scenarioPath = path.join(VMAP_DIR, scenarioId);
        detailsPath = path.join(scenarioPath, "details.json");
        console.log("Checking VMAP path:", detailsPath);
      }

      // If not found in VMAP, try VAST
      if (!(await fs.pathExists(detailsPath))) {
        console.log("Not found in VMAP, checking VAST...");
        scenarioPath = path.join(VAST_DIR, scenarioId);
        detailsPath = path.join(scenarioPath, "details.json");
        console.log("Checking VAST path:", detailsPath);
      }

      // If not found in VAST, try MP4
      if (!(await fs.pathExists(detailsPath))) {
        console.log("Not found in VAST, checking MP4...");
        scenarioPath = path.join(MP4_DIR, scenarioId);
        detailsPath = path.join(scenarioPath, "details.json");
        console.log("Checking MP4 path:", detailsPath);
      }

      // If not found in MP4, try GIF
      if (!(await fs.pathExists(detailsPath))) {
        console.log("Not found in MP4, checking GIF...");
        scenarioPath = path.join(GIF_DIR, scenarioId);
        detailsPath = path.join(scenarioPath, "details.json");
        console.log("Checking GIF path:", detailsPath);
      }

      console.log("Path exists:", await fs.pathExists(detailsPath));

      if (!(await fs.pathExists(detailsPath))) {
        console.log("Details file not found");
        return null;
      }

      const details = await fs.readJson(detailsPath);
      console.log("Details loaded:", details);

      const segmentMapPath = path.join(scenarioPath, "segmentMap.json");
      const segmentMap = (await fs.pathExists(segmentMapPath))
        ? await fs.readJson(segmentMapPath)
        : {};

      const result = {
        id: scenarioId,
        ...details,
        segmentCount: Object.keys(segmentMap).length,
      };

      console.log("Returning from file system:", result);
      return result;
    } catch (error) {
      console.error("Error reading scenario from file system:", error);
      return null;
    }
  }

  // Create new scenario
  async createScenario(scenarioData) {
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
    } = scenarioData;
    const scenarioId = name.replace(/[^a-zA-Z0-9-_]/g, "_");

    // Generate cookie value if addCookie is YES and type is HLS Live
    // let cookieValue = null;
    // if (addCookie === "YES" && type === "HLS" && playbackType === "Live") {
    //   const crypto = require("crypto");
    //   cookieValue = crypto.randomBytes(16).toString("hex");
    //   console.log(`Generated cookie value for scenario ${scenarioId}: ${cookieValue}`);
    // }

    // Determine base directory based on type and playbackType
    let baseDir;
    if (type === "HLS" && playbackType === "VOD") {
      baseDir = VOD_HLS_DIR;
    } else if (type === "DASH") {
      baseDir = DASH_DIR;
    } else if (type === "VMAP") {
      baseDir = VMAP_DIR;
    } else if (type === "VAST") {
      baseDir = VAST_DIR;
    } else if (type === "MP4") {
      baseDir = MP4_DIR;
    } else if (type === "GIF") {
      baseDir = GIF_DIR;
    } else {
      baseDir = HLS_DIR;
    }
    const scenarioPath = path.join(baseDir, scenarioId);

    // Check if scenario already exists
    if (await fs.pathExists(scenarioPath)) {
      throw new Error("Scenario already exists");
    }

    // Convert request headers array to object for storage
    const headersObject = {};
    if (requestHeaders && Array.isArray(requestHeaders)) {
      requestHeaders.forEach((header) => {
        if (header.name && header.value) {
          headersObject[header.name] = header.value;
        }
      });
    }

    const details = {
      name,
      description: description || "",
      sourceManifestUrl: sourceManifestUrl || "",
      type: type || "HLS",
      playbackType: playbackType || "Live",
      belongsToCustomer: belongsToCustomer || "",
      specialNotes: specialNotes || "",
      category: category || "",
      approveVersion: approveVersion || "",
      debug: debug || "",
      selectedAudioVariant: selectedAudioVariant || null,
      requestHeaders: headersObject,
      addCookie: addCookie || "NO",
      cookieValue: null,
      createdAt: new Date().toISOString(),
      profiles: [],
      downloadStatus: "idle",
    };

    // Create file system structure based on type
    if (type === "DASH") {
      // DASH folder structure
      await fs.ensureDir(path.join(scenarioPath, "manifests"));
      await fs.ensureDir(path.join(scenarioPath, "media/video"));
      await fs.ensureDir(path.join(scenarioPath, "media/audio"));
    } else if (
      type === "VMAP" ||
      type === "VAST" ||
      type === "MP4" ||
      type === "GIF"
    ) {
      // VMAP/VAST/MP4/GIF folder structure - just the main folder
      await fs.ensureDir(scenarioPath);
    } else if (type === "HLS" && playbackType === "VOD") {
      // VOD HLS folder structure
      await fs.ensureDir(path.join(scenarioPath, "master"));
      await fs.ensureDir(path.join(scenarioPath, "media/video"));
      await fs.ensureDir(path.join(scenarioPath, "media/audio"));
      await fs.ensureDir(path.join(scenarioPath, "profiles"));
    } else {
      // HLS Live folder structure
      await fs.ensureDir(path.join(scenarioPath, "master"));
      await fs.ensureDir(path.join(scenarioPath, "media/video"));
      await fs.ensureDir(path.join(scenarioPath, "media/audio"));
      await fs.ensureDir(path.join(scenarioPath, "profiles"));
    }

    await fs.writeJson(path.join(scenarioPath, "details.json"), details, {
      spaces: 2,
    });

    // Only create these files for HLS/DASH
    if (
      type !== "VMAP" &&
      type !== "VAST" &&
      type !== "MP4" &&
      type !== "GIF"
    ) {
      await fs.writeJson(
        path.join(scenarioPath, "segmentMap.json"),
        {},
        { spaces: 2 },
      );
      await fs.writeJson(
        path.join(scenarioPath, "manifestMap.json"),
        {},
        { spaces: 2 },
      );
    }

    // Save to database if available
    const isDbConnected = await this.checkDatabaseConnection();

    if (isDbConnected) {
      try {
        const scenario = new Scenario({
          scenarioId,
          ...details,
          requestHeaders: new Map(Object.entries(headersObject)),
          scenarioPath,
        });

        await scenario.save();
        console.log("Scenario saved to database:", scenarioId);
      } catch (error) {
        console.error("Error saving scenario to database:", error);
        // Continue with file system only
      }
    }

    return { id: scenarioId, ...details };
  }

  // Update scenario
  async updateScenario(scenarioId, updateData) {
    const isDbConnected = await this.checkDatabaseConnection();

    if (isDbConnected) {
      try {
        const scenario = await Scenario.findOneAndUpdate(
          { scenarioId },
          { ...updateData, updatedAt: new Date() },
          { new: true },
        );

        if (scenario) {
          console.log("Scenario updated in database:", scenarioId);
        }
      } catch (error) {
        console.error("Error updating scenario in database:", error);
      }
    }

    // Also update file system - check all directories
    try {
      let scenarioPath = path.join(HLS_DIR, scenarioId);
      let detailsPath = path.join(scenarioPath, "details.json");

      // Check VOD HLS directory if not found in HLS
      if (!(await fs.pathExists(detailsPath))) {
        scenarioPath = path.join(VOD_HLS_DIR, scenarioId);
        detailsPath = path.join(scenarioPath, "details.json");
      }

      // Check DASH directory if not found in VOD HLS
      if (!(await fs.pathExists(detailsPath))) {
        scenarioPath = path.join(DASH_DIR, scenarioId);
        detailsPath = path.join(scenarioPath, "details.json");
      }

      // Check VMAP directory if not found in DASH
      if (!(await fs.pathExists(detailsPath))) {
        scenarioPath = path.join(VMAP_DIR, scenarioId);
        detailsPath = path.join(scenarioPath, "details.json");
      }

      // Check VAST directory if not found in VMAP
      if (!(await fs.pathExists(detailsPath))) {
        scenarioPath = path.join(VAST_DIR, scenarioId);
        detailsPath = path.join(scenarioPath, "details.json");
      }

      // Check MP4 directory if not found in VAST
      if (!(await fs.pathExists(detailsPath))) {
        scenarioPath = path.join(MP4_DIR, scenarioId);
        detailsPath = path.join(scenarioPath, "details.json");
      }

      // Check GIF directory if not found in MP4
      if (!(await fs.pathExists(detailsPath))) {
        scenarioPath = path.join(GIF_DIR, scenarioId);
        detailsPath = path.join(scenarioPath, "details.json");
      }

      if (await fs.pathExists(detailsPath)) {
        const details = await fs.readJson(detailsPath);
        const updatedDetails = { ...details, ...updateData };
        await fs.writeJson(detailsPath, updatedDetails, { spaces: 2 });
      }
    } catch (error) {
      console.error("Error updating scenario in file system:", error);
    }
  }

  // Delete scenario
  async deleteScenario(scenarioId) {
    const isDbConnected = await this.checkDatabaseConnection();

    // Get scenario type from database or file system
    let scenarioType = "HLS"; // default
    let playbackType = "Live"; // default
    if (isDbConnected) {
      try {
        const scenario = await Scenario.findOne({ scenarioId });
        if (scenario) {
          scenarioType = scenario.type || "HLS";
          playbackType = scenario.playbackType || "Live";
        }
        await Scenario.findOneAndDelete({ scenarioId });
        console.log("Scenario deleted from database:", scenarioId);
      } catch (error) {
        console.error("Error deleting scenario from database:", error);
      }
    }

    // If not found in DB, check file system
    if (scenarioType === "HLS" && playbackType === "Live") {
      const hlsDetailsPath = path.join(HLS_DIR, scenarioId, "details.json");
      const vodHlsDetailsPath = path.join(
        VOD_HLS_DIR,
        scenarioId,
        "details.json",
      );
      const dashDetailsPath = path.join(DASH_DIR, scenarioId, "details.json");
      const vmapDetailsPath = path.join(VMAP_DIR, scenarioId, "details.json");
      const vastDetailsPath = path.join(VAST_DIR, scenarioId, "details.json");
      const mp4DetailsPath = path.join(MP4_DIR, scenarioId, "details.json");
      const gifDetailsPath = path.join(GIF_DIR, scenarioId, "details.json");

      if (await fs.pathExists(vodHlsDetailsPath)) {
        const details = await fs.readJson(vodHlsDetailsPath);
        scenarioType = details.type || "HLS";
        playbackType = details.playbackType || "VOD";
      } else if (await fs.pathExists(dashDetailsPath)) {
        const details = await fs.readJson(dashDetailsPath);
        scenarioType = details.type || "DASH";
      } else if (await fs.pathExists(vmapDetailsPath)) {
        const details = await fs.readJson(vmapDetailsPath);
        scenarioType = details.type || "VMAP";
      } else if (await fs.pathExists(vastDetailsPath)) {
        const details = await fs.readJson(vastDetailsPath);
        scenarioType = details.type || "VAST";
      } else if (await fs.pathExists(mp4DetailsPath)) {
        const details = await fs.readJson(mp4DetailsPath);
        scenarioType = details.type || "MP4";
      } else if (await fs.pathExists(gifDetailsPath)) {
        const details = await fs.readJson(gifDetailsPath);
        scenarioType = details.type || "GIF";
      } else if (await fs.pathExists(hlsDetailsPath)) {
        const details = await fs.readJson(hlsDetailsPath);
        scenarioType = details.type || "HLS";
        playbackType = details.playbackType || "Live";
      }
    }

    // Determine base directory
    let baseDir;
    if (scenarioType === "HLS" && playbackType === "VOD") {
      baseDir = VOD_HLS_DIR;
    } else if (scenarioType === "DASH") {
      baseDir = DASH_DIR;
    } else if (scenarioType === "VMAP") {
      baseDir = VMAP_DIR;
    } else if (scenarioType === "VAST") {
      baseDir = VAST_DIR;
    } else if (scenarioType === "MP4") {
      baseDir = MP4_DIR;
    } else if (scenarioType === "GIF") {
      baseDir = GIF_DIR;
    } else {
      baseDir = HLS_DIR;
    }

    // Delete main scenario folder from file system
    try {
      const scenarioPath = path.join(baseDir, scenarioId);
      if (await fs.pathExists(scenarioPath)) {
        await fs.remove(scenarioPath);
        console.log("Deleted main scenario folder:", scenarioId);
      }
    } catch (error) {
      console.error("Error deleting main scenario from file system:", error);
    }

    // Delete original scenario folder from file system (only for HLS/DASH)
    if (
      scenarioType !== "VMAP" &&
      scenarioType !== "VAST" &&
      scenarioType !== "MP4" &&
      scenarioType !== "GIF"
    ) {
      try {
        const originalScenarioPath = path.join(
          baseDir,
          `${scenarioId}_original`,
        );
        if (await fs.pathExists(originalScenarioPath)) {
          await fs.remove(originalScenarioPath);
          console.log(
            "Deleted original scenario folder:",
            `${scenarioId}_original`,
          );
        }
      } catch (error) {
        console.error(
          "Error deleting original scenario from file system:",
          error,
        );
      }
    }

    // Delete ZIP file if it exists (only for HLS/DASH)
    if (
      scenarioType !== "VMAP" &&
      scenarioType !== "VAST" &&
      scenarioType !== "MP4" &&
      scenarioType !== "GIF"
    ) {
      try {
        const zipPath = path.join(baseDir, `${scenarioId}.zip`);
        if (await fs.pathExists(zipPath)) {
          await fs.remove(zipPath);
          console.log("Deleted scenario ZIP file:", `${scenarioId}.zip`);
        }
      } catch (error) {
        console.error("Error deleting scenario ZIP file:", error);
      }
    }
  }

  // Sync existing file system scenarios to database
  async syncFileSystemToDatabase() {
    const isDbConnected = await this.checkDatabaseConnection();

    if (!isDbConnected) {
      return;
    }

    try {
      let syncedCount = 0;

      // Sync HLS scenarios
      if (await fs.pathExists(HLS_DIR)) {
        const hlsDirs = await fs.readdir(HLS_DIR);

        for (const dir of hlsDirs) {
          const scenarioPath = path.join(HLS_DIR, dir);
          const detailsPath = path.join(scenarioPath, "details.json");

          if (await fs.pathExists(detailsPath)) {
            const existingScenario = await Scenario.findOne({
              scenarioId: dir,
            });

            if (!existingScenario) {
              const details = await fs.readJson(detailsPath);

              const scenario = new Scenario({
                scenarioId: dir,
                ...details,
                scenarioPath,
              });

              await scenario.save();
              syncedCount++;
            }
          }
        }
      }

      // Sync DASH scenarios
      if (await fs.pathExists(DASH_DIR)) {
        const dashDirs = await fs.readdir(DASH_DIR);

        for (const dir of dashDirs) {
          const scenarioPath = path.join(DASH_DIR, dir);
          const detailsPath = path.join(scenarioPath, "details.json");

          if (await fs.pathExists(detailsPath)) {
            const existingScenario = await Scenario.findOne({
              scenarioId: dir,
            });

            if (!existingScenario) {
              const details = await fs.readJson(detailsPath);

              const scenario = new Scenario({
                scenarioId: dir,
                ...details,
                scenarioPath,
              });

              await scenario.save();
              syncedCount++;
            }
          }
        }
      }

      // Sync VMAP scenarios
      if (await fs.pathExists(VMAP_DIR)) {
        const vmapDirs = await fs.readdir(VMAP_DIR);

        for (const dir of vmapDirs) {
          const scenarioPath = path.join(VMAP_DIR, dir);
          const detailsPath = path.join(scenarioPath, "details.json");

          if (await fs.pathExists(detailsPath)) {
            const existingScenario = await Scenario.findOne({
              scenarioId: dir,
            });

            if (!existingScenario) {
              const details = await fs.readJson(detailsPath);

              const scenario = new Scenario({
                scenarioId: dir,
                ...details,
                scenarioPath,
              });

              await scenario.save();
              syncedCount++;
            }
          }
        }
      }

      // Sync VAST scenarios
      if (await fs.pathExists(VAST_DIR)) {
        const vastDirs = await fs.readdir(VAST_DIR);

        for (const dir of vastDirs) {
          const scenarioPath = path.join(VAST_DIR, dir);
          const detailsPath = path.join(scenarioPath, "details.json");

          if (await fs.pathExists(detailsPath)) {
            const existingScenario = await Scenario.findOne({
              scenarioId: dir,
            });

            if (!existingScenario) {
              const details = await fs.readJson(detailsPath);

              const scenario = new Scenario({
                scenarioId: dir,
                ...details,
                scenarioPath,
              });

              await scenario.save();
              syncedCount++;
            }
          }
        }
      }

      // Sync MP4 scenarios
      if (await fs.pathExists(MP4_DIR)) {
        const mp4Dirs = await fs.readdir(MP4_DIR);

        for (const dir of mp4Dirs) {
          const scenarioPath = path.join(MP4_DIR, dir);
          const detailsPath = path.join(scenarioPath, "details.json");

          if (await fs.pathExists(detailsPath)) {
            const existingScenario = await Scenario.findOne({
              scenarioId: dir,
            });

            if (!existingScenario) {
              const details = await fs.readJson(detailsPath);

              const scenario = new Scenario({
                scenarioId: dir,
                ...details,
                scenarioPath,
              });

              await scenario.save();
              syncedCount++;
            }
          }
        }
      }

      // Sync GIF scenarios
      if (await fs.pathExists(GIF_DIR)) {
        const gifDirs = await fs.readdir(GIF_DIR);

        for (const dir of gifDirs) {
          const scenarioPath = path.join(GIF_DIR, dir);
          const detailsPath = path.join(scenarioPath, "details.json");

          if (await fs.pathExists(detailsPath)) {
            const existingScenario = await Scenario.findOne({
              scenarioId: dir,
            });

            if (!existingScenario) {
              const details = await fs.readJson(detailsPath);

              const scenario = new Scenario({
                scenarioId: dir,
                ...details,
                scenarioPath,
              });

              await scenario.save();
              syncedCount++;
            }
          }
        }
      }

      if (syncedCount > 0) {
        console.log(`Synced ${syncedCount} scenarios to database`);
      }
    } catch (error) {
      console.error("Sync error:", error.message);
    }
  }
}

module.exports = new ScenarioService();
