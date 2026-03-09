const fs = require("fs-extra");
const path = require("path");
const { XMLParser, XMLBuilder } = require("fast-xml-parser");

/**
 * DASH Live Streaming Service
 *
 * Simulates live DASH streaming by serving manifests sequentially
 * Similar to HLS liveStreamService but adapted for DASH/MPD format
 */
class DashLiveStreamService {
  constructor() {
    this.streamStates = new Map();
    this.requestCounts = new Map();
    this.pendingDelays = new Map();
    this.deliveredManifests = new Map();
    this.repeatStates = new Map();

    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      parseAttributeValue: false,
      preserveOrder: false,
    });

    this.xmlBuilder = new XMLBuilder({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      format: true,
      indentBy: "",
      suppressEmptyNode: false,
      suppressBooleanAttributes: false,
      preserveOrder: false,
    });
  }

  /**
   * Initialize a live stream for a DASH scenario
   */
  async initializeLiveStream(scenarioId, profileNumber = 0) {
    try {
      const scenarioPath = path.join(__dirname, "../dash", scenarioId);
      const manifestsDir = path.join(scenarioPath, "manifests");

      if (!(await fs.pathExists(manifestsDir))) {
        throw new Error(
          `No manifests directory found for scenario ${scenarioId}`,
        );
      }

      // Get available manifests with their timestamps
      const manifestFiles = await fs.readdir(manifestsDir);
      const mpdFiles = manifestFiles
        .filter((f) => f.endsWith(".mpd"))
        .map((file) => {
          const timestamp = parseInt(file.split("-")[0]);
          return { filename: file, timestamp };
        })
        .sort((a, b) => a.timestamp - b.timestamp);

      if (mpdFiles.length === 0) {
        throw new Error(`No MPD files found for scenario ${scenarioId}`);
      }

      // Extract minBufferTime from first manifest
      const firstManifestPath = path.join(manifestsDir, mpdFiles[0].filename);
      const minBufferTime = await this.extractMinBufferTime(firstManifestPath);

      // Initialize stream state
      const streamKey = `${scenarioId}-${profileNumber}`;
      this.streamStates.set(streamKey, {
        scenarioId,
        profileNumber,
        totalManifests: mpdFiles.length,
        manifestList: mpdFiles,
        minBufferTime: minBufferTime,
        isActive: true,
      });

      this.requestCounts.set(streamKey, 0);

      console.log(
        `[DASH-LIVE] Initialized live stream for ${scenarioId}: ${mpdFiles.length} manifests (${minBufferTime}s buffer)`,
      );

      return this.streamStates.get(streamKey);
    } catch (error) {
      console.error(
        `[DASH-LIVE] Error initializing live stream for ${scenarioId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Extract minBufferTime from MPD manifest
   */
  async extractMinBufferTime(manifestPath) {
    try {
      const content = await fs.readFile(manifestPath, "utf8");
      const parsed = this.xmlParser.parse(content);

      if (parsed.MPD && parsed.MPD["@_minBufferTime"]) {
        const bufferMatch = parsed.MPD["@_minBufferTime"].match(/PT([\d.]+)S/);
        if (bufferMatch) {
          return Math.ceil(parseFloat(bufferMatch[1]));
        }
      }

      return 2; // Default
    } catch (error) {
      console.error("[DASH-LIVE] Error extracting minBufferTime:", error);
      return 2;
    }
  }

  /**
   * Get manifest metadata from manifestMap.json
   */
  async getManifestMetadata(scenarioId, manifestNumber) {
    try {
      const manifestMapPath = path.join(
        __dirname,
        "../dash",
        scenarioId,
        "manifestMap.json",
      );

      if (!(await fs.pathExists(manifestMapPath))) {
        return null;
      }

      const manifestMap = await fs.readJson(manifestMapPath);

      // DASH uses profile 0 by default
      const profile0 = manifestMap.profile?.["0"] || {};

      const manifestEntry = Object.entries(profile0).find(
        ([key, val]) => val.manifestNumber === manifestNumber,
      );

      if (manifestEntry) {
        return { key: manifestEntry[0], ...manifestEntry[1] };
      }

      return null;
    } catch (error) {
      console.error("[DASH-LIVE] Error reading manifest metadata:", error);
      return null;
    }
  }

  /**
   * Get the current live MPD manifest
   */
  async getLiveManifest(scenarioId, profileNumber = 0) {
    const streamKey = `${scenarioId}-${profileNumber}`;
    let streamState = this.streamStates.get(streamKey);

    if (!streamState) {
      streamState = await this.initializeLiveStream(scenarioId, profileNumber);
    }

    let requestCount = this.requestCounts.get(streamKey) || 0;
    const nextRequestNumber = requestCount + 1;

    // Check for delay/status/repeat configuration
    const manifestInfo = await this.getManifestMetadata(
      scenarioId,
      nextRequestNumber,
    );

    // Handle repeat logic BEFORE reading manifest content
    let currentRepeatState = this.repeatStates.get(streamKey);
    if (
      !currentRepeatState ||
      currentRepeatState.manifestNumber !== nextRequestNumber
    ) {
      currentRepeatState = { manifestNumber: nextRequestNumber, count: 0 };
      this.repeatStates.set(streamKey, currentRepeatState);
    }

    // Increment count for this delivery
    currentRepeatState.count++;

    // Check if we've exceeded the repeat limit BEFORE delivering
    if (manifestInfo && manifestInfo.repeat > 0) {
      if (manifestInfo.repeatPercentage > 0) {
        const randomValue = Math.random() * 100;
        if (randomValue < manifestInfo.repeatPercentage) {
          // Repeat is triggered by percentage
          if (currentRepeatState.count > manifestInfo.repeat) {
            // Exceeded repeat limit, move to next manifest WITHOUT delivering current one
            this.requestCounts.set(streamKey, requestCount + 1);
            this.repeatStates.set(streamKey, {
              manifestNumber: nextRequestNumber + 1,
              count: 0,
            });
            console.log(
              `[DASH-LIVE] Manifest ${nextRequestNumber} repeat completed (delivered ${manifestInfo.repeat} times), moving to next`,
            );
            // Recursively call to get the next manifest
            return this.getLiveManifest(scenarioId, profileNumber);
          } else {
            console.log(
              `[DASH-LIVE] Delivering manifest ${nextRequestNumber} (${currentRepeatState.count}/${manifestInfo.repeat})`,
            );
          }
        } else {
          // Percentage check failed, skip repeat and move to next
          this.requestCounts.set(streamKey, requestCount + 1);
          this.repeatStates.set(streamKey, {
            manifestNumber: nextRequestNumber + 1,
            count: 0,
          });
          // Recursively call to get the next manifest
          return this.getLiveManifest(scenarioId, profileNumber);
        }
      } else {
        // Legacy: repeat without percentage (always apply)
        if (currentRepeatState.count > manifestInfo.repeat) {
          // Exceeded repeat limit, move to next manifest WITHOUT delivering current one
          this.requestCounts.set(streamKey, requestCount + 1);
          this.repeatStates.set(streamKey, {
            manifestNumber: nextRequestNumber + 1,
            count: 0,
          });
          console.log(
            `[DASH-LIVE] Manifest ${nextRequestNumber} repeat completed (delivered ${manifestInfo.repeat} times), moving to next`,
          );
          // Recursively call to get the next manifest
          return this.getLiveManifest(scenarioId, profileNumber);
        } else {
          console.log(
            `[DASH-LIVE] Delivering manifest ${nextRequestNumber} (${currentRepeatState.count}/${manifestInfo.repeat})`,
          );
        }
      }
    } else {
      // No repeat configured, move to next after this delivery
      this.requestCounts.set(streamKey, requestCount + 1);
      this.repeatStates.set(streamKey, {
        manifestNumber: nextRequestNumber + 1,
        count: 0,
      });
    }

    const iterationKey = `${nextRequestNumber}-${currentRepeatState.count}`;

    // Apply delay with percentage-based logic
    if (
      manifestInfo &&
      manifestInfo.delay > 0 &&
      manifestInfo.delayPercentage > 0
    ) {
      const randomValue = Math.random() * 100;
      if (randomValue < manifestInfo.delayPercentage) {
        const currentPending = this.pendingDelays.get(streamKey);
        const currentDelivered = this.deliveredManifests.get(streamKey);

        if (
          currentPending !== iterationKey &&
          currentDelivered !== iterationKey
        ) {
          console.log(
            `[DASH-LIVE] Applying ${manifestInfo.delay}s delay to manifest ${nextRequestNumber} (${manifestInfo.delayPercentage}% chance)`,
          );
          this.pendingDelays.set(streamKey, iterationKey);
          await this.sleep(manifestInfo.delay * 1000);
          this.pendingDelays.delete(streamKey);
          this.deliveredManifests.set(streamKey, iterationKey);
        }
      }
    }

    // Get the manifest content
    const manifestIndex = Math.min(
      nextRequestNumber - 1,
      streamState.manifestList.length - 1,
    );
    const manifestFile = streamState.manifestList[manifestIndex];
    const manifestPath = path.join(
      __dirname,
      "../dash",
      scenarioId,
      "manifests",
      manifestFile.filename,
    );

    let manifestContent = await fs.readFile(manifestPath, "utf8");
    let statusCode = 200;

    // Apply status code with percentage-based logic
    if (manifestInfo && manifestInfo.status && manifestInfo.status !== 200) {
      if (manifestInfo.statusPercentage > 0) {
        const randomValue = Math.random() * 100;
        if (randomValue < manifestInfo.statusPercentage) {
          statusCode = manifestInfo.status;
          console.log(
            `[DASH-LIVE] Applying status ${manifestInfo.status} to manifest ${nextRequestNumber} (${manifestInfo.statusPercentage}% chance)`,
          );
        }
      }
    }

    // Update manifest to be dynamic and fix paths
    manifestContent = this.updateManifestForLiveStreaming(
      manifestContent,
      streamState,
      scenarioId,
    );

    return {
      content: manifestContent,
      statusCode: statusCode,
      manifestNumber: nextRequestNumber,
      filename: manifestFile.filename,
    };
  }

  /**
   * Update MPD manifest for live streaming
   * Sets type="dynamic" and adds appropriate attributes
   * BaseURL is already set during rewrite, so relative paths work correctly
   */
  updateManifestForLiveStreaming(manifestContent, streamState, scenarioId) {
      try {
        // Use string replacement instead of XML parsing to avoid corruption
        let updatedContent = manifestContent;

        // Update BaseURL to point to DASH livestream endpoint
        // Handle both formats:
        // 1. <BaseURL>/dash/{scenarioId}/</BaseURL>
        // 2. Inline BaseURL="/dash/{scenarioId}/"
        
        const livestreamBaseUrl = `/api/scenarios/${scenarioId}/dash-live-stream/`;
        
        // Replace BaseURL tags (most common in Period elements)
        const baseUrlTagPattern = new RegExp(`<BaseURL>/dash/${scenarioId}/</BaseURL>`, 'g');
        updatedContent = updatedContent.replace(baseUrlTagPattern, `<BaseURL>${livestreamBaseUrl}</BaseURL>`);
        
        // Also handle BaseURL as attribute (less common but possible)
        const baseUrlAttrPattern = new RegExp(`BaseURL="/dash/${scenarioId}/"`, 'g');
        updatedContent = updatedContent.replace(baseUrlAttrPattern, `BaseURL="${livestreamBaseUrl}"`);
        
        // Handle case where BaseURL might have different formats
        updatedContent = updatedContent.replace(
          /<BaseURL>\/dash\/[^<]+\/<\/BaseURL>/g,
          `<BaseURL>${livestreamBaseUrl}</BaseURL>`
        );

        console.log(`[DASH-LIVE] Updated BaseURL from /dash/${scenarioId}/ to ${livestreamBaseUrl}`);

        // Update type to dynamic if not already
        if (!updatedContent.includes('type="dynamic"')) {
          updatedContent = updatedContent.replace(
            /type="[^"]*"/,
            'type="dynamic"',
          );
        }

        // Update or add minimumUpdatePeriod
        const updatePeriod = streamState.minBufferTime || 2;
        const minimumUpdatePeriodAttr = `minimumUpdatePeriod="PT${updatePeriod}S"`;

        if (updatedContent.includes("minimumUpdatePeriod=")) {
          updatedContent = updatedContent.replace(
            /minimumUpdatePeriod="[^"]*"/,
            minimumUpdatePeriodAttr,
          );
        } else {
          // Add after type attribute
          updatedContent = updatedContent.replace(
            /type="dynamic"/,
            `type="dynamic" ${minimumUpdatePeriodAttr}`,
          );
        }

        // Update publishTime to current time
        const publishTime = new Date().toISOString();
        const publishTimeAttr = `publishTime="${publishTime}"`;

        if (updatedContent.includes("publishTime=")) {
          updatedContent = updatedContent.replace(
            /publishTime="[^"]*"/,
            publishTimeAttr,
          );
        } else {
          // Add after minimumUpdatePeriod
          updatedContent = updatedContent.replace(
            /minimumUpdatePeriod="[^"]*"/,
            `$& ${publishTimeAttr}`,
          );
        }

        // Ensure timeShiftBufferDepth exists
        if (!updatedContent.includes("timeShiftBufferDepth=")) {
          updatedContent = updatedContent.replace(
            /publishTime="[^"]*"/,
            `$& timeShiftBufferDepth="PT60S"`,
          );
        }

        return updatedContent;
      } catch (error) {
        console.error("[DASH-LIVE] Error updating manifest:", error);
        return manifestContent;
      }
    }


  /**
   * Reset live stream state
   */
  async resetLiveStream(scenarioId, profileNumber = 0) {
    const streamKey = `${scenarioId}-${profileNumber}`;

    this.streamStates.delete(streamKey);
    this.requestCounts.set(streamKey, 0);
    this.pendingDelays.delete(streamKey);
    this.deliveredManifests.delete(streamKey);
    this.repeatStates.delete(streamKey);

    console.log(
      `[DASH-LIVE] Reset live stream for ${scenarioId} profile ${profileNumber}`,
    );
  }

  /**
   * Get live stream status
   */
  getLiveStreamStatus(scenarioId, profileNumber = 0) {
    const streamKey = `${scenarioId}-${profileNumber}`;
    const streamState = this.streamStates.get(streamKey);
    const requestCount = this.requestCounts.get(streamKey) || 0;

    if (!streamState) {
      return {
        initialized: false,
        scenarioId,
        profileNumber,
      };
    }

    return {
      initialized: true,
      scenarioId,
      profileNumber,
      currentManifest: requestCount + 1,
      totalManifests: streamState.totalManifests,
      minBufferTime: streamState.minBufferTime,
      isActive: streamState.isActive,
    };
  }

  /**
   * Set request count manually
   */
  setRequestCount(scenarioId, profileNumber, count) {
    const streamKey = `${scenarioId}-${profileNumber}`;
    this.requestCounts.set(streamKey, count);
    console.log(`[DASH-LIVE] Set request count to ${count} for ${streamKey}`);
  }

  /**
   * Get current request count
   */
  getRequestCount(scenarioId, profileNumber = 0) {
    const streamKey = `${scenarioId}-${profileNumber}`;
    return this.requestCounts.get(streamKey) || 0;
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = new DashLiveStreamService();
