const fs = require("fs-extra");
const path = require("path");
const config = require("../config");

/**
 * Segment Identity Service
 *
 * Implements immutable segment identity tracking:
 * - Each segment is identified once, stored once, named once
 * - Segments are never renamed
 * - Playlists are regenerated as sliding views over segments
 */
class SegmentIdentityService {
  /**
   * Load or initialize the segment identity map
   * @param {string} scenarioPath - Path to scenario directory
   * @returns {Promise<Object>} Identity map and next ID
   */
  async loadIdentityMap(scenarioPath) {
    const identityMapPath = path.join(scenarioPath, "segmentMap.json");

    if (await fs.pathExists(identityMapPath)) {
      const data = await fs.readJson(identityMapPath);

      // Check if it's the new format (has mapping and nextId)
      if (data.mapping && data.nextId) {
        return {
          mapping: data.mapping,
          nextId: data.nextId,
          path: identityMapPath,
        };
      }

      // Old format - migrate it
      console.log("Migrating old segmentMap.json format to new format");
      const mapping = {};
      let maxId = 0;

      // Convert old format to new format
      for (const [sourceUri, internalUri] of Object.entries(data)) {
        const id = parseInt(internalUri.replace(".ts", ""));
        if (!isNaN(id) && id > maxId) {
          maxId = id;
        }

        mapping[sourceUri] = {
          sourceUri,
          internalId: id,
          internalUri,
          duration: 6.0,
          programDateTime: null,
          downloaded: true,
          createdAt: new Date().toISOString(),
        };
      }

      return {
        mapping,
        nextId: maxId + 1,
        path: identityMapPath,
      };
    }

    return {
      mapping: {},
      nextId: 1,
      path: identityMapPath,
    };
  }

  /**
   * Save the segment identity map
   * @param {string} identityMapPath - Path to identity map file
   * @param {Object} mapping - Segment mapping
   * @param {number} nextId - Next available ID
   */
  async saveIdentityMap(identityMapPath, mapping, nextId) {
    await fs.writeJson(
      identityMapPath,
      {
        mapping,
        nextId,
        lastUpdated: new Date().toISOString(),
      },
      { spaces: 2 },
    );
  }

  /**
   * Parse HLS manifest and extract segment information
   * @param {string} manifestContent - Raw manifest content
   * @param {string} baseUrl - Base URL for resolving relative URIs
   * @returns {Object} Segments array and media sequence
   */
  parseManifestSegments(manifestContent, baseUrl) {
    const lines = manifestContent.split("\n");
    const segments = [];
    let currentDuration = null;
    let currentProgramDateTime = null;
    let mediaSequence = null;
    let currentSequenceNumber = null;

    // Extract media sequence from manifest
    for (const line of lines) {
      if (line.trim().startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
        mediaSequence = parseInt(line.split(":")[1]);
        currentSequenceNumber = mediaSequence;
        break;
      }
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Extract duration
      if (line.startsWith("#EXTINF:")) {
        const match = line.match(/#EXTINF:([\d.]+)/);
        if (match) {
          currentDuration = parseFloat(match[1]);
        }
      }

      // Extract program date time
      if (line.startsWith("#EXT-X-PROGRAM-DATE-TIME:")) {
        currentProgramDateTime = line.split(":", 2)[1].trim();
      }

      // Segment URI
      if (line && !line.startsWith("#")) {
        const sourceUri = this.resolveUrl(line, baseUrl);

        segments.push({
          sourceUri,
          duration: currentDuration || 6.0,
          programDateTime: currentProgramDateTime,
          sequenceNumber: currentSequenceNumber,
          originalLine: line,
        });

        // Increment sequence number for next segment
        if (currentSequenceNumber !== null) {
          currentSequenceNumber++;
        }

        // Reset for next segment
        currentDuration = null;
        currentProgramDateTime = null;
      }
    }

    return {
      segments,
      mediaSequence: mediaSequence || 0,
    };
  }

  /**
   * Backward scan to find new segments (Approach B core algorithm)
   *
   * Logic:
   * 1. Start from last segment
   * 2. If NOT in mapping -> add to new segments list
   * 3. If EXISTS in mapping -> set flag = true
   * 4. If NOT EXISTS and flag = true -> STOP (we've found the overlap point)
   * 5. Apply maxSegmentsPerFetch limit if provided
   *
   * @param {Array} playlistSegments - Ordered segments from latest playlist
   * @param {Object} mapping - Existing segment identity mapping
   * @param {boolean} isFirstManifest - Whether this is the first manifest fetch
   * @param {number} maxSegmentsPerFetch - Maximum number of new segments to ingest (default: 6)
   * @returns {Object} { newSegments: Array, limitApplied: boolean, totalNewFound: number }
   */
  findNewSegments(
    playlistSegments,
    mapping,
    isFirstManifest = false,
    maxSegmentsPerFetch = 6,
  ) {
    const newSegments = [];
    let foundExistingSegment = false; // Flag to track if we found an existing segment
    let segmentCount = 0;
    let limitApplied = false;

    // Walk backward from the end
    for (let i = playlistSegments.length - 1; i >= 0; i--) {
      const segment = playlistSegments[i];
      const existsInMapping = !!mapping[segment.sourceUri];

      if (existsInMapping) {
        // Found existing segment - set flag
        foundExistingSegment = true;
        console.log(
          `Found existing segment at position ${i}: ${path.basename(
            segment.sourceUri,
          )}`,
        );
      } else {
        // Segment does NOT exist in mapping

        if (foundExistingSegment) {
          // We already found an existing segment, and now we found a non-existing one
          // This means we've passed the overlap point - STOP
          console.log(
            `Stopping scan - found gap after existing segment at position ${i}`,
          );
          break;
        }

        // This is a new segment - add it (prepend to maintain order)
        newSegments.unshift(segment);
        segmentCount++;
        console.log(
          `New segment at position ${i}: ${path.basename(segment.sourceUri)}`,
        );

        // Apply segment limit
        if (segmentCount >= maxSegmentsPerFetch) {
          limitApplied = true;
          console.log(
            `Segment limit reached (${maxSegmentsPerFetch} segments)`,
          );
          break;
        }
      }
    }

    const totalNewFound = newSegments.length;

    // Log information about limit application
    if (limitApplied && totalNewFound < segmentCount) {
      console.warn(
        `Playlist produced more than ${maxSegmentsPerFetch} new segments, limit applied. Found: ${segmentCount}, Ingested: ${totalNewFound}`,
      );
    } else if (totalNewFound > 0 && totalNewFound < maxSegmentsPerFetch) {
      console.log(
        `Playlist produced ${totalNewFound} new segments, limit is ${maxSegmentsPerFetch} (no limiting needed)`,
      );
    }

    console.log(`Scan complete: ${newSegments.length} new segments found`);

    return {
      newSegments,
      limitApplied,
      totalNewFound,
    };
  }

  /**
   * Assign stable identities to new segments
   * @param {Array} newSegments - New segments to assign IDs
   * @param {Object} mapping - Existing mapping
   * @param {number} nextId - Next available ID
   * @returns {Object} Updated mapping and next ID
   */
  assignIdentities(newSegments, mapping, nextId) {
    const updatedMapping = { ...mapping };
    let currentId = nextId;

    for (const segment of newSegments) {
      const internalId = currentId++;
      const internalUri = `${internalId}.ts`;

      updatedMapping[segment.sourceUri] = {
        sourceUri: segment.sourceUri,
        internalId,
        internalUri,
        duration: segment.duration,
        programDateTime: segment.programDateTime,
        sequenceNumber: segment.sequenceNumber,
        downloaded: false,
        createdAt: new Date().toISOString(),
      };
    }

    return {
      mapping: updatedMapping,
      nextId: currentId,
    };
  }

  /**
   * Rewrite playlist with internal URIs
   * @param {string} originalManifest - Original manifest content
   * @param {Array} playlistSegments - Parsed segments
   * @param {Object} mapping - Segment identity mapping
   * @param {string} scenarioId - Scenario ID for URL generation
   * @param {string} mediaType - 'video' or 'audio'
   * @returns {string} Rewritten manifest
   */
  rewritePlaylist(
    originalManifest,
    playlistSegments,
    mapping,
    scenarioId,
    mediaType = "video",
  ) {
    const lines = originalManifest.split("\n");
    const rewrittenLines = [];
    let segmentIndex = 0;
    let originMediaSequence = null;
    let localSegmentCount = 0;

    // First pass: extract origin media sequence
    for (const line of lines) {
      if (line.trim().startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
        originMediaSequence = parseInt(line.split(":")[1]);
        break;
      }
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Keep MEDIA-SEQUENCE exactly as it is in the origin manifest
      // The origin manifest is the source of truth for the window
      if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
        rewrittenLines.push(line); // Keep original - DO NOT MODIFY
        continue;
      }

      // Rewrite segment URIs - use local if available, origin if not
      if (line && !line.startsWith("#")) {
        localSegmentCount++; // Count segments in local manifest

        if (segmentIndex < playlistSegments.length) {
          const segment = playlistSegments[segmentIndex];
          const identity = mapping[segment.sourceUri];

          if (identity && identity.downloaded) {
            // Use relative URL for local playback
            const relativeUrl = `../../media/${mediaType}/${identity.internalUri}`;
            rewrittenLines.push(relativeUrl);
          } else {
            // Skip segments that are not downloaded yet
            console.log(`Skipping undownloaded segment: ${segment.sourceUri}`);

            // Also remove the preceding #EXTINF line if it exists
            if (
              rewrittenLines.length > 0 &&
              rewrittenLines[rewrittenLines.length - 1].startsWith("#EXTINF")
            ) {
              rewrittenLines.pop(); // Remove the #EXTINF line
              console.log(
                `Also removed preceding #EXTINF line for undownloaded segment`,
              );
            }

            // Don't add this segment to the rewritten manifest
            segmentIndex++;
            continue;
          }

          segmentIndex++;
        } else {
          rewrittenLines.push(line);
        }
      } else {
        // Keep all metadata lines unchanged (EXTINF, PDT, etc.)
        rewrittenLines.push(line);
      }
    }

    const rewrittenManifest = rewrittenLines.join("\n");

    // GUARDRAILS: Ensure local manifest matches origin structure
    this.validateManifestStructure(
      rewrittenManifest,
      originalManifest,
      originMediaSequence,
      playlistSegments.length,
      localSegmentCount,
    );

    return rewrittenManifest;
  }

  /**
   * Validate that local manifest maintains origin structure
   * CRITICAL: Prevents storage-driven decisions from corrupting timeline
   * @param {string} localManifest - Generated local manifest
   * @param {string} originManifest - Original manifest
   * @param {number} originMediaSequence - Origin media sequence
   * @param {number} originSegmentCount - Origin segment count
   * @param {number} localSegmentCount - Local segment count
   */
  validateManifestStructure(
    localManifest,
    originManifest,
    originMediaSequence,
    originSegmentCount,
    localSegmentCount,
  ) {
    // Extract local media sequence
    const localMediaSequenceMatch = localManifest.match(
      /#EXT-X-MEDIA-SEQUENCE:(\d+)/,
    );
    const localMediaSequence = localMediaSequenceMatch
      ? parseInt(localMediaSequenceMatch[1])
      : null;

    // GUARDRAIL 1: MEDIA-SEQUENCE must always match origin
    if (localMediaSequence !== originMediaSequence) {
      const error = `MANIFEST VALIDATION FAILED: MEDIA-SEQUENCE mismatch
        Origin: ${originMediaSequence}
        Local:  ${localMediaSequence}
        
        This indicates storage-driven decisions are corrupting the timeline.
        The origin manifest must be the source of truth for MEDIA-SEQUENCE.`;

      console.error(error);
      throw new Error(
        `MEDIA-SEQUENCE validation failed: origin=${originMediaSequence}, local=${localMediaSequence}`,
      );
    }

    // GUARDRAIL 2: Segment count must always match origin
    if (localSegmentCount !== originSegmentCount) {
      const error = `MANIFEST VALIDATION FAILED: Segment count mismatch
        Origin segments: ${originSegmentCount}
        Local segments:  ${localSegmentCount}
        
        This indicates the local manifest window differs from origin.
        The origin manifest must determine which segments appear.`;

      console.error(error);
      throw new Error(
        `Segment count validation failed: origin=${originSegmentCount}, local=${localSegmentCount}`,
      );
    }

    // Success - log validation passed
    console.log(
      `Manifest validation passed: MEDIA-SEQUENCE=${localMediaSequence}, segments=${localSegmentCount}`,
    );
  }

  /**
   * Resolve relative URL to absolute
   * @param {string} url - URL to resolve
   * @param {string} baseUrl - Base URL
   * @returns {string} Absolute URL
   */
  resolveUrl(url, baseUrl) {
    if (url.startsWith("http")) {
      return url;
    }

    const base = new URL(baseUrl);
    return new URL(url, base).href;
  }

  /**
   * Get statistics about segment identity map
   * @param {string} scenarioPath - Path to scenario
   * @returns {Promise<Object>} Statistics
   */
  async getStatistics(scenarioPath) {
    const identityMap = await this.loadIdentityMap(scenarioPath);
    const segments = Object.values(identityMap.mapping);

    return {
      totalSegments: segments.length,
      downloadedSegments: segments.filter((s) => s.downloaded).length,
      nextId: identityMap.nextId,
      oldestSegment: segments[0]?.createdAt,
      newestSegment: segments[segments.length - 1]?.createdAt,
    };
  }

  /**
   * Load or initialize the manifest mapping
   * @param {string} scenarioPath - Path to scenario directory
   * @param {number} profileNumber - Profile number
   * @returns {Promise<Object>} Manifest mapping
   */
  async loadManifestMapping(scenarioPath, profileNumber) {
    const manifestMappingPath = path.join(
      scenarioPath,
      `manifestMapping_profile${profileNumber}.json`,
    );

    if (await fs.pathExists(manifestMappingPath)) {
      return await fs.readJson(manifestMappingPath);
    }

    return {
      profileNumber,
      mappings: [],
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Save manifest mapping entry
   * @param {string} scenarioPath - Path to scenario directory
   * @param {number} profileNumber - Profile number
   * @param {string} originalManifestUrl - Original manifest URL
   * @param {string} rewrittenManifestFile - Rewritten manifest filename
   * @param {number} mediaSequence - Media sequence number
   * @param {Object} manifestMetadata - Additional manifest metadata
   */
  async saveManifestMapping(
    scenarioPath,
    profileNumber,
    originalManifestUrl,
    rewrittenManifestFile,
    mediaSequence,
    manifestMetadata = {},
  ) {
    const manifestMappingPath = path.join(
      scenarioPath,
      `manifestMapping_profile${profileNumber}.json`,
    );

    // Load existing mapping
    const manifestMapping = await this.loadManifestMapping(
      scenarioPath,
      profileNumber,
    );

    // Create new mapping entry
    const mappingEntry = {
      timestamp: new Date().toISOString(),
      originalManifestUrl,
      rewrittenManifestFile,
      mediaSequence,
      segmentCount: manifestMetadata.segmentCount || 0,
      targetDuration: manifestMetadata.targetDuration || 6,
      playlistType: manifestMetadata.playlistType || null,
      version: manifestMetadata.version || 3,
    };

    // Add to mappings array
    manifestMapping.mappings.push(mappingEntry);
    manifestMapping.lastUpdated = new Date().toISOString();

    // Keep only last 100 entries to prevent file from growing too large
    if (manifestMapping.mappings.length > 100) {
      manifestMapping.mappings = manifestMapping.mappings.slice(-100);
    }

    // Save updated mapping
    await fs.writeJson(manifestMappingPath, manifestMapping, { spaces: 2 });

    console.log(
      `Saved manifest mapping: ${rewrittenManifestFile} (sequence: ${mediaSequence})`,
    );
  }

  /**
   * Get manifest mapping statistics
   * @param {string} scenarioPath - Path to scenario directory
   * @param {number} profileNumber - Profile number
   * @returns {Promise<Object>} Manifest mapping statistics
   */
  async getManifestMappingStats(scenarioPath, profileNumber) {
    const manifestMapping = await this.loadManifestMapping(
      scenarioPath,
      profileNumber,
    );

    return {
      profileNumber,
      totalMappings: manifestMapping.mappings.length,
      firstMapping: manifestMapping.mappings[0]?.timestamp,
      lastMapping:
        manifestMapping.mappings[manifestMapping.mappings.length - 1]
          ?.timestamp,
      lastMediaSequence:
        manifestMapping.mappings[manifestMapping.mappings.length - 1]
          ?.mediaSequence,
    };
  }
}

module.exports = new SegmentIdentityService();
