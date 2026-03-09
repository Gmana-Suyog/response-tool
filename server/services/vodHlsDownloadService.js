const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");
const manifestService = require("./manifestService");

/**
 * VOD HLS Download Service
 * 
 * Downloads HLS VOD content with the following structure:
 * - Downloads only the lowest bitrate/quality profile (profile 0)
 * - Saves to server/vod/hls/{scenarioId}_original/
 * - Single manifest per profile (VOD has complete segment list)
 * - Tracks manifests in manifestRecord.json
 * - Tracks segments in segmentRecord.json with EXTINF values
 * 
 * Simplified VOD Download:
 * - Downloads only the first N segments specified by maxSegmentsToDownload
 * - No unique EXTINF tracking or special segment selection
 * - Segments are renamed sequentially (1.ts, 2.ts, 3.ts, etc.)
 * - Manifest rewrite only includes downloaded segments
 */
class VodHlsDownloadService {
  constructor() {
    this.activeDownloads = new Map();
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
      ...customHeaders,
    };
  }

  async startVodHlsDownload(scenarioId, options = {}) {
    try {
      const scenarioPath = path.join(__dirname, "../vod/hls", scenarioId);
      const originalScenarioPath = path.join(
        __dirname,
        "../vod/hls",
        `${scenarioId}_original`,
      );
      const detailsPath = path.join(scenarioPath, "details.json");

      if (!(await fs.pathExists(detailsPath))) {
        throw new Error("Scenario not found");
      }

      const details = await fs.readJson(detailsPath);

      // Stop existing download if running
      if (this.activeDownloads.has(scenarioId)) {
        await this.stopVodHlsDownload(scenarioId);
      }

      // Extract maxSegmentsToDownload and maxAudioSegmentsToDownload from options
      const maxSegmentsToDownload = options.maxSegmentsToDownload || null;
      const maxAudioSegmentsToDownload = options.maxAudioSegmentsToDownload || null;

      // Update status
      details.downloadStatus = "downloading";
      details.currentProfile = 0; // Always profile 0 for VOD
      details.maxSegmentsToDownload = maxSegmentsToDownload;
      details.maxAudioSegmentsToDownload = maxAudioSegmentsToDownload;
      await fs.writeJson(detailsPath, details, { spaces: 2 });

      // Create folder structure
      await this.createVodFolderStructure(originalScenarioPath);

      // Copy master manifest to original folder
      await this.copyMasterManifestToOriginal(
        scenarioPath,
        originalScenarioPath,
      );

      // Start download process
      const downloadInfo = {
        scenarioId,
        profileNumber: 0, // Always download from profile 0 (lowest quality)
        maxSegmentsToDownload,
        maxAudioSegmentsToDownload,
        intervalId: null,
        segmentCount: 0,
        startTime: new Date(),
        isRunning: true,
        originalScenarioPath,
        downloadedSegments: new Set(),
      };

      this.activeDownloads.set(scenarioId, downloadInfo);

      // Start VOD download
      await this.downloadVodContent(downloadInfo);

      return {
        message: "VOD HLS download started",
        scenarioId,
        profileNumber: 0,
        maxSegmentsToDownload,
        maxAudioSegmentsToDownload,
        status: "downloading",
      };
    } catch (error) {
      throw error;
    }
  }

  async createVodFolderStructure(originalScenarioPath) {
    await fs.ensureDir(path.join(originalScenarioPath, "master"));
    await fs.ensureDir(path.join(originalScenarioPath, "media/video"));
    await fs.ensureDir(path.join(originalScenarioPath, "media/audio"));
    await fs.ensureDir(path.join(originalScenarioPath, "media/subtitle"));
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
      console.log("Copied master manifest to VOD original folder");
    }
  }

  async downloadVodContent(downloadInfo) {
    const { scenarioId, profileNumber, originalScenarioPath, maxSegmentsToDownload, maxAudioSegmentsToDownload } = downloadInfo;

    try {
      console.log(
        `Starting VOD HLS download for scenario ${scenarioId}, profile ${profileNumber}`,
      );
      if (maxSegmentsToDownload) {
        console.log(`Will download first ${maxSegmentsToDownload} video segments from manifest`);
      } else {
        console.log(`Will download all video segments from manifest`);
      }
      if (maxAudioSegmentsToDownload) {
        console.log(`Will download first ${maxAudioSegmentsToDownload} audio segments from manifest`);
      }

      const scenarioPath = path.join(__dirname, "../vod/hls", scenarioId);
      const detailsPath = path.join(scenarioPath, "details.json");
      const details = await fs.readJson(detailsPath);

      // Get custom headers
      const customHeaders = this.getCustomHeaders(details);
      const headers = this.prepareHeaders(customHeaders);

      // Get master manifest to find the lowest bitrate profile
      const masterManifestPath = path.join(scenarioPath, "master/master.m3u8");
      if (!(await fs.pathExists(masterManifestPath))) {
        throw new Error("Master manifest not found");
      }

      const masterContent = await fs.readFile(masterManifestPath, "utf8");
      
      // Find the lowest bitrate profile (profile 0)
      const lowestProfileUrl = this.extractLowestBitrateProfileUrl(
        masterContent,
        details.sourceManifestUrl,
      );

      if (!lowestProfileUrl) {
        throw new Error("Could not find lowest bitrate profile in master manifest");
      }

      console.log(`Downloading from lowest bitrate profile: ${lowestProfileUrl}`);

      // Fetch profile manifest
      const fetchTimestamp = Date.now();
      const response = await axios.get(lowestProfileUrl, {
        headers,
        timeout: 30000,
      });

      const manifestContent = response.data;

      // Create profile directory
      const profileDir = path.join(originalScenarioPath, "profiles", "0");
      await fs.ensureDir(profileDir);

      // Save manifest with timestamp
      const originalBaseFilename = path.basename(lowestProfileUrl);
      const manifestFileName = `${fetchTimestamp}_${originalBaseFilename}`;
      const manifestPath = path.join(profileDir, manifestFileName);

      await fs.writeFile(manifestPath, manifestContent);
      console.log(`Saved VOD manifest: ${manifestFileName}`);

      // Update manifestRecord.json
      await this.updateManifestRecord(
        scenarioId,
        manifestFileName,
        "video",
        0,
      );

      // Parse manifest to get all segments
      const { segments } = this.parseManifestSegments(
        manifestContent,
        lowestProfileUrl,
      );

      console.log(`Found ${segments.length} segments in VOD manifest`);

      // Identify segments to download
      const { segmentsToDownload } = this.selectSegmentsToDownload(
        segments,
        maxSegmentsToDownload,
      );

      console.log(`Will download ${segmentsToDownload.length} segments`);

      // Check for and download initialization segment (EXT-X-MAP) if present
      await this.downloadInitSegmentIfPresent(
        scenarioId,
        manifestContent,
        lowestProfileUrl,
        originalScenarioPath,
        customHeaders,
        "video",
      );

      // Download segments
      await this.downloadAllSegments(
        scenarioId,
        segmentsToDownload,
        downloadInfo,
        customHeaders,
      );

      // Check for audio variants and download if present
      await this.checkAndDownloadAudio(
        scenarioId,
        masterContent,
        details,
        downloadInfo,
        customHeaders,
      );

      // Check for subtitle tracks and download if present
      await this.checkAndDownloadSubtitles(
        scenarioId,
        masterContent,
        details,
        customHeaders,
      );

      // Start rewrite process after download completes
      console.log(`Starting VOD rewrite process for scenario ${scenarioId}`);
      const vodRewriteService = require("./vodRewriteService");
      await vodRewriteService.rewriteVodScenario(scenarioId);
      console.log(`VOD rewrite process completed for scenario ${scenarioId}`);

      // Reload details after rewrite to preserve profile information
      const updatedDetails = await fs.readJson(detailsPath);
      updatedDetails.downloadStatus = "stopped";
      await fs.writeJson(detailsPath, updatedDetails, { spaces: 2 });

      console.log(`VOD HLS download completed for scenario ${scenarioId}`);
    } catch (error) {
      console.error(`Error downloading VOD content for ${scenarioId}:`, error);
      throw error;
    } finally {
      downloadInfo.isRunning = false;
      this.activeDownloads.delete(scenarioId);
    }
  }

  async downloadInitSegmentIfPresent(
    scenarioId,
    manifestContent,
    manifestUrl,
    originalScenarioPath,
    customHeaders,
    mediaType = "video",
  ) {
    try {
      // Check if manifest contains EXT-X-MAP
      const mapMatch = manifestContent.match(/#EXT-X-MAP:URI="([^"]+)"/);
      
      if (!mapMatch) {
        console.log(`No EXT-X-MAP found in ${mediaType} manifest, skipping init segment download`);
        return;
      }

      const initSegmentUri = mapMatch[1];
      console.log(`Found EXT-X-MAP:URI="${initSegmentUri}" in ${mediaType} manifest`);

      // Resolve the full URL for the init segment
      const initSegmentUrl = this.resolveUrl(initSegmentUri, manifestUrl);
      console.log(`Downloading ${mediaType} init segment: ${initSegmentUri}`);

      // Prepare headers
      const headers = this.prepareHeaders(customHeaders);

      // Download the init segment
      const response = await axios.get(initSegmentUrl, {
        headers,
        timeout: 30000,
        responseType: "arraybuffer",
      });

      // Save to media directory
      const mediaDir = path.join(originalScenarioPath, `media/${mediaType}`);
      await fs.ensureDir(mediaDir);

      const initSegmentPath = path.join(mediaDir, initSegmentUri);
      await fs.writeFile(initSegmentPath, response.data);

      console.log(`Successfully downloaded ${mediaType} init segment: ${initSegmentUri}`);
    } catch (error) {
      console.error(`Error downloading ${mediaType} init segment:`, error.message);
      // Don't throw - init segment might not be critical
    }
  }

  async downloadAllSegments(scenarioId, segments, downloadInfo, customHeaders) {
    const { originalScenarioPath } = downloadInfo;

    console.log(`Starting download of ${segments.length} video segments`);

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      // Use the full relative path from the manifest as the unique identifier
      const segmentFullPath = segment.relativePath;

      // Check if already downloaded
      if (downloadInfo.downloadedSegments.has(segmentFullPath)) {
        console.log(`Segment already downloaded, skipping: ${segmentFullPath}`);
        continue;
      }

      try {
        console.log(
          `Downloading video segment ${i + 1}/${segments.length}: ${segmentFullPath} (EXTINF: ${segment.extinf})`,
        );

        await this.downloadSegment(
          segment.sourceUri,
          originalScenarioPath,
          segmentFullPath,
          "video",
          customHeaders,
        );

        // Mark as downloaded
        downloadInfo.downloadedSegments.add(segmentFullPath);
        await this.updateSegmentRecord(scenarioId, segmentFullPath, "video", segment.extinf);

        downloadInfo.segmentCount++;
      } catch (error) {
        console.error(`Failed to download segment ${segmentFullPath}:`, error.message);
      }
    }

    console.log(`Completed download of ${downloadInfo.segmentCount} video segments`);
  }

  async checkAndDownloadAudio(
    scenarioId,
    masterContent,
    details,
    downloadInfo,
    customHeaders,
  ) {
    try {
      // Check if audio variant is selected
      const scenarioPath = path.join(__dirname, "../vod/hls", scenarioId);
      const audioInfoPath = path.join(scenarioPath, "audioInfo.json");

      if (!(await fs.pathExists(audioInfoPath))) {
        console.log("No audio variant selected for VOD");
        return;
      }

      const audioInfo = await fs.readJson(audioInfoPath);
      console.log(`Audio variant selected: ${audioInfo.trackInfo.name}`);

      // Get audio playlist URL
      const audioPlaylistUrl = audioInfo.playlistUrl;
      const audioVariantName = audioInfo.trackInfo.name;

      // Fetch audio manifest
      const headers = this.prepareHeaders(customHeaders);
      const fetchTimestamp = Date.now();
      const response = await axios.get(audioPlaylistUrl, {
        headers,
        timeout: 30000,
      });

      const audioManifestContent = response.data;

      // Create audio directory
      const audioDir = path.join(
        downloadInfo.originalScenarioPath,
        "audio",
        audioVariantName,
      );
      await fs.ensureDir(audioDir);

      // Save audio manifest
      const audioManifestFileName = `${fetchTimestamp}-audio.m3u8`;
      const audioManifestPath = path.join(audioDir, audioManifestFileName);
      await fs.writeFile(audioManifestPath, audioManifestContent);
      console.log(`Saved VOD audio manifest: ${audioManifestFileName}`);

      // Update manifestRecord.json for audio
      await this.updateManifestRecord(
        scenarioId,
        audioManifestFileName,
        "audio",
        audioVariantName,
      );

      // Parse audio manifest to get segments
      const { segments: audioSegments } = this.parseManifestSegments(
        audioManifestContent,
        audioPlaylistUrl,
      );

      console.log(`Found ${audioSegments.length} audio segments in VOD manifest`);

      // Identify segments to download for audio - use maxAudioSegmentsToDownload if provided
      const audioSegmentLimit = downloadInfo.maxAudioSegmentsToDownload || downloadInfo.maxSegmentsToDownload;
      const { segmentsToDownload: audioSegmentsToDownload } = this.selectSegmentsToDownload(
        audioSegments,
        audioSegmentLimit,
      );

      console.log(`Will download ${audioSegmentsToDownload.length} audio segments`);

      // Check for and download audio initialization segment (EXT-X-MAP) if present
      await this.downloadInitSegmentIfPresent(
        scenarioId,
        audioManifestContent,
        audioPlaylistUrl,
        downloadInfo.originalScenarioPath,
        customHeaders,
        "audio",
      );

      // Download all audio segments
      await this.downloadAllAudioSegments(
        scenarioId,
        audioSegmentsToDownload,
        downloadInfo,
        customHeaders,
      );
    } catch (error) {
      console.error(`Error downloading audio for VOD scenario ${scenarioId}:`, error);
    }
  }

  async downloadAllAudioSegments(
    scenarioId,
    audioSegments,
    downloadInfo,
    customHeaders,
  ) {
    const { originalScenarioPath } = downloadInfo;

    console.log(`Starting download of ${audioSegments.length} audio segments`);

    for (let i = 0; i < audioSegments.length; i++) {
      const segment = audioSegments[i];
      // Use the full relative path from the manifest as the unique identifier
      const segmentFullPath = segment.relativePath;
      const audioSegmentKey = `audio_${segmentFullPath}`;

      // Check if already downloaded
      if (downloadInfo.downloadedSegments.has(audioSegmentKey)) {
        console.log(`Audio segment already downloaded, skipping: ${segmentFullPath}`);
        continue;
      }

      try {
        console.log(
          `Downloading audio segment ${i + 1}/${audioSegments.length}: ${segmentFullPath} (EXTINF: ${segment.extinf})`,
        );

        await this.downloadSegment(
          segment.sourceUri,
          originalScenarioPath,
          segmentFullPath,
          "audio",
          customHeaders,
        );

        // Mark as downloaded
        downloadInfo.downloadedSegments.add(audioSegmentKey);
        await this.updateSegmentRecord(scenarioId, audioSegmentKey, "audio", segment.extinf);
      } catch (error) {
        console.error(`Failed to download audio segment ${segmentFullPath}:`, error.message);
      }
    }

    console.log(`Completed download of audio segments`);
  }

  async checkAndDownloadSubtitles(
    scenarioId,
    masterContent,
    details,
    customHeaders,
  ) {
    try {
      console.log(`Checking for subtitle tracks in VOD scenario ${scenarioId}`);

      // Use manifestService to download subtitle playlists
      const manifestService = require("./manifestService");
      await manifestService.downloadSubtitlePlaylists(
        scenarioId,
        masterContent,
        details.sourceManifestUrl,
        customHeaders,
        "VOD",
      );

      console.log(`Subtitle download completed for VOD scenario ${scenarioId}`);
    } catch (error) {
      console.error(`Error downloading subtitles for VOD scenario ${scenarioId}:`, error);
      // Don't throw - subtitles are optional
    }
  }

  async downloadSegment(
    segmentUrl,
    originalScenarioPath,
    segmentRelativePath,
    type,
    customHeaders = {},
  ) {
    try {
      const headers = this.prepareHeaders(customHeaders);

      const response = await axios.get(segmentUrl, {
        responseType: "stream",
        headers,
        timeout: 30000,
      });

      const mediaDir = type === "audio" ? "media/audio" : "media/video";
      // Use the full relative path to preserve directory structure
      const segmentPath = path.join(
        originalScenarioPath,
        mediaDir,
        segmentRelativePath,
      );
      await fs.ensureDir(path.dirname(segmentPath));

      const writer = fs.createWriteStream(segmentPath);
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on("finish", () => {
          resolve();
        });
        writer.on("error", reject);
      });
    } catch (error) {
      console.error(`Error downloading segment ${segmentRelativePath}:`, error);
      throw error;
    }
  }

  extractLowestBitrateProfileUrl(masterContent, baseUrl) {
    const lines = masterContent.split("\n");
    let lowestBandwidth = Infinity;
    let lowestProfileUrl = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith("#EXT-X-STREAM-INF")) {
        // Extract bandwidth
        const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
        if (bandwidthMatch) {
          const bandwidth = parseInt(bandwidthMatch[1]);
          if (bandwidth < lowestBandwidth) {
            lowestBandwidth = bandwidth;
            // Get the URL from the next line
            const nextLine = lines[i + 1]?.trim();
            if (nextLine && !nextLine.startsWith("#")) {
              lowestProfileUrl = this.resolveUrl(nextLine, baseUrl);
            }
          }
        }
      }
    }

    return lowestProfileUrl;
  }

  selectSegmentsToDownload(segments, maxSegmentsToDownload) {
    // If no limit specified, download all segments
    if (!maxSegmentsToDownload || maxSegmentsToDownload <= 0) {
      return {
        segmentsToDownload: segments,
      };
    }

    // Simply download the first N segments
    const segmentsToDownload = segments.slice(0, maxSegmentsToDownload);

    console.log(`Will download first ${segmentsToDownload.length} segments from manifest`);

    return {
      segmentsToDownload,
    };
  }

  parseManifestSegments(manifestContent, baseUrl) {
    const lines = manifestContent.split("\n");
    const segments = [];
    let currentExtinf = null;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      
      // Parse EXTINF line to get duration
      if (trimmed.startsWith("#EXTINF:")) {
        const match = trimmed.match(/#EXTINF:([\d.]+)/);
        if (match) {
          currentExtinf = parseFloat(match[1]);
        }
      } else if (trimmed && !trimmed.startsWith("#")) {
        // This is a segment URL
        segments.push({
          sourceUri: this.resolveUrl(trimmed, baseUrl),
          relativePath: trimmed, // Store the full relative path from manifest
          extinf: currentExtinf, // Store the EXTINF duration value
        });
        currentExtinf = null; // Reset for next segment
      }
    }

    return { segments };
  }

  resolveUrl(url, baseUrl) {
    if (url.startsWith("http")) {
      return url;
    }

    const base = new URL(baseUrl);
    return new URL(url, base).href;
  }

  async updateManifestRecord(
    scenarioId,
    originalManifestFileName,
    type,
    identifier,
  ) {
    try {
      const originalScenarioPath = path.join(
        __dirname,
        "../vod/hls",
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

      const sectionKey = String(identifier);
      const targetSection =
        type === "video" ? manifestRecord.profile : manifestRecord.audio;

      if (!targetSection[sectionKey]) {
        targetSection[sectionKey] = {};
      }

      // Check if already exists
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
        `Updated VOD manifestRecord.json for ${type} ${identifier}: ${originalManifestFileName}`,
      );
      return manifestNumber;
    } catch (error) {
      console.error(
        `Error updating VOD manifestRecord.json for scenario ${scenarioId}:`,
        error,
      );
      return null;
    }
  }

  async updateSegmentRecord(scenarioId, segmentName, segmentType = "video", extinf = null) {
    try {
      const scenarioPath = path.join(
        __dirname,
        "../vod/hls",
        `${scenarioId}_original`,
      );
      const segmentRecordPath = path.join(scenarioPath, "segmentRecord.json");

      // Load existing record
      let segmentRecord = { downloadedSegments: {}, extinfValues: {} };
      if (await fs.pathExists(segmentRecordPath)) {
        segmentRecord = await fs.readJson(segmentRecordPath);
      }

      // Ensure downloadedSegments is an object
      if (
        !segmentRecord.downloadedSegments ||
        typeof segmentRecord.downloadedSegments !== "object"
      ) {
        segmentRecord.downloadedSegments = {};
      }

      // Ensure extinfValues is an object
      if (
        !segmentRecord.extinfValues ||
        typeof segmentRecord.extinfValues !== "object"
      ) {
        segmentRecord.extinfValues = {};
      }

      // Add segment with type and extinf if not already present
      if (!segmentRecord.downloadedSegments[segmentName]) {
        segmentRecord.downloadedSegments[segmentName] = {
          type: segmentType,
          extinf: extinf,
        };

        // Track unique EXTINF values
        if (extinf !== null && extinf !== undefined) {
          const extinfKey = String(extinf);
          if (!segmentRecord.extinfValues[extinfKey]) {
            segmentRecord.extinfValues[extinfKey] = [];
          }
          segmentRecord.extinfValues[extinfKey].push(segmentName);
        }

        // Save updated record
        await fs.writeJson(segmentRecordPath, segmentRecord, { spaces: 2 });
      }
    } catch (error) {
      console.error(
        `Error updating VOD segmentRecord.json for ${scenarioId}:`,
        error,
      );
    }
  }

  async stopVodHlsDownload(scenarioId) {
    const downloadInfo = this.activeDownloads.get(scenarioId);

    if (downloadInfo) {
      console.log(`Stopping VOD HLS download for scenario ${scenarioId}`);
      downloadInfo.isRunning = false;

      // Update status
      const scenarioPath = path.join(__dirname, "../vod/hls", scenarioId);
      const detailsPath = path.join(scenarioPath, "details.json");

      if (await fs.pathExists(detailsPath)) {
        const details = await fs.readJson(detailsPath);
        details.downloadStatus = "stopped";
        await fs.writeJson(detailsPath, details, { spaces: 2 });
      }

      this.activeDownloads.delete(scenarioId);
      console.log(`VOD HLS download stopped for scenario ${scenarioId}`);
    }
  }

  getActiveDownloads() {
    return Array.from(this.activeDownloads.values()).map((info) => ({
      scenarioId: info.scenarioId,
      profileNumber: info.profileNumber,
      segmentCount: info.segmentCount,
      startTime: info.startTime,
      isRunning: info.isRunning,
    }));
  }
}

module.exports = new VodHlsDownloadService();
