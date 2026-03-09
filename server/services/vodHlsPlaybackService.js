const fs = require("fs-extra");
const path = require("path");

/**
 * VOD HLS Playback Service
 * 
 * Handles playback for VOD HLS scenarios:
 * - Serves static VOD manifests (no live streaming logic)
 * - Serves master-local.m3u8 for multi-bitrate playback
 * - Serves playlist.m3u8 for single profile playback
 * - Serves audio manifests if available
 * - All manifests are static (EXT-X-ENDLIST present)
 * - Applies delay and status code configurations from manifestMap.json
 */
class VodHlsPlaybackService {
  constructor() {
    // Track request counts per scenario/profile for applying configurations
    this.requestCounts = new Map();
  }

  /**
   * Sleep helper for delays
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get manifest metadata from manifestMap.json
   */
  async getManifestMetadata(scenarioId, sectionKey, manifestNumber) {
    try {
      const manifestMapPath = path.join(
        __dirname,
        "../vod/hls",
        scenarioId,
        "manifestMap.json",
      );

      if (!(await fs.pathExists(manifestMapPath))) {
        return null;
      }

      const manifestMap = await fs.readJson(manifestMapPath);

      // Navigate to the correct section (e.g., profile.0 or audio.eng)
      const sectionParts = sectionKey.split(".");
      let target = manifestMap;
      for (const part of sectionParts) {
        target = target[part];
        if (!target) return null;
      }

      // Find manifest by manifestNumber
      for (const key of Object.keys(target)) {
        if (target[key].manifestNumber === manifestNumber) {
          return target[key];
        }
      }

      return null;
    } catch (error) {
      console.error(
        `Error getting manifest metadata for ${scenarioId}:`,
        error,
      );
      return null;
    }
  }

  /**
   * Get the VOD master manifest
   */
  async getVodMasterManifest(scenarioId) {
    try {
      const scenarioPath = path.join(__dirname, "../vod/hls", scenarioId);
      const masterLocalPath = path.join(
        scenarioPath,
        "master/master-local.m3u8",
      );

      if (!(await fs.pathExists(masterLocalPath))) {
        throw new Error("VOD master manifest not found");
      }

      const manifestContent = await fs.readFile(masterLocalPath, "utf8");
      console.log(`[VOD-${scenarioId}] Serving master-local.m3u8`);

      return manifestContent;
    } catch (error) {
      console.error(
        `Error getting VOD master manifest for ${scenarioId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get the VOD profile playlist with delay and status configurations applied
   */
  async getVodProfilePlaylist(scenarioId, profileNumber) {
    try {
      const scenarioPath = path.join(__dirname, "../vod/hls", scenarioId);
      const playlistPath = path.join(
        scenarioPath,
        "profiles",
        String(profileNumber),
        "playlist.m3u8",
      );

      if (!(await fs.pathExists(playlistPath))) {
        throw new Error(
          `VOD profile ${profileNumber} playlist not found for scenario ${scenarioId}`,
        );
      }

      // Track request count for this scenario/profile
      const streamKey = `${scenarioId}-profile-${profileNumber}`;
      const currentCount = this.requestCounts.get(streamKey) || 0;
      const nextCount = currentCount + 1;
      this.requestCounts.set(streamKey, nextCount);

      // Get manifest metadata for configuration (manifestNumber is always 1 for VOD)
      const manifestInfo = await this.getManifestMetadata(
        scenarioId,
        `profile.${profileNumber}`,
        1,
      );

      let finalStatus = 200;

      // Apply delay if configured
      if (manifestInfo && manifestInfo.delay > 0) {
        const delayPercentage = manifestInfo.delayPercentage || 100;
        const randomValue = Math.random() * 100;

        if (randomValue < delayPercentage) {
          console.log(
            `[VOD-DELAY] Applying ${manifestInfo.delay}s delay to profile ${profileNumber} playlist (${delayPercentage}% chance triggered)`,
          );
          await this.sleep(manifestInfo.delay * 1000);
        }
      }

      // Apply status code if configured
      if (manifestInfo && manifestInfo.status && manifestInfo.status !== 200) {
        const statusPercentage = manifestInfo.statusPercentage || 100;
        const randomValue = Math.random() * 100;

        if (randomValue < statusPercentage) {
          finalStatus = manifestInfo.status;
          console.log(
            `[VOD-STATUS] Applying status ${manifestInfo.status} to profile ${profileNumber} playlist (${statusPercentage}% chance triggered)`,
          );
        }
      }

      const manifestContent = await fs.readFile(playlistPath, "utf8");
      console.log(
        `[VOD-${scenarioId}] Serving profile ${profileNumber} playlist.m3u8 (request #${nextCount}, status: ${finalStatus})`,
      );

      return { content: manifestContent, status: finalStatus };
    } catch (error) {
      console.error(
        `Error getting VOD profile playlist for ${scenarioId}, profile ${profileNumber}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get the VOD audio playlist with delay and status configurations applied
   */
  async getVodAudioPlaylist(scenarioId, audioVariant) {
    try {
      const scenarioPath = path.join(__dirname, "../vod/hls", scenarioId);
      const audioPlaylistPath = path.join(
        scenarioPath,
        "audio",
        audioVariant,
        "audio.m3u8",
      );

      if (!(await fs.pathExists(audioPlaylistPath))) {
        throw new Error(
          `VOD audio playlist not found for variant ${audioVariant} in scenario ${scenarioId}`,
        );
      }

      // Track request count for this scenario/audio
      const streamKey = `${scenarioId}-audio-${audioVariant}`;
      const currentCount = this.requestCounts.get(streamKey) || 0;
      const nextCount = currentCount + 1;
      this.requestCounts.set(streamKey, nextCount);

      // Get manifest metadata for configuration (manifestNumber is always 1 for VOD)
      const manifestInfo = await this.getManifestMetadata(
        scenarioId,
        `audio.${audioVariant}`,
        1,
      );

      let finalStatus = 200;

      // Apply delay if configured
      if (manifestInfo && manifestInfo.delay > 0) {
        const delayPercentage = manifestInfo.delayPercentage || 100;
        const randomValue = Math.random() * 100;

        if (randomValue < delayPercentage) {
          console.log(
            `[VOD-DELAY] Applying ${manifestInfo.delay}s delay to audio ${audioVariant} playlist (${delayPercentage}% chance triggered)`,
          );
          await this.sleep(manifestInfo.delay * 1000);
        }
      }

      // Apply status code if configured
      if (manifestInfo && manifestInfo.status && manifestInfo.status !== 200) {
        const statusPercentage = manifestInfo.statusPercentage || 100;
        const randomValue = Math.random() * 100;

        if (randomValue < statusPercentage) {
          finalStatus = manifestInfo.status;
          console.log(
            `[VOD-STATUS] Applying status ${manifestInfo.status} to audio ${audioVariant} playlist (${statusPercentage}% chance triggered)`,
          );
        }
      }

      const manifestContent = await fs.readFile(audioPlaylistPath, "utf8");
      console.log(
        `[VOD-${scenarioId}] Serving audio playlist for variant ${audioVariant} (request #${nextCount}, status: ${finalStatus})`,
      );

      return { content: manifestContent, status: finalStatus };
    } catch (error) {
      console.error(
        `Error getting VOD audio playlist for ${scenarioId}, variant ${audioVariant}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Check if VOD scenario has been rewritten and is ready for playback
   */
  async isVodScenarioReady(scenarioId) {
    try {
      const scenarioPath = path.join(__dirname, "../vod/hls", scenarioId);

      // Check if master-local.m3u8 exists
      const masterLocalPath = path.join(
        scenarioPath,
        "master/master-local.m3u8",
      );
      if (!(await fs.pathExists(masterLocalPath))) {
        return false;
      }

      // Check if profile 0 playlist exists
      const playlistPath = path.join(
        scenarioPath,
        "profiles/0/playlist.m3u8",
      );
      if (!(await fs.pathExists(playlistPath))) {
        return false;
      }

      // Check if media directory exists with segments
      const mediaVideoDir = path.join(scenarioPath, "media/video");
      if (!(await fs.pathExists(mediaVideoDir))) {
        return false;
      }

      const videoFiles = await fs.readdir(mediaVideoDir);
      const tsFiles = videoFiles.filter((f) => f.endsWith(".ts"));

      if (tsFiles.length === 0) {
        return false;
      }

      console.log(
        `[VOD-${scenarioId}] Scenario is ready for playback (${tsFiles.length} segments)`,
      );
      return true;
    } catch (error) {
      console.error(
        `Error checking VOD scenario readiness for ${scenarioId}:`,
        error,
      );
      return false;
    }
  }

  /**
   * Get VOD scenario statistics
   */
  async getVodScenarioStats(scenarioId) {
    try {
      const scenarioPath = path.join(__dirname, "../vod/hls", scenarioId);

      // Count video segments
      const mediaVideoDir = path.join(scenarioPath, "media/video");
      let videoSegmentCount = 0;
      if (await fs.pathExists(mediaVideoDir)) {
        const videoFiles = await fs.readdir(mediaVideoDir);
        videoSegmentCount = videoFiles.filter((f) => f.endsWith(".ts")).length;
      }

      // Count audio segments if they exist
      const mediaAudioDir = path.join(scenarioPath, "media/audio");
      let audioSegmentCount = 0;
      if (await fs.pathExists(mediaAudioDir)) {
        const audioFiles = await fs.readdir(mediaAudioDir);
        audioSegmentCount = audioFiles.filter((f) => f.endsWith(".ts")).length;
      }

      // Check if segmentTiming.json exists to get duration info
      const segmentTimingPath = path.join(scenarioPath, "segmentTiming.json");
      let totalDuration = 0;
      if (await fs.pathExists(segmentTimingPath)) {
        const segmentTiming = await fs.readJson(segmentTimingPath);
        for (const timing of Object.values(segmentTiming)) {
          totalDuration += timing.extinf || 0;
        }
      }

      return {
        videoSegmentCount,
        audioSegmentCount,
        totalDuration: Math.round(totalDuration),
        isReady: videoSegmentCount > 0,
      };
    } catch (error) {
      console.error(
        `Error getting VOD scenario stats for ${scenarioId}:`,
        error,
      );
      return {
        videoSegmentCount: 0,
        audioSegmentCount: 0,
        totalDuration: 0,
        isReady: false,
      };
    }
  }
}

module.exports = new VodHlsPlaybackService();
