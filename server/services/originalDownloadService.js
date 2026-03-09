const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");
const manifestService = require("./manifestService");
const segmentMapService = require("./segmentMapService");
const fileOperationService = require("./fileOperationService");
const config = require("../config");

/**
 * Original Download Service - Best-Practice HLS Implementation
 *
 * This service implements a two-phase production-safe download approach:
 *
 * PHASE 1 - OPTIMAL MANIFEST CAPTURE (Best-Practice, Non-blocking):
 * - Polls at targetDuration/2 (e.g., 6s segments → 3s polling) per HLS spec
 * - Media sequence-based duplicate detection prevents redundant saves
 * - Saves manifests immediately with accurate fetch timestamps
 * - Identifies new segments without downloading them
 * - Never blocks on segment downloads
 *
 * PHASE 2 - SEGMENT DOWNLOAD (Background, Parallel):
 * - Downloads segments in background using setImmediate
 * - Multiple segment downloads can run in parallel
 * - Does not block manifest fetching loop
 * - Tracks download progress independently
 *
 * BENEFITS:
 * - Follows HLS best practices (RFC 8216 compliant)
 * - Production-safe polling frequency
 * - Captures manifest updates reliably without overwhelming servers
 * - Duplicate detection prevents redundant storage
 * - Accurate manifest timestamps (fetch time, not save time)
 * - Parallel segment downloads for efficiency
 * - Complete server behavior preservation
 * - Custom request headers support for authentication/authorization
 *
 * STORAGE STRUCTURE:
 * - {scenarioId}_original/ - Contains original files with server filenames
 * - Manifests: {timestamp}_{originalname.m3u8}
 * - Segments: Original filenames preserved
 */
class OriginalDownloadService {
  constructor() {
    this.activeDownloads = new Map(); // scenarioId -> download info
  }

  /**
   * Get custom headers from scenario details
   */
  getCustomHeaders(details) {
    const customHeaders = {};
    if (details.requestHeaders && typeof details.requestHeaders === "object") {
      Object.assign(customHeaders, details.requestHeaders);
    }
    return customHeaders;
  }

  /**
   * Prepare HTTP headers by merging custom headers with defaults
   */
  prepareHeaders(customHeaders = {}) {
    return {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept:
        "application/vnd.apple.mpegurl, application/x-mpegURL, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      Connection: "keep-alive",
      ...customHeaders, // Custom headers override defaults
    };
  }

  async startOriginalDownload(scenarioId, profileNumber, options = {}) {
    try {
      const scenarioPath = path.join(__dirname, "../hls", scenarioId);
      const originalScenarioPath = path.join(
        __dirname,
        "../hls",
        `${scenarioId}_original`,
      );
      const detailsPath = path.join(scenarioPath, "details.json");

      if (!(await fs.pathExists(detailsPath))) {
        throw new Error("Scenario not found");
      }

      const details = await fs.readJson(detailsPath);

      // Stop existing download if running
      if (this.activeDownloads.has(scenarioId)) {
        await this.stopOriginalDownload(scenarioId);
      }

      // Extract maxSegmentsPerFetch and maxSegmentsToDownload from options
      const maxSegmentsPerFetch = options.maxSegmentsPerFetch || 6;
      const maxSegmentsToDownload = options.maxSegmentsToDownload || null;

      // Update status
      details.downloadStatus = "downloading";
      details.currentProfile = profileNumber;
      details.maxSegmentsPerFetch = maxSegmentsPerFetch;
      details.maxSegmentsToDownload = maxSegmentsToDownload;
      await fs.writeJson(detailsPath, details, { spaces: 2 });

      // Create original scenario folder structure
      await this.createOriginalFolderStructure(originalScenarioPath);

      // Clean up any existing first manifest tracking files to ensure fresh start
      await this.cleanupFirstManifestTracking(scenarioId);

      // Also create main scenario folder structure for incremental processing
      await fs.ensureDir(path.join(scenarioPath, "master"));
      await fs.ensureDir(path.join(scenarioPath, "media/video"));
      await fs.ensureDir(path.join(scenarioPath, "media/audio"));
      await fs.ensureDir(path.join(scenarioPath, "profiles"));

      // Copy master manifest to original folder
      await this.copyMasterManifestToOriginal(
        scenarioPath,
        originalScenarioPath,
      );

      // Also copy master manifest to main scenario folder for immediate use
      const masterManifestPath = path.join(scenarioPath, "master/master.m3u8");
      if (await fs.pathExists(masterManifestPath)) {
        // Master manifest already exists in main folder, copy it to original
        const originalMasterPath = path.join(
          originalScenarioPath,
          "master/master.m3u8",
        );
        await fs.copy(masterManifestPath, originalMasterPath);

        // Create initial master-local.m3u8 for playback
        const masterRewriter = require("./rewriteMaster");
        await masterRewriter.rewriteMasterForScenario(scenarioId, false);
      }

      // Start download process with continuous fetching
      const downloadInfo = {
        scenarioId,
        profileNumber,
        maxSegmentsPerFetch,
        maxSegmentsToDownload,
        intervalId: null,
        segmentCount: 0,
        startTime: new Date(),
        isRunning: true,
        gracefulShutdown: false, // Flag for graceful shutdown mode
        pendingDownloads: 0, // Counter for pending segment downloads
        lastManifestContent: null,
        lastMediaSequence: null,
        targetDuration: 6,
        consecutiveErrors: 0,
        maxConsecutiveErrors: 5,
        originalScenarioPath,
        downloadedSegments: new Set(), // Track downloaded segments by original filename
        backgroundDownloadsActive: 0, // Track active background downloads
      };

      this.activeDownloads.set(scenarioId, downloadInfo);

      // NOTE: Simplified approach - download all segments and clean up afterwards
      // No need for complex first manifest detection since we do post-processing cleanup

      // Start continuous download
      this.startContinuousOriginalDownload(downloadInfo);

      // Check if audio variant is selected and start audio download
      await this.checkAndStartAudioDownload(scenarioId, downloadInfo);

      return {
        message: "Original download started",
        scenarioId,
        profileNumber,
        maxSegmentsPerFetch,
        maxSegmentsToDownload,
        status: "downloading",
      };
    } catch (error) {
      throw error;
    }
  }

  async checkAndStartAudioDownload(scenarioId, downloadInfo) {
    try {
      const scenarioPath = path.join(__dirname, "../hls", scenarioId);
      const audioInfoPath = path.join(scenarioPath, "audioInfo.json");

      // Check if audio variant is selected
      if (await fs.pathExists(audioInfoPath)) {
        const audioInfo = await fs.readJson(audioInfoPath);
        console.log(
          `Audio variant selected: ${audioInfo.trackInfo.name}, starting audio download`,
        );

        // Start audio manifest polling and segment downloading
        this.startContinuousAudioDownload(scenarioId, audioInfo, downloadInfo);
      }
    } catch (error) {
      console.error(
        `Error checking audio info for scenario ${scenarioId}:`,
        error,
      );
      // Don't throw - audio is optional
    }
  }

  async startContinuousAudioDownload(scenarioId, audioInfo, downloadInfo) {
    try {
      const scenarioPath = path.join(__dirname, "../hls", scenarioId);
      const originalScenarioPath = downloadInfo.originalScenarioPath;
      const audioVariantName = audioInfo.trackInfo.name;

      // Create audio directories using the reusable function (for manifests only)
      await this.createManifestDirectory(
        originalScenarioPath,
        "audio",
        audioVariantName,
      );

      // Ensure the media/audio directory exists (no variant subfolder for segments)
      await fs.ensureDir(path.join(originalScenarioPath, "media/audio"));

      // Start audio manifest polling (similar to video but for audio)
      this.startAudioManifestPolling(scenarioId, audioInfo, downloadInfo);

      console.log(
        `Started continuous audio download for scenario ${scenarioId} with variant ${audioVariantName}`,
      );
    } catch (error) {
      console.error(
        `Error starting audio download for scenario ${scenarioId}:`,
        error,
      );
    }
  }

  async startAudioManifestPolling(scenarioId, audioInfo, downloadInfo) {
    const pollAudio = async () => {
      if (!downloadInfo.isRunning) {
        return;
      }

      try {
        const result = await this.fetchAndSaveAudioManifestOnly(
          scenarioId,
          audioInfo,
          downloadInfo,
        );

        // Start audio segment downloads in background
        if (result.newSegments && result.newSegments.length > 0) {
          this.downloadAudioSegmentsInBackground(
            scenarioId,
            result.newSegments,
            downloadInfo,
          );
        }
      } catch (error) {
        console.error(
          `Audio manifest fetch error for scenario ${scenarioId}:`,
          error,
        );
      }

      // Continue polling if still running
      if (downloadInfo.isRunning) {
        setTimeout(pollAudio, downloadInfo.targetDuration * 500); // Poll at half target duration
      }
    };

    // Start initial audio manifest fetch
    pollAudio();
  }

  /**
   * Check if this is the first audio manifest being processed for an audio variant
   * Used to determine whether to apply first-manifest cleanup logic for audio
   */
  async isFirstAudioManifest(scenarioId, audioVariantName) {
    try {
      const originalScenarioPath = path.join(
        __dirname,
        "../hls",
        `${scenarioId}_original`,
      );
      const audioDir = path.join(
        originalScenarioPath,
        "audio",
        audioVariantName,
      );

      if (!(await fs.pathExists(audioDir))) {
        return true; // No audio directory exists, so this is definitely the first
      }

      // Check how many audio manifest files exist
      const files = await fs.readdir(audioDir);
      const manifestFiles = files.filter(
        (file) => file.endsWith(".m3u8") && /^\d+-audio-/.test(file), // Timestamped audio manifests only
      );

      // If we have 1 or fewer manifests, this is still considered the first manifest processing
      return manifestFiles.length <= 1;
    } catch (error) {
      console.error(
        `Error checking if first audio manifest for scenario ${scenarioId}:`,
        error,
      );
      return true; // Default to first manifest on error
    }
  }

  async fetchAndSaveAudioManifestOnly(scenarioId, audioInfo, downloadInfo) {
    try {
      const scenarioPath = path.join(__dirname, "../hls", scenarioId);
      const originalScenarioPath = downloadInfo.originalScenarioPath;

      // Get custom headers from scenario details
      const detailsPath = path.join(scenarioPath, "details.json");
      const details = await fs.readJson(detailsPath);
      const customHeaders = this.getCustomHeaders(details);
      const headers = this.prepareHeaders(customHeaders);

      // Get audio playlist URL from audioInfo
      const audioPlaylistUrl = audioInfo.playlistUrl;
      const audioVariantName = audioInfo.trackInfo.name; // Get the selected audio variant name

      // Fetch audio manifest
      const fetchTimestamp = Date.now();
      const response = await axios.get(audioPlaylistUrl, {
        headers,
        timeout: 30000,
      });

      const manifestContent = response.data;

      // Parse manifest to get segments
      const playlist = manifestService.parseM3U8(manifestContent);

      // Create audio directory using the selected variant name
      const audioDir = await this.createManifestDirectory(
        originalScenarioPath,
        "audio",
        audioVariantName,
      );

      // Save timestamped audio manifest
      const timestamp = fetchTimestamp;
      const date = new Date(timestamp);
      const hours = String(date.getHours()).padStart(2, "0");
      const minutes = String(date.getMinutes()).padStart(2, "0");
      const seconds = String(date.getSeconds()).padStart(2, "0");

      const audioManifestFileName = `${timestamp}-audio-${hours}-${minutes}-${seconds}.m3u8`;
      const audioManifestPath = path.join(audioDir, audioManifestFileName);

      await fs.writeFile(audioManifestPath, manifestContent);
      console.log(
        `Saved audio manifest: ${audioManifestFileName} in ${audioVariantName} folder`,
      );

      const manifestNumber = await this.updateManifestRecord(
        scenarioId,
        audioManifestFileName,
        "audio",
        audioVariantName,
      );

      // Update manifestMap.json for audio manifest
      await this.updateAudioManifestMap(
        scenarioId,
        audioManifestFileName,
        audioManifestFileName,
        audioVariantName,
        manifestNumber,
      );

      // INTEGRATED CLEANUP LOGIC FOR AUDIO: Check if this is the very first audio manifest
      // We determine this by checking if we have processed the first audio manifest yet
      // Load or create persistent first audio manifest segments tracking
      const firstAudioManifestSegmentsSet =
        await this.loadFirstAudioManifestSegments(scenarioId, audioVariantName);

      const isVeryFirstAudioManifest = firstAudioManifestSegmentsSet.size === 0;

      const baseUrl = audioPlaylistUrl.substring(
        0,
        audioPlaylistUrl.lastIndexOf("/") + 1,
      );

      let segmentsToProcess;
      if (isVeryFirstAudioManifest) {
        // First audio manifest: Download the last N segments (same as video)
        // Use maxSegmentsToDownload if specified, otherwise default to 6
        const segmentLimit = downloadInfo.maxSegmentsToDownload || 6;
        const segmentsToDownload = Math.min(segmentLimit, playlist.segments.length);
        segmentsToProcess = playlist.segments.slice(-segmentsToDownload);

        // IMPORTANT: Track all audio segments from first manifest to prevent downloading them later
        // Store this persistently to survive restarts
        const allFirstAudioManifestSegments = new Set();
        for (const segment of playlist.segments) {
          const segmentName = path.basename(segment.url);
          allFirstAudioManifestSegments.add(segmentName);
        }

        // Save to persistent storage
        await this.saveFirstAudioManifestSegments(
          scenarioId,
          audioVariantName,
          allFirstAudioManifestSegments,
        );

        // Also update in-memory for immediate use
        downloadInfo.firstAudioManifestSegments = allFirstAudioManifestSegments;

        console.log(
          `VERY FIRST AUDIO MANIFEST DETECTED: Only downloading last ${segmentsToDownload} audio segments out of ${playlist.segments.length} total segments`,
        );
        console.log(
          `First audio manifest segments (last ${segmentsToDownload}):`,
          segmentsToProcess.map((s) => path.basename(s.url)),
        );
        console.log(
          `First audio manifest segments (all ${playlist.segments.length} tracked to prevent later download):`,
          Array.from(allFirstAudioManifestSegments),
        );
      } else {
        // Subsequent audio manifests: Process all segments (they will be filtered by duplicate check)
        segmentsToProcess = playlist.segments;

        // Ensure in-memory state is in sync with persistent state
        downloadInfo.firstAudioManifestSegments = firstAudioManifestSegmentsSet;

        console.log(
          `SUBSEQUENT AUDIO MANIFEST: Processing all ${segmentsToProcess.length} audio segments for new segment detection`,
        );
      }

      const newSegments = [];

      for (const segment of segmentsToProcess) {
        const segmentFileName = path.basename(segment.url);
        const audioSegmentKey = `audio_${segmentFileName}`;

        // Check if this audio segment was in the first manifest but not downloaded (should be skipped)
        // NOTE: This check should NOT apply during first audio manifest processing
        const firstAudioManifestSkipCheck =
          !isVeryFirstAudioManifest &&
          downloadInfo.firstAudioManifestSegments &&
          downloadInfo.firstAudioManifestSegments.has(segmentFileName) &&
          !downloadInfo.downloadedSegments.has(audioSegmentKey);

        // Check if we already have this audio segment or should skip it
        if (
          !downloadInfo.downloadedSegments.has(audioSegmentKey) &&
          !firstAudioManifestSkipCheck
        ) {
          newSegments.push({
            originalFileName: segmentFileName,
            sourceUri: baseUrl + segment.url,
            originalScenarioPath: originalScenarioPath,
            type: "audio",
          });
        } else if (firstAudioManifestSkipCheck) {
          console.log(
            `Audio segment from first manifest but not in last 6, skipping: ${segmentFileName}`,
          );
        }
      }

      const manifestType = isVeryFirstAudioManifest
        ? "VERY FIRST"
        : "SUBSEQUENT";
      console.log(
        `${manifestType} AUDIO MANIFEST - Found ${newSegments.length} new audio segments for ${audioVariantName} (${playlist.segments.length} total in playlist, ${segmentsToProcess.length} processed)`,
      );

      return {
        newSegments,
        manifestContent,
        timestamp: fetchTimestamp,
      };
    } catch (error) {
      console.error(
        `Error fetching audio manifest for scenario ${scenarioId}:`,
        error,
      );
      throw error;
    }
  }

  async downloadAudioSegmentsInBackground(
    scenarioId,
    newSegments,
    downloadInfo,
  ) {
    setImmediate(async () => {
      console.log(
        `Starting background download of ${newSegments.length} audio segments for scenario ${scenarioId}`,
      );

      // Get custom headers from scenario details
      const scenarioPath = path.join(__dirname, "../hls", scenarioId);
      const detailsPath = path.join(scenarioPath, "details.json");
      let customHeaders = {};
      try {
        const details = await fs.readJson(detailsPath);
        customHeaders = this.getCustomHeaders(details);
      } catch (error) {
        console.error("Error loading scenario details for headers:", error);
      }

      downloadInfo.pendingDownloads += newSegments.length;

      const downloadPromises = newSegments.map(async (segment) => {
        try {
          if (!downloadInfo.isRunning && !downloadInfo.gracefulShutdown) {
            console.log(
              `Abrupt shutdown: Canceling audio segment download: ${segment.originalFileName}`,
            );
            return null;
          }

          const audioSegmentKey = `audio_${segment.originalFileName}`;

          // Triple-check duplicate prevention for audio segments
          if (downloadInfo.downloadedSegments.has(audioSegmentKey)) {
            console.log(
              `Audio segment already downloaded, skipping: ${segment.originalFileName}`,
            );
            return null;
          }

          const segmentRecord = await this.loadSegmentRecord(scenarioId);
          if (segmentRecord.has(audioSegmentKey)) {
            console.log(
              `Audio segment already in record, skipping: ${segment.originalFileName}`,
            );
            downloadInfo.downloadedSegments.add(audioSegmentKey);
            return null;
          }

          const segmentPath = path.join(
            downloadInfo.originalScenarioPath,
            "media/audio",
            segment.originalFileName,
          );
          if (await fs.pathExists(segmentPath)) {
            console.log(
              `Audio segment file already exists, skipping: ${segment.originalFileName}`,
            );
            downloadInfo.downloadedSegments.add(audioSegmentKey);
            await this.updateSegmentRecord(
              scenarioId,
              audioSegmentKey,
              "audio",
            );
            return null;
          }

          // Download audio segment
          console.log(`Downloading audio segment: ${segment.originalFileName}`);
          await this.downloadOriginalAudioSegment(
            segment.sourceUri,
            downloadInfo.originalScenarioPath,
            segment.originalFileName,
            customHeaders,
          );

          // Mark as downloaded
          downloadInfo.downloadedSegments.add(audioSegmentKey);
          await this.updateSegmentRecord(scenarioId, audioSegmentKey, "audio");

          console.log(
            `Background downloaded audio segment: ${segment.originalFileName}`,
          );
          return segment.originalFileName;
        } catch (error) {
          console.error(
            `Failed to download audio segment ${segment.originalFileName}:`,
            error.message,
          );
          return null;
        } finally {
          if (downloadInfo.pendingDownloads > 0) {
            downloadInfo.pendingDownloads--;
          }
        }
      });

      const results = await Promise.allSettled(downloadPromises);
      const successfulDownloads = results.filter(
        (result) => result.status === "fulfilled" && result.value !== null,
      ).length;

      console.log(
        `Audio download batch completed: ${successfulDownloads}/${newSegments.length} audio segments for scenario ${scenarioId}`,
      );
    });
  }

  async downloadOriginalAudioSegment(
    segmentUrl,
    originalScenarioPath,
    originalFileName,
    customHeaders = {},
  ) {
    try {
      console.log(`Downloading audio segment from: ${segmentUrl}`);

      const headers = this.prepareHeaders(customHeaders);

      const response = await axios.get(segmentUrl, {
        responseType: "stream",
        headers,
        timeout: 30000,
      });

      const segmentPath = path.join(
        originalScenarioPath,
        "media/audio",
        originalFileName,
      );
      await fs.ensureDir(path.dirname(segmentPath));

      const writer = fs.createWriteStream(segmentPath);
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on("finish", () => {
          console.log(`Audio segment saved: ${originalFileName}`);
          resolve();
        });
        writer.on("error", reject);
      });
    } catch (error) {
      console.error(
        `Error downloading audio segment ${originalFileName}:`,
        error,
      );
      throw error;
    }
  }

  async stopOriginalDownload(scenarioId) {
    const downloadInfo = this.activeDownloads.get(scenarioId);

    if (downloadInfo) {
      console.log(`Initiating graceful shutdown for scenario ${scenarioId}`);

      // PHASE 1: Stop fetching new manifests but allow current downloads to complete
      downloadInfo.isRunning = false; // This stops the manifest polling loop
      downloadInfo.gracefulShutdown = true; // Flag to indicate graceful shutdown mode

      if (downloadInfo.intervalId) {
        clearInterval(downloadInfo.intervalId);
      }

      // Update status to "stopping" to indicate graceful shutdown in progress
      const scenarioPath = path.join(__dirname, "../hls", scenarioId);
      const detailsPath = path.join(scenarioPath, "details.json");

      if (await fs.pathExists(detailsPath)) {
        const details = await fs.readJson(detailsPath);
        details.downloadStatus = "stopping"; // Intermediate status
        await fs.writeJson(detailsPath, details, { spaces: 2 });
      }

      console.log(`Stopped manifest fetching for scenario ${scenarioId}`);
      console.log(`Waiting for pending segment downloads to complete...`);

      // PHASE 2: Wait for all pending segment downloads to complete
      await this.waitForPendingDownloads(downloadInfo, scenarioId);

      // PHASE 3: Now safe to remove from active downloads and proceed with rewriting
      this.activeDownloads.delete(scenarioId);

      // Update final status to "stopped"
      if (await fs.pathExists(detailsPath)) {
        const details = await fs.readJson(detailsPath);
        details.downloadStatus = "stopped";
        await fs.writeJson(detailsPath, details, { spaces: 2 });
      }

      console.log(`All downloads completed for scenario ${scenarioId}`);

      // PROCESS REWRITING: Since cleanup is now integrated into download process,
      // we can directly proceed to rewriting without cleanup
      await this.processSelectiveRewriting(
        scenarioId,
        downloadInfo.profileNumber,
      );

      console.log(`Graceful shutdown completed for scenario ${scenarioId}`);
    }
  }

  /**
   * Create directory structure for manifest storage
   * @param {string} basePath - Base path (e.g., originalScenarioPath)
   * @param {string} type - Type of directory ('profiles' or 'audio')
   * @param {string|number} identifier - Profile number or audio variant name
   * @returns {string} - The created directory path
   */
  async createManifestDirectory(basePath, type, identifier) {
    const dirPath = path.join(basePath, type, String(identifier));
    await fs.ensureDir(dirPath);
    return dirPath;
  }

  async createOriginalFolderStructure(originalScenarioPath) {
    await fs.ensureDir(path.join(originalScenarioPath, "master"));
    await fs.ensureDir(path.join(originalScenarioPath, "media/video"));
    await fs.ensureDir(path.join(originalScenarioPath, "media/audio"));
    await fs.ensureDir(path.join(originalScenarioPath, "profiles"));
  }

  async copyMasterManifestToOriginal(scenarioPath, originalScenarioPath) {
    const masterManifestPath = path.join(scenarioPath, "master/master.m3u8");
    const originalMasterPath = path.join(
      originalScenarioPath,
      "master/master.m3u8",
    );

    if (await fs.pathExists(masterManifestPath)) {
      await fs.copy(masterManifestPath, originalMasterPath);
      console.log("Copied master manifest to original folder");
    }
  }

  /**
   * Wait for all pending segment downloads to complete during graceful shutdown
   */
  async waitForPendingDownloads(downloadInfo, scenarioId) {
    const maxWaitTime = 60000; // Maximum 60 seconds to wait
    const checkInterval = 1000; // Check every 1 second
    let waitedTime = 0;

    console.log(
      `Waiting for ${downloadInfo.pendingDownloads} pending downloads...`,
    );

    while (downloadInfo.pendingDownloads > 0 && waitedTime < maxWaitTime) {
      await this.sleep(checkInterval);
      waitedTime += checkInterval;

      if (waitedTime % 5000 === 0) {
        // Log every 5 seconds
        console.log(
          `Still waiting... ${downloadInfo.pendingDownloads} downloads pending (${waitedTime / 1000}s elapsed)`,
        );
      }
    }

    if (downloadInfo.pendingDownloads > 0) {
      console.warn(
        `Timeout waiting for downloads. ${downloadInfo.pendingDownloads} downloads may still be pending.`,
      );
    } else {
      console.log(`All pending downloads completed for scenario ${scenarioId}`);
    }
  }

  async startContinuousOriginalDownload(downloadInfo) {
    const { scenarioId, profileNumber, maxSegmentsPerFetch } = downloadInfo;

    console.log(
      `Starting continuous original download for scenario ${scenarioId}, profile ${profileNumber}`,
    );

    // Initial manifest fetch and save (non-blocking for segments)
    try {
      const result = await this.fetchAndSaveManifestOnly(
        scenarioId,
        profileNumber,
        maxSegmentsPerFetch,
      );

      // Start initial segment downloads in background
      if (result.newSegments && result.newSegments.length > 0) {
        this.downloadSegmentsInBackground(
          scenarioId,
          result.newSegments,
          downloadInfo,
        );
      }
    } catch (error) {
      console.error(
        `Initial original manifest fetch error for scenario ${scenarioId}:`,
        error,
      );
      downloadInfo.consecutiveErrors++;
    }

    // Start continuous monitoring loop
    this.continuousOriginalDownloadLoop(downloadInfo);
  }

  async continuousOriginalDownloadLoop(downloadInfo) {
    const { scenarioId, profileNumber, maxSegmentsPerFetch } = downloadInfo;

    console.log(
      `Starting continuous polling for scenario ${scenarioId} profile ${profileNumber}`,
    );

    while (downloadInfo.isRunning) {
      try {
        // Fetch and save manifest immediately (non-blocking for segments)
        console.log(`Fetching playlist snapshot for scenario ${scenarioId}...`);

        const result = await this.fetchAndSaveManifestOnly(
          scenarioId,
          profileNumber,
          maxSegmentsPerFetch,
        );

        // Reset error counter on successful manifest fetch
        downloadInfo.consecutiveErrors = 0;

        // Update target duration based on manifest info
        if (result.targetDuration) {
          downloadInfo.targetDuration = result.targetDuration;
        }

        // Start segment downloads in background (non-blocking)
        if (result.newSegments && result.newSegments.length > 0) {
          this.downloadSegmentsInBackground(
            scenarioId,
            result.newSegments,
            downloadInfo,
          );
        }

        // Log the result with manifest save status
        const statusMessage = `Captured manifest snapshot (seq: ${result.mediaSequence}) at ${new Date().toISOString()}. Manifest: ${result.manifestSaved ? "SAVED" : "SKIPPED (identical)"}, New segments queued: ${result.newSegments?.length || 0}, Total segments in playlist: ${result.playlistSegments}`;

        console.log(statusMessage);

        // CONTINUOUS POLLING: No fixed delays - poll as fast as possible
        // Only add minimal delay to prevent overwhelming the server
        await this.sleep(100); // 100ms minimal delay to prevent server overload
      } catch (error) {
        console.error(
          `Original download error for scenario ${scenarioId}:`,
          error,
        );
        downloadInfo.consecutiveErrors++;

        // If too many consecutive errors, add a short delay
        if (downloadInfo.consecutiveErrors >= 5) {
          console.warn(
            `Multiple consecutive errors for scenario ${scenarioId}, brief pause...`,
          );
          await this.sleep(1000); // 1 second pause after errors
          downloadInfo.consecutiveErrors = 0; // Reset counter
        } else {
          // Very short backoff for errors to maintain continuous polling
          await this.sleep(200); // 200ms delay on error
        }
      }
    }

    console.log(
      `Continuous original download loop ended for scenario ${scenarioId}`,
    );
  }

  async checkOriginalManifestChanges(downloadInfo) {
    try {
      const { scenarioId, profileNumber } = downloadInfo;
      const scenarioPath = path.join(__dirname, "../hls", scenarioId);
      const detailsPath = path.join(scenarioPath, "details.json");
      const details = await fs.readJson(detailsPath);

      // Get custom headers from scenario details
      const customHeaders = this.getCustomHeaders(details);
      const headers = this.prepareHeaders(customHeaders);

      // Get master manifest to find profile URL
      const masterManifestPath = path.join(scenarioPath, "master/master.m3u8");
      if (!(await fs.pathExists(masterManifestPath))) {
        return false;
      }

      const masterContent = await fs.readFile(masterManifestPath, "utf8");
      const profileUrl = this.extractProfileUrl(
        masterContent,
        profileNumber,
        details.sourceManifestUrl,
      );

      if (!profileUrl) {
        return false;
      }

      // Fetch current manifest
      const response = await axios.get(profileUrl, {
        headers: {
          ...headers,
          Referer: "https://www.google.com/", // Keep referer as it might be important for some streams
        },
        timeout: 15000, // Shorter timeout for frequent checks
      });

      const currentManifestContent = response.data;

      // Extract media sequence number for comparison
      const mediaSequenceMatch = currentManifestContent.match(
        /#EXT-X-MEDIA-SEQUENCE:(\d+)/,
      );
      const currentMediaSequence = mediaSequenceMatch
        ? parseInt(mediaSequenceMatch[1])
        : 0;

      // Extract target duration (supports both integer and decimal formats)
      const targetDurationMatch = currentManifestContent.match(
        /#EXT-X-TARGETDURATION:([\d.]+)/,
      );
      if (targetDurationMatch) {
        // Use Math.ceil to ensure polling frequency meets HLS requirements
        // TARGETDURATION must be ≥ longest segment, players round up internally
        downloadInfo.targetDuration = Math.ceil(
          parseFloat(targetDurationMatch[1]),
        );
      }

      // Check if manifest has changed
      const hasChanged =
        downloadInfo.lastManifestContent !== currentManifestContent ||
        downloadInfo.lastMediaSequence !== currentMediaSequence;

      // Update stored values
      downloadInfo.lastManifestContent = currentManifestContent;
      downloadInfo.lastMediaSequence = currentMediaSequence;

      return hasChanged;
    } catch (error) {
      console.error(
        `Error checking original manifest changes for scenario ${downloadInfo.scenarioId}:`,
        error,
      );
      return true; // Assume changed on error to trigger download attempt
    }
  }

  async fetchAndSaveManifestOnly(
    scenarioId,
    profileNumber,
    maxSegmentsPerFetch = 6,
  ) {
    try {
      const scenarioPath = path.join(__dirname, "../hls", scenarioId);
      const originalScenarioPath = path.join(
        __dirname,
        "../hls",
        `${scenarioId}_original`,
      );
      const detailsPath = path.join(scenarioPath, "details.json");
      const details = await fs.readJson(detailsPath);

      // Get custom headers from scenario details
      const customHeaders = this.getCustomHeaders(details);
      const headers = this.prepareHeaders(customHeaders);

      // Get master manifest to find profile URL
      const masterManifestPath = path.join(scenarioPath, "master/master.m3u8");
      if (!(await fs.pathExists(masterManifestPath))) {
        throw new Error("Master manifest not found");
      }

      const masterContent = await fs.readFile(masterManifestPath, "utf8");
      const profileUrl = this.extractProfileUrl(
        masterContent,
        profileNumber,
        details.sourceManifestUrl,
      );

      if (!profileUrl) {
        throw new Error(
          `Profile ${profileNumber} not found in master manifest`,
        );
      }

      // Fetch profile manifest and capture timestamp immediately
      const fetchTimestamp = Date.now(); // Capture timestamp BEFORE fetch
      const response = await axios.get(profileUrl, {
        headers: {
          ...headers,
          Referer: "https://www.google.com/", // Keep referer as it might be important for some streams
        },
        timeout: 30000,
      });
      const manifestContent = response.data;

      // Extract media sequence number for non-blocking duplicate check
      const mediaSequenceMatch = manifestContent.match(
        /#EXT-X-MEDIA-SEQUENCE:(\d+)/,
      );

      // SAFE HANDLING: If MEDIA-SEQUENCE is missing, do not dedupe and do not update state
      if (!mediaSequenceMatch) {
        console.warn(
          `MEDIA-SEQUENCE missing in manifest, skipping duplicate detection (fetched at ${new Date(fetchTimestamp).toISOString()})`,
        );

        // Parse manifest normally but don't update sequence state
        const { segments: playlistSegments, mediaSequence } =
          this.parseManifestSegments(manifestContent, profileUrl);

        const targetDurationMatch = manifestContent.match(
          /#EXT-X-TARGETDURATION:([\d.]+)/,
        );
        const targetDuration = targetDurationMatch
          ? Math.ceil(parseFloat(targetDurationMatch[1]))
          : 6;

        // Save manifest (treat as new since we can't determine if duplicate)
        const profileDir = await this.createManifestDirectory(
          originalScenarioPath,
          "profiles",
          profileNumber,
        );

        const originalBaseFilename = path.basename(profileUrl);
        const fetchDate = new Date(fetchTimestamp);
        const originalManifestFilename = `${fetchTimestamp}_${originalBaseFilename}`;
        const originalManifestPath = path.join(
          profileDir,
          originalManifestFilename,
        );

        await fs.writeFile(originalManifestPath, manifestContent);
        const latestManifestPath = path.join(profileDir, originalBaseFilename);
        await fs.writeFile(latestManifestPath, manifestContent);

        console.log(
          `Saved manifest without sequence info: ${originalManifestFilename}`,
        );

        return {
          newSegments: [],
          totalSegments: 0,
          playlistSegments: playlistSegments.length,
          targetDuration,
          mediaSequence: null,
          isNewSequence: false,
          reason: "media-sequence-missing",
          manifestSaved: true,
          comparisonResult: "no-sequence-check",
        };
      }

      const currentMediaSequence = parseInt(mediaSequenceMatch[1]);

      // CONTENT COMPARISON CHECK - Compare with previous manifest content
      // This check is non-blocking and prioritizes capturing all manifests
      const activeDownloadInfo = this.activeDownloads.get(scenarioId);

      // Update sequence tracking for reference
      if (activeDownloadInfo) {
        activeDownloadInfo.lastMediaSequence = currentMediaSequence;
      }

      const profileDir = await this.createManifestDirectory(
        originalScenarioPath,
        "profiles",
        profileNumber,
      );

      // NON-BLOCKING CONTENT COMPARISON: Check if manifest content is identical to previous
      let shouldSaveManifest = true;
      let comparisonResult = "no-previous-content";

      // Quick non-blocking check against last saved content
      if (activeDownloadInfo && activeDownloadInfo.lastManifestContent) {
        if (activeDownloadInfo.lastManifestContent === manifestContent) {
          shouldSaveManifest = false;
          comparisonResult = "identical-content";
          console.log(
            `CONTENT CHECK: Manifest content identical to previous, skipping save (seq: ${currentMediaSequence}) at ${new Date(fetchTimestamp).toISOString()}`,
          );
        } else {
          comparisonResult = "content-changed";
        }
      }

      // Update stored content for next comparison (always update regardless of save decision)
      if (activeDownloadInfo) {
        activeDownloadInfo.lastManifestContent = manifestContent;
      }

      let originalManifestFilename = null;
      let savedManifest = false;

      if (shouldSaveManifest) {
        // SAVE MANIFEST with accurate fetch timestamp
        // Extract original filename from profile URL
        const originalBaseFilename = path.basename(profileUrl);

        // Create timestamped version with FETCH timestamp (not save timestamp)
        const fetchDate = new Date(fetchTimestamp);
        originalManifestFilename = `${fetchTimestamp}_${originalBaseFilename}`;
        const originalManifestPath = path.join(
          profileDir,
          originalManifestFilename,
        );

        await fs.writeFile(originalManifestPath, manifestContent);
        await this.updateManifestRecord(
          scenarioId,
          originalManifestFilename,
          "video",
          profileNumber,
        );

        // Also create/update the latest version with original filename
        const latestManifestPath = path.join(profileDir, originalBaseFilename);
        await fs.writeFile(latestManifestPath, manifestContent);

        savedManifest = true;
        console.log(
          `Saved NEW manifest snapshot (seq: ${currentMediaSequence}): ${originalManifestFilename} (fetched at ${fetchDate.toISOString()})`,
        );
      }

      // Parse manifest to get segments (always parse regardless of save status)
      const { segments: playlistSegments, mediaSequence } =
        this.parseManifestSegments(manifestContent, profileUrl);

      // Extract target duration from manifest (supports both integer and decimal formats)
      const targetDurationMatch = manifestContent.match(
        /#EXT-X-TARGETDURATION:([\d.]+)/,
      );
      const targetDuration = targetDurationMatch
        ? Math.ceil(parseFloat(targetDurationMatch[1]))
        : 6;

      // Find new segments that haven't been downloaded yet
      const downloadInfo = this.activeDownloads.get(scenarioId);

      if (!downloadInfo) {
        console.log(`No active download info found for scenario ${scenarioId}`);
        return {
          newSegments: [],
          totalSegments: 0,
          playlistSegments: playlistSegments.length,
          targetDuration,
          manifestSaved: savedManifest,
          comparisonResult: comparisonResult,
        };
      }

      // If manifest content was identical, we still need to return segment info but no new segments
      if (!shouldSaveManifest) {
        console.log(
          `Profile ${profileNumber}: Manifest content identical - no new segments to process (${playlistSegments.length} total in playlist)`,
        );
        return {
          newSegments: [],
          totalSegments: downloadInfo.downloadedSegments.size,
          playlistSegments: playlistSegments.length,
          targetDuration,
          mediaSequence: currentMediaSequence,
          isNewSequence: false,
          manifestSaved: savedManifest,
          comparisonResult: comparisonResult,
        };
      }

      // Load persistent segment record for triple-check duplicate prevention
      const segmentRecord = await this.loadSegmentRecord(scenarioId);

      // INTEGRATED CLEANUP LOGIC: Check if this is the very first manifest being saved
      // We determine this by checking if we have processed the first manifest yet
      // Load or create persistent first manifest segments tracking
      const firstManifestSegmentsSet =
        await this.loadFirstManifestSegments(scenarioId);

      const isVeryFirstManifest = firstManifestSegmentsSet.size === 0;

      console.log(
        `DEBUG: First manifest detection - firstManifestSegmentsSet.size: ${firstManifestSegmentsSet.size}, isVeryFirstManifest: ${isVeryFirstManifest}`,
      );

      let segmentsToProcess;
      if (isVeryFirstManifest) {
        // This is the very first manifest being saved - download the last N segments
        // Use maxSegmentsToDownload if specified, otherwise default to 6
        const segmentLimit = downloadInfo.maxSegmentsToDownload || 6;
        const segmentsToDownload = Math.min(segmentLimit, playlistSegments.length);
        segmentsToProcess = playlistSegments.slice(-segmentsToDownload);

        // IMPORTANT: Track all segments from first manifest to prevent downloading them later
        // Store this persistently to survive restarts
        // Use full sourceUri instead of just basename to handle duplicate filenames in different paths
        const allFirstManifestSegments = new Set();
        for (const segment of playlistSegments) {
          // Store the full sourceUri to uniquely identify segments
          allFirstManifestSegments.add(segment.sourceUri);
        }

        // Save to persistent storage
        await this.saveFirstManifestSegments(
          scenarioId,
          allFirstManifestSegments,
        );

        // Also update in-memory for immediate use
        downloadInfo.firstManifestSegments = allFirstManifestSegments;

        console.log(
          `VERY FIRST MANIFEST DETECTED: Only downloading last ${segmentsToDownload} segments out of ${playlistSegments.length} total segments`,
        );
        console.log(
          `First manifest segments (last ${segmentsToDownload} to download):`,
          segmentsToProcess.map((s) => s.sourceUri),
        );
        console.log(
          `First manifest segments (all ${playlistSegments.length} tracked to prevent later download)`,
        );
      } else {
        // Subsequent manifests: Download all new segments (they will be filtered by duplicate check)
        segmentsToProcess = playlistSegments;

        // Ensure in-memory state is in sync with persistent state
        downloadInfo.firstManifestSegments = firstManifestSegmentsSet;

        console.log(
          `SUBSEQUENT MANIFEST: Processing all ${segmentsToProcess.length} segments for new segment detection`,
        );
      }

      console.log(
        `DEBUG: Processing ${segmentsToProcess.length} segments (isVeryFirstManifest: ${isVeryFirstManifest})`,
      );

      const newSegments = [];

      for (const segment of segmentsToProcess) {
        const originalFileName = path.basename(segment.sourceUri);
        const fullSourceUri = segment.sourceUri;

        // QUADRUPLE-CHECK DUPLICATE PREVENTION:
        // 1. In-memory check (fastest)
        // 2. Persistent segmentRecord.json check (source of truth)
        // 3. First manifest segments check (prevent downloading segments from first manifest that weren't in last 6)
        //    - Use full sourceUri for comparison to handle duplicate filenames in different paths
        // 4. File system check (final verification)
        const inMemoryCheck =
          downloadInfo.downloadedSegments.has(originalFileName);
        const persistentCheck = segmentRecord.has(originalFileName);

        // Check if this segment was in the first manifest but not downloaded (should be skipped)
        // NOTE: This check should NOT apply during first manifest processing
        // Use full sourceUri to uniquely identify segments (handles duplicate filenames in different paths)
        const firstManifestSkipCheck =
          !isVeryFirstManifest &&
          downloadInfo.firstManifestSegments &&
          downloadInfo.firstManifestSegments.has(fullSourceUri) &&
          !downloadInfo.downloadedSegments.has(originalFileName);

        console.log(
          `DEBUG: Segment ${originalFileName} (${fullSourceUri}) - inMemory: ${inMemoryCheck}, persistent: ${persistentCheck}, firstManifestSkip: ${firstManifestSkipCheck}`,
        );

        if (!inMemoryCheck && !persistentCheck && !firstManifestSkipCheck) {
          // Additional file system check for extra safety
          const segmentPath = path.join(
            originalScenarioPath,
            "media/video",
            originalFileName,
          );
          const fileExists = await fs.pathExists(segmentPath);

          if (!fileExists) {
            newSegments.push({
              sourceUri: segment.sourceUri,
              originalFileName: originalFileName,
              originalScenarioPath: originalScenarioPath,
            });
          } else {
            console.log(
              `Quadruple-check: Segment exists on filesystem but not in records, adding to records: ${originalFileName}`,
            );
            // Add to in-memory and persistent records since file exists
            downloadInfo.downloadedSegments.add(originalFileName);
            await this.updateSegmentRecord(
              scenarioId,
              originalFileName,
              "video",
            );
          }
        } else {
          if (firstManifestSkipCheck) {
            console.log(
              `Quadruple-check: Segment from first manifest but not in last 6, skipping: ${originalFileName}`,
            );
          } else {
            console.log(
              `Quadruple-check: Segment already downloaded (memory: ${inMemoryCheck}, persistent: ${persistentCheck}): ${originalFileName}`,
            );
          }
        }
      }

      // Debug: Show exactly which segments are being queued for download
      console.log(
        `SEGMENTS QUEUED FOR DOWNLOAD (${newSegments.length} total):`,
        newSegments.map((s) => s.originalFileName),
      );

      const manifestType = isVeryFirstManifest ? "VERY FIRST" : "SUBSEQUENT";
      console.log(
        `Profile ${profileNumber}: ${manifestType} MANIFEST - Found ${newSegments.length} new segments (${playlistSegments.length} total in playlist, ${segmentsToProcess.length} processed) - Manifest ${savedManifest ? "SAVED" : "SKIPPED (identical)"}`,
      );

      return {
        newSegments: newSegments,
        totalSegments: downloadInfo.downloadedSegments.size,
        playlistSegments: playlistSegments.length,
        targetDuration,
        mediaSequence: currentMediaSequence,
        isNewSequence: true,
        manifestSaved: savedManifest,
        comparisonResult: comparisonResult,
      };
    } catch (error) {
      console.error("Error fetching and saving manifest:", error);
      throw error;
    }
  }

  async downloadSegmentsInBackground(scenarioId, newSegments, downloadInfo) {
    // Start downloading segments in background without blocking
    // Use setImmediate to ensure this runs asynchronously and doesn't block manifest polling
    setImmediate(async () => {
      console.log(
        `Starting non-blocking background download of ${newSegments.length} segments for scenario ${scenarioId}`,
      );

      // Get custom headers from scenario details
      const scenarioPath = path.join(__dirname, "../hls", scenarioId);
      const detailsPath = path.join(scenarioPath, "details.json");
      let customHeaders = {};
      try {
        const details = await fs.readJson(detailsPath);
        customHeaders = this.getCustomHeaders(details);
      } catch (error) {
        console.error("Error loading scenario details for headers:", error);
      }

      // Increment pending downloads counter
      downloadInfo.pendingDownloads += newSegments.length;

      // Download segments in parallel to avoid blocking
      const downloadPromises = newSegments.map(async (segment) => {
        try {
          // Check if download is in graceful shutdown mode
          // During graceful shutdown, we continue downloading but don't start new manifest fetches
          if (downloadInfo.gracefulShutdown) {
            console.log(
              `Graceful shutdown mode: Continuing download of queued segment: ${segment.originalFileName}`,
            );
          }

          // Only cancel if it's an abrupt shutdown (not graceful)
          if (!downloadInfo.isRunning && !downloadInfo.gracefulShutdown) {
            console.log(
              `Abrupt shutdown: Canceling segment download: ${segment.originalFileName}`,
            );
            return null;
          }

          // TRIPLE-CHECK DUPLICATE PREVENTION (non-blocking):
          // 1. In-memory check (fastest)
          if (downloadInfo.downloadedSegments.has(segment.originalFileName)) {
            console.log(
              `Triple-check 1/3 (memory): Segment already downloaded, skipping: ${segment.originalFileName}`,
            );
            return null;
          }

          // 2. Persistent segmentRecord.json check (source of truth)
          const segmentRecord = await this.loadSegmentRecord(scenarioId);
          if (segmentRecord.has(segment.originalFileName)) {
            console.log(
              `Triple-check 2/3 (persistent): Segment already in record, skipping: ${segment.originalFileName}`,
            );
            // Update in-memory to sync with persistent record
            downloadInfo.downloadedSegments.add(segment.originalFileName);
            return null;
          }

          // 3. File system check (final verification)
          const segmentPath = path.join(
            segment.originalScenarioPath,
            "media/video",
            segment.originalFileName,
          );
          if (await fs.pathExists(segmentPath)) {
            console.log(
              `Triple-check 3/3 (filesystem): Segment file already exists, skipping: ${segment.originalFileName}`,
            );
            // Update both in-memory and persistent records since file exists
            downloadInfo.downloadedSegments.add(segment.originalFileName);
            await this.updateSegmentRecord(
              scenarioId,
              segment.originalFileName,
              "video",
            );
            return null;
          }

          // All checks passed - proceed with download
          const shutdownStatus = downloadInfo.gracefulShutdown
            ? " (graceful shutdown)"
            : "";
          console.log(
            `Triple-check passed: Downloading segment ${segment.originalFileName}${shutdownStatus}`,
          );

          await this.downloadOriginalSegment(
            segment.sourceUri,
            segment.originalScenarioPath,
            segment.originalFileName,
            customHeaders,
          );

          // Mark as downloaded in all tracking systems (non-blocking)
          downloadInfo.downloadedSegments.add(segment.originalFileName);
          await this.updateSegmentRecord(
            scenarioId,
            segment.originalFileName,
            "video",
          );

          // Skip incremental segment mapping during download
          // Segment mapping will be created properly after download stops and cleanup completes
          // await this.updateSegmentMappingIncremental(
          //   scenarioId,
          //   segment.originalFileName,
          // );

          // Skip incremental manifest updates during download
          // Manifests will be properly rewritten after download stops and cleanup completes
          // await this.updateManifestsIncremental(
          //   scenarioId,
          //   downloadInfo.profileNumber,
          // );

          console.log(
            `Background downloaded segment: ${segment.originalFileName}${shutdownStatus}`,
          );
          return segment.originalFileName;
        } catch (error) {
          console.error(
            `Failed to background download segment ${segment.originalFileName}:`,
            error.message,
          );
          return null;
        } finally {
          // Always decrement pending downloads counter
          if (downloadInfo.pendingDownloads > 0) {
            downloadInfo.pendingDownloads--;
          }
        }
      });

      // Wait for all downloads to complete (but don't block manifest polling)
      const results = await Promise.allSettled(downloadPromises);
      const successfulDownloads = results.filter(
        (result) => result.status === "fulfilled" && result.value !== null,
      ).length;

      const shutdownStatus = downloadInfo.gracefulShutdown
        ? " (during graceful shutdown)"
        : "";
      console.log(
        `Background download batch completed: ${successfulDownloads}/${newSegments.length} segments for scenario ${scenarioId}${shutdownStatus}`,
      );
    });
  }

  async downloadOriginalSegments(
    scenarioId,
    profileNumber,
    maxSegmentsPerFetch = 6,
  ) {
    try {
      const scenarioPath = path.join(__dirname, "../hls", scenarioId);
      const originalScenarioPath = path.join(
        __dirname,
        "../hls",
        `${scenarioId}_original`,
      );
      const detailsPath = path.join(scenarioPath, "details.json");
      const details = await fs.readJson(detailsPath);

      // Get custom headers from scenario details
      const customHeaders = this.getCustomHeaders(details);
      const headers = this.prepareHeaders(customHeaders);

      // Get master manifest to find profile URL
      const masterManifestPath = path.join(scenarioPath, "master/master.m3u8");
      if (!(await fs.pathExists(masterManifestPath))) {
        throw new Error("Master manifest not found");
      }

      const masterContent = await fs.readFile(masterManifestPath, "utf8");
      const profileUrl = this.extractProfileUrl(
        masterContent,
        profileNumber,
        details.sourceManifestUrl,
      );

      if (!profileUrl) {
        throw new Error(
          `Profile ${profileNumber} not found in master manifest`,
        );
      }

      // Fetch profile manifest and capture timestamp immediately
      const fetchTimestamp = Date.now(); // Capture timestamp BEFORE fetch
      const response = await axios.get(profileUrl, {
        headers: {
          ...headers,
          Referer: "https://www.google.com/", // Keep referer as it might be important for some streams
        },
        timeout: 30000,
      });
      const manifestContent = response.data;

      // SAVE MANIFEST IMMEDIATELY with accurate fetch timestamp
      const profileDir = await this.createManifestDirectory(
        originalScenarioPath,
        "profiles",
        profileNumber,
      );

      // Extract original filename from profile URL
      const originalBaseFilename = path.basename(profileUrl);

      // Create timestamped version with FETCH timestamp (not save timestamp)
      const fetchDate = new Date(fetchTimestamp);
      const originalManifestFilename = `${fetchTimestamp}_${originalBaseFilename}`;
      const originalManifestPath = path.join(
        profileDir,
        originalManifestFilename,
      );

      await fs.writeFile(originalManifestPath, manifestContent);

      // Also create/update the latest version with original filename
      const latestManifestPath = path.join(profileDir, originalBaseFilename);
      await fs.writeFile(latestManifestPath, manifestContent);

      console.log(
        `Saved manifest snapshot immediately: ${originalManifestFilename} (fetched at ${fetchDate.toISOString()})`,
      );

      // Parse manifest to get segments
      const { segments: playlistSegments, mediaSequence } =
        this.parseManifestSegments(manifestContent, profileUrl);

      // Extract target duration from manifest (supports both integer and decimal formats)
      const targetDurationMatch = manifestContent.match(
        /#EXT-X-TARGETDURATION:([\d.]+)/,
      );
      const targetDuration = targetDurationMatch
        ? Math.ceil(parseFloat(targetDurationMatch[1]))
        : 6;

      // Find new segments that haven't been downloaded yet
      const downloadInfo = this.activeDownloads.get(scenarioId);

      if (!downloadInfo) {
        console.log(`No active download info found for scenario ${scenarioId}`);
        return {
          newSegmentsCount: 0,
          totalSegments: 0,
          playlistSegments: playlistSegments.length,
          targetDuration,
        };
      }

      const newSegments = [];

      // Process ALL segments in playlist (no limiting for original preservation)
      const segmentsToProcess = playlistSegments;

      for (const segment of segmentsToProcess) {
        const originalFileName = path.basename(segment.sourceUri);
        const segmentPath = path.join(
          originalScenarioPath,
          "media/video",
          originalFileName,
        );

        // Check if segment already exists and is not in our downloaded set
        if (!downloadInfo.downloadedSegments.has(originalFileName)) {
          newSegments.push(segment);
        }
      }

      console.log(
        `Profile ${profileNumber}: Found ${newSegments.length} new segments (${playlistSegments.length} total in playlist, processing ALL segments)`,
      );

      // Download new segments with original filenames
      let downloadedCount = 0;
      for (const segment of newSegments) {
        const originalFileName = path.basename(segment.sourceUri);

        try {
          await this.downloadOriginalSegment(
            segment.sourceUri,
            originalScenarioPath,
            originalFileName,
            customHeaders,
          );

          // Mark as downloaded
          downloadInfo.downloadedSegments.add(originalFileName);
          downloadedCount++;

          console.log(`Downloaded original segment: ${originalFileName}`);
        } catch (error) {
          console.error(
            `Failed to download original segment ${originalFileName}:`,
            error.message,
          );
        }
      }

      console.log(
        `Downloaded ${downloadedCount} new segments. Manifest was already saved with accurate timestamp.`,
      );

      return {
        newSegmentsCount: newSegments.length,
        totalSegments: downloadInfo.downloadedSegments.size,
        playlistSegments: playlistSegments.length,
        targetDuration,
      };
    } catch (error) {
      console.error("Error downloading original segments:", error);
      throw error;
    }
  }

  async downloadOriginalSegment(
    segmentUrl,
    originalScenarioPath,
    fileName,
    customHeaders = {},
  ) {
    try {
      const headers = this.prepareHeaders(customHeaders);

      const response = await axios.get(segmentUrl, {
        responseType: "stream",
        headers: {
          ...headers,
          Referer: "https://www.google.com/", // Keep referer as it might be important for some streams
        },
        timeout: 30000,
      });

      const segmentPath = path.join(
        originalScenarioPath,
        "media/video",
        fileName,
      );
      await fs.ensureDir(path.dirname(segmentPath));

      const writer = fs.createWriteStream(segmentPath);
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
      });
    } catch (error) {
      console.error(`Error downloading original segment ${segmentUrl}:`, error);
      throw error;
    }
  }

  async processOriginalToRewritten(scenarioId, profileNumber) {
    try {
      console.log(
        `Processing original files to rewritten format for scenario ${scenarioId}`,
      );

      const scenarioPath = path.join(__dirname, "../hls", scenarioId);
      const originalScenarioPath = path.join(
        __dirname,
        "../hls",
        `${scenarioId}_original`,
      );

      // Ensure main scenario folder structure exists
      await fs.ensureDir(path.join(scenarioPath, "master"));
      await fs.ensureDir(path.join(scenarioPath, "media/video"));
      await fs.ensureDir(path.join(scenarioPath, "media/audio"));
      await fs.ensureDir(path.join(scenarioPath, "profiles"));

      // Copy master manifest to main folder (already exists, but ensure it's there)
      const originalMasterPath = path.join(
        originalScenarioPath,
        "master/master.m3u8",
      );
      const mainMasterPath = path.join(scenarioPath, "master/master.m3u8");

      if (await fs.pathExists(originalMasterPath)) {
        await fs.copy(originalMasterPath, mainMasterPath);
      }

      // DISABLED - Use processSelectiveRewriting instead
      // await this.processSegmentRenaming(
      //   scenarioId,
      //   originalScenarioPath,
      //   scenarioPath,
      // );

      // Process manifests: rewrite URLs and create timestamped versions
      await this.processManifestRewriting(
        scenarioId,
        originalScenarioPath,
        scenarioPath,
        profileNumber,
      );

      // Copy Profile 0 manifests to all other profiles for master manifest compatibility
      await this.copyProfile0ToAllProfiles(scenarioId, scenarioPath);

      // Rewrite master manifest again to ensure it points to all profiles correctly
      const masterRewriter = require("./rewriteMaster");
      await masterRewriter.rewriteMasterForScenario(scenarioId, false);

      // Initialize live streaming for this scenario
      await this.initializeLiveStreamingForScenario(scenarioId, profileNumber);

      console.log(
        `Successfully processed original files to rewritten format for scenario ${scenarioId}`,
      );
    } catch (error) {
      console.error(
        `Error processing original to rewritten for scenario ${scenarioId}:`,
        error,
      );
      throw error;
    }
  }

  async initializeLiveStreamingForScenario(scenarioId, profileNumber) {
    try {
      console.log(`Initializing live streaming for scenario ${scenarioId}...`);

      const scenarioPath = path.join(__dirname, "../hls", scenarioId);
      const originalScenarioPath = path.join(
        __dirname,
        "../hls",
        `${scenarioId}_original`,
      );

      // Create segment timing information from downloaded manifests
      await this.createSegmentTimingData(
        scenarioId,
        originalScenarioPath,
        scenarioPath,
      );

      // Initialize live stream service
      const liveStreamService = require("./liveStreamService");
      await liveStreamService.initializeLiveStream(scenarioId, profileNumber);

      // Update master manifest to use live streaming endpoints
      const masterPath = path.join(scenarioPath, "master/master.m3u8");
      const localMasterPath = path.join(
        scenarioPath,
        "master/master-local.m3u8",
      );

      if (await fs.pathExists(masterPath)) {
        // Use the proper master rewriter that preserves audio tracks
        const masterRewriter = require("./rewriteMaster");
        await masterRewriter.rewriteMasterForScenario(scenarioId, false);
        console.log(
          "Updated master-local.m3u8 with proper audio track support",
        );
      }

      console.log(`Live streaming initialized for scenario ${scenarioId}`);
      console.log(
        `HLS playlist URL: /api/scenarios/${scenarioId}/player/profiles/${profileNumber}/playlist.m3u8`,
      );
    } catch (error) {
      console.error(
        `Error initializing live streaming for ${scenarioId}:`,
        error,
      );
      // Don't throw - live streaming is optional
    }
  }

  async createSegmentTimingData(
    scenarioId,
    originalScenarioPath,
    scenarioPath,
  ) {
    try {
      console.log(`Creating segment timing data for ${scenarioId}...`);

      // Read all timestamped manifests from profile 0
      const profile0Dir = path.join(originalScenarioPath, "profiles/0");

      if (!(await fs.pathExists(profile0Dir))) {
        console.log(
          "No profile 0 directory found, skipping timing data creation",
        );
        return;
      }

      const manifestFiles = await fs.readdir(profile0Dir);
      const timestampedManifests = manifestFiles
        .filter((file) => file.match(/^\d+_.*\.m3u8$/))
        .sort((a, b) => {
          const timestampA = parseInt(a.split("_")[0]);
          const timestampB = parseInt(b.split("_")[0]);
          return timestampA - timestampB;
        });

      if (timestampedManifests.length === 0) {
        console.log(
          "No timestamped manifests found, skipping timing data creation",
        );
        return;
      }

      const segmentTiming = {
        scenarioId,
        createdAt: new Date().toISOString(),
        manifests: [],
        segments: {},
      };

      // Process each manifest to extract segment timing
      for (const manifestFile of timestampedManifests) {
        const manifestPath = path.join(profile0Dir, manifestFile);
        const manifestContent = await fs.readFile(manifestPath, "utf8");
        const timestamp = parseInt(manifestFile.split("_")[0]);

        // Parse manifest to extract segments and their timing
        const manifestData = manifestService.parseM3U8(manifestContent);

        segmentTiming.manifests.push({
          filename: manifestFile,
          timestamp,
          segmentCount: manifestData.segments.length,
          mediaSequence: manifestData.mediaSequence,
        });

        // Extract segment timing information
        manifestData.segments.forEach((segment, index) => {
          const segmentName = path.basename(segment.url);
          if (!segmentTiming.segments[segmentName]) {
            segmentTiming.segments[segmentName] = {
              firstSeen: timestamp,
              duration: segment.duration,
              sequence: manifestData.mediaSequence + index,
            };
          }
        });
      }

      // Save timing data
      const timingPath = path.join(scenarioPath, "segmentTiming.json");
      await fs.writeJson(timingPath, segmentTiming, { spaces: 2 });

      console.log(
        `Created segment timing data with ${Object.keys(segmentTiming.segments).length} segments`,
      );
    } catch (error) {
      console.error(`Error creating segment timing data:`, error);
      // Don't throw - timing data is optional
    }
  }

  // DISABLED - This function is replaced by processSelectiveSegmentRenaming
  // async processSegmentRenaming(scenarioId, originalScenarioPath, scenarioPath) {
  //   try {
  //     const originalVideoDir = path.join(originalScenarioPath, "media/video");
  //     const mainVideoDir = path.join(scenarioPath, "media/video");
  //
  //     if (!(await fs.pathExists(originalVideoDir))) {
  //       console.log("No original video segments found");
  //       return;
  //     }
  //
  //     // Get all original segment files
  //     const originalSegments = await fs.readdir(originalVideoDir);
  //     const segmentFiles = originalSegments.filter(
  //       (file) =>
  //         file.endsWith(".ts") ||
  //         file.endsWith(".m4s") ||
  //         file.endsWith(".mp4"),
  //     );
  //
  //     // Sort segments to maintain order
  //     segmentFiles.sort();
  //
  //     // Create segment mapping preserving original sequence relationship
  //     const segmentMap = {};
  //     let segmentCounter = 1;
  //
  //     for (const originalFileName of segmentFiles) {
  //       const newFileName = `${segmentCounter}.ts`;
  //       const originalPath = path.join(originalVideoDir, originalFileName);
  //       const newPath = path.join(mainVideoDir, newFileName);
  //
  //       // Copy segment with new name
  //       await fs.copy(originalPath, newPath);
  //
  //       // Add to segment mapping - key is original filename, value is new filename
  //       segmentMap[originalFileName] = newFileName;
  //
  //       console.log(
  //         `Renamed segment: ${originalFileName} → ${newFileName} (seq: ${segmentCounter})`,
  //       );
  //       segmentCounter++;
  //     }
  //
  //     // Save segment mapping using the safe service
  //     await segmentMapService.writeSegmentMap(scenarioPath, segmentMap);
  //
  //     console.log(
  //       `Processed ${segmentFiles.length} segments and created segmentMap.json`,
  //     );
  //   } catch (error) {
  //     console.error("Error processing segment renaming:", error);
  //     throw error;
  //   }
  // }

  async processManifestRewriting(
    scenarioId,
    originalScenarioPath,
    scenarioPath,
    profileNumber,
  ) {
    try {
      const originalProfileDir = path.join(
        originalScenarioPath,
        "profiles",
        String(profileNumber),
      );
      const mainProfileDir = path.join(
        scenarioPath,
        "profiles",
        String(profileNumber),
      );

      if (!(await fs.pathExists(originalProfileDir))) {
        console.log(`No original profile ${profileNumber} manifests found`);
        return;
      }

      // Load segment mapping
      const segmentMapPath = path.join(scenarioPath, "segmentMap.json");
      const segmentMap = await fs.readJson(segmentMapPath);

      // Get all original manifest files (timestamped versions only)
      const originalManifests = await fs.readdir(originalProfileDir);
      const timestampedManifestFiles = originalManifests.filter(
        (file) => file.endsWith(".m3u8") && /^\d+_/.test(file),
      );

      await fs.ensureDir(mainProfileDir);

      const manifestMapping = [];

      for (const originalManifestFile of timestampedManifestFiles) {
        const originalManifestPath = path.join(
          originalProfileDir,
          originalManifestFile,
        );
        const originalContent = await fs.readFile(originalManifestPath, "utf8");

        // Extract timestamp from filename (format: timestamp_originalname.m3u8)
        const timestampMatch = originalManifestFile.match(/^(\d+)_(.+)$/);
        if (!timestampMatch) {
          console.log(
            `Skipping manifest with unexpected format: ${originalManifestFile}`,
          );
          continue;
        }

        const timestamp = timestampMatch[1];
        const originalName = timestampMatch[2];

        // Convert timestamp to date for proper formatting
        const date = new Date(parseInt(timestamp));
        const hours = String(date.getHours()).padStart(2, "0");
        const minutes = String(date.getMinutes()).padStart(2, "0");
        const seconds = String(date.getSeconds()).padStart(2, "0");

        // Create rewritten filename in the expected format
        const rewrittenManifestFilename = `${timestamp}-${profileNumber}-${hours}-${minutes}-${seconds}.m3u8`;

        // Rewrite manifest content to use renamed segments
        const rewrittenContent = this.rewriteManifestContent(
          originalContent,
          segmentMap,
          scenarioId,
        );

        // Save rewritten manifest with proper timestamped filename
        const rewrittenManifestPath = path.join(
          mainProfileDir,
          rewrittenManifestFilename,
        );
        await fs.writeFile(rewrittenManifestPath, rewrittenContent);

        // Extract metadata for manifest mapping
        const mediaSequenceMatch = originalContent.match(
          /#EXT-X-MEDIA-SEQUENCE:(\d+)/,
        );
        const mediaSequence = mediaSequenceMatch
          ? parseInt(mediaSequenceMatch[1])
          : 0;

        manifestMapping.push({
          localManifestName: rewrittenManifestFilename,
          timestamp: date.toISOString(),
          mediaSequence: mediaSequence,
          profileNumber: profileNumber,
        });

        console.log(
          `Rewritten manifest: ${originalManifestFile} → ${rewrittenManifestFilename}`,
        );
      }

      // Also create playlist.m3u8 from the latest manifest using livestream format
      if (timestampedManifestFiles.length > 0) {
        // Sort by timestamp to get the latest
        const sortedManifests = timestampedManifestFiles.sort((a, b) => {
          const matchA = a.match(/^(\d+)_/);
          const matchB = b.match(/^(\d+)_/);

          if (!matchA || !matchB) {
            console.warn(
              `Manifest filename doesn't match expected pattern: ${!matchA ? a : b}`,
            );
            return 0;
          }

          const timestampA = parseInt(matchA[1]);
          const timestampB = parseInt(matchB[1]);
          return timestampB - timestampA; // Latest first
        });

        const latestOriginalFile = sortedManifests[0];
        const latestOriginalPath = path.join(
          originalProfileDir,
          latestOriginalFile,
        );
        const latestContent = await fs.readFile(latestOriginalPath, "utf8");

        // Use livestream format instead of VOD
        const rewrittenLatestContent = this.rewriteManifestContentForLivestream(
          latestContent,
          segmentMap,
          scenarioId,
        );

        const playlistPath = path.join(mainProfileDir, "playlist.m3u8");
        await fileOperationService.updatePlaylistSafely(
          playlistPath,
          rewrittenLatestContent,
        );

        console.log(
          `Created livestream playlist.m3u8 from latest manifest: ${latestOriginalFile}`,
        );
      }

      // Save global manifestMap.json (single source of truth)
      const globalManifestMapPath = path.join(scenarioPath, "manifestMap.json");
      let globalManifestMap = {};

      if (await fs.pathExists(globalManifestMapPath)) {
        globalManifestMap = await fs.readJson(globalManifestMapPath);
      }

      // Add mappings for this profile using the new method
      await this.updateManifestMap(
        scenarioId,
        profileNumber,
        timestampedManifestFiles,
      );

      console.log(
        `Processed ${timestampedManifestFiles.length} manifests and updated manifestMap.json for livestream format`,
      );
    } catch (error) {
      console.error("Error processing manifest rewriting:", error);
      throw error;
    }
  }

  rewriteManifestContent(originalContent, segmentMap, scenarioId) {
    return this.rewriteManifestContentWithLastNSegments(
      originalContent,
      segmentMap,
      scenarioId,
      6,
    );
  }

  /**
   * Update manifestMap.json with manifest filename mappings
   */
  async updateManifestMap(scenarioId, profileNumber, timestampedManifestFiles) {
    return this.updateManifestMapGeneric(
      scenarioId,
      timestampedManifestFiles,
      `profile.${profileNumber}`,
      "video",
      profileNumber,
      /^(\d+)_(.+)$/,
      (timestamp, profileNumber) => {
        const date = new Date(parseInt(timestamp));
        const hours = String(date.getHours()).padStart(2, "0");
        const minutes = String(date.getMinutes()).padStart(2, "0");
        const seconds = String(date.getSeconds()).padStart(2, "0");
        return `${timestamp}-${profileNumber}-${hours}-${minutes}-${seconds}.m3u8`;
      },
      (scenarioId, profileNumber, originalManifestFile) =>
        path.join(
          __dirname,
          "../hls",
          `${scenarioId}_original`,
          "profiles",
          String(profileNumber),
          originalManifestFile,
        ),
    );
  }

  /**
   * Generic function to update manifestMap.json with manifest filename mappings
   *
   * @param {string} scenarioId - The scenario ID
   * @param {Array} timestampedManifestFiles - Array of original manifest filenames
   * @param {string} sectionKey - Key for the section in manifestMap.json (e.g., "profile0" or "audio.eng a2")
   * @param {string} mediaType - Type of media ("video" or "audio")
   * @param {string|number} identifier - Profile number or audio variant name
   * @param {RegExp} filenamePattern - Pattern to extract timestamp from filename
   * @param {Function} rewrittenFilenameGenerator - Function to generate rewritten filename
   * @param {Function} originalPathGenerator - Function to generate path to original manifest file
   */
  async updateManifestMapGeneric(
    scenarioId,
    timestampedManifestFiles,
    sectionKey,
    mediaType,
    identifier,
    filenamePattern,
    rewrittenFilenameGenerator,
    originalPathGenerator,
  ) {
    try {
      const scenarioPath = path.join(__dirname, "../hls", scenarioId);
      const manifestMapPath = path.join(scenarioPath, "manifestMap.json");

      // Load manifestRecord.json to get manifestNumber
      const originalScenarioPath = path.join(
        __dirname,
        "../hls",
        `${scenarioId}_original`,
      );
      const manifestRecordPath = path.join(
        originalScenarioPath,
        "manifestRecord.json",
      );
      let manifestRecord = { profile: {}, audio: {} };
      if (await fs.pathExists(manifestRecordPath)) {
        manifestRecord = await fs.readJson(manifestRecordPath);
      }

      // Load existing manifestMap.json
      let manifestMap = {};
      if (await fs.pathExists(manifestMapPath)) {
        manifestMap = await fs.readJson(manifestMapPath);
      }

      // Handle nested section keys (e.g., "audio.eng a2")
      const sectionParts = sectionKey.split(".");
      let currentSection = manifestMap;

      for (let i = 0; i < sectionParts.length; i++) {
        const part = sectionParts[i];
        if (i === sectionParts.length - 1) {
          // Last part - this is where we store the mappings
          if (!currentSection[part]) {
            currentSection[part] = {};
          }
          currentSection = currentSection[part];
        } else {
          // Intermediate part - ensure it exists
          if (!currentSection[part]) {
            currentSection[part] = {};
          }
          currentSection = currentSection[part];
        }
      }

      // Add mappings for each timestamped manifest
      for (const originalManifestFile of timestampedManifestFiles) {
        const timestampMatch = originalManifestFile.match(filenamePattern);
        if (timestampMatch) {
          const timestamp = timestampMatch[1];
          const rewrittenManifestFilename = rewrittenFilenameGenerator(
            timestamp,
            identifier,
          );

          // Extract media sequence from original file if possible
          const originalManifestPath = originalPathGenerator(
            scenarioId,
            identifier,
            originalManifestFile,
          );

          let mediaSequence = 0;
          if (await fs.pathExists(originalManifestPath)) {
            try {
              const originalContent = await fs.readFile(
                originalManifestPath,
                "utf8",
              );
              const mediaSequenceMatch = originalContent.match(
                /#EXT-X-MEDIA-SEQUENCE:(\d+)/,
              );
              mediaSequence = mediaSequenceMatch
                ? parseInt(mediaSequenceMatch[1])
                : 0;
            } catch (error) {
              console.warn(
                `Could not read media sequence from ${originalManifestFile}:`,
                error.message,
              );
            }
          }

          const recordSectionKey = identifier;
          const recordTargetSection =
            mediaType === "video"
              ? manifestRecord.profile
              : manifestRecord.audio;
          let manifestNumber = 0;
          if (
            recordTargetSection &&
            recordTargetSection[recordSectionKey] &&
            recordTargetSection[recordSectionKey][originalManifestFile]
          ) {
            manifestNumber =
              recordTargetSection[recordSectionKey][originalManifestFile]
                .manifestNumber;
          }

          const existingMapping = currentSection[originalManifestFile];
          const mappingData = {
            rewrittenFilename: rewrittenManifestFilename,
            timestamp: new Date(parseInt(timestamp)).toISOString(),
            mediaSequence: mediaSequence,
            manifestNumber: manifestNumber,
            type: mediaType,
            delay: 0,
            delayPercentage: 100,
            status: 200,
            statusPercentage: 100,
            isEdited: false,
            isEditedForAll: false,
            repeat: 0,
            repeatPercentage: 100,
          };

          if (mediaType === "video") {
            mappingData.profileNumber = identifier;
          } else if (mediaType === "audio") {
            mappingData.variantName = identifier;
          }

          currentSection[originalManifestFile] = mappingData;
        }
      }

      // Save updated manifestMap.json
      await fs.writeJson(manifestMapPath, manifestMap, { spaces: 2 });

      console.log(
        `Updated manifestMap.json for ${mediaType} ${identifier} with ${timestampedManifestFiles.length} manifest mappings`,
      );
    } catch (error) {
      console.error(
        `Error updating manifestMap.json for scenario ${scenarioId}:`,
        error,
      );
      // Don't throw - this is not critical for functionality
    }
  }

  /**
   * Update manifestMap.json for audio manifests
   */
  async updateAudioManifestMap(
    scenarioId,
    originalAudioManifestFile,
    rewrittenAudioManifestFile,
    audioVariantName = null,
    manifestNumber = 0,
  ) {
    try {
      const scenarioPath = path.join(__dirname, "../hls", scenarioId);
      const manifestMapPath = path.join(scenarioPath, "manifestMap.json");

      // Load existing manifestMap.json
      let manifestMap = {};
      if (await fs.pathExists(manifestMapPath)) {
        manifestMap = await fs.readJson(manifestMapPath);
      }

      // Ensure audio section exists
      if (!manifestMap.audio) {
        manifestMap.audio = {};
      }

      // If audioVariantName is provided, create a subsection for it
      if (audioVariantName) {
        if (!manifestMap.audio[audioVariantName]) {
          manifestMap.audio[audioVariantName] = {};
        }

        // Extract timestamp from audio manifest filename
        const timestampMatch = originalAudioManifestFile.match(/^(\d+)-audio-/);
        let timestamp = new Date().toISOString();
        if (timestampMatch) {
          timestamp = new Date(parseInt(timestampMatch[1])).toISOString();
        }

        const existingMapping =
          manifestMap.audio[audioVariantName][originalAudioManifestFile];
        manifestMap.audio[audioVariantName][originalAudioManifestFile] = {
          rewrittenFilename: rewrittenAudioManifestFile,
          timestamp: timestamp,
          manifestNumber: manifestNumber,
          type: "audio",
          variantName: audioVariantName,
          delay: 0,
          delayPercentage: 100,
          status: 200,
          statusPercentage: 100,
          isEdited: false,
          isEditedForAll: false,
          repeat: 0,
          repeatPercentage: 100,
        };
      } else {
        // Fallback to root audio section for backward compatibility
        const timestampMatch = originalAudioManifestFile.match(/^(\d+)-audio-/);
        let timestamp = new Date().toISOString();
        if (timestampMatch) {
          timestamp = new Date(parseInt(timestampMatch[1])).toISOString();
        }

        const existingMapping = manifestMap.audio[originalAudioManifestFile];
        manifestMap.audio[originalAudioManifestFile] = {
          rewrittenFilename: rewrittenAudioManifestFile,
          timestamp: timestamp,
          manifestNumber: manifestNumber,
          type: "audio",
          delay: 0,
          delayPercentage: 100,
          status: 200,
          statusPercentage: 100,
          isEdited: false,
          isEditedForAll: false,
          repeat: 0,
          repeatPercentage: 100,
        };
      }

      // Save updated manifestMap.json
      await fs.writeJson(manifestMapPath, manifestMap, { spaces: 2 });

      const variantInfo = audioVariantName
        ? ` for variant ${audioVariantName}`
        : "";
      console.log(
        `Updated manifestMap.json for audio manifest: ${originalAudioManifestFile} → ${rewrittenAudioManifestFile}${variantInfo}`,
      );
    } catch (error) {
      console.error(
        `Error updating audio manifestMap.json for scenario ${scenarioId}:`,
        error,
      );
      // Don't throw - this is not critical for functionality
    }
  }

  /**
   * Update manifestRecord.json in the _original folder to track manifest download sequence
   */
  async updateManifestRecord(
    scenarioId,
    originalManifestFileName,
    type,
    identifier,
  ) {
    try {
      const originalScenarioPath = path.join(
        __dirname,
        "../hls",
        `${scenarioId}_original`,
      );
      const manifestRecordPath = path.join(
        originalScenarioPath,
        "manifestRecord.json",
      );

      await fs.ensureDir(originalScenarioPath);

      let manifestRecord = { profile: {}, audio: {} };
      if (await fs.pathExists(manifestRecordPath)) {
        manifestRecord = await fs.readJson(manifestRecordPath);
      }

      // Ensure structure exists
      if (!manifestRecord.profile) manifestRecord.profile = {};
      if (!manifestRecord.audio) manifestRecord.audio = {};

      const sectionKey = identifier;
      const targetSection =
        type === "video" ? manifestRecord.profile : manifestRecord.audio;

      if (!targetSection[sectionKey]) {
        targetSection[sectionKey] = {};
      }

      // Check if already exists to avoid redundant counting
      if (targetSection[sectionKey][originalManifestFileName]) {
        return targetSection[sectionKey][originalManifestFileName]
          .manifestNumber;
      }

      // Calculate the next manifest number
      const manifestNumber = Object.keys(targetSection[sectionKey]).length + 1;

      targetSection[sectionKey][originalManifestFileName] = {
        manifestNumber,
        timestamp: new Date().toISOString(),
        filename: originalManifestFileName,
      };

      await fs.writeJson(manifestRecordPath, manifestRecord, { spaces: 2 });
      console.log(
        `Updated manifestRecord.json for ${type} ${identifier}: ${originalManifestFileName} (Number: ${manifestNumber})`,
      );
      return manifestNumber;
    } catch (error) {
      console.error(
        `Error updating manifestRecord.json for scenario ${scenarioId}:`,
        error,
      );
      return null;
    }
  }

  /**
   * Rewrite manifest content but only rewrite the last N segments to local URLs
   * This preserves the exact structure and line count of the original manifest
   */
  rewriteManifestContentWithLastNSegments(
    originalContent,
    segmentMap,
    scenarioId,
    lastNSegments = 6,
  ) {
    const lines = originalContent.split("\n");
    const rewrittenLines = [];

    // First pass: identify all segment URLs and their positions
    const segmentPositions = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (trimmed && !trimmed.startsWith("#")) {
        // This is a segment URL
        segmentPositions.push(i);
      }
    }

    // Calculate which segments should be rewritten (last N)
    const totalSegments = segmentPositions.length;
    const startRewriteIndex = Math.max(0, totalSegments - lastNSegments);
    const segmentsToRewrite = segmentPositions.slice(startRewriteIndex);

    console.log(
      `Rewriting last ${Math.min(lastNSegments, totalSegments)} of ${totalSegments} segments`,
    );

    // Second pass: rewrite only the specified segments
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (segmentsToRewrite.includes(i)) {
        // This is one of the last N segments - rewrite it
        const originalFileName = path.basename(trimmed);
        const newFileName = segmentMap[originalFileName];

        if (newFileName) {
          // Use relative URL pointing to the backend API endpoint
          const relativeUrl = `../../media/video/${newFileName}`;
          rewrittenLines.push(relativeUrl);
          console.log(`Rewrote segment: ${originalFileName} → ${newFileName}`);
        } else {
          // Keep original URL if not in segment map
          rewrittenLines.push(line);
          console.log(`Keeping original URL (not in map): ${originalFileName}`);
        }
      } else {
        // Keep all other lines exactly as they are (including non-rewritten segments)
        rewrittenLines.push(line);
      }
    }

    return rewrittenLines.join("\n");
  }

  rewriteManifestContentForLivestream(originalContent, segmentMap, scenarioId) {
    // Use the same last-N-segments logic but preserve livestream format
    return this.rewriteManifestContentWithLastNSegments(
      originalContent,
      segmentMap,
      scenarioId,
      6,
    );
  }

  parseManifestSegments(manifestContent, baseUrl) {
    const lines = manifestContent.split("\n");
    const segments = [];
    let mediaSequence = 0;

    // Extract media sequence
    const mediaSequenceMatch = manifestContent.match(
      /#EXT-X-MEDIA-SEQUENCE:(\d+)/,
    );
    if (mediaSequenceMatch) {
      mediaSequence = parseInt(mediaSequenceMatch[1]);
    }

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        segments.push({
          sourceUri: this.resolveUrl(trimmed, baseUrl),
        });
      }
    }

    return { segments, mediaSequence };
  }

  extractProfileUrl(masterContent, profileNumber, baseUrl) {
    const lines = masterContent.split("\n");
    let profileIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith("#EXT-X-STREAM-INF")) {
        if (profileIndex === profileNumber) {
          const nextLine = lines[i + 1]?.trim();
          if (nextLine && !nextLine.startsWith("#")) {
            return this.resolveUrl(nextLine, baseUrl);
          }
        }
        profileIndex++;
      }
    }
    return null;
  }

  resolveUrl(url, baseUrl) {
    if (url.startsWith("http")) {
      return url;
    }

    const base = new URL(baseUrl);
    return new URL(url, base).href;
  }

  async updateManifestsIncremental(scenarioId, profileNumber) {
    try {
      const scenarioPath = path.join(__dirname, "../hls", scenarioId);
      const originalScenarioPath = path.join(
        __dirname,
        "../hls",
        `${scenarioId}_original`,
      );
      const segmentMapPath = path.join(scenarioPath, "segmentMap.json");
      const mainProfileDir = path.join(
        scenarioPath,
        "profiles",
        String(profileNumber),
      );
      const originalProfileDir = path.join(
        originalScenarioPath,
        "profiles",
        String(profileNumber),
      );

      // Load current segment map safely
      const segmentMap = await segmentMapService.readSegmentMap(scenarioPath);

      if (Object.keys(segmentMap).length === 0) {
        console.log("No segments in map yet, skipping manifest update");
        return; // No segments yet
      }
      await fs.ensureDir(mainProfileDir);

      // Use timestamped manifests for livestream simulation instead of creating complete playlist
      if (await fs.pathExists(originalProfileDir)) {
        // Get the latest timestamped manifest from original folder
        const originalManifests = await fs.readdir(originalProfileDir);
        const timestampedManifestFiles = originalManifests.filter(
          (file) => file.endsWith(".m3u8") && /^\d+_/.test(file),
        );

        if (timestampedManifestFiles.length > 0) {
          // Sort by timestamp to get the latest
          const sortedManifests = timestampedManifestFiles.sort((a, b) => {
            const matchA = a.match(/^(\d+)_/);
            const matchB = b.match(/^(\d+)_/);

            if (!matchA || !matchB) {
              return 0;
            }

            const timestampA = parseInt(matchA[1]);
            const timestampB = parseInt(matchB[1]);
            return timestampB - timestampA; // Latest first
          });

          const latestOriginalFile = sortedManifests[0];
          const latestOriginalPath = path.join(
            originalProfileDir,
            latestOriginalFile,
          );
          const latestContent = await fs.readFile(latestOriginalPath, "utf8");

          // Rewrite manifest content for livestream (preserves sliding window)
          const rewrittenLatestContent =
            this.rewriteManifestContentForLivestream(
              latestContent,
              segmentMap,
              scenarioId,
            );

          const playlistPath = path.join(mainProfileDir, "playlist.m3u8");
          await fileOperationService.updatePlaylistSafely(
            playlistPath,
            rewrittenLatestContent,
          );

          console.log(
            `Updated livestream playlist from latest manifest: ${latestOriginalFile}`,
          );
        }
      }

      // Copy Profile 0 manifests to all other profiles (for master manifest compatibility)
      if (profileNumber === 0) {
        await this.copyProfile0ManifestsToOtherProfiles(
          scenarioId,
          scenarioPath,
        );
      }
    } catch (error) {
      console.error(
        `Error updating manifests incrementally for scenario ${scenarioId}:`,
        error,
      );
    }
  }

  async copyProfile0ManifestsToOtherProfiles(scenarioId, scenarioPath) {
    try {
      // Get profile count from scenario details
      const detailsPath = path.join(scenarioPath, "details.json");
      if (!(await fs.pathExists(detailsPath))) {
        return;
      }

      const details = await fs.readJson(detailsPath);
      const profileCount = details.profileCount || 5;

      if (profileCount <= 1) {
        return; // Only 1 profile, no copying needed
      }

      const profile0Dir = path.join(scenarioPath, "profiles", "0");
      if (!(await fs.pathExists(profile0Dir))) {
        return; // Profile 0 doesn't exist yet
      }

      // Get manifest files from Profile 0
      const profile0Files = await fs.readdir(profile0Dir);
      const manifestFiles = profile0Files.filter((file) =>
        file.endsWith(".m3u8"),
      );

      // Copy to other profiles (1, 2, 3, etc.)
      for (
        let targetProfile = 1;
        targetProfile < profileCount;
        targetProfile++
      ) {
        const targetProfileDir = path.join(
          scenarioPath,
          "profiles",
          String(targetProfile),
        );
        await fs.ensureDir(targetProfileDir);

        for (const manifestFile of manifestFiles) {
          const sourcePath = path.join(profile0Dir, manifestFile);

          // Update filename for target profile
          let targetFilename = manifestFile;
          const timestampedMatch = manifestFile.match(
            /^(\d+)-0-(\d{2})-(\d{2})-(\d{2})\.m3u8$/,
          );
          if (timestampedMatch) {
            const [, timestamp, hours, minutes, seconds] = timestampedMatch;
            targetFilename = `${timestamp}-${targetProfile}-${hours}-${minutes}-${seconds}.m3u8`;
          }
          // For playlist.m3u8, keep the same name and content (segments are shared)

          const targetPath = path.join(targetProfileDir, targetFilename);

          // Remove existing file if it exists to avoid copy conflicts
          if (await fs.pathExists(targetPath)) {
            await fs.remove(targetPath);
          }

          // Now copy the file
          await fs.copy(sourcePath, targetPath);
        }

        console.log(
          `Copied ${manifestFiles.length} manifests to Profile ${targetProfile}`,
        );
      }
    } catch (error) {
      console.error(
        `Error copying Profile 0 manifests to other profiles:`,
        error,
      );
    }
  }

  async updateSegmentMappingIncremental(scenarioId, originalFileName) {
    try {
      const scenarioPath = path.join(__dirname, "../hls", scenarioId);
      const originalScenarioPath = path.join(
        __dirname,
        "../hls",
        `${scenarioId}_original`,
      );
      const mainVideoDir = path.join(scenarioPath, "media/video");
      const originalVideoDir = path.join(originalScenarioPath, "media/video");

      // Ensure main video directory exists
      await fs.ensureDir(mainVideoDir);

      // Load existing segment map safely
      const segmentMap = await segmentMapService.readSegmentMap(scenarioPath);

      // Check if this segment is already mapped (prevent duplicates)
      if (segmentMap[originalFileName]) {
        console.log(`Segment already mapped, skipping: ${originalFileName}`);
        return; // Already mapped
      }

      // Get all segments from the current manifest to determine if this is one of the last 6
      const currentManifestSegments =
        await this.getCurrentManifestSegments(scenarioId);
      const segmentIndex = currentManifestSegments.findIndex((seg) =>
        seg.includes(originalFileName),
      );
      const totalSegments = currentManifestSegments.length;
      const isLastSixSegment = segmentIndex >= totalSegments - 6;

      let newFileName;
      let shouldCopySegment = false;

      if (isLastSixSegment) {
        // This is one of the last 6 segments - rename it to 1.ts, 2.ts, etc.
        const positionInLastSix = segmentIndex - (totalSegments - 6) + 1; // 1-based
        newFileName = `${positionInLastSix}.ts`;
        shouldCopySegment = true;
      } else {
        // This is not one of the last 6 segments - keep original filename but copy it
        newFileName = originalFileName;
        shouldCopySegment = true;
      }

      const originalPath = path.join(originalVideoDir, originalFileName);
      const newPath = path.join(mainVideoDir, newFileName);

      // Copy segment if it doesn't exist
      if (
        shouldCopySegment &&
        (await fs.pathExists(originalPath)) &&
        !(await fs.pathExists(newPath))
      ) {
        await fileOperationService.safeCopy(originalPath, newPath);
        console.log(`Copied segment: ${originalFileName} → ${newFileName}`);
      }

      // Add segment to map safely
      await segmentMapService.addSegment(
        scenarioPath,
        originalFileName,
        newFileName,
      );

      console.log(
        `Updated segment mapping: ${originalFileName} → ${newFileName} (total: ${Object.keys(segmentMap).length + 1})`,
      );
    } catch (error) {
      console.error(
        `Error updating segment mapping for ${originalFileName}:`,
        error,
      );
    }
  }

  /**
   * Get segments from the current manifest being processed
   */
  async getCurrentManifestSegments(scenarioId) {
    try {
      // This is a simplified approach - in a real implementation, you'd track the current manifest
      // For now, we'll assume segments are processed in order and use a simple heuristic
      const scenarioPath = path.join(__dirname, "../hls", scenarioId);
      const segmentMap = await segmentMapService.readSegmentMap(scenarioPath);

      // Return all segments we've seen so far (this is a simplification)
      return Object.keys(segmentMap);
    } catch (error) {
      console.error(`Error getting current manifest segments:`, error);
      return [];
    }
  }

  /**
   * Load segmentRecord.json to track downloaded segments persistently
   * Non-blocking operation that returns a Set of downloaded segment names
   */
  async loadSegmentRecord(scenarioId) {
    try {
      const scenarioPath = path.join(
        __dirname,
        "../hls",
        `${scenarioId}_original`,
      );
      const segmentRecordPath = path.join(scenarioPath, "segmentRecord.json");

      if (await fs.pathExists(segmentRecordPath)) {
        const segmentRecord = await fs.readJson(segmentRecordPath);

        // Handle both old array format and new object format
        if (Array.isArray(segmentRecord.downloadedSegments)) {
          // Old format - return as Set
          return new Set(segmentRecord.downloadedSegments);
        } else if (
          segmentRecord.downloadedSegments &&
          typeof segmentRecord.downloadedSegments === "object"
        ) {
          // New format - return keys as Set
          return new Set(Object.keys(segmentRecord.downloadedSegments));
        }

        return new Set();
      }

      return new Set();
    } catch (error) {
      console.error(
        `Error loading segmentRecord.json for ${scenarioId}:`,
        error,
      );
      return new Set(); // Return empty set on error
    }
  }

  /**
   * Update segmentRecord.json with newly downloaded segment (non-blocking)
   * Uses setImmediate to ensure this doesn't block the download process
   */
  async updateSegmentRecord(scenarioId, segmentName, segmentType = "video") {
    setImmediate(async () => {
      try {
        const scenarioPath = path.join(
          __dirname,
          "../hls",
          `${scenarioId}_original`,
        );
        const segmentRecordPath = path.join(scenarioPath, "segmentRecord.json");

        // Load existing record
        let segmentRecord = { downloadedSegments: {} };
        if (await fs.pathExists(segmentRecordPath)) {
          const existingRecord = await fs.readJson(segmentRecordPath);

          // Handle migration from array format to object format
          if (Array.isArray(existingRecord.downloadedSegments)) {
            // Convert array to object format, assuming all existing segments are video
            segmentRecord.downloadedSegments = {};
            for (const segment of existingRecord.downloadedSegments) {
              segmentRecord.downloadedSegments[segment] = "video";
            }
          } else if (
            existingRecord.downloadedSegments &&
            typeof existingRecord.downloadedSegments === "object"
          ) {
            segmentRecord = existingRecord;
          }
        }

        // Ensure downloadedSegments is an object
        if (
          !segmentRecord.downloadedSegments ||
          typeof segmentRecord.downloadedSegments !== "object"
        ) {
          segmentRecord.downloadedSegments = {};
        }

        // Add segment with type if not already present
        if (!segmentRecord.downloadedSegments[segmentName]) {
          segmentRecord.downloadedSegments[segmentName] = segmentType;

          // Save updated record
          await fs.writeJson(segmentRecordPath, segmentRecord, { spaces: 2 });
          console.log(
            `Updated segmentRecord.json: Added ${segmentName} (${segmentType}) (total: ${Object.keys(segmentRecord.downloadedSegments).length})`,
          );
        }
      } catch (error) {
        console.error(
          `Error updating segmentRecord.json for ${scenarioId}:`,
          error,
        );
      }
    });
  }

  /**
   * Initialize segmentRecord.json from in-memory data on server restart
   * This ensures persistence across server restarts
   */
  async initializeSegmentRecord(scenarioId) {
    try {
      const downloadInfo = this.activeDownloads.get(scenarioId);
      if (!downloadInfo) return;

      const segmentRecord = await this.loadSegmentRecord(scenarioId);

      // Load segmentRecord into in-memory set
      for (const segmentName of segmentRecord) {
        downloadInfo.downloadedSegments.add(segmentName);
      }

      console.log(
        `Loaded ${segmentRecord.size} segments from segmentRecord.json into memory for ${scenarioId}`,
      );
    } catch (error) {
      console.error(
        `Error initializing segmentRecord for ${scenarioId}:`,
        error,
      );
    }
  }

  /**
   * Load first manifest segments from persistent storage
   * Returns a Set of segment URIs (full paths) that were in the first manifest
   */
  async loadFirstManifestSegments(scenarioId) {
    try {
      const scenarioPath = path.join(
        __dirname,
        "../hls",
        `${scenarioId}_original`,
      );
      const firstManifestSegmentsPath = path.join(
        scenarioPath,
        "firstManifestSegments.json",
      );

      if (await fs.pathExists(firstManifestSegmentsPath)) {
        const data = await fs.readJson(firstManifestSegmentsPath);
        return new Set(data.segments || []);
      }

      return new Set();
    } catch (error) {
      console.error(
        `Error loading firstManifestSegments.json for ${scenarioId}:`,
        error,
      );
      return new Set();
    }
  }

  /**
   * Save first manifest segments to persistent storage
   * Stores the full segment URIs from the first manifest to prevent downloading them later
   */
  async saveFirstManifestSegments(scenarioId, segmentsSet) {
    try {
      const scenarioPath = path.join(
        __dirname,
        "../hls",
        `${scenarioId}_original`,
      );
      const firstManifestSegmentsPath = path.join(
        scenarioPath,
        "firstManifestSegments.json",
      );

      const data = {
        segments: Array.from(segmentsSet),
        createdAt: new Date().toISOString(),
        description:
          "Full segment URIs from the first manifest - used to prevent downloading overlapping segments from subsequent manifests. URIs include full paths to handle duplicate filenames in different directories.",
      };

      await fs.writeJson(firstManifestSegmentsPath, data, { spaces: 2 });
      console.log(
        `Saved firstManifestSegments.json: ${segmentsSet.size} segments tracked`,
      );
    } catch (error) {
      console.error(
        `Error saving firstManifestSegments.json for ${scenarioId}:`,
        error,
      );
    }
  }

  /**
   * Load first audio manifest segments from persistent storage
   * Returns a Set of segment names that were in the first audio manifest for a specific variant
   */
  async loadFirstAudioManifestSegments(scenarioId, audioVariantName) {
    try {
      const scenarioPath = path.join(
        __dirname,
        "../hls",
        `${scenarioId}_original`,
      );
      const firstAudioManifestSegmentsPath = path.join(
        scenarioPath,
        `firstAudioManifestSegments_${audioVariantName}.json`,
      );

      if (await fs.pathExists(firstAudioManifestSegmentsPath)) {
        const data = await fs.readJson(firstAudioManifestSegmentsPath);
        return new Set(data.segments || []);
      }

      return new Set();
    } catch (error) {
      console.error(
        `Error loading firstAudioManifestSegments.json for ${scenarioId} variant ${audioVariantName}:`,
        error,
      );
      return new Set();
    }
  }

  /**
   * Save first audio manifest segments to persistent storage
   * Stores the segments that were in the first audio manifest to prevent downloading them later
   */
  async saveFirstAudioManifestSegments(
    scenarioId,
    audioVariantName,
    segmentsSet,
  ) {
    try {
      const scenarioPath = path.join(
        __dirname,
        "../hls",
        `${scenarioId}_original`,
      );
      const firstAudioManifestSegmentsPath = path.join(
        scenarioPath,
        `firstAudioManifestSegments_${audioVariantName}.json`,
      );

      const data = {
        segments: Array.from(segmentsSet),
        audioVariantName: audioVariantName,
        createdAt: new Date().toISOString(),
        description:
          "Audio segments from the first manifest - used to prevent downloading overlapping segments from subsequent manifests",
      };

      await fs.writeJson(firstAudioManifestSegmentsPath, data, { spaces: 2 });
      console.log(
        `Saved firstAudioManifestSegments_${audioVariantName}.json: ${segmentsSet.size} audio segments tracked`,
      );
    } catch (error) {
      console.error(
        `Error saving firstAudioManifestSegments.json for ${scenarioId} variant ${audioVariantName}:`,
        error,
      );
    }
  }

  /**
   * Clean up first manifest tracking files to ensure fresh start
   * This should be called when starting a new download to reset the first manifest detection
   */
  async cleanupFirstManifestTracking(scenarioId) {
    try {
      const scenarioPath = path.join(
        __dirname,
        "../hls",
        `${scenarioId}_original`,
      );

      // Remove video first manifest tracking
      const firstManifestSegmentsPath = path.join(
        scenarioPath,
        "firstManifestSegments.json",
      );
      if (await fs.pathExists(firstManifestSegmentsPath)) {
        await fs.remove(firstManifestSegmentsPath);
        console.log(`Cleaned up firstManifestSegments.json for fresh start`);
      }

      // Remove audio first manifest tracking files (all variants)
      const files = await fs.readdir(scenarioPath).catch(() => []);
      for (const file of files) {
        if (
          file.startsWith("firstAudioManifestSegments_") &&
          file.endsWith(".json")
        ) {
          const filePath = path.join(scenarioPath, file);
          await fs.remove(filePath);
          console.log(`Cleaned up ${file} for fresh start`);
        }
      }
    } catch (error) {
      console.error(
        `Error cleaning up first manifest tracking for ${scenarioId}:`,
        error,
      );
      // Don't throw - this is not critical for the download to proceed
    }
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getActiveDownloads() {
    return Array.from(this.activeDownloads.values()).map((info) => ({
      scenarioId: info.scenarioId,
      profileNumber: info.profileNumber,
      maxSegmentsPerFetch: info.maxSegmentsPerFetch,
      segmentCount: info.downloadedSegments.size,
      startTime: info.startTime,
      isActive: info.isRunning,
      targetDuration: info.targetDuration,
      consecutiveErrors: info.consecutiveErrors,
      backgroundDownloadsActive: info.backgroundDownloadsActive || 0,
    }));
  }

  async copyProfile0ToAllProfiles(scenarioId, scenarioPath) {
    try {
      console.log(
        `Copying Profile 0 manifests to all other profiles for scenario ${scenarioId}`,
      );

      // Get profile count from scenario details
      const detailsPath = path.join(scenarioPath, "details.json");
      if (!(await fs.pathExists(detailsPath))) {
        console.log("No details.json found, skipping profile copying");
        return;
      }

      const details = await fs.readJson(detailsPath);
      const profileCount = details.profileCount || 5;

      // Only proceed if we have more than 1 profile
      if (profileCount <= 1) {
        console.log("Only 1 profile detected, no copying needed");
        return;
      }

      console.log(
        `Found ${profileCount} profiles, copying Profile 0 to profiles 1-${profileCount - 1}`,
      );

      // Check if Profile 0 directory exists
      const profile0Dir = path.join(scenarioPath, "profiles", "0");
      if (!(await fs.pathExists(profile0Dir))) {
        console.log("Profile 0 directory not found, skipping profile copying");
        return;
      }

      // Get all manifest files from Profile 0
      const profile0Files = await fs.readdir(profile0Dir);
      const manifestFiles = profile0Files.filter((file) =>
        file.endsWith(".m3u8"),
      );

      if (manifestFiles.length === 0) {
        console.log(
          "No manifest files found in Profile 0, skipping profile copying",
        );
        return;
      }

      console.log(
        `Found ${manifestFiles.length} manifest files in Profile 0 to copy`,
      );

      // Copy to all other profiles (1, 2, 3, etc.)
      for (
        let targetProfile = 1;
        targetProfile < profileCount;
        targetProfile++
      ) {
        const targetProfileDir = path.join(
          scenarioPath,
          "profiles",
          String(targetProfile),
        );

        // Ensure target profile directory exists
        await fs.ensureDir(targetProfileDir);

        console.log(`Copying manifests to Profile ${targetProfile}`);

        // Copy each manifest file with updated profile number in filename
        let successCount = 0;
        let failCount = 0;

        for (const manifestFile of manifestFiles) {
          try {
            const sourcePath = path.join(profile0Dir, manifestFile);

            // Update filename: change profile number from 0 to target profile
            let targetFilename = manifestFile;

            // Handle timestamped manifests: [timestamp]-0-[hh]-[mm]-[ss].m3u8
            const timestampedMatch = manifestFile.match(
              /^(\d+)-0-(\d{2})-(\d{2})-(\d{2})\.m3u8$/,
            );
            if (timestampedMatch) {
              const [, timestamp, hours, minutes, seconds] = timestampedMatch;
              targetFilename = `${timestamp}-${targetProfile}-${hours}-${minutes}-${seconds}.m3u8`;
            }

            const targetPath = path.join(targetProfileDir, targetFilename);

            // Copy directly to the correct filename
            await fileOperationService.safeCopy(sourcePath, targetPath);
            console.log(`  Copied: ${manifestFile} → ${targetFilename}`);
            successCount++;
          } catch (error) {
            console.warn(
              `Failed to copy ${manifestFile} to Profile ${targetProfile}:`,
              error.message,
            );
            failCount++;
          }
        }

        if (failCount > 0) {
          console.warn(
            `Failed to copy ${failCount} files to Profile ${targetProfile}`,
          );
        }

        console.log(
          `Successfully copied ${successCount} manifests to Profile ${targetProfile}`,
        );
      }

      // Update manifestMap.json to include all profiles
      await this.updateManifestMapForAllProfiles(scenarioPath, profileCount);

      console.log(
        `Successfully copied Profile 0 manifests to all ${profileCount - 1} other profiles`,
      );
    } catch (error) {
      console.error(
        `Error copying Profile 0 to all profiles for scenario ${scenarioId}:`,
        error.message,
      );
      // Don't throw error - profile copying is not critical for basic functionality
      console.log("Continuing despite profile copying errors...");
    }
  }

  async updateManifestMapForAllProfiles(scenarioPath, profileCount) {
    try {
      const manifestMapPath = path.join(scenarioPath, "manifestMap.json");
      let manifestMap = {};

      // Load existing manifest map (should have Profile 0 data)
      if (await fs.pathExists(manifestMapPath)) {
        manifestMap = await fs.readJson(manifestMapPath);
      }

      // If Profile 0 exists in the map, copy its structure to all other profiles
      if (manifestMap.profile && manifestMap.profile["0"]) {
        console.log("Updating manifestMap.json for all profiles");

        for (
          let targetProfile = 1;
          targetProfile < profileCount;
          targetProfile++
        ) {
          // Copy Profile 0 structure but update filenames
          manifestMap.profile[String(targetProfile)] = {};

          for (const [originalFilename, mapping] of Object.entries(
            manifestMap.profile["0"],
          )) {
            // Update the rewritten filename to use the correct profile number
            const originalRewrittenFilename = mapping.rewrittenFilename;
            let newRewrittenFilename = originalRewrittenFilename;

            // Update timestamped manifest filenames
            const timestampedMatch = originalRewrittenFilename.match(
              /^(\d+)-0-(\d{2})-(\d{2})-(\d{2})\.m3u8$/,
            );
            if (timestampedMatch) {
              const [, timestamp, hours, minutes, seconds] = timestampedMatch;
              newRewrittenFilename = `${timestamp}-${targetProfile}-${hours}-${minutes}-${seconds}.m3u8`;
            }

            manifestMap.profile[String(targetProfile)][originalFilename] = {
              ...mapping,
              rewrittenFilename: newRewrittenFilename,
              profileNumber: targetProfile,
              repeat: mapping.repeat || 0,
            };
          }
        }

        // Save updated manifest map
        await fs.writeJson(manifestMapPath, manifestMap, { spaces: 2 });
        console.log(`Updated manifestMap.json with ${profileCount} profiles`);
      } else {
        console.log(
          "No Profile 0 data found in manifestMap.json, skipping update",
        );
      }
    } catch (error) {
      console.error("Error updating manifestMap.json for all profiles:", error);
      throw error;
    }
  }

  /**
   * Rewrite a single manifest file selectivly (used for reset functionality)
   */
  async rewriteSingleManifest(
    scenarioId,
    originalManifestFileName,
    type,
    identifier,
    targetPath,
  ) {
    try {
      const originalScenarioPath = path.join(
        __dirname,
        "../hls",
        `${scenarioId}_original`,
      );
      const scenarioPath = path.join(__dirname, "../hls", scenarioId);
      const manifestRecordPath = path.join(
        originalScenarioPath,
        "manifestRecord.json",
      );

      if (!(await fs.pathExists(manifestRecordPath))) {
        throw new Error("manifestRecord.json not found in original folder");
      }

      const manifestRecord = await fs.readJson(manifestRecordPath);
      const section =
        type === "video" ? manifestRecord.profile : manifestRecord.audio;

      // Fallback logic for identifier: many profiles rely on profile 0 as template
      let sourceIdentifier = identifier;
      if (!section?.[sourceIdentifier]?.[originalManifestFileName]) {
        if (type === "video" && section?.["0"]?.[originalManifestFileName]) {
          console.log(
            `Fallback: Using Profile 0 as template for Profile ${identifier}`,
          );
          sourceIdentifier = "0";
        } else if (type === "audio") {
          // Find any available variant that has this manifest recorded
          const availableVariant = Object.keys(section || {}).find(
            (v) => section[v][originalManifestFileName],
          );
          if (availableVariant) {
            console.log(
              `Fallback: Using Audio variant ${availableVariant} as template for ${identifier}`,
            );
            sourceIdentifier = availableVariant;
          }
        }
      }

      const record = section?.[sourceIdentifier]?.[originalManifestFileName];

      if (!record) {
        throw new Error(
          `Manifest record not found for ${originalManifestFileName} in ${type} ${identifier} (or fallback ${sourceIdentifier})`,
        );
      }

      const manifestNumber = record.manifestNumber;
      const isVideo = type === "video";

      const segmentMapFile = isVideo
        ? "segmentMap.json"
        : "audioSegmentMap.json";
      const segmentMapPath = path.join(scenarioPath, segmentMapFile);

      if (!(await fs.pathExists(segmentMapPath))) {
        throw new Error(`${segmentMapFile} not found`);
      }

      const segmentMap = await fs.readJson(segmentMapPath);

      const subDir = isVideo ? "profiles" : "audio";
      let originalPath = path.join(
        originalScenarioPath,
        subDir,
        String(sourceIdentifier),
        originalManifestFileName,
      );

      // Final filesystem fallback check
      if (!(await fs.pathExists(originalPath))) {
        if (isVideo && sourceIdentifier !== "0") {
          const fallbackPath = path.join(
            originalScenarioPath,
            subDir,
            "0",
            originalManifestFileName,
          );
          if (await fs.pathExists(fallbackPath)) {
            originalPath = fallbackPath;
            console.log(
              `Filesystem Fallback: Found original manifest in Profile 0 for ${identifier}`,
            );
          }
        }
      }

      if (!(await fs.pathExists(originalPath))) {
        throw new Error(`Original manifest file not found: ${originalPath}`);
      }

      const originalContent = await fs.readFile(originalPath, "utf8");

      let rewrittenContent;
      if (isVideo) {
        if (manifestNumber === 1) {
          rewrittenContent = this.rewriteFirstManifestSelectively(
            originalContent,
            segmentMap,
          );
        } else {
          rewrittenContent = this.rewriteSubsequentManifestSelectivelyFixed(
            originalContent,
            segmentMap,
          );
        }
      } else {
        if (manifestNumber === 1) {
          rewrittenContent = this.rewriteFirstAudioManifestSelectively(
            originalContent,
            segmentMap,
          );
        } else {
          rewrittenContent = this.rewriteSubsequentAudioManifestSelectively(
            originalContent,
            segmentMap,
          );
        }
      }

      await fs.writeFile(targetPath, rewrittenContent);
      console.log(
        `Successfully reset manifest ${originalManifestFileName} (source ${sourceIdentifier}) to ${targetPath}`,
      );
      return true;
    } catch (error) {
      console.error(
        `Error rewriting single manifest ${originalManifestFileName}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * NEW SELECTIVE REWRITING PROCESS
   *
   * This implements the new selective rewriting logic:
   * 1. First manifest: Only rename and rewrite URLs for the last 6 segments (1.ts to 6.ts)
   * 2. Subsequent manifests: Only rewrite new segments that appear, continuing numbering
   * 3. Maintain segmentMap.json with original -> rewritten filename mappings
   * 4. Keep manifest progression identical to original except for rewritten segments
   */
  async processSelectiveRewriting(scenarioId, profileNumber) {
    try {
      console.log(
        `Starting selective rewriting process for scenario ${scenarioId}`,
      );

      const scenarioPath = path.join(__dirname, "../hls", scenarioId);
      const originalScenarioPath = path.join(
        __dirname,
        "../hls",
        `${scenarioId}_original`,
      );

      // Clean up any existing mixed state first
      await this.cleanupMixedState(scenarioPath);

      // Ensure main scenario folder structure exists
      await fs.ensureDir(path.join(scenarioPath, "master"));
      await fs.ensureDir(path.join(scenarioPath, "media/video"));
      await fs.ensureDir(path.join(scenarioPath, "media/audio"));
      await fs.ensureDir(path.join(scenarioPath, "profiles"));

      // Copy master manifest to main folder
      const originalMasterPath = path.join(
        originalScenarioPath,
        "master/master.m3u8",
      );
      const mainMasterPath = path.join(scenarioPath, "master/master.m3u8");

      if (await fs.pathExists(originalMasterPath)) {
        await fs.copy(originalMasterPath, mainMasterPath);
      }

      // Process selective segment renaming and manifest rewriting
      await this.processSelectiveSegmentRenaming(
        scenarioId,
        originalScenarioPath,
        scenarioPath,
      );

      await this.processSelectiveManifestRewriting(
        scenarioId,
        originalScenarioPath,
        scenarioPath,
        profileNumber,
      );

      // Process audio selective segment renaming and manifest rewriting (if audio exists)
      await this.processSelectiveAudioSegmentRenaming(
        scenarioId,
        originalScenarioPath,
        scenarioPath,
      );

      await this.processSelectiveAudioManifestRewriting(
        scenarioId,
        originalScenarioPath,
        scenarioPath,
      );

      // Copy Profile 0 manifests to all other profiles for master manifest compatibility
      await this.copyProfile0ToAllProfiles(scenarioId, scenarioPath);

      // Copy selected audio variant manifests to all other audio variants
      await this.copySelectedAudioVariantToAllVariants(
        scenarioId,
        scenarioPath,
      );

      // Rewrite master manifest
      const masterRewriter = require("./rewriteMaster");
      await masterRewriter.rewriteMasterForScenario(scenarioId, false);

      // Initialize live streaming for this scenario
      await this.initializeLiveStreamingForScenario(scenarioId, profileNumber);

      console.log(
        `Successfully completed selective rewriting for scenario ${scenarioId}`,
      );
    } catch (error) {
      console.error(
        `Error in selective rewriting for scenario ${scenarioId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Clean up any existing mixed state in the main scenario directory
   * This ensures we start with a clean slate for the rewriting process
   */
  async cleanupMixedState(scenarioPath) {
    try {
      console.log("Cleaning up any existing mixed state...");

      // Remove existing rewritten content to start fresh
      const dirsToClean = [
        path.join(scenarioPath, "media/video"),
        path.join(scenarioPath, "media/audio"),
        path.join(scenarioPath, "profiles"),
        path.join(scenarioPath, "audio"),
      ];

      for (const dir of dirsToClean) {
        if (await fs.pathExists(dir)) {
          await fs.remove(dir);
          console.log(`Cleaned directory: ${path.relative(scenarioPath, dir)}`);
        }
      }

      // Remove existing mapping files to start fresh
      const filesToClean = [
        path.join(scenarioPath, "segmentMap.json"),
        path.join(scenarioPath, "audioSegmentMap.json"),
        path.join(scenarioPath, "manifestMap.json"),
      ];

      for (const file of filesToClean) {
        if (await fs.pathExists(file)) {
          await fs.remove(file);
          console.log(`Cleaned file: ${path.relative(scenarioPath, file)}`);
        }
      }

      console.log("Mixed state cleanup completed");
    } catch (error) {
      console.error("Error during mixed state cleanup:", error);
      // Don't throw - this is cleanup, continue with the process
    }
  }

  /**
   * Selective segment renaming - only rename segments that were actually downloaded and kept after cleanup
   * This function should only copy segments that exist in segmentRecord.json after cleanup
   */
  async processSelectiveSegmentRenaming(
    scenarioId,
    originalScenarioPath,
    scenarioPath,
  ) {
    try {
      const originalVideoDir = path.join(originalScenarioPath, "media/video");
      const mainVideoDir = path.join(scenarioPath, "media/video");

      if (!(await fs.pathExists(originalVideoDir))) {
        console.log("No original video segments found");
        return;
      }

      // Get ALL manifests to identify segments that will be rewritten
      const profileDir = path.join(originalScenarioPath, "profiles", "0");
      if (!(await fs.pathExists(profileDir))) {
        console.log("No profile 0 directory found");
        return;
      }

      const manifestFiles = await fs.readdir(profileDir);
      const m3u8Files = manifestFiles.filter(
        (f) => f.endsWith(".m3u8") && f !== "playlist.m3u8",
      );

      if (m3u8Files.length === 0) {
        console.log("No manifest files found");
        return;
      }

      // Sort manifests chronologically
      m3u8Files.sort();

      // Get the segment limit from scenario details
      const detailsPath = path.join(scenarioPath, "details.json");
      let segmentLimit = 6; // Default to 6
      if (await fs.pathExists(detailsPath)) {
        const details = await fs.readJson(detailsPath);
        segmentLimit = details.maxSegmentsToDownload || 6;
      }

      console.log(`Using segment limit: ${segmentLimit} for rewriting`);

      // Collect segments in chronological order as they first appear in the last N positions
      const segmentsToRewrite = [];
      const seenSegments = new Set();

      for (const manifestFile of m3u8Files) {
        const manifestPath = path.join(profileDir, manifestFile);
        const manifestContent = await fs.readFile(manifestPath, "utf8");
        const lines = manifestContent.split("\n");

        // Extract segment URLs from this manifest
        const segmentLines = [];
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith("#")) {
            segmentLines.push(path.basename(trimmed));
          }
        }

        // Get the last N segments from this manifest (or all if less than N)
        const lastNSegments = segmentLines.slice(-segmentLimit);

        // Add new segments in the order they first appear
        for (const segment of lastNSegments) {
          if (!seenSegments.has(segment)) {
            segmentsToRewrite.push(segment);
            seenSegments.add(segment);
          }
        }
      }

      console.log(
        `Found ${segmentsToRewrite.length} unique segments to rewrite in chronological order`,
      );

      // Ensure main video directory is clean
      if (await fs.pathExists(mainVideoDir)) {
        await fs.remove(mainVideoDir);
      }
      await fs.ensureDir(mainVideoDir);

      // Create segment mapping - copy and number segments in chronological order
      const segmentMap = {};
      let segmentCounter = 1;

      for (const originalFileName of segmentsToRewrite) {
        const originalPath = path.join(originalVideoDir, originalFileName);

        // Check if the segment file actually exists
        if (!(await fs.pathExists(originalPath))) {
          console.warn(`Segment file not found: ${originalFileName}, skipping`);
          continue;
        }

        const newFileName = `${segmentCounter}.ts`;
        const newPath = path.join(mainVideoDir, newFileName);

        // Copy segment with new name
        await fs.copy(originalPath, newPath);

        // Add to segment mapping - key is original filename, value is new filename
        segmentMap[originalFileName] = newFileName;

        console.log(
          `Renamed segment: ${originalFileName} → ${newFileName} (seq: ${segmentCounter})`,
        );
        segmentCounter++;
      }

      // Save segment mapping using the safe service
      await segmentMapService.writeSegmentMap(scenarioPath, segmentMap);

      console.log(
        `Processed ${Object.keys(segmentMap).length} segments and created segmentMap.json`,
      );
    } catch (error) {
      console.error("Error processing selective segment renaming:", error);
      throw error;
    }
  }

  /**
   * Get the path to the first manifest file for a given profile
   */
  async getFirstManifestPath(originalScenarioPath, profileNumber) {
    try {
      const profileDir = path.join(
        originalScenarioPath,
        "profiles",
        profileNumber.toString(),
      );

      if (!(await fs.pathExists(profileDir))) {
        return null;
      }

      const files = await fs.readdir(profileDir);
      const manifestFiles = files.filter(
        (f) => f.endsWith(".m3u8") && f !== "playlist.m3u8",
      );

      if (manifestFiles.length === 0) {
        return null;
      }

      // Sort to get the first (earliest) manifest
      manifestFiles.sort();
      return path.join(profileDir, manifestFiles[0]);
    } catch (error) {
      console.error("Error getting first manifest path:", error);
      return null;
    }
  }

  /**
   * Get the path to the first audio manifest file
   */
  async getFirstAudioManifestPath(originalScenarioPath) {
    try {
      // Check if audioInfo.json exists to get the audio variant name
      // audioInfo.json is in the main scenario directory, not the _original directory
      const scenarioPath = originalScenarioPath.replace("_original", "");
      const audioInfoPath = path.join(scenarioPath, "audioInfo.json");
      if (!(await fs.pathExists(audioInfoPath))) {
        return null;
      }

      const audioInfo = await fs.readJson(audioInfoPath);
      const audioVariantName = audioInfo.trackInfo.name;

      const audioDir = path.join(
        originalScenarioPath,
        "audio",
        audioVariantName,
      );

      if (!(await fs.pathExists(audioDir))) {
        return null;
      }

      const files = await fs.readdir(audioDir);
      const manifestFiles = files.filter(
        (f) => f.endsWith(".m3u8") && f !== "audio.m3u8",
      );

      if (manifestFiles.length === 0) {
        return null;
      }

      // Sort to get the first (earliest) manifest
      manifestFiles.sort();
      return path.join(audioDir, manifestFiles[0]);
    } catch (error) {
      console.error("Error getting first audio manifest path:", error);
      return null;
    }
  }

  /**
   * Selective manifest rewriting - implements the new logic:
   * - First manifest: Only rewrite last 6 segments, keep others unchanged
   * - Subsequent manifests: Only rewrite segments that exist in segmentMap, keep others unchanged
   */
  async processSelectiveManifestRewriting(
    scenarioId,
    originalScenarioPath,
    scenarioPath,
    profileNumber,
  ) {
    try {
      const originalProfileDir = path.join(
        originalScenarioPath,
        "profiles",
        String(profileNumber),
      );
      const mainProfileDir = path.join(
        scenarioPath,
        "profiles",
        String(profileNumber),
      );

      if (!(await fs.pathExists(originalProfileDir))) {
        console.log(`No original profile ${profileNumber} manifests found`);
        return;
      }

      // Load segment mapping
      const segmentMapPath = path.join(scenarioPath, "segmentMap.json");
      if (!(await fs.pathExists(segmentMapPath))) {
        console.log("No segmentMap.json found, cannot rewrite manifests");
        return;
      }

      const segmentMap = await fs.readJson(segmentMapPath);

      // Get the segment limit from scenario details
      const detailsPath = path.join(scenarioPath, "details.json");
      let segmentLimit = 6; // Default to 6
      if (await fs.pathExists(detailsPath)) {
        const details = await fs.readJson(detailsPath);
        segmentLimit = details.maxSegmentsToDownload || 6;
      }

      console.log(`Using segment limit: ${segmentLimit} for manifest rewriting`);

      // Get all original manifest files (timestamped versions only)
      const originalManifests = await fs.readdir(originalProfileDir);
      const timestampedManifestFiles = originalManifests.filter(
        (file) => file.endsWith(".m3u8") && /^\d+_/.test(file),
      );

      // Sort manifests by timestamp to process in order
      timestampedManifestFiles.sort((a, b) => {
        const timestampA = parseInt(a.split("_")[0]);
        const timestampB = parseInt(b.split("_")[0]);
        return timestampA - timestampB;
      });

      // Ensure main profile directory is clean
      if (await fs.pathExists(mainProfileDir)) {
        await fs.remove(mainProfileDir);
      }
      await fs.ensureDir(mainProfileDir);

      let isFirstManifest = true;

      for (const originalManifestFile of timestampedManifestFiles) {
        const originalManifestPath = path.join(
          originalProfileDir,
          originalManifestFile,
        );
        const originalContent = await fs.readFile(originalManifestPath, "utf8");

        // Extract timestamp from filename (format: timestamp_originalname.m3u8)
        const timestampMatch = originalManifestFile.match(/^(\d+)_(.+)$/);
        if (!timestampMatch) {
          console.log(
            `Skipping manifest with unexpected format: ${originalManifestFile}`,
          );
          continue;
        }

        const timestamp = timestampMatch[1];

        // Convert timestamp to date for proper formatting
        const date = new Date(parseInt(timestamp));
        const hours = String(date.getHours()).padStart(2, "0");
        const minutes = String(date.getMinutes()).padStart(2, "0");
        const seconds = String(date.getSeconds()).padStart(2, "0");

        // Create rewritten filename in the expected format
        const rewrittenManifestFilename = `${timestamp}-${profileNumber}-${hours}-${minutes}-${seconds}.m3u8`;

        // Apply selective rewriting logic
        let rewrittenContent;
        if (isFirstManifest) {
          // First manifest: Only rewrite last N segments
          rewrittenContent = this.rewriteFirstManifestSelectivelyWithLimit(
            originalContent,
            segmentMap,
            segmentLimit,
          );
          isFirstManifest = false;
        } else {
          // Subsequent manifests: Only rewrite segments that exist in segmentMap
          rewrittenContent = this.rewriteSubsequentManifestSelectivelyFixed(
            originalContent,
            segmentMap,
          );
        }

        // Save rewritten manifest
        const rewrittenManifestPath = path.join(
          mainProfileDir,
          rewrittenManifestFilename,
        );
        await fs.writeFile(rewrittenManifestPath, rewrittenContent);

        console.log(
          `Rewritten manifest: ${originalManifestFile} → ${rewrittenManifestFilename}`,
        );
      }

      // Update manifestMap.json with all the mappings
      await this.updateManifestMap(
        scenarioId,
        profileNumber,
        timestampedManifestFiles,
      );

      // Create playlist.m3u8 as the latest manifest
      if (timestampedManifestFiles.length > 0) {
        const latestOriginalFile =
          timestampedManifestFiles[timestampedManifestFiles.length - 1];
        const timestampMatch = latestOriginalFile.match(/^(\d+)_(.+)$/);
        if (timestampMatch) {
          const timestamp = timestampMatch[1];
          const date = new Date(parseInt(timestamp));
          const hours = String(date.getHours()).padStart(2, "0");
          const minutes = String(date.getMinutes()).padStart(2, "0");
          const seconds = String(date.getSeconds()).padStart(2, "0");

          const latestRewrittenFile = `${timestamp}-${profileNumber}-${hours}-${minutes}-${seconds}.m3u8`;
          const latestRewrittenPath = path.join(
            mainProfileDir,
            latestRewrittenFile,
          );
          const playlistPath = path.join(mainProfileDir, "playlist.m3u8");

          if (await fs.pathExists(latestRewrittenPath)) {
            await fs.copy(latestRewrittenPath, playlistPath);
          }
        }
      }

      console.log(
        `Processed ${timestampedManifestFiles.length} manifests with selective rewriting`,
      );
    } catch (error) {
      console.error("Error in selective manifest rewriting:", error);
      throw error;
    }
  }

  /**
   * Fixed version of subsequent manifest rewriting - only rewrite segments that exist in segmentMap
   * Do not try to add new segments or modify the segmentMap
   */
  rewriteSubsequentManifestSelectivelyFixed(originalContent, segmentMap) {
    const lines = originalContent.split("\n");
    const rewrittenLines = [];

    // Extract all segment lines with their positions
    const segmentLines = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line && !line.startsWith("#")) {
        segmentLines.push({
          lineIndex: i,
          segmentName: path.basename(line),
          originalLine: lines[i],
        });
      }
    }

    // For each unique segment name in segmentMap, find its LAST occurrence in the manifest
    // This handles duplicate filenames by only rewriting the live edge occurrence
    const segmentNameToLastIndex = new Map();
    for (const segmentLine of segmentLines) {
      if (segmentMap[segmentLine.segmentName]) {
        // This segment is in our map, track its last occurrence
        segmentNameToLastIndex.set(
          segmentLine.segmentName,
          segmentLine.lineIndex,
        );
      }
    }

    console.log(
      `Rewriting subsequent manifest: Total segments: ${segmentLines.length}, Segments to rewrite: ${segmentNameToLastIndex.size}`,
    );

    // Process each line
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (trimmed && !trimmed.startsWith("#")) {
        // This is a segment URL line
        const segmentName = path.basename(trimmed);

        // Only rewrite if this is the LAST occurrence of this segment name AND it exists in segmentMap
        const lastIndex = segmentNameToLastIndex.get(segmentName);
        if (lastIndex === i) {
          // This is the last occurrence of this segment - rewrite it
          const localSegmentName = segmentMap[segmentName];
          rewrittenLines.push(`../media/video/${localSegmentName}`);
          console.log(
            `  Line ${i}: Rewriting ${segmentName} -> ${localSegmentName} (last occurrence)`,
          );
        } else {
          // Either not in segmentMap, or not the last occurrence - keep original
          rewrittenLines.push(line);
        }
      } else {
        // Keep all other lines (headers, comments, etc.) unchanged
        rewrittenLines.push(line);
      }
    }

    return rewrittenLines.join("\n");
  }

  /**
   * Rewrite first manifest - only rewrite URLs for the last N segments
   * Keep all other segments unchanged in the manifest
   */
  rewriteFirstManifestSelectively(originalContent, segmentMap) {
    return this.rewriteFirstManifestSelectivelyGeneric(
      originalContent,
      segmentMap,
      "../media/video",
      6, // Default to 6 segments
    );
  }

  /**
   * Rewrite first manifest with custom segment limit
   */
  rewriteFirstManifestSelectivelyWithLimit(originalContent, segmentMap, segmentLimit) {
    return this.rewriteFirstManifestSelectivelyGeneric(
      originalContent,
      segmentMap,
      "../media/video",
      segmentLimit,
    );
  }

  /**
   * Generic function to rewrite first manifest - only rewrite URLs for the last N segments
   * Keep all other segments unchanged in the manifest
   *
   * @param {string} originalContent - Original manifest content
   * @param {Object} segmentMap - Mapping of original segment names to new names
   * @param {string} localPath - Local path prefix for segments (e.g., "../media/video" or "../../media/audio")
   * @param {number} segmentLimit - Number of segments to rewrite from the end (default: 6)
   */
  rewriteFirstManifestSelectivelyGeneric(
    originalContent,
    segmentMap,
    localPath,
    segmentLimit = 6,
  ) {
    const lines = originalContent.split("\n");
    const rewrittenLines = [];

    // First, extract all segment URLs from the manifest
    const segmentLines = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line && !line.startsWith("#")) {
        segmentLines.push({
          lineIndex: i,
          segmentName: path.basename(line),
          originalLine: lines[i],
        });
      }
    }

    // Get the last N segments that should be rewritten
    const lastNSegments = segmentLines.slice(-segmentLimit);
    // Use line indices instead of segment names to handle duplicate filenames
    const lineIndicesToRewrite = new Set(lastNSegments.map((s) => s.lineIndex));

    console.log(
      `Rewriting first manifest: Total segments: ${segmentLines.length}, Last ${segmentLimit} line indices: ${Array.from(lineIndicesToRewrite).join(", ")}`,
    );

    // Track which lines to skip (segments not in map and their preceding EXTINF lines)
    const linesToSkip = new Set();

    // First pass: identify segments to skip and their EXTINF lines
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (trimmed && !trimmed.startsWith("#")) {
        // This is a segment URL line
        const segmentName = path.basename(trimmed);

        // If this is one of the last N segments but NOT in the segment map, skip it
        if (lineIndicesToRewrite.has(i) && !segmentMap[segmentName]) {
          linesToSkip.add(i); // Skip the segment line
          // Also skip the preceding EXTINF line
          if (i > 0 && lines[i - 1].trim().startsWith("#EXTINF")) {
            linesToSkip.add(i - 1);
          }
          console.log(
            `  Line ${i}: Skipping ${segmentName} (not in segment map)`,
          );
        }
      }
    }

    // Second pass: process each line
    for (let i = 0; i < lines.length; i++) {
      // Skip lines that were marked for removal
      if (linesToSkip.has(i)) {
        continue;
      }

      const line = lines[i];
      const trimmed = line.trim();

      if (trimmed && !trimmed.startsWith("#")) {
        // This is a segment URL line
        const segmentName = path.basename(trimmed);

        // Only rewrite if this is one of the last N segment lines (by line index) AND in the map
        if (lineIndicesToRewrite.has(i) && segmentMap[segmentName]) {
          // Rewrite this segment URL to point to local file
          const localSegmentName = segmentMap[segmentName];
          rewrittenLines.push(`${localPath}/${localSegmentName}`);
          console.log(
            `  Line ${i}: Rewriting ${segmentName} -> ${localSegmentName}`,
          );
        } else {
          // Keep original segment URL unchanged (for segments not in the last N)
          rewrittenLines.push(line);
        }
      } else {
        // Keep all other lines (headers, comments, etc.) unchanged
        rewrittenLines.push(line);
      }
    }

    return rewrittenLines.join("\n");
  }

  /**
   * Rewrite subsequent manifests - only rewrite new segments that appear and were downloaded
   * This method needs to check if new segments actually exist in the downloaded files
   */
  rewriteSubsequentManifestSelectively(
    originalContent,
    segmentMap,
    segmentCounter,
  ) {
    return this.rewriteSubsequentManifestSelectivelyGeneric(
      originalContent,
      segmentMap,
      segmentCounter,
      "../media/video",
    );
  }

  /**
   * Generic function to rewrite subsequent manifests - only rewrite segments that exist in the segment map
   *
   * @param {string} originalContent - Original manifest content
   * @param {Object} segmentMap - Mapping of original segment names to new names
   * @param {number} segmentCounter - Current segment counter (not used in this version)
   * @param {string} localPath - Local path prefix for segments (e.g., "../media/video" or "../../media/audio")
   */
  rewriteSubsequentManifestSelectivelyGeneric(
    originalContent,
    segmentMap,
    segmentCounter,
    localPath,
  ) {
    const lines = originalContent.split("\n");
    const rewrittenLines = [];
    const newSegments = {};
    let nextSegmentCounter = segmentCounter;

    // Process each line
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (trimmed && !trimmed.startsWith("#")) {
        // This is a segment URL line
        const segmentName = path.basename(trimmed);

        if (segmentMap[segmentName]) {
          // Existing segment - use existing mapping
          const localSegmentName = segmentMap[segmentName];
          rewrittenLines.push(`${localPath}/${localSegmentName}`);
        } else {
          // New segment not in our map - this means it wasn't downloaded
          // Skip this segment AND its preceding EXTINF line to maintain valid manifest
          if (rewrittenLines.length > 0 && rewrittenLines[rewrittenLines.length - 1].startsWith("#EXTINF")) {
            rewrittenLines.pop(); // Remove the EXTINF line for this segment
          }
          // Don't add the segment line - effectively removing it from the manifest
        }
      } else {
        // Keep all other lines (headers, comments, etc.) unchanged
        rewrittenLines.push(line);
      }
    }

    return {
      content: rewrittenLines.join("\n"),
      nextSegmentCounter,
      newSegments,
    };
  }

  /**
   * Async version that checks if new segments were actually downloaded
   */
  async rewriteSubsequentManifestSelectivelyAsync(
    originalContent,
    segmentMap,
    segmentCounter,
    originalVideoDir,
    scenarioPath,
  ) {
    const lines = originalContent.split("\n");
    const rewrittenLines = [];
    const newSegments = {};
    let nextSegmentCounter = segmentCounter;

    // Process each line
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (trimmed && !trimmed.startsWith("#")) {
        // This is a segment URL line
        const segmentName = path.basename(trimmed);

        if (segmentMap[segmentName]) {
          // Existing segment - use existing mapping
          const localSegmentName = segmentMap[segmentName];
          rewrittenLines.push(`../media/video/${localSegmentName}`);
        } else {
          // New segment - check if it was actually downloaded
          const originalSegmentPath = path.join(originalVideoDir, segmentName);

          if (await fs.pathExists(originalSegmentPath)) {
            // Segment was downloaded - add it to mapping and copy to main folder
            const newLocalName = `${nextSegmentCounter}.ts`;
            newSegments[segmentName] = newLocalName;

            // Copy the segment to the main video folder
            const mainVideoDir = path.join(scenarioPath, "media/video");
            const newSegmentPath = path.join(mainVideoDir, newLocalName);
            await fs.copy(originalSegmentPath, newSegmentPath);

            // Use the new local path in manifest
            rewrittenLines.push(`../media/video/${newLocalName}`);
            nextSegmentCounter++;

            console.log(
              `New segment found and mapped: ${segmentName} → ${newLocalName}`,
            );
          } else {
            // Segment wasn't downloaded - keep original URL
            rewrittenLines.push(line);
          }
        }
      } else {
        // Keep all other lines (headers, comments, etc.) unchanged
        rewrittenLines.push(line);
      }
    }

    return {
      content: rewrittenLines.join("\n"),
      nextSegmentCounter,
      newSegments,
    };
  }

  /**
   * Process selective audio segment renaming - only rename audio segments that were actually downloaded and kept after cleanup
   * Creates audioSegmentMap.json similar to segmentMap.json for video segments
   */
  async processSelectiveAudioSegmentRenaming(
    scenarioId,
    originalScenarioPath,
    scenarioPath,
  ) {
    try {
      // Check if audio info exists (indicates separate audio was downloaded)
      const audioInfoPath = path.join(scenarioPath, "audioInfo.json");

      if (!(await fs.pathExists(audioInfoPath))) {
        console.log("No audio info found, skipping audio segment renaming");
        return;
      }

      const originalAudioDir = path.join(originalScenarioPath, "media/audio");
      const mainAudioDir = path.join(scenarioPath, "media/audio");

      if (!(await fs.pathExists(originalAudioDir))) {
        console.log("No original audio segments found");
        return;
      }

      // Get the first audio manifest to determine which are the last 6 segments
      const firstAudioManifestPath =
        await this.getFirstAudioManifestPath(originalScenarioPath);
      if (!firstAudioManifestPath) {
        console.log(
          "No first audio manifest found, cannot determine last 6 audio segments",
        );
        return;
      }

      const firstAudioManifestContent = await fs.readFile(
        firstAudioManifestPath,
        "utf8",
      );

      // Get ALL audio manifests to analyze (not just the first one)
      const audioInfoForManifests = await fs.readJson(
        path.join(scenarioPath, "audioInfo.json"),
      );
      const audioVariantName = audioInfoForManifests.trackInfo.name;

      const audioManifestDir = path.join(
        originalScenarioPath,
        "audio",
        audioVariantName,
      );

      const manifestFiles = await fs.readdir(audioManifestDir);
      const m3u8Files = manifestFiles.filter(
        (f) => f.endsWith(".m3u8") && f !== "audio.m3u8",
      );

      if (m3u8Files.length === 0) {
        console.log("No audio manifest files found");
        return;
      }

      // Sort manifests chronologically
      m3u8Files.sort();

      // Get the segment limit from scenario details
      const detailsPath = path.join(scenarioPath, "details.json");
      let segmentLimit = 6; // Default to 6
      if (await fs.pathExists(detailsPath)) {
        const details = await fs.readJson(detailsPath);
        segmentLimit = details.maxSegmentsToDownload || 6;
      }

      console.log(`Using segment limit: ${segmentLimit} for audio rewriting`);

      // Collect segments in chronological order as they first appear in the last N positions
      // This matches the logic used in processSelectiveSegmentRenaming for video
      const segmentsToRewrite = [];
      const seenSegments = new Set();

      for (const manifestFile of m3u8Files) {
        const manifestPath = path.join(audioManifestDir, manifestFile);
        const manifestContent = await fs.readFile(manifestPath, "utf8");
        const lines = manifestContent.split("\n");

        // Extract segment URLs from this manifest
        const segmentLines = [];
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith("#")) {
            segmentLines.push(path.basename(trimmed));
          }
        }

        // Get the last N segments from this manifest (or all if less than N)
        const lastNSegments = segmentLines.slice(-segmentLimit);

        // Add new segments in the order they first appear
        for (const segment of lastNSegments) {
          if (!seenSegments.has(segment)) {
            segmentsToRewrite.push(segment);
            seenSegments.add(segment);
          }
        }
      }

      console.log(
        `Found ${segmentsToRewrite.length} unique audio segments to rewrite in chronological order`,
      );

      // Ensure main audio directory is clean
      if (await fs.pathExists(mainAudioDir)) {
        await fs.remove(mainAudioDir);
      }
      await fs.ensureDir(mainAudioDir);

      // Create audio segment mapping - copy and number segments in chronological order
      const audioSegmentMap = {};
      let audioSegmentCounter = 1;

      for (const originalFileName of segmentsToRewrite) {
        const originalPath = path.join(originalAudioDir, originalFileName);

        // Check if the segment file actually exists
        if (!(await fs.pathExists(originalPath))) {
          console.warn(
            `Audio segment file not found: ${originalFileName}, skipping`,
          );
          continue;
        }

        const newFileName = `${audioSegmentCounter}.ts`;
        const newPath = path.join(mainAudioDir, newFileName);

        // Copy segment with new name
        await fs.copy(originalPath, newPath);

        // Add to audio segment mapping - key is original filename, value is new filename
        audioSegmentMap[originalFileName] = newFileName;

        console.log(
          `Renamed audio segment: ${originalFileName} → ${newFileName} (seq: ${audioSegmentCounter})`,
        );
        audioSegmentCounter++;
      }

      // Save audio segment mapping
      const audioSegmentMapPath = path.join(
        scenarioPath,
        "audioSegmentMap.json",
      );
      await fs.writeJson(audioSegmentMapPath, audioSegmentMap, { spaces: 2 });

      console.log(
        `Processed ${Object.keys(audioSegmentMap).length} audio segments and created audioSegmentMap.json`,
      );
    } catch (error) {
      console.error(
        "Error processing selective audio segment renaming:",
        error,
      );
      throw error;
    }
  }

  /**
   * Process selective audio manifest rewriting - rewrite audio manifests to point to local segments
   * Similar to video manifest rewriting but for audio
   */
  async processSelectiveAudioManifestRewriting(
    scenarioId,
    originalScenarioPath,
    scenarioPath,
  ) {
    try {
      // Check if audio info exists (indicates separate audio was downloaded)
      const audioInfoPath = path.join(scenarioPath, "audioInfo.json");

      if (!(await fs.pathExists(audioInfoPath))) {
        console.log("No audio info found, skipping audio manifest rewriting");
        return;
      }

      const audioInfo = await fs.readJson(audioInfoPath);
      const audioVariantName = audioInfo.trackInfo.name;

      const originalAudioDir = path.join(
        originalScenarioPath,
        "audio",
        audioVariantName,
      );
      const mainAudioDir = path.join(scenarioPath, "audio", audioVariantName);

      if (!(await fs.pathExists(originalAudioDir))) {
        console.log(
          `No original audio manifests found for variant ${audioVariantName}`,
        );
        return;
      }

      // Load audio segment mapping
      const audioSegmentMapPath = path.join(
        scenarioPath,
        "audioSegmentMap.json",
      );
      if (!(await fs.pathExists(audioSegmentMapPath))) {
        console.log(
          "No audioSegmentMap.json found, skipping audio manifest rewriting",
        );
        return;
      }

      const audioSegmentMap = await fs.readJson(audioSegmentMapPath);

      // Get the segment limit from scenario details
      const detailsPath = path.join(scenarioPath, "details.json");
      let segmentLimit = 6; // Default to 6
      if (await fs.pathExists(detailsPath)) {
        const details = await fs.readJson(detailsPath);
        segmentLimit = details.maxSegmentsToDownload || 6;
      }

      console.log(`Using segment limit: ${segmentLimit} for audio manifest rewriting`);

      // Get all original audio manifest files (timestamped versions only)
      const originalManifests = await fs.readdir(originalAudioDir);
      const timestampedManifestFiles = originalManifests.filter(
        (file) => file.endsWith(".m3u8") && /^\d+-audio-/.test(file),
      );

      // Sort manifests by timestamp to process in order
      timestampedManifestFiles.sort((a, b) => {
        const timestampA = parseInt(a.split("-")[0]);
        const timestampB = parseInt(b.split("-")[0]);
        return timestampA - timestampB;
      });

      // Ensure main audio directory is clean
      if (await fs.pathExists(mainAudioDir)) {
        await fs.remove(mainAudioDir);
      }
      await fs.ensureDir(mainAudioDir);

      let isFirstAudioManifest = true;

      for (const originalManifestFile of timestampedManifestFiles) {
        const originalManifestPath = path.join(
          originalAudioDir,
          originalManifestFile,
        );
        const originalContent = await fs.readFile(originalManifestPath, "utf8");

        // Extract timestamp from filename (format: timestamp-audio-HH-MM-SS.m3u8)
        const timestampMatch = originalManifestFile.match(
          /^(\d+)-audio-(\d{2})-(\d{2})-(\d{2})\.m3u8$/,
        );
        if (!timestampMatch) {
          console.log(
            `Skipping audio manifest with unexpected format: ${originalManifestFile}`,
          );
          continue;
        }

        const timestamp = timestampMatch[1];
        const hours = timestampMatch[2];
        const minutes = timestampMatch[3];
        const seconds = timestampMatch[4];

        // Create rewritten filename in the expected format
        const cleanedVariantName = audioVariantName.replace(/\s+/g, "");
        const rewrittenManifestFilename = `${timestamp}-audio${cleanedVariantName}-${hours}-${minutes}-${seconds}.m3u8`;

        // Apply selective rewriting logic for audio
        let rewrittenContent;
        if (isFirstAudioManifest) {
          // First audio manifest: Only rewrite last N segments
          rewrittenContent = this.rewriteFirstAudioManifestSelectivelyWithLimit(
            originalContent,
            audioSegmentMap,
            segmentLimit,
          );
          isFirstAudioManifest = false;
        } else {
          // Subsequent audio manifests: Only rewrite segments that exist in our map
          rewrittenContent = this.rewriteSubsequentAudioManifestSelectively(
            originalContent,
            audioSegmentMap,
          );
        }

        // Save rewritten audio manifest
        const rewrittenManifestPath = path.join(
          mainAudioDir,
          rewrittenManifestFilename,
        );
        await fs.writeFile(rewrittenManifestPath, rewrittenContent);

        console.log(
          `Rewritten audio manifest: ${originalManifestFile} → ${rewrittenManifestFilename}`,
        );
      }

      // Update manifestMap.json with audio mappings
      await this.updateAudioManifestMapForRewriting(
        scenarioId,
        timestampedManifestFiles,
        audioVariantName,
      );

      // Create audio.m3u8 as the latest manifest (similar to playlist.m3u8 for video)
      if (timestampedManifestFiles.length > 0) {
        const latestOriginalFile =
          timestampedManifestFiles[timestampedManifestFiles.length - 1];
        const timestampMatch = latestOriginalFile.match(
          /^(\d+)-audio-(\d{2})-(\d{2})-(\d{2})\.m3u8$/,
        );
        if (timestampMatch) {
          const timestamp = timestampMatch[1];
          const hours = timestampMatch[2];
          const minutes = timestampMatch[3];
          const seconds = timestampMatch[4];

          const cleanedVariantName = audioVariantName.replace(/\s+/g, "");
          const latestRewrittenFile = `${timestamp}-audio${cleanedVariantName}-${hours}-${minutes}-${seconds}.m3u8`;
          const latestRewrittenPath = path.join(
            mainAudioDir,
            latestRewrittenFile,
          );
          const audioPlaylistPath = path.join(mainAudioDir, "audio.m3u8");

          if (await fs.pathExists(latestRewrittenPath)) {
            await fs.copy(latestRewrittenPath, audioPlaylistPath);
          }
        }
      }

      console.log(
        `Processed ${timestampedManifestFiles.length} audio manifests with selective rewriting for variant ${audioVariantName}`,
      );
    } catch (error) {
      console.error("Error in selective audio manifest rewriting:", error);
      // Don't throw - audio is optional
    }
  }

  /**
   * Rewrite first audio manifest - only rewrite URLs for the last 6 segments
   * Keep all other segments unchanged in the manifest
   */
  rewriteFirstAudioManifestSelectively(originalContent, audioSegmentMap) {
    return this.rewriteFirstManifestSelectivelyGeneric(
      originalContent,
      audioSegmentMap,
      "../../media/audio",
      6, // Default to 6 segments
    );
  }

  /**
   * Rewrite first audio manifest with custom segment limit
   */
  rewriteFirstAudioManifestSelectivelyWithLimit(originalContent, audioSegmentMap, segmentLimit) {
    return this.rewriteFirstManifestSelectivelyGeneric(
      originalContent,
      audioSegmentMap,
      "../../media/audio",
      segmentLimit,
    );
  }

  /**
   * Rewrite subsequent audio manifests - only rewrite segments that exist in our audio segment map
   */
  rewriteSubsequentAudioManifestSelectively(originalContent, audioSegmentMap) {
    const result = this.rewriteSubsequentManifestSelectivelyGeneric(
      originalContent,
      audioSegmentMap,
      0, // segmentCounter not used for audio
      "../../media/audio",
    );
    return result.content;
  }

  /**
   * Update manifestMap.json with audio manifest mappings
   */
  async updateAudioManifestMapForRewriting(
    scenarioId,
    timestampedManifestFiles,
    audioVariantName,
  ) {
    return this.updateManifestMapGeneric(
      scenarioId,
      timestampedManifestFiles,
      `audio.${audioVariantName}`,
      "audio",
      audioVariantName,
      /^(\d+)-audio-(\d{2})-(\d{2})-(\d{2})\.m3u8$/,
      (timestamp, audioVariantName) => {
        const timestampMatch = timestampedManifestFiles
          .find((f) => f.startsWith(timestamp))
          ?.match(/^(\d+)-audio-(\d{2})-(\d{2})-(\d{2})\.m3u8$/);
        if (timestampMatch) {
          const [, , hours, minutes, seconds] = timestampMatch;
          const cleanedVariantName = audioVariantName.replace(/\s+/g, "");
          return `${timestamp}-audio${cleanedVariantName}-${hours}-${minutes}-${seconds}.m3u8`;
        }
        return `${timestamp}-audio.m3u8`;
      },
      (scenarioId, audioVariantName, originalManifestFile) =>
        path.join(
          __dirname,
          "../hls",
          `${scenarioId}_original`,
          "audio",
          audioVariantName,
          originalManifestFile,
        ),
    );
  }

  /**
   * Copy selected audio variant manifests to all other audio variants
   * Similar to how video Profile 0 is copied to all other profiles
   */
  async copySelectedAudioVariantToAllVariants(scenarioId, scenarioPath) {
    try {
      // Check if audio info exists (indicates separate audio was downloaded)
      const audioInfoPath = path.join(scenarioPath, "audioInfo.json");

      if (!(await fs.pathExists(audioInfoPath))) {
        console.log("No audio info found, skipping audio variant copying");
        return;
      }

      const audioInfo = await fs.readJson(audioInfoPath);
      const selectedAudioVariantName = audioInfo.trackInfo.name;

      console.log(
        `Copying selected audio variant ${selectedAudioVariantName} manifests to all other audio variants for scenario ${scenarioId}`,
      );

      // Get all audio variants from master manifest
      const masterManifestPath = path.join(scenarioPath, "master/master.m3u8");
      if (!(await fs.pathExists(masterManifestPath))) {
        console.log("No master manifest found, skipping audio variant copying");
        return;
      }

      const masterContent = await fs.readFile(masterManifestPath, "utf8");
      const manifestService = require("./manifestService");
      const audioTracks =
        manifestService.parseAudioTracksFromMaster(masterContent);

      if (audioTracks.length <= 1) {
        console.log("Only 1 or no audio variants detected, no copying needed");
        return;
      }

      console.log(
        `Found ${audioTracks.length} audio variants, copying ${selectedAudioVariantName} to other variants`,
      );

      // Check if selected audio variant directory exists
      const selectedAudioDir = path.join(
        scenarioPath,
        "audio",
        selectedAudioVariantName,
      );
      if (!(await fs.pathExists(selectedAudioDir))) {
        console.log(
          "Selected audio variant directory not found, skipping audio variant copying",
        );
        return;
      }

      // Get all manifest files from selected audio variant
      const selectedAudioFiles = await fs.readdir(selectedAudioDir);
      const manifestFiles = selectedAudioFiles.filter((file) =>
        file.endsWith(".m3u8"),
      );

      if (manifestFiles.length === 0) {
        console.log(
          "No manifest files found in selected audio variant, skipping audio variant copying",
        );
        return;
      }

      console.log(
        `Found ${manifestFiles.length} manifest files in selected audio variant to copy`,
      );

      // Copy to all other audio variants
      for (const audioTrack of audioTracks) {
        const targetAudioVariantName = audioTrack.name;

        if (targetAudioVariantName === selectedAudioVariantName) {
          continue; // Skip the source variant
        }

        const targetAudioDir = path.join(
          scenarioPath,
          "audio",
          targetAudioVariantName,
        );

        // Ensure target audio variant directory exists
        await fs.ensureDir(targetAudioDir);

        console.log(
          `Copying audio manifests to variant ${targetAudioVariantName}`,
        );

        // Copy each manifest file (content is identical, just different variant folder)
        let successCount = 0;
        let failCount = 0;

        for (const manifestFile of manifestFiles) {
          try {
            const sourcePath = path.join(selectedAudioDir, manifestFile);

            // Update filename for target variant
            let targetFilename = manifestFile;
            const timestampedMatch = manifestFile.match(
              /^(\d+)-audio.*?(\d{2})-(\d{2})-(\d{2})\.m3u8$/,
            );
            if (timestampedMatch) {
              const [, timestamp, hours, minutes, seconds] = timestampedMatch;
              const cleanedTargetVariantName = targetAudioVariantName.replace(
                /\s+/g,
                "",
              );
              targetFilename = `${timestamp}-audio${cleanedTargetVariantName}-${hours}-${minutes}-${seconds}.m3u8`;
            }

            const targetPath = path.join(targetAudioDir, targetFilename);

            // Copy with new name (content is the same, just different filename)
            await fs.copy(sourcePath, targetPath);
            console.log(
              `  Copied: ${manifestFile} → ${targetFilename} to ${targetAudioVariantName}`,
            );
            successCount++;
          } catch (error) {
            console.warn(
              `Failed to copy ${manifestFile} to audio variant ${targetAudioVariantName}:`,
              error.message,
            );
            failCount++;
          }
        }

        if (failCount > 0) {
          console.warn(
            `Failed to copy ${failCount} files to audio variant ${targetAudioVariantName}`,
          );
        }

        console.log(
          `Successfully copied ${successCount} manifests to audio variant ${targetAudioVariantName}`,
        );
      }

      // Update manifestMap.json to include all audio variants
      await this.updateManifestMapForAllAudioVariants(
        scenarioPath,
        audioTracks,
        selectedAudioVariantName,
      );

      console.log(
        `Successfully copied selected audio variant manifests to all ${audioTracks.length - 1} other audio variants`,
      );
    } catch (error) {
      console.error(
        `Error copying selected audio variant to all variants for scenario ${scenarioId}:`,
        error.message,
      );
      // Don't throw error - audio variant copying is not critical for basic functionality
      console.log("Continuing despite audio variant copying errors...");
    }
  }

  /**
   * Update manifestMap.json to include all audio variants
   */
  async updateManifestMapForAllAudioVariants(
    scenarioPath,
    audioTracks,
    selectedAudioVariantName,
  ) {
    try {
      const manifestMapPath = path.join(scenarioPath, "manifestMap.json");
      let manifestMap = {};

      // Load existing manifest map (should have selected audio variant data)
      if (await fs.pathExists(manifestMapPath)) {
        manifestMap = await fs.readJson(manifestMapPath);
      }

      // If selected audio variant exists in the map, copy its structure to all other variants
      if (manifestMap.audio && manifestMap.audio[selectedAudioVariantName]) {
        console.log("Updating manifestMap.json for all audio variants");

        for (const audioTrack of audioTracks) {
          const targetVariantName = audioTrack.name;

          if (targetVariantName === selectedAudioVariantName) {
            continue; // Skip the source variant
          }

          // Copy selected variant structure (content is identical)
          manifestMap.audio[targetVariantName] = {
            ...manifestMap.audio[selectedAudioVariantName],
          };

          // Update variant name and rewritten filename in each mapping
          for (const [originalFilename, mapping] of Object.entries(
            manifestMap.audio[targetVariantName],
          )) {
            const originalRewrittenFilename = mapping.rewrittenFilename;
            let newRewrittenFilename = originalRewrittenFilename;

            const timestampedMatch = originalRewrittenFilename.match(
              /^(\d+)-audio.*?(\d{2})-(\d{2})-(\d{2})\.m3u8$/,
            );
            if (timestampedMatch) {
              const [, timestamp, hours, minutes, seconds] = timestampedMatch;
              const cleanedTargetVariantName = targetVariantName.replace(
                /\s+/g,
                "",
              );
              newRewrittenFilename = `${timestamp}-audio${cleanedTargetVariantName}-${hours}-${minutes}-${seconds}.m3u8`;
            }

            manifestMap.audio[targetVariantName][originalFilename] = {
              ...mapping,
              rewrittenFilename: newRewrittenFilename,
              variantName: targetVariantName,
              repeat: mapping.repeat || 0,
            };
          }
        }

        // Save updated manifest map
        await fs.writeJson(manifestMapPath, manifestMap, { spaces: 2 });
        console.log(
          `Updated manifestMap.json with ${audioTracks.length} audio variants`,
        );
      } else {
        console.log(
          "No selected audio variant data found in manifestMap.json, skipping update",
        );
      }
    } catch (error) {
      console.error(
        "Error updating manifestMap.json for all audio variants:",
        error,
      );
      throw error;
    }
  }
}

module.exports = new OriginalDownloadService();
