const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");
const { XMLParser } = require("fast-xml-parser");

/**
 * DASH Download Service
 * 
 * Implements manifest and segment download for DASH streams
 * Similar to HLS originalDownloadService but adapted for DASH/MPD format
 * 
 * STORAGE STRUCTURE:
 * - {scenarioId}_original/ - Contains original files
 * - manifests/ - Timestamped MPD manifests
 * - media/video/ - Video segments
 * - media/audio/ - Audio segments
 */
class DashDownloadService {
  constructor() {
    this.activeDownloads = new Map();
    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      parseAttributeValue: true,
    });
  }

  getCustomHeaders(details) {
    const customHeaders = {};
    if (details.requestHeaders && typeof details.requestHeaders === "object") {
      Object.assign(customHeaders, details.requestHeaders);
    }
    return customHeaders;
  }

  prepareHeaders(customHeaders = {}) {
    return {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "application/dash+xml, application/xml, text/xml, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      Connection: "keep-alive",
      ...customHeaders,
    };
  }

  async startDashDownload(scenarioId, options = {}) {
    try {
      console.log(`[DASH] Starting download for scenario: ${scenarioId}`);
      const scenarioPath = path.join(__dirname, "../dash", scenarioId);
      const originalScenarioPath = path.join(__dirname, "../dash", `${scenarioId}_original`);
      const detailsPath = path.join(scenarioPath, "details.json");

      console.log(`[DASH] Scenario path: ${scenarioPath}`);
      console.log(`[DASH] Original scenario path: ${originalScenarioPath}`);
      console.log(`[DASH] Details path: ${detailsPath}`);

      if (!(await fs.pathExists(detailsPath))) {
        console.error(`[DASH] Details file not found at: ${detailsPath}`);
        throw new Error("Scenario not found");
      }

      const details = await fs.readJson(detailsPath);
      console.log(`[DASH] Loaded scenario details:`, {
        name: details.name,
        type: details.type,
        sourceManifestUrl: details.sourceManifestUrl,
      });

      if (this.activeDownloads.has(scenarioId)) {
        console.log(`[DASH] Stopping existing download for scenario: ${scenarioId}`);
        await this.stopDashDownload(scenarioId);
      }

      const maxSegmentsPerFetch = options.maxSegmentsPerFetch || 6;
      console.log(`[DASH] Max segments per fetch: ${maxSegmentsPerFetch}`);

      details.downloadStatus = "downloading";
      details.maxSegmentsPerFetch = maxSegmentsPerFetch;
      await fs.writeJson(detailsPath, details, { spaces: 2 });
      console.log(`[DASH] Updated scenario status to downloading`);

      await this.createDashFolderStructure(originalScenarioPath);
      console.log(`[DASH] Created folder structure`);

      const downloadInfo = {
        scenarioId,
        maxSegmentsPerFetch,
        intervalId: null,
        segmentCount: 0,
        startTime: new Date(),
        isRunning: true,
        gracefulShutdown: false,
        pendingDownloads: 0,
        lastManifestContent: null,
        targetDuration: 2,
        consecutiveErrors: 0,
        maxConsecutiveErrors: 5,
        originalScenarioPath,
        downloadedSegments: new Set(),
        backgroundDownloadsActive: 0,
        lowestVideoProfile: null,
        lowestAudioProfile: null,
      };

      this.activeDownloads.set(scenarioId, downloadInfo);
      console.log(`[DASH] Added to active downloads`);

      this.startContinuousDashDownload(downloadInfo);
      console.log(`[DASH] Started continuous download loop`);

      return {
        message: "DASH download started",
        scenarioId,
        maxSegmentsPerFetch,
        status: "downloading",
      };
    } catch (error) {
      console.error(`[DASH] Error starting download:`, error);
      throw error;
    }
  }

  async createDashFolderStructure(originalScenarioPath) {
    await fs.ensureDir(path.join(originalScenarioPath, "manifests"));
    await fs.ensureDir(path.join(originalScenarioPath, "media/video"));
    await fs.ensureDir(path.join(originalScenarioPath, "media/audio"));
    // Profile-specific directories will be created dynamically when downloading segments
  }

  async startContinuousDashDownload(downloadInfo) {
    const { scenarioId, maxSegmentsPerFetch } = downloadInfo;

    console.log(`[DASH] Starting continuous DASH download for scenario ${scenarioId}`);

    try {
      console.log(`[DASH] Fetching initial manifest...`);
      const result = await this.fetchAndSaveDashManifestOnly(scenarioId, maxSegmentsPerFetch);
      console.log(`[DASH] Initial manifest fetch result:`, {
        newSegments: result.newSegments?.length || 0,
        manifestSaved: result.manifestSaved,
      });

      if (result.newSegments && result.newSegments.length > 0) {
        console.log(`[DASH] Starting background download of ${result.newSegments.length} segments`);
        this.downloadDashSegmentsInBackground(scenarioId, result.newSegments, downloadInfo);
      } else {
        console.log(`[DASH] No new segments to download from initial manifest`);
      }
    } catch (error) {
      console.error(`[DASH] Initial DASH manifest fetch error for scenario ${scenarioId}:`, error);
      console.error(`[DASH] Error details:`, error.message);
      console.error(`[DASH] Error stack:`, error.stack);
      downloadInfo.consecutiveErrors++;
    }

    console.log(`[DASH] Starting continuous polling loop...`);
    this.continuousDashDownloadLoop(downloadInfo);
  }

  async continuousDashDownloadLoop(downloadInfo) {
    const { scenarioId, maxSegmentsPerFetch } = downloadInfo;

    console.log(`[DASH] Starting continuous DASH polling for scenario ${scenarioId}`);

    while (downloadInfo.isRunning) {
      try {
        console.log(`[DASH] Fetching DASH manifest snapshot for scenario ${scenarioId}...`);

        const result = await this.fetchAndSaveDashManifestOnly(scenarioId, maxSegmentsPerFetch);

        if (result.targetDuration) {
          downloadInfo.targetDuration = result.targetDuration;
        }

        if (result.newSegments && result.newSegments.length > 0) {
          console.log(`[DASH] Queueing ${result.newSegments.length} segments for download`);
          this.downloadDashSegmentsInBackground(scenarioId, result.newSegments, downloadInfo);
        } else {
          console.log(`[DASH] No new segments to download`);
        }

        const statusMessage = `Captured DASH manifest snapshot at ${new Date().toISOString()}. Manifest: ${result.manifestSaved ? "SAVED" : "SKIPPED (identical)"}, New segments queued: ${result.newSegments?.length || 0}`;

        console.log(`[DASH] ${statusMessage}`);

        downloadInfo.consecutiveErrors = 0; // Reset on success
        await this.sleep(100);
      } catch (error) {
        console.error(`[DASH] Download error for scenario ${scenarioId}:`, error);
        console.error(`[DASH] Error stack:`, error.stack);
        downloadInfo.consecutiveErrors++;

        if (downloadInfo.consecutiveErrors >= 5) {
          console.warn(`[DASH] Multiple consecutive errors for scenario ${scenarioId}, brief pause...`);
          await this.sleep(1000);
          downloadInfo.consecutiveErrors = 0;
        } else {
          await this.sleep(200);
        }
      }
    }

    console.log(`[DASH] Continuous DASH download loop ended for scenario ${scenarioId}`);
  }

  async fetchAndSaveDashManifestOnly(scenarioId, maxSegmentsPerFetch = 6) {
    try {
      console.log(`[DASH] Fetching manifest for scenario: ${scenarioId}`);
      const scenarioPath = path.join(__dirname, "../dash", scenarioId);
      const originalScenarioPath = path.join(__dirname, "../dash", `${scenarioId}_original`);
      const detailsPath = path.join(scenarioPath, "details.json");
      const details = await fs.readJson(detailsPath);

      console.log(`[DASH] Manifest URL: ${details.sourceManifestUrl}`);

      const customHeaders = this.getCustomHeaders(details);
      const headers = this.prepareHeaders(customHeaders);

      const fetchTimestamp = Date.now();
      console.log(`[DASH] Fetching manifest at timestamp: ${fetchTimestamp}`);
      
      const response = await axios.get(details.sourceManifestUrl, {
        headers,
        timeout: 30000,
      });

      console.log(`[DASH] Manifest fetched successfully, status: ${response.status}`);
      const manifestContent = response.data;
      console.log(`[DASH] Manifest content length: ${manifestContent.length} bytes`);

      const activeDownloadInfo = this.activeDownloads.get(scenarioId);

      let shouldSaveManifest = true;
      let comparisonResult = "no-previous-content";

      if (activeDownloadInfo && activeDownloadInfo.lastManifestContent) {
        if (activeDownloadInfo.lastManifestContent === manifestContent) {
          shouldSaveManifest = false;
          comparisonResult = "identical-content";
          console.log(`[DASH] Manifest content identical to previous, skipping save`);
        } else {
          comparisonResult = "content-changed";
          console.log(`[DASH] Manifest content changed, will save`);
        }
      }

      if (activeDownloadInfo) {
        activeDownloadInfo.lastManifestContent = manifestContent;
      }

      let savedManifest = false;

      if (shouldSaveManifest) {
        const manifestsDir = path.join(originalScenarioPath, "manifests");
        await fs.ensureDir(manifestsDir);

        const fetchDate = new Date(fetchTimestamp);
        const hours = String(fetchDate.getHours()).padStart(2, "0");
        const minutes = String(fetchDate.getMinutes()).padStart(2, "0");
        const seconds = String(fetchDate.getSeconds()).padStart(2, "0");

        const manifestFilename = `${fetchTimestamp}-manifest-${hours}-${minutes}-${seconds}.mpd`;
        const manifestPath = path.join(manifestsDir, manifestFilename);

        await fs.writeFile(manifestPath, manifestContent);
        savedManifest = true;
        console.log(`[DASH] Saved manifest: ${manifestFilename}`);
      }

      console.log(`[DASH] Parsing manifest...`);
      const parsedManifest = this.xmlParser.parse(manifestContent);
      console.log(`[DASH] Manifest parsed successfully`);
      
      const { videoSegments, audioSegments, minBufferTime } = this.parseDashManifest(parsedManifest, details.sourceManifestUrl);
      console.log(`[DASH] Parsed segments - Video: ${videoSegments.length}, Audio: ${audioSegments.length}`);

      const targetDuration = minBufferTime || 2;

      const downloadInfo = this.activeDownloads.get(scenarioId);

      if (!downloadInfo) {
        console.log(`[DASH] No active download info found for scenario ${scenarioId}`);
        return {
          newSegments: [],
          totalSegments: 0,
          targetDuration,
          manifestSaved: savedManifest,
          comparisonResult: comparisonResult,
        };
      }

      if (!shouldSaveManifest) {
        console.log(`[DASH] Manifest content identical - no new segments to process`);
        return {
          newSegments: [],
          totalSegments: downloadInfo.downloadedSegments.size,
          targetDuration,
          manifestSaved: savedManifest,
          comparisonResult: comparisonResult,
        };
      }

      const segmentRecord = await this.loadSegmentRecord(scenarioId);
      const firstManifestSegmentsSet = await this.loadFirstManifestSegments(scenarioId);
      const isVeryFirstManifest = firstManifestSegmentsSet.size === 0;

      console.log(`[DASH] Is first manifest: ${isVeryFirstManifest}`);

      const newSegments = [];
      const allFirstManifestSegments = new Set();

      const processSegments = (segments, type) => {
        let segmentsToProcess;
        
        if (isVeryFirstManifest) {
          // For first manifest: include init segment + ALL media segments
          // This ensures all segments referenced in the manifest are available for playback
          const initSegments = segments.filter(s => s.isInit);
          const mediaSegments = segments.filter(s => !s.isInit);
          
          // Combine init segments with ALL media segments
          segmentsToProcess = [...initSegments, ...mediaSegments];
          
          console.log(`[DASH] FIRST MANIFEST: Taking ${initSegments.length} init + ALL ${mediaSegments.length} ${type} media segments`);

          // Track ALL segments from first manifest to prevent downloading them later
          for (const segment of segments) {
            allFirstManifestSegments.add(segment.sourceUri);
          }
          
          console.log(`[DASH] Tracked ${segments.length} ${type} segments from first manifest to prevent later download`);
        } else {
          // Subsequent manifests: process all segments (filtered by duplicate check)
          segmentsToProcess = segments;
          downloadInfo.firstManifestSegments = firstManifestSegmentsSet;
          console.log(`[DASH] SUBSEQUENT MANIFEST: Processing all ${segmentsToProcess.length} ${type} segments for new segment detection`);
        }

        for (const segment of segmentsToProcess) {
          const segmentKey = `${type}_${segment.originalFileName}`;
          const fullSourceUri = segment.sourceUri;

          const inMemoryCheck = downloadInfo.downloadedSegments.has(segmentKey);
          const persistentCheck = segmentRecord.has(segmentKey);
          const firstManifestSkipCheck = !isVeryFirstManifest &&
            downloadInfo.firstManifestSegments &&
            downloadInfo.firstManifestSegments.has(fullSourceUri) &&
            !downloadInfo.downloadedSegments.has(segmentKey);

          if (!inMemoryCheck && !persistentCheck && !firstManifestSkipCheck) {
            newSegments.push({
              ...segment,
              type,
            });
          }
        }
      };

      processSegments(videoSegments, "video");
      processSegments(audioSegments, "audio");

      // Save all first manifest segments after processing both video and audio
      if (isVeryFirstManifest && allFirstManifestSegments.size > 0) {
        await this.saveFirstManifestSegments(scenarioId, allFirstManifestSegments);
        downloadInfo.firstManifestSegments = allFirstManifestSegments;
        console.log(`[DASH] Saved ${allFirstManifestSegments.size} total segments from first manifest (video + audio)`);
      }

      console.log(`[DASH] Found ${newSegments.length} new segments to download`);

      return {
        newSegments,
        totalSegments: downloadInfo.downloadedSegments.size,
        targetDuration,
        manifestSaved: savedManifest,
        comparisonResult: comparisonResult,
      };
    } catch (error) {
      console.error("[DASH] Error fetching and saving DASH manifest:", error);
      throw error;
    }
  }

  parseDashManifest(parsedManifest, baseUrl) {
    const videoSegments = [];
    const audioSegments = [];
    let minBufferTime = 2;

    try {
      const mpd = parsedManifest.MPD;
      
      if (mpd["@_minBufferTime"]) {
        const bufferMatch = mpd["@_minBufferTime"].match(/PT([\d.]+)S/);
        if (bufferMatch) {
          minBufferTime = Math.ceil(parseFloat(bufferMatch[1]));
        }
      }

      const baseUrlParts = baseUrl.split("/");
      baseUrlParts.pop();
      const manifestBaseUrl = baseUrlParts.join("/") + "/";

      const periods = Array.isArray(mpd.Period) ? mpd.Period : [mpd.Period];

      // Process all periods to collect segments
      for (const period of periods) {
        if (!period) continue;

        // Handle BaseURL in period if present
        let periodBaseUrl = manifestBaseUrl;
        if (period.BaseURL) {
          const baseUrlValue = typeof period.BaseURL === 'string' ? period.BaseURL : period.BaseURL['#text'];
          if (baseUrlValue) {
            periodBaseUrl = manifestBaseUrl + baseUrlValue;
          }
        }

        const adaptationSets = Array.isArray(period.AdaptationSet) ? period.AdaptationSet : [period.AdaptationSet];

        let lowestVideoProfile = null;
        let lowestAudioProfile = null;

        for (const adaptationSet of adaptationSets) {
          if (!adaptationSet) continue;

          const mimeType = adaptationSet["@_mimeType"];
          const contentType = adaptationSet["@_contentType"];
          const representations = Array.isArray(adaptationSet.Representation) ? adaptationSet.Representation : [adaptationSet.Representation];

          const isVideo = (mimeType && mimeType.includes("video")) || contentType === "video";
          const isAudio = (mimeType && mimeType.includes("audio")) || contentType === "audio";

          if (isVideo) {
            for (const rep of representations) {
              if (!rep) continue;
              const bandwidth = rep["@_bandwidth"] || 0;
              if (!lowestVideoProfile || bandwidth < lowestVideoProfile.bandwidth) {
                lowestVideoProfile = { representation: rep, bandwidth };
              }
            }
          } else if (isAudio) {
            for (const rep of representations) {
              if (!rep) continue;
              const bandwidth = rep["@_bandwidth"] || 0;
              if (!lowestAudioProfile || bandwidth < lowestAudioProfile.bandwidth) {
                lowestAudioProfile = { representation: rep, bandwidth };
              }
            }
          }
        }

        if (lowestVideoProfile) {
          const segments = this.extractSegmentsFromRepresentation(lowestVideoProfile.representation, periodBaseUrl);
          videoSegments.push(...segments);
          console.log(`[DASH] Period: Selected lowest video profile: bandwidth=${lowestVideoProfile.bandwidth}, segments=${segments.length}`);
        }

        if (lowestAudioProfile) {
          const segments = this.extractSegmentsFromRepresentation(lowestAudioProfile.representation, periodBaseUrl);
          audioSegments.push(...segments);
          console.log(`[DASH] Period: Selected lowest audio profile: bandwidth=${lowestAudioProfile.bandwidth}, segments=${segments.length}`);
        }
      }

      console.log(`[DASH] Total segments across all periods - Video: ${videoSegments.length}, Audio: ${audioSegments.length}`);
    } catch (error) {
      console.error("Error parsing DASH manifest:", error);
    }

    return { videoSegments, audioSegments, minBufferTime };
  }

  extractSegmentsFromRepresentation(representation, baseUrl) {
    const segments = [];

    try {
      const segmentTemplate = representation.SegmentTemplate;
      if (!segmentTemplate) return segments;

      const initialization = segmentTemplate["@_initialization"];
      const media = segmentTemplate["@_media"];
      const timescale = segmentTemplate["@_timescale"] || 1;

      // Extract profile directory from initialization or media path
      // e.g., "V_video_216384_p_0/init.m4s" -> "V_video_216384_p_0"
      // e.g., "A_audio_1000028133_128_en/init.m4s" -> "A_audio_1000028133_128_en"
      let profileDir = "";
      if (initialization && initialization.includes("/")) {
        profileDir = initialization.split("/")[0];
      } else if (media && media.includes("/")) {
        profileDir = media.split("/")[0];
      }

      console.log(`[DASH] Extracted profile directory: ${profileDir}`);

      if (initialization) {
        const initUrl = baseUrl + initialization;
        const initFileName = initialization.split("/").pop();
        segments.push({
          sourceUri: initUrl,
          originalFileName: initFileName,
          profileDir: profileDir,
          isInit: true,
        });
      }

      const segmentTimeline = segmentTemplate.SegmentTimeline;
      if (segmentTimeline && segmentTimeline.S) {
        const sElements = Array.isArray(segmentTimeline.S) ? segmentTimeline.S : [segmentTimeline.S];

        // Expand all segments from all S elements with "r" attribute
        for (const s of sElements) {
          const t = s["@_t"];
          const d = s["@_d"];
          const r = s["@_r"] || 0;

          // Calculate segment times using formula: t_start + (n x d)
          // Total segments = r + 1
          for (let i = 0; i <= r; i++) {
            const time = t + (i * d);
            const segmentUrl = media.replace("$Time$", time);
            const fullUrl = baseUrl + segmentUrl;
            const fileName = segmentUrl.split("/").pop();

            segments.push({
              sourceUri: fullUrl,
              originalFileName: fileName,
              profileDir: profileDir,
              time,
              duration: d,
              isInit: false,
            });
          }
        }
      }
    } catch (error) {
      console.error("Error extracting segments from representation:", error);
    }

    return segments;
  }

  async downloadDashSegmentsInBackground(scenarioId, newSegments, downloadInfo) {
    setImmediate(async () => {
      console.log(`Starting background download of ${newSegments.length} DASH segments for scenario ${scenarioId}`);

      const scenarioPath = path.join(__dirname, "../dash", scenarioId);
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
            console.log(`Abrupt shutdown: Canceling DASH segment download: ${segment.originalFileName}`);
            return null;
          }

          const segmentKey = `${segment.type}_${segment.originalFileName}`;

          if (downloadInfo.downloadedSegments.has(segmentKey)) {
            console.log(`DASH segment already downloaded, skipping: ${segment.originalFileName}`);
            return null;
          }

          const segmentRecord = await this.loadSegmentRecord(scenarioId);
          if (segmentRecord.has(segmentKey)) {
            console.log(`DASH segment already in record, skipping: ${segment.originalFileName}`);
            downloadInfo.downloadedSegments.add(segmentKey);
            return null;
          }

          const segmentPath = path.join(
            downloadInfo.originalScenarioPath,
            `media/${segment.type}`,
            segment.profileDir || "",
            segment.originalFileName
          );
          if (await fs.pathExists(segmentPath)) {
            console.log(`DASH segment file already exists, skipping: ${segment.profileDir}/${segment.originalFileName}`);
            downloadInfo.downloadedSegments.add(segmentKey);
            await this.updateSegmentRecord(scenarioId, segmentKey, segment.type);
            return null;
          }

          console.log(`Downloading DASH ${segment.type} segment: ${segment.profileDir}/${segment.originalFileName}`);
          await this.downloadDashSegment(
            segment.sourceUri,
            downloadInfo.originalScenarioPath,
            segment.originalFileName,
            segment.type,
            segment.profileDir || "",
            customHeaders
          );

          downloadInfo.downloadedSegments.add(segmentKey);
          await this.updateSegmentRecord(scenarioId, segmentKey, segment.type);

          console.log(`Background downloaded DASH segment: ${segment.originalFileName}`);
          return segment.originalFileName;
        } catch (error) {
          console.error(`Failed to download DASH segment ${segment.originalFileName}:`, error.message);
          return null;
        } finally {
          if (downloadInfo.pendingDownloads > 0) {
            downloadInfo.pendingDownloads--;
          }
        }
      });

      const results = await Promise.allSettled(downloadPromises);
      const successfulDownloads = results.filter(
        (result) => result.status === "fulfilled" && result.value !== null
      ).length;

      console.log(`DASH download batch completed: ${successfulDownloads}/${newSegments.length} segments for scenario ${scenarioId}`);
    });
  }

  async downloadDashSegment(segmentUrl, originalScenarioPath, originalFileName, type, profileDir, customHeaders = {}) {
    try {
      console.log(`Downloading DASH ${type} segment from: ${segmentUrl}`);

      const headers = this.prepareHeaders(customHeaders);

      const response = await axios.get(segmentUrl, {
        responseType: "stream",
        headers,
        timeout: 30000,
      });

      // Create path with profile directory: media/video/V_video_216384_p_0/segment.m4s
      const segmentPath = path.join(originalScenarioPath, `media/${type}`, profileDir, originalFileName);
      await fs.ensureDir(path.dirname(segmentPath));

      const writer = fs.createWriteStream(segmentPath);
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on("finish", () => {
          console.log(`DASH ${type} segment saved: ${profileDir}/${originalFileName}`);
          resolve();
        });
        writer.on("error", reject);
      });
    } catch (error) {
      console.error(`Error downloading DASH segment ${originalFileName}:`, error);
      throw error;
    }
  }

  async stopDashDownload(scenarioId) {
    const downloadInfo = this.activeDownloads.get(scenarioId);

    if (downloadInfo) {
      console.log(`Initiating graceful shutdown for DASH scenario ${scenarioId}`);

      downloadInfo.isRunning = false;
      downloadInfo.gracefulShutdown = true;

      if (downloadInfo.intervalId) {
        clearInterval(downloadInfo.intervalId);
      }

      const scenarioPath = path.join(__dirname, "../dash", scenarioId);
      const detailsPath = path.join(scenarioPath, "details.json");

      if (await fs.pathExists(detailsPath)) {
        const details = await fs.readJson(detailsPath);
        details.downloadStatus = "stopping";
        await fs.writeJson(detailsPath, details, { spaces: 2 });
      }

      console.log(`Stopped DASH manifest fetching for scenario ${scenarioId}`);
      console.log(`Waiting for pending DASH segment downloads to complete...`);

      await this.waitForPendingDownloads(downloadInfo, scenarioId);

      this.activeDownloads.delete(scenarioId);

      console.log(`All DASH downloads completed for scenario ${scenarioId}`);

      // Process DASH manifest rewriting
      console.log(`Starting DASH manifest rewriting for scenario ${scenarioId}`);
      
      try {
        const dashRewriteService = require("./dashRewriteService");
        await dashRewriteService.processDashRewriting(scenarioId);
        console.log(`DASH manifest rewriting completed for scenario ${scenarioId}`);
      } catch (error) {
        console.error(`Error during DASH manifest rewriting for scenario ${scenarioId}:`, error);
      }

      if (await fs.pathExists(detailsPath)) {
        const details = await fs.readJson(detailsPath);
        details.downloadStatus = "stopped";
        await fs.writeJson(detailsPath, details, { spaces: 2 });
      }

      console.log(`Graceful shutdown completed for DASH scenario ${scenarioId}`);
    }
  }

  async waitForPendingDownloads(downloadInfo, scenarioId) {
    const maxWaitTime = 60000;
    const checkInterval = 1000;
    let waitedTime = 0;

    console.log(`Waiting for ${downloadInfo.pendingDownloads} pending DASH downloads...`);

    while (downloadInfo.pendingDownloads > 0 && waitedTime < maxWaitTime) {
      await this.sleep(checkInterval);
      waitedTime += checkInterval;

      if (waitedTime % 5000 === 0) {
        console.log(`Still waiting... ${downloadInfo.pendingDownloads} DASH downloads pending (${waitedTime / 1000}s elapsed)`);
      }
    }

    if (downloadInfo.pendingDownloads > 0) {
      console.warn(`Timeout waiting for DASH downloads. ${downloadInfo.pendingDownloads} downloads may still be pending.`);
    } else {
      console.log(`All pending DASH downloads completed for scenario ${scenarioId}`);
    }
  }

  async loadSegmentRecord(scenarioId) {
    try {
      const scenarioPath = path.join(__dirname, "../dash", scenarioId);
      const segmentRecordPath = path.join(scenarioPath, "segmentRecord.json");

      if (await fs.pathExists(segmentRecordPath)) {
        const record = await fs.readJson(segmentRecordPath);
        return new Set(record);
      }
    } catch (error) {
      console.error(`Error loading segment record for ${scenarioId}:`, error);
    }
    return new Set();
  }

  async updateSegmentRecord(scenarioId, segmentKey, type) {
    try {
      const scenarioPath = path.join(__dirname, "../dash", scenarioId);
      const segmentRecordPath = path.join(scenarioPath, "segmentRecord.json");

      let record = [];
      if (await fs.pathExists(segmentRecordPath)) {
        record = await fs.readJson(segmentRecordPath);
      }

      if (!record.includes(segmentKey)) {
        record.push(segmentKey);
        await fs.writeJson(segmentRecordPath, record, { spaces: 2 });
      }
    } catch (error) {
      console.error(`Error updating segment record for ${scenarioId}:`, error);
    }
  }

  async loadFirstManifestSegments(scenarioId) {
    try {
      const scenarioPath = path.join(__dirname, "../dash", scenarioId);
      const firstManifestPath = path.join(scenarioPath, "firstManifestSegments.json");

      if (await fs.pathExists(firstManifestPath)) {
        const segments = await fs.readJson(firstManifestPath);
        return new Set(segments);
      }
    } catch (error) {
      console.error(`Error loading first manifest segments for ${scenarioId}:`, error);
    }
    return new Set();
  }

  async saveFirstManifestSegments(scenarioId, segments) {
    try {
      const scenarioPath = path.join(__dirname, "../dash", scenarioId);
      const firstManifestPath = path.join(scenarioPath, "firstManifestSegments.json");

      await fs.writeJson(firstManifestPath, Array.from(segments), { spaces: 2 });
    } catch (error) {
      console.error(`Error saving first manifest segments for ${scenarioId}:`, error);
    }
  }

  getActiveDownloads() {
    return Array.from(this.activeDownloads.keys());
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = new DashDownloadService();
