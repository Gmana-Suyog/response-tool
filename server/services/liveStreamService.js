const fs = require("fs-extra");
const path = require("path");

/**
 * Live streaming service that cycles through downloaded manifests based on request count
 * This simulates the exact progression of the original live stream
 */
class LiveStreamService {
  constructor() {
    // Track the current state of each scenario's live stream
    this.streamStates = new Map();
    // Track request counts for each scenario/profile
    this.requestCounts = new Map();
    // Track pending delays to block progression (streamKey -> manifestNumber)
    this.pendingDelays = new Map();
    // Track delivered manifests to allow moving forward (streamKey -> manifestNumber)
    this.deliveredManifests = new Map();
    // Track repeat counts for each scenario/profile (streamKey -> { manifestNumber, count })
    this.repeatStates = new Map();
  }

  /**
   * Initialize a live stream for a scenario
   */
  async initializeLiveStream(scenarioId, profileNumber = 0) {
    try {
      const scenarioPath = path.join(__dirname, "../hls", scenarioId);
      const profileDir = path.join(
        scenarioPath,
        "profiles",
        String(profileNumber),
      );

      // Get available manifests with their timestamps
      const manifestFiles = await fs.readdir(profileDir);
      const timestampedManifests = manifestFiles
        .filter((file) => file.match(/^\d+-\d+-\d{2}-\d{2}-\d{2}\.m3u8$/))
        .map((file) => {
          const timestamp = parseInt(file.split("-")[0]);
          return { filename: file, timestamp };
        })
        .sort((a, b) => a.timestamp - b.timestamp); // Oldest first (chronological order)

      if (timestampedManifests.length === 0) {
        throw new Error(
          `No timestamped manifests found for scenario ${scenarioId}`,
        );
      }

      // Extract target duration from original manifest
      const targetDuration = await this.extractTargetDurationFromOriginal(
        scenarioId,
        profileNumber,
      );

      // Initialize stream state
      const streamKey = `${scenarioId}-${profileNumber}`;
      this.streamStates.set(streamKey, {
        scenarioId,
        profileNumber,
        totalManifests: timestampedManifests.length,
        manifestList: timestampedManifests,
        targetDuration: targetDuration,
        isActive: true,
      });

      // Initialize request count
      this.requestCounts.set(streamKey, 0);

      console.log(
        `Initialized live stream for ${scenarioId} profile ${profileNumber}: ${timestampedManifests.length} manifests (${targetDuration}s duration)`,
      );
      return this.streamStates.get(streamKey);
    } catch (error) {
      console.error(`Error initializing live stream for ${scenarioId}:`, error);
      throw error;
    }
  }

  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async getManifestMetadata(scenarioId, sectionKey, manifestNumber) {
    try {
      const manifestMapPath = path.join(
        __dirname,
        "../hls",
        scenarioId,
        "manifestMap.json",
      );
      if (!(await fs.pathExists(manifestMapPath))) return null;

      const manifestMap = await fs.readJson(manifestMapPath);
      const sectionParts = sectionKey.split(".");
      let target = manifestMap;
      for (const part of sectionParts) {
        target = target[part] || {};
      }

      // Find by manifestNumber
      const manifestEntry = Object.entries(target).find(
        ([key, val]) => val.manifestNumber === manifestNumber,
      );
      if (manifestEntry) {
        return { key: manifestEntry[0], ...manifestEntry[1] };
      }
      return null;
    } catch (error) {
      console.error("Error reading manifest metadata:", error);
      return null;
    }
  }

  /**
   * Get the current live audio playlist for a scenario
   */
  async getLiveAudioPlaylist(scenarioId, audioVariant) {
    const streamKey = `${scenarioId}-0`; // Sync with video
    const audioKey = `${scenarioId}-audio-${audioVariant}`;
    let streamState = this.streamStates.get(streamKey);

    if (!streamState) {
      streamState = await this.initializeLiveStream(scenarioId, 0);
    }

    let requestCount = this.requestCounts.get(streamKey) || 0;
    const nextRequestNumber = requestCount + 1;

    // Check for delay/status for audio manifest with percentage-based logic
    const manifestInfo = await this.getManifestMetadata(
      scenarioId,
      `audio.${audioVariant}`,
      nextRequestNumber,
    );

    const currentRepeatCount = this.repeatStates.get(streamKey)?.count || 0;
    const iterationKey = `${nextRequestNumber}-${currentRepeatCount}`;

    // Apply percentage-based random logic for delay
    if (
      manifestInfo &&
      manifestInfo.delay > 0 &&
      manifestInfo.delayPercentage > 0
    ) {
      const randomValue = Math.random() * 100; // 0-100
      if (randomValue < manifestInfo.delayPercentage) {
        const currentPending = this.pendingDelays.get(audioKey);
        const currentDelivered = this.deliveredManifests.get(audioKey);

        if (currentPending === iterationKey) {
          // Block progression: return the playlist for this manifest immediately
        } else if (currentDelivered === iterationKey) {
          // Already delivered this iteration
        } else {
          // Start delaying
          console.log(
            `[AUDIO DELAY] Applying ${manifestInfo.delay}s delay to audio manifest ${nextRequestNumber} (${manifestInfo.delayPercentage}% chance triggered)`,
          );
          this.pendingDelays.set(audioKey, iterationKey);
          await this.sleep(manifestInfo.delay * 1000);
          this.pendingDelays.delete(audioKey);
          this.deliveredManifests.set(audioKey, iterationKey);
        }
      }
    } else if (
      manifestInfo &&
      manifestInfo.delay > 0 &&
      !manifestInfo.delayPercentage
    ) {
      // Legacy behavior: always apply delay if no percentage is set
      const currentPending = this.pendingDelays.get(audioKey);
      const currentDelivered = this.deliveredManifests.get(audioKey);

      if (currentPending === iterationKey) {
        // Block progression: return the playlist for this manifest immediately
      } else if (currentDelivered === iterationKey) {
        // Already delivered this iteration
      } else {
        // Start delaying
        this.pendingDelays.set(audioKey, iterationKey);
        await this.sleep(manifestInfo.delay * 1000);
        this.pendingDelays.delete(audioKey);
        this.deliveredManifests.set(audioKey, iterationKey);
      }
    }

    const playlist = await this.generateSequentialAudioPlaylist(
      scenarioId,
      audioVariant,
      nextRequestNumber,
    );

    // Apply percentage-based random logic for status
    let finalStatus = 200;
    if (manifestInfo && manifestInfo.status && manifestInfo.status !== 200) {
      if (manifestInfo.statusPercentage > 0) {
        const randomValue = Math.random() * 100; // 0-100
        if (randomValue < manifestInfo.statusPercentage) {
          finalStatus = manifestInfo.status;
          console.log(
            `[AUDIO STATUS] Applying status ${manifestInfo.status} to audio manifest ${nextRequestNumber} (${manifestInfo.statusPercentage}% chance triggered)`,
          );
        }
      } else {
        // Legacy behavior: always apply status if no percentage is set
        finalStatus = manifestInfo.status;
      }
    }

    if (finalStatus !== 200) {
      return { content: playlist, status: finalStatus };
    }

    return playlist;
  }

  /**
   * Generate a sequential audio playlist that starts from 1.ts and progresses sequentially
   * This ensures audio segments are synchronized with video segments
   */
  async generateSequentialAudioPlaylist(
    scenarioId,
    audioVariant,
    requestNumber,
  ) {
    try {
      const scenarioPath = path.join(__dirname, "../hls", scenarioId);
      const audioDir = path.join(scenarioPath, "audio", audioVariant);

      // Check if audio directory exists
      if (!(await fs.pathExists(audioDir))) {
        throw new Error(
          `Audio directory not found for variant ${audioVariant}: ${audioDir}`,
        );
      }

      // Get available audio manifests with their timestamps
      const manifestFiles = await fs.readdir(audioDir);
      const timestampedManifests = manifestFiles
        .filter((file) => file.match(/^\d+-audio.*-\d{2}-\d{2}-\d{2}\.m3u8$/))
        .map((file) => {
          const timestamp = parseInt(file.split("-")[0]);
          return { filename: file, timestamp };
        })
        .sort((a, b) => a.timestamp - b.timestamp);

      if (timestampedManifests.length === 0) {
        throw new Error(
          `No timestamped audio manifests found for ${scenarioId} variant ${audioVariant}`,
        );
      }

      // Get the manifest index (requestNumber is 1-based, array is 0-based)
      const manifestIndex = Math.min(
        requestNumber - 1,
        timestampedManifests.length - 1,
      );
      const manifestIndex0Based = Math.max(0, manifestIndex);

      const manifestInfo = timestampedManifests[manifestIndex0Based];
      if (!manifestInfo) {
        throw new Error(
          `No audio manifest found at index ${manifestIndex0Based} for ${scenarioId}`,
        );
      }

      // Read the locally saved timestamped audio manifest
      const manifestPath = path.join(audioDir, manifestInfo.filename);

      if (!(await fs.pathExists(manifestPath))) {
        throw new Error(`Audio manifest file not found: ${manifestPath}`);
      }

      let manifestContent = await fs.readFile(manifestPath, "utf8");

      // Remove EXT-X-ENDLIST to keep it live
      manifestContent = this.removeEndList(manifestContent);

      console.log(
        `Serving locally saved audio manifest ${manifestInfo.filename} for request ${requestNumber}`,
      );

      return manifestContent;
    } catch (error) {
      console.error(
        `Error generating sequential audio playlist for ${scenarioId} (${audioVariant}):`,
        error,
      );
      throw error;
    }
  }

  /**
   * Helper to get the repeat value for a specific manifest number across all components
   */
  async getRepeatValueForManifest(scenarioId, profileNumber, manifestNumber) {
    try {
      const manifestMapPath = path.join(
        __dirname,
        "../hls",
        scenarioId,
        "manifestMap.json",
      );
      if (!(await fs.pathExists(manifestMapPath))) return 0;

      const manifestMap = await fs.readJson(manifestMapPath);
      let maxRepeat = 0;

      // Check video profile
      if (manifestMap.profile && manifestMap.profile[String(profileNumber)]) {
        const videoEntry = Object.values(
          manifestMap.profile[String(profileNumber)],
        ).find((v) => v.manifestNumber === manifestNumber);
        if (videoEntry && videoEntry.repeat > 0) {
          maxRepeat = Math.max(maxRepeat, videoEntry.repeat);
        }
      }

      // Check all audio variants
      if (manifestMap.audio) {
        for (const variant in manifestMap.audio) {
          const audioEntry = Object.values(manifestMap.audio[variant]).find(
            (v) => v.manifestNumber === manifestNumber,
          );
          if (audioEntry && audioEntry.repeat > 0) {
            maxRepeat = Math.max(maxRepeat, audioEntry.repeat);
          }
        }
      }

      return maxRepeat;
    } catch (error) {
      console.error("Error getting repeat value:", error);
      return 0;
    }
  }

  /**
   * Get the current live playlist for a scenario
   */
  async getLivePlaylist(scenarioId, profileNumber = 0) {
    const streamKey = `${scenarioId}-${profileNumber}`;
    let streamState = this.streamStates.get(streamKey);

    if (!streamState) {
      streamState = await this.initializeLiveStream(scenarioId, profileNumber);
    }

    let requestCount = this.requestCounts.get(streamKey) || 0;
    let nextRequestNumber = requestCount + 1;

    // Safety boundary
    if (nextRequestNumber > streamState.totalManifests) {
      nextRequestNumber = streamState.totalManifests;
    }

    // Check for repeat settings with percentage-based logic
    const manifestMetadata = await this.getManifestMetadata(
      scenarioId,
      `profile.${profileNumber}`,
      nextRequestNumber,
    );

    let repeatValue = 0;
    if (manifestMetadata && manifestMetadata.repeat > 0) {
      if (manifestMetadata.repeatPercentage > 0) {
        // Apply percentage-based random logic for repeat
        const randomValue = Math.random() * 100; // 0-100
        if (randomValue < manifestMetadata.repeatPercentage) {
          repeatValue = manifestMetadata.repeat;
          console.log(
            `[REPEAT] Applying repeat ${repeatValue} to manifest ${nextRequestNumber} (${manifestMetadata.repeatPercentage}% chance triggered)`,
          );
        }
      } else {
        // Legacy behavior: always apply repeat if no percentage is set
        repeatValue = manifestMetadata.repeat;
      }
    }

    let shouldIncrement = true;

    if (repeatValue > 0) {
      let repeatState = this.repeatStates.get(streamKey);
      if (repeatState && repeatState.manifestNumber === nextRequestNumber) {
        // Already repeating this manifest
        if (repeatState.count < repeatValue) {
          repeatState.count++;
          shouldIncrement = false;
          console.log(
            `[REPEAT] Scenario ${scenarioId} Profile ${profileNumber}: Manifest ${nextRequestNumber} repeat ${repeatState.count}/${repeatValue}`,
          );
        } else {
          // Reached repeat limit, move to next manifest WITHOUT delivering current one
          this.repeatStates.delete(streamKey);
          this.requestCounts.set(streamKey, nextRequestNumber);
          console.log(
            `[REPEAT] Scenario ${scenarioId} Profile ${profileNumber}: Manifest ${nextRequestNumber} repeat completed (delivered ${repeatValue} times), moving to next`,
          );
          // Recursively call to get the next manifest
          return this.getLivePlaylist(scenarioId, profileNumber);
        }
      } else {
        // First time seeing this manifest with repeat > 0
        // Start at count 1 (this is the first delivery)
        this.repeatStates.set(streamKey, {
          manifestNumber: nextRequestNumber,
          count: 1,
        });
        shouldIncrement = false;
        console.log(
          `[REPEAT] Scenario ${scenarioId} Profile ${profileNumber}: Starting repeat for manifest ${nextRequestNumber} (1/${repeatValue})`,
        );
      }
    }

    // Check manifestMap.json for this manifestNumber (for delay/status)
    const manifestInfo = await this.getManifestMetadata(
      scenarioId,
      `profile.${profileNumber}`,
      nextRequestNumber,
    );

    let finalStatus = 200;
    const currentRepeatCount = this.repeatStates.get(streamKey)?.count || 0;
    const iterationKey = `${nextRequestNumber}-${currentRepeatCount}`;

    // Apply percentage-based random logic for delay
    if (
      manifestInfo &&
      manifestInfo.delay > 0 &&
      manifestInfo.delayPercentage > 0
    ) {
      const randomValue = Math.random() * 100; // 0-100
      if (randomValue < manifestInfo.delayPercentage) {
        // Apply delay based on percentage
        const currentPending = this.pendingDelays.get(streamKey);
        const currentDelivered = this.deliveredManifests.get(streamKey);

        if (currentPending === iterationKey) {
          // Block progression: return same manifest immediately
        } else if (currentDelivered === iterationKey) {
          // Already delivered this iteration, handle increment logic below
        } else {
          // Start new delay
          console.log(
            `[DELAY] Applying ${manifestInfo.delay}s delay to manifest ${nextRequestNumber} (${manifestInfo.delayPercentage}% chance triggered)`,
          );
          this.pendingDelays.set(streamKey, iterationKey);
          await this.sleep(manifestInfo.delay * 1000);
          this.pendingDelays.delete(streamKey);
          this.deliveredManifests.set(streamKey, iterationKey);
        }
      }
    } else if (
      manifestInfo &&
      manifestInfo.delay > 0 &&
      !manifestInfo.delayPercentage
    ) {
      // Legacy behavior: always apply delay if no percentage is set
      const currentPending = this.pendingDelays.get(streamKey);
      const currentDelivered = this.deliveredManifests.get(streamKey);

      if (currentPending === iterationKey) {
        // Block progression: return same manifest immediately
      } else if (currentDelivered === iterationKey) {
        // Already delivered this iteration, handle increment logic below
      } else {
        // Start new delay
        this.pendingDelays.set(streamKey, iterationKey);
        await this.sleep(manifestInfo.delay * 1000);
        this.pendingDelays.delete(streamKey);
        this.deliveredManifests.set(streamKey, iterationKey);
      }
    }

    if (shouldIncrement) {
      this.requestCounts.set(streamKey, nextRequestNumber);
    }

    // Apply percentage-based random logic for status
    if (manifestInfo && manifestInfo.status && manifestInfo.status !== 200) {
      if (manifestInfo.statusPercentage > 0) {
        const randomValue = Math.random() * 100; // 0-100
        if (randomValue < manifestInfo.statusPercentage) {
          finalStatus = manifestInfo.status;
          console.log(
            `[STATUS] Applying status ${manifestInfo.status} to manifest ${nextRequestNumber} (${manifestInfo.statusPercentage}% chance triggered)`,
          );
        }
      } else {
        // Legacy behavior: always apply status if no percentage is set
        finalStatus = manifestInfo.status;
      }
    }

    // Serve the current manifest number (which might be repeated)
    const playlist = await this.generateSequentialPlaylist(
      scenarioId,
      profileNumber,
      nextRequestNumber,
    );

    if (finalStatus !== 200) {
      return { content: playlist, status: finalStatus };
    }

    return playlist;
  }

  /**
   * Generate a sequential playlist that starts from 1.ts and progresses sequentially
   */
  async generateSequentialPlaylist(scenarioId, profileNumber, requestNumber) {
    try {
      const streamKey = `${scenarioId}-${profileNumber}`;
      const streamState = this.streamStates.get(streamKey);

      if (!streamState || !streamState.manifestList) {
        throw new Error(
          `Stream not initialized for ${scenarioId} profile ${profileNumber}`,
        );
      }

      // Get the manifest index (requestNumber is 1-based, array is 0-based)
      const manifestIndex = Math.min(
        requestNumber - 1,
        streamState.manifestList.length - 1,
      );
      const manifestIndex0Based = Math.max(0, manifestIndex);

      const manifestInfo = streamState.manifestList[manifestIndex0Based];
      if (!manifestInfo) {
        throw new Error(
          `No manifest found at index ${manifestIndex0Based} for ${scenarioId}`,
        );
      }

      // Read the locally saved timestamped manifest
      const scenarioPath = path.join(__dirname, "../hls", scenarioId);
      const profileDir = path.join(
        scenarioPath,
        "profiles",
        String(profileNumber),
      );
      const manifestPath = path.join(profileDir, manifestInfo.filename);

      if (!(await fs.pathExists(manifestPath))) {
        throw new Error(`Manifest file not found: ${manifestPath}`);
      }

      let manifestContent = await fs.readFile(manifestPath, "utf8");

      // Remove EXT-X-ENDLIST to keep it live
      manifestContent = this.removeEndList(manifestContent);

      console.log(
        `Serving locally saved manifest ${manifestInfo.filename} for request ${requestNumber}`,
      );

      return manifestContent;
    } catch (error) {
      console.error(
        `Error generating sequential playlist for ${scenarioId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Remove EXT-X-ENDLIST to keep the stream live while preserving all other attributes
   * Also fix relative URLs to work correctly with the API endpoint structure
   * This ensures the manifest maintains all original HLS attributes like:
   * - #EXTM3U
   * - #EXT-X-VERSION:3
   * - #EXT-X-MEDIA-SEQUENCE
   * - #EXT-X-TARGETDURATION
   * - #EXT-X-PROGRAM-DATE-TIME
   * - #EXTINF
   */
  removeEndList(manifestContent) {
    const lines = manifestContent.split("\n");
    const processedLines = lines
      .filter((line) => line.trim() !== "#EXT-X-ENDLIST")
      .map((line) => {
        // Fix relative URLs for local segments
        if (
          line.trim() &&
          !line.startsWith("#") &&
          line.includes("../media/video/")
        ) {
          // Convert ../media/video/1.ts to ../../media/video/1.ts
          // From /api/scenarios/testing/player/profiles/0/playlist.m3u8
          // We need to go up 2 levels to reach /api/scenarios/testing/player/media/video/1.ts
          return line.replace("../media/video/", "../../media/video/");
        }
        return line;
      });

    return processedLines.join("\n");
  }

  /**
   * Get manifest by chronological index (0 = first manifest downloaded)
   */
  async getManifestByIndex(scenarioId, profileNumber, index) {
    try {
      const streamKey = `${scenarioId}-${profileNumber}`;
      const streamState = this.streamStates.get(streamKey);

      if (
        streamState &&
        streamState.manifestList &&
        index >= 0 &&
        index < streamState.manifestList.length
      ) {
        const scenarioPath = path.join(__dirname, "../hls", scenarioId);
        const profileDir = path.join(
          scenarioPath,
          "profiles",
          String(profileNumber),
        );
        const manifestPath = path.join(
          profileDir,
          streamState.manifestList[index].filename,
        );
        const manifestContent = await fs.readFile(manifestPath, "utf8");
        return manifestContent;
      }

      return null;
    } catch (error) {
      console.error(
        `Error getting manifest by index ${index} for ${scenarioId}:`,
        error.message,
      );
      return null;
    }
  }

  /**
   * Get the last available manifest
   */
  async getLastAvailableManifest(scenarioId, profileNumber) {
    try {
      const streamKey = `${scenarioId}-${profileNumber}`;
      const streamState = this.streamStates.get(streamKey);

      if (
        streamState &&
        streamState.manifestList &&
        streamState.manifestList.length > 0
      ) {
        const lastIndex = streamState.manifestList.length - 1;
        return await this.getManifestByIndex(
          scenarioId,
          profileNumber,
          lastIndex,
        );
      }

      return null;
    } catch (error) {
      console.error(
        `Error getting last available manifest for ${scenarioId}:`,
        error.message,
      );
      return null;
    }
  }

  /**
   * Get stream status/stats for request-based cycling
   */
  getStreamStatus(scenarioId, profileNumber = 0) {
    const streamKey = `${scenarioId}-${profileNumber}`;
    const streamState = this.streamStates.get(streamKey);

    if (!streamState) {
      return { status: "not_initialized" };
    }

    const requestCount = this.requestCounts.get(streamKey) || 0;
    const requestsPerManifest = 1;
    const currentManifestIndex = Math.min(
      Math.floor(requestCount / requestsPerManifest),
      streamState.totalManifests - 1,
    );

    return {
      status: "active",
      scenarioId: streamState.scenarioId,
      profileNumber: streamState.profileNumber,
      totalManifests: streamState.totalManifests,
      currentManifestIndex,
      totalRequests: requestCount,
      requestsPerManifest,
      isComplete: currentManifestIndex >= streamState.totalManifests - 1,
    };
  }

  /**
   * Reset a live stream (restart from beginning)
   */
  resetLiveStream(scenarioId, profileNumber = 0) {
    const streamKey = `${scenarioId}-${profileNumber}`;
    this.streamStates.delete(streamKey);
    this.requestCounts.set(streamKey, 0); // Reset request count
    console.log(`Reset live stream for ${scenarioId} profile ${profileNumber}`);
  }

  /**
   * Reset all profiles for a scenario (useful when loading master manifest)
   */
  resetScenarioStreams(scenarioId) {
    // Reset all profiles for this scenario
    const keysToReset = [];
    for (const [key, state] of this.streamStates.entries()) {
      if (state.scenarioId === scenarioId) {
        keysToReset.push(key);
      }
    }

    keysToReset.forEach((key) => {
      this.streamStates.delete(key);
      this.requestCounts.set(key, 0);
    });

    // Also reset any request counts that might exist without stream states
    for (const [key] of this.requestCounts.entries()) {
      if (key.startsWith(`${scenarioId}-`)) {
        this.requestCounts.set(key, 0);
      }
    }

    console.log(
      `Reset all live streams for scenario ${scenarioId} (${keysToReset.length} profiles reset)`,
    );
  }

  /**
   * Reset all live streams (useful for testing)
   */
  resetAllStreams() {
    this.streamStates.clear();
    this.requestCounts.clear();
    console.log(`Reset all live streams`);
  }

  /**
   * Set custom requests per manifest (for fine-tuning playback speed)
   */
  setRequestsPerManifest(
    scenarioId,
    profileNumber = 0,
    requestsPerManifest = 1,
  ) {
    // This could be implemented if needed for more control
    console.log(
      `Set requests per manifest for ${scenarioId}: ${requestsPerManifest}`,
    );
  }

  /**
   * Extract target duration from original manifest files
   */
  async extractTargetDurationFromOriginal(scenarioId, profileNumber = 0) {
    try {
      const originalScenarioPath = path.join(
        __dirname,
        "../hls",
        `${scenarioId}_original`,
      );
      const originalProfileDir = path.join(
        originalScenarioPath,
        "profiles",
        String(profileNumber),
      );

      // Check if original profile directory exists
      if (!(await fs.pathExists(originalProfileDir))) {
        console.warn(
          `Original profile directory not found: ${originalProfileDir}, using default 6s`,
        );
        return 6; // Default fallback
      }

      // Get the first manifest file to extract target duration
      const manifestFiles = await fs.readdir(originalProfileDir);
      const m3u8Files = manifestFiles.filter((file) => file.endsWith(".m3u8"));

      if (m3u8Files.length === 0) {
        console.warn(
          `No manifest files found in ${originalProfileDir}, using default 6s`,
        );
        return 6; // Default fallback
      }

      // Read the first manifest file
      const firstManifestPath = path.join(originalProfileDir, m3u8Files[0]);
      const manifestContent = await fs.readFile(firstManifestPath, "utf8");

      // Fallback: look for EXT-X-TARGETDURATION in raw content
      const targetDurationMatch = manifestContent.match(
        /#EXT-X-TARGETDURATION:(\d+)/,
      );
      if (targetDurationMatch) {
        const duration = parseInt(targetDurationMatch[1]);
        console.log(`Extracted target duration from raw content: ${duration}s`);
        return duration;
      }

      console.warn(
        `Could not extract target duration from manifest, using default 6s`,
      );
      return 6; // Default fallback
    } catch (error) {
      console.error(
        `Error extracting target duration for ${scenarioId}:`,
        error.message,
      );
      return 6; // Default fallback
    }
  }
  /**
   * Get current request count for a scenario (useful for debugging)
   */
  getRequestCount(scenarioId, profileNumber = 0) {
    const streamKey = `${scenarioId}-${profileNumber}`;
    return this.requestCounts.get(streamKey) || 0;
  }

  /**
   * Set request count manually (useful for testing specific manifest positions)
   */
  setRequestCount(scenarioId, profileNumber = 0, count = 0) {
    const streamKey = `${scenarioId}-${profileNumber}`;
    this.requestCounts.set(streamKey, count);
    console.log(
      `Set request count for ${scenarioId} profile ${profileNumber}: ${count}`,
    );
  }
}

module.exports = new LiveStreamService();
