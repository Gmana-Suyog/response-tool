const fs = require("fs-extra");
const path = require("path");

/**
 * Tracks manifest requests per profile to enable pointer swapping
 * Part 7 of spec: "profileManifest.m3u8" behavior
 */
class ManifestRequestTracker {
  constructor() {
    // Map: scenarioId -> profileNumber -> requestCount
    this.requestCounts = new Map();
  }

  /**
   * Get the next request number for a profile and increment counter
   */
  getNextRequestNumber(scenarioId, profileNumber) {
    if (!this.requestCounts.has(scenarioId)) {
      this.requestCounts.set(scenarioId, new Map());
    }

    const scenarioMap = this.requestCounts.get(scenarioId);
    const currentCount = scenarioMap.get(profileNumber) || 0;
    const nextCount = currentCount + 1;

    scenarioMap.set(profileNumber, nextCount);

    return nextCount;
  }

  /**
   * Reset request counter for a profile
   */
  resetRequestCount(scenarioId, profileNumber) {
    if (this.requestCounts.has(scenarioId)) {
      const scenarioMap = this.requestCounts.get(scenarioId);
      scenarioMap.delete(profileNumber);
    }
  }

  /**
   * Reset all request counters for a scenario
   */
  resetScenario(scenarioId) {
    this.requestCounts.delete(scenarioId);
  }

  /**
   * Get current request count without incrementing
   */
  getCurrentRequestCount(scenarioId, profileNumber) {
    if (!this.requestCounts.has(scenarioId)) {
      return 0;
    }

    const scenarioMap = this.requestCounts.get(scenarioId);
    return scenarioMap.get(profileNumber) || 0;
  }

  /**
   * Serve the correct manifest based on request number
   * This implements the pointer swapping logic from Part 7
   */
  async serveProfileManifest(
    scenarioId,
    profileNumber,
    useProfileManifest = false,
  ) {
    try {
      const scenarioPath = path.join(__dirname, "../hls", scenarioId);
      const profileDir = path.join(
        scenarioPath,
        "profiles",
        String(profileNumber),
      );

      // If not using profileManifest.m3u8 pointer swapping, just return playlist.m3u8
      if (!useProfileManifest) {
        const playlistPath = path.join(profileDir, "playlist.m3u8");
        if (await fs.pathExists(playlistPath)) {
          return await fs.readFile(playlistPath, "utf8");
        }
        throw new Error(`Playlist not found for profile ${profileNumber}`);
      }

      // Get request number
      const requestNumber = this.getNextRequestNumber(
        scenarioId,
        profileNumber,
      );

      // Get all timestamped manifests for this profile
      const manifestFiles = await fs.readdir(profileDir);
      const timestampedManifests = manifestFiles
        .filter((file) => file.match(/^\d+-\d+-\d+h-\d+m-\d+s\.m3u8$/))
        .sort((a, b) => {
          const timestampA = parseInt(a.split("-")[0]);
          const timestampB = parseInt(b.split("-")[0]);
          return timestampA - timestampB; // Oldest first
        });

      if (timestampedManifests.length === 0) {
        // Fall back to playlist.m3u8 if no timestamped manifests
        const playlistPath = path.join(profileDir, "playlist.m3u8");
        if (await fs.pathExists(playlistPath)) {
          return await fs.readFile(playlistPath, "utf8");
        }
        throw new Error(`No manifests found for profile ${profileNumber}`);
      }

      // Select manifest based on request number (circular)
      const manifestIndex = (requestNumber - 1) % timestampedManifests.length;
      const selectedManifest = timestampedManifests[manifestIndex];
      const selectedManifestPath = path.join(profileDir, selectedManifest);

      console.log(
        `Request #${requestNumber} for profile ${profileNumber}: serving ${selectedManifest} (${
          manifestIndex + 1
        }/${timestampedManifests.length})`,
      );

      // Read and return the selected manifest
      const manifestContent = await fs.readFile(selectedManifestPath, "utf8");

      // Optional: Create/update profileManifest.m3u8 as a pointer
      const profileManifestPath = path.join(profileDir, "profileManifest.m3u8");

      // Delete old profileManifest.m3u8 if it exists
      if (await fs.pathExists(profileManifestPath)) {
        await fs.remove(profileManifestPath);
      }

      // Copy selected manifest as profileManifest.m3u8
      await fs.writeFile(profileManifestPath, manifestContent);

      return manifestContent;
    } catch (error) {
      console.error(
        `Error serving profile manifest for ${scenarioId}/${profileNumber}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get statistics about manifest requests
   */
  getStats(scenarioId) {
    if (!this.requestCounts.has(scenarioId)) {
      return {};
    }

    const scenarioMap = this.requestCounts.get(scenarioId);
    const stats = {};

    for (const [profileNumber, count] of scenarioMap.entries()) {
      stats[`profile_${profileNumber}`] = count;
    }

    return stats;
  }
}

module.exports = new ManifestRequestTracker();
