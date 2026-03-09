const fs = require("fs-extra");
const path = require("path");

/**
 * Service to safely handle segment map operations with file locking protection
 */
class SegmentMapService {
  constructor() {
    // Track ongoing operations to prevent concurrent writes
    this.operationLocks = new Map();
  }

  /**
   * Safely read segment map with error handling
   */
  async readSegmentMap(scenarioPath) {
    const segmentMapPath = path.join(scenarioPath, "segmentMap.json");

    try {
      if (!(await fs.pathExists(segmentMapPath))) {
        return {};
      }

      const content = await fs.readFile(segmentMapPath, "utf8");

      // Handle empty or corrupted files
      if (!content.trim()) {
        console.log("Empty segment map file, returning empty object");
        return {};
      }

      try {
        return JSON.parse(content);
      } catch (parseError) {
        console.error(
          "Corrupted segment map JSON, recreating:",
          parseError.message,
        );
        // Backup corrupted file
        const backupPath = path.join(
          scenarioPath,
          `segmentMap.backup.${Date.now()}.json`,
        );
        await fs.writeFile(backupPath, content);
        console.log(`Backed up corrupted segment map to: ${backupPath}`);
        return {};
      }
    } catch (error) {
      console.error("Error reading segment map:", error.message);
      return {};
    }
  }

  /**
   * Safely write segment map with locking protection
   */
  async writeSegmentMap(scenarioPath, segmentMap) {
    const segmentMapPath = path.join(scenarioPath, "segmentMap.json");
    const lockKey = segmentMapPath;

    // Wait for any ongoing operations on this file
    while (this.operationLocks.has(lockKey)) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    // Acquire lock
    this.operationLocks.set(lockKey, true);

    try {
      // Ensure directory exists
      await fs.ensureDir(scenarioPath);

      // Write to temporary file first, then rename (atomic operation)
      const tempPath = `${segmentMapPath}.tmp`;
      await fs.writeJson(tempPath, segmentMap, { spaces: 2 });

      // Atomic rename
      await fs.rename(tempPath, segmentMapPath);

      console.log(
        `Safely updated segment map with ${Object.keys(segmentMap).length} entries`,
      );
    } catch (error) {
      console.error("Error writing segment map:", error.message);
      throw error;
    } finally {
      // Release lock
      this.operationLocks.delete(lockKey);
    }
  }

  /**
   * Add a single segment to the map safely
   */
  async addSegment(scenarioPath, originalFileName, localFileName) {
    const segmentMap = await this.readSegmentMap(scenarioPath);
    segmentMap[originalFileName] = localFileName;
    await this.writeSegmentMap(scenarioPath, segmentMap);

    console.log(
      `Added segment mapping: ${originalFileName} → ${localFileName}`,
    );
    return segmentMap;
  }

  /**
   * Add multiple segments to the map safely
   */
  async addSegments(scenarioPath, segmentMappings) {
    const segmentMap = await this.readSegmentMap(scenarioPath);

    Object.assign(segmentMap, segmentMappings);
    await this.writeSegmentMap(scenarioPath, segmentMap);

    const addedCount = Object.keys(segmentMappings).length;
    console.log(`Added ${addedCount} segment mappings to map`);
    return segmentMap;
  }

  /**
   * Get segment count safely
   */
  async getSegmentCount(scenarioPath) {
    const segmentMap = await this.readSegmentMap(scenarioPath);
    return Object.keys(segmentMap).length;
  }

  /**
   * Check if segment exists in map
   */
  async hasSegment(scenarioPath, originalFileName) {
    const segmentMap = await this.readSegmentMap(scenarioPath);
    return segmentMap.hasOwnProperty(originalFileName);
  }
}

module.exports = new SegmentMapService();
