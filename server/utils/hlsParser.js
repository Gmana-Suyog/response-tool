/**
 * HLS Manifest Parser Utilities
 * Provides functions to parse and manipulate HLS manifests
 */

class HLSParser {
  /**
   * Parse master manifest to extract stream information
   */
  static parseMasterManifest(content) {
    const lines = content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line);
    const streams = [];

    let currentStream = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith("#EXT-X-STREAM-INF:")) {
        // Parse stream info
        currentStream = this.parseStreamInfo(line);

        // Next line should be the URL
        if (i + 1 < lines.length && !lines[i + 1].startsWith("#")) {
          currentStream.url = lines[i + 1];
          streams.push(currentStream);
          currentStream = null;
        }
      }
    }

    return {
      streams,
      isValid: streams.length > 0,
    };
  }

  /**
   * Parse media manifest to extract segment information
   */
  static parseMediaManifest(content) {
    const lines = content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line);
    const segments = [];
    const metadata = {
      version: null,
      targetDuration: null,
      mediaSequence: null,
      isLive: true,
    };

    let currentSegment = null;

    for (const line of lines) {
      if (line.startsWith("#EXT-X-VERSION:")) {
        metadata.version = parseInt(line.split(":")[1]);
      } else if (line.startsWith("#EXT-X-TARGETDURATION:")) {
        metadata.targetDuration = parseInt(line.split(":")[1]);
      } else if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
        metadata.mediaSequence = parseInt(line.split(":")[1]);
      } else if (line.startsWith("#EXTINF:")) {
        const parts = line.split(":")[1].split(",");
        currentSegment = {
          duration: parseFloat(parts[0]),
          title: parts[1] || "",
        };
      } else if (line === "#EXT-X-ENDLIST") {
        metadata.isLive = false;
      } else if (line && !line.startsWith("#")) {
        // This is a segment URL
        if (currentSegment) {
          currentSegment.url = line;
          segments.push(currentSegment);
          currentSegment = null;
        } else {
          // Segment without EXTINF (shouldn't happen in valid HLS)
          segments.push({ url: line, duration: 0 });
        }
      }
    }

    return {
      segments,
      metadata,
      isValid: segments.length > 0,
    };
  }

  /**
   * Parse EXT-X-STREAM-INF line to extract stream properties
   */
  static parseStreamInfo(line) {
    const stream = {};
    const content = line.substring("#EXT-X-STREAM-INF:".length);

    // Split by comma, but be careful of quoted values
    const parts = this.splitStreamInfoParts(content);

    for (const part of parts) {
      const [key, value] = part.split("=", 2);
      if (key && value) {
        const cleanKey = key.trim();
        let cleanValue = value.trim();

        // Remove quotes if present
        if (cleanValue.startsWith('"') && cleanValue.endsWith('"')) {
          cleanValue = cleanValue.slice(1, -1);
        }

        // Convert numeric values
        if (cleanKey === "BANDWIDTH" || cleanKey === "AVERAGE-BANDWIDTH") {
          stream[cleanKey.toLowerCase().replace("-", "_")] =
            parseInt(cleanValue);
        } else if (cleanKey === "FRAME-RATE") {
          stream.frame_rate = parseFloat(cleanValue);
        } else {
          stream[cleanKey.toLowerCase().replace("-", "_")] = cleanValue;
        }
      }
    }

    return stream;
  }

  /**
   * Split stream info parts while respecting quoted values
   */
  static splitStreamInfoParts(content) {
    const parts = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < content.length; i++) {
      const char = content[i];

      if (char === '"') {
        inQuotes = !inQuotes;
        current += char;
      } else if (char === "," && !inQuotes) {
        if (current.trim()) {
          parts.push(current.trim());
        }
        current = "";
      } else {
        current += char;
      }
    }

    if (current.trim()) {
      parts.push(current.trim());
    }

    return parts;
  }

  /**
   * Generate a new manifest with rewritten segment URLs
   */
  static rewriteMediaManifest(
    originalContent,
    segmentMap,
    basePath = "../media/video/"
  ) {
    const lines = originalContent.split("\n");
    const rewrittenLines = [];

    for (const line of lines) {
      if (line.trim() && !line.startsWith("#")) {
        // This is a segment URL
        const segmentName = this.extractSegmentName(line.trim());
        const localSegmentName = segmentMap[segmentName];

        if (localSegmentName) {
          rewrittenLines.push(basePath + localSegmentName);
        } else {
          // Keep original if not found in map
          rewrittenLines.push(line);
        }
      } else {
        // Keep all other lines (headers, comments, etc.)
        rewrittenLines.push(line);
      }
    }

    return rewrittenLines.join("\n");
  }

  /**
   * Extract segment filename from URL
   */
  static extractSegmentName(url) {
    // Handle both full URLs and relative paths
    const parts = url.split("/");
    return parts[parts.length - 1];
  }

  /**
   * Validate HLS manifest format
   */
  static validateManifest(content) {
    const lines = content.split("\n").map((line) => line.trim());

    // Must start with #EXTM3U
    if (!lines[0] || lines[0] !== "#EXTM3U") {
      return { valid: false, error: "Manifest must start with #EXTM3U" };
    }

    // Check for required tags in media manifests
    const hasTargetDuration = lines.some((line) =>
      line.startsWith("#EXT-X-TARGETDURATION:")
    );
    const hasSegments = lines.some((line) => line && !line.startsWith("#"));

    if (hasSegments && !hasTargetDuration) {
      return {
        valid: false,
        error: "Media manifest missing EXT-X-TARGETDURATION",
      };
    }

    return { valid: true };
  }

  /**
   * Get manifest type (master or media)
   */
  static getManifestType(content) {
    const lines = content.split("\n").map((line) => line.trim());

    // Master manifests contain EXT-X-STREAM-INF
    if (lines.some((line) => line.startsWith("#EXT-X-STREAM-INF:"))) {
      return "master";
    }

    // Media manifests contain EXTINF or segments
    if (
      lines.some((line) => line.startsWith("#EXTINF:")) ||
      lines.some((line) => line && !line.startsWith("#"))
    ) {
      return "media";
    }

    return "unknown";
  }
}

module.exports = HLSParser;
