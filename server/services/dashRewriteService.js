const fs = require("fs-extra");
const path = require("path");
const { XMLParser, XMLBuilder } = require("fast-xml-parser");

/**
 * DASH Rewrite Service
 *
 * Handles rewriting of DASH MPD manifests to point to locally saved segments
 * Similar to HLS rewriting but adapted for DASH/MPD XML format
 *
 * REWRITING LOGIC:
 * - Rewrites SegmentTemplate initialization and media attributes
 * - Points to local media/video and media/audio directories
 * - Preserves all other MPD attributes and structure
 * - Saves rewritten manifests to main scenario directory
 */
class DashRewriteService {
  constructor() {
    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      parseAttributeValue: false,
      preserveOrder: false,
      format: true,
    });

    this.xmlBuilder = new XMLBuilder({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      format: true,
      indentBy: "",
      suppressEmptyNode: true,
      processEntities: false,
      suppressBooleanAttributes: false,
    });
  }

  /**
   * Main entry point for DASH rewriting process
   * Called after download completes
   */
  async processDashRewriting(scenarioId) {
    try {
      console.log(
        `[DASH-REWRITE] Starting rewriting process for scenario: ${scenarioId}`,
      );

      const scenarioPath = path.join(__dirname, "../dash", scenarioId);
      const originalScenarioPath = path.join(
        __dirname,
        "../dash",
        `${scenarioId}_original`,
      );

      // Clean up any existing rewritten content
      await this.cleanupRewrittenContent(scenarioPath);

      // Ensure main scenario folder structure exists
      await fs.ensureDir(path.join(scenarioPath, "manifests"));
      await fs.ensureDir(path.join(scenarioPath, "media/video"));
      await fs.ensureDir(path.join(scenarioPath, "media/audio"));

      // Copy media segments from original to main scenario directory
      await this.copyMediaSegments(originalScenarioPath, scenarioPath);

      // Process manifest rewriting
      await this.rewriteAllDashManifests(
        scenarioId,
        originalScenarioPath,
        scenarioPath,
      );

      console.log(
        `[DASH-REWRITE] Successfully completed rewriting for scenario: ${scenarioId}`,
      );
    } catch (error) {
      console.error(
        `[DASH-REWRITE] Error in rewriting for scenario ${scenarioId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Clean up existing rewritten content to start fresh
   */
  async cleanupRewrittenContent(scenarioPath) {
    try {
      console.log("[DASH-REWRITE] Cleaning up existing rewritten content...");

      const dirsToClean = [
        path.join(scenarioPath, "manifests"),
        path.join(scenarioPath, "media"),
      ];

      for (const dir of dirsToClean) {
        if (await fs.pathExists(dir)) {
          await fs.remove(dir);
          console.log(
            `[DASH-REWRITE] Cleaned directory: ${path.basename(dir)}`,
          );
        }
      }

      // Recreate directories
      await fs.ensureDir(path.join(scenarioPath, "manifests"));
      await fs.ensureDir(path.join(scenarioPath, "media/video"));
      await fs.ensureDir(path.join(scenarioPath, "media/audio"));

      console.log("[DASH-REWRITE] Cleanup completed");
    } catch (error) {
      console.error("[DASH-REWRITE] Error during cleanup:", error);
    }
  }

  /**
   * Copy media segments from original to main scenario directory
   */
  async copyMediaSegments(originalScenarioPath, scenarioPath) {
    try {
      console.log("[DASH-REWRITE] Copying media segments...");

      const originalMediaPath = path.join(originalScenarioPath, "media");
      const mainMediaPath = path.join(scenarioPath, "media");

      if (!(await fs.pathExists(originalMediaPath))) {
        console.log(
          "[DASH-REWRITE] No media directory found in original scenario",
        );
        return;
      }

      // Copy video segments
      const originalVideoPath = path.join(originalMediaPath, "video");
      const mainVideoPath = path.join(mainMediaPath, "video");

      if (await fs.pathExists(originalVideoPath)) {
        await fs.copy(originalVideoPath, mainVideoPath);
        console.log("[DASH-REWRITE] Copied video segments");
      }

      // Copy audio segments
      const originalAudioPath = path.join(originalMediaPath, "audio");
      const mainAudioPath = path.join(mainMediaPath, "audio");

      if (await fs.pathExists(originalAudioPath)) {
        await fs.copy(originalAudioPath, mainAudioPath);
        console.log("[DASH-REWRITE] Copied audio segments");
      }

      console.log("[DASH-REWRITE] Media segments copy completed");
    } catch (error) {
      console.error("[DASH-REWRITE] Error copying media segments:", error);
      throw error;
    }
  }

  /**
   * Rewrite all DASH manifests from original to main scenario directory
   */
  async rewriteAllDashManifests(
    scenarioId,
    originalScenarioPath,
    scenarioPath,
  ) {
    try {
      const originalManifestsDir = path.join(originalScenarioPath, "manifests");

      if (!(await fs.pathExists(originalManifestsDir))) {
        console.log("[DASH-REWRITE] No original manifests found");
        return;
      }

      const manifestFiles = await fs.readdir(originalManifestsDir);
      const mpdFiles = manifestFiles.filter((f) => f.endsWith(".mpd"));

      if (mpdFiles.length === 0) {
        console.log("[DASH-REWRITE] No MPD files found");
        return;
      }

      console.log(
        `[DASH-REWRITE] Found ${mpdFiles.length} MPD files to rewrite`,
      );

      // Sort manifests chronologically
      mpdFiles.sort();

      const rewrittenManifestsDir = path.join(scenarioPath, "manifests");
      await fs.ensureDir(rewrittenManifestsDir);

      // Initialize manifestMap structure
      const manifestMap = {
        profile: {},
        audio: {},
      };

      // Rewrite each manifest and build manifestMap
      for (let i = 0; i < mpdFiles.length; i++) {
        const manifestFile = mpdFiles[i];
        const originalManifestPath = path.join(
          originalManifestsDir,
          manifestFile,
        );
        const rewrittenManifestPath = path.join(
          rewrittenManifestsDir,
          manifestFile,
        );

        await this.rewriteSingleDashManifest(
          originalManifestPath,
          rewrittenManifestPath,
          originalScenarioPath,
          scenarioPath,
        );

        // Add to manifestMap for profile 0 (DASH doesn't have multiple profiles like HLS)
        if (!manifestMap.profile["0"]) {
          manifestMap.profile["0"] = {};
        }

        manifestMap.profile["0"][manifestFile] = {
          manifestNumber: i + 1,
          originalFilename: manifestFile,
          rewrittenFilename: manifestFile,
          delay: 0,
          delayPercentage: 100,
          status: 200,
          statusPercentage: 100,
          repeat: 0,
          repeatPercentage: 100,
          isEdited: false,
          isEditedForAll: false,
          isConfigEdited: false, // Track configuration changes separately for DASH
          isContentEdited: false, // Track file content edits separately for DASH
        };

        console.log(`[DASH-REWRITE] Rewritten: ${manifestFile}`);
      }

      // Save manifestMap.json
      const manifestMapPath = path.join(scenarioPath, "manifestMap.json");
      await fs.writeJson(manifestMapPath, manifestMap, { spaces: 2 });
      console.log(
        `[DASH-REWRITE] Created manifestMap.json with ${mpdFiles.length} manifests`,
      );

      console.log(
        `[DASH-REWRITE] Successfully rewritten ${mpdFiles.length} manifests`,
      );
    } catch (error) {
      console.error("[DASH-REWRITE] Error rewriting manifests:", error);
      throw error;
    }
  }

  /**
   * Rewrite a single DASH manifest
   */
  async rewriteSingleDashManifest(
    originalManifestPath,
    rewrittenManifestPath,
    originalScenarioPath,
    scenarioPath,
  ) {
    try {
      let originalContent = await fs.readFile(originalManifestPath, "utf8");

      // Remove all XML declarations from original content before parsing
      // This prevents duplicate declarations in the output
      originalContent = originalContent.replace(/<\?xml[^?]*\?>\s*/g, '');

      // Parse the MPD XML
      const parsedMpd = this.xmlParser.parse(originalContent);

      // Rewrite the manifest
      const rewrittenMpd = await this.rewriteMpdContent(
        parsedMpd,
        originalScenarioPath,
        scenarioPath,
      );

      // Build the XML back
      let rewrittenContent = this.xmlBuilder.build(rewrittenMpd);

      // Remove any XML declarations that might have been added by the builder
      rewrittenContent = rewrittenContent.replace(/<\?xml[^?]*\?>\s*/g, '');

      // Add single XML declaration at the beginning
      const xmlDeclaration = '<?xml version="1.0" encoding="UTF-8"?>';
      const finalContent = `${xmlDeclaration}\n${rewrittenContent}`;

      // Save rewritten manifest
      await fs.writeFile(rewrittenManifestPath, finalContent);
    } catch (error) {
      console.error(
        `[DASH-REWRITE] Error rewriting manifest ${path.basename(originalManifestPath)}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get list of downloaded segment times from the media directory
   */
  async getDownloadedSegmentTimes(scenarioPath, mediaType, prefix) {
    try {
      const mediaPath = path.join(scenarioPath, "media", mediaType);
      
      if (!(await fs.pathExists(mediaPath))) {
        return [];
      }

      const files = await fs.readdir(mediaPath);
      const segmentTimes = [];

      // Extract times from filenames like "video4_6963200_r0s.m4s"
      const pattern = new RegExp(`${prefix}_(\\d+)_r0s\\.m4s`);
      
      for (const file of files) {
        const match = file.match(pattern);
        if (match) {
          segmentTimes.push(parseInt(match[1]));
        }
      }

      // Sort times in ascending order
      segmentTimes.sort((a, b) => a - b);
      
      console.log(`[DASH-REWRITE] Found ${segmentTimes.length} downloaded ${mediaType} segments for ${prefix}`);
      
      return segmentTimes;
    } catch (error) {
      console.error(`[DASH-REWRITE] Error getting downloaded segment times:`, error);
      return [];
    }
  }

  /**
   * Rewrite MPD content to point to local segments
   * Keeps ALL representations but points them to the same downloaded segments
   */
  async rewriteMpdContent(parsedMpd, originalScenarioPath, scenarioPath) {
    try {
      const mpd = parsedMpd.MPD;

      if (!mpd) {
        throw new Error("Invalid MPD structure");
      }

      // Extract scenarioId from scenarioPath
      const scenarioId = path.basename(scenarioPath);

      // Get list of downloaded profile directories from ORIGINAL scenario path
      // (segments are downloaded there first, then copied to main scenario path)
      const videoProfileInfo = await this.getDownloadedProfileDirs(
        originalScenarioPath,
        "video",
      );
      const audioProfileInfo = await this.getDownloadedProfileDirs(
        originalScenarioPath,
        "audio",
      );

      console.log(
        `[DASH-REWRITE] Video structure: hasSubdirectories=${videoProfileInfo.hasSubdirectories}, profiles=${videoProfileInfo.profiles.join(", ")}, prefix=${videoProfileInfo.prefix}`,
      );
      console.log(
        `[DASH-REWRITE] Audio structure: hasSubdirectories=${audioProfileInfo.hasSubdirectories}, profiles=${audioProfileInfo.profiles.join(", ")}, prefix=${audioProfileInfo.prefix}`,
      );

      // Determine target paths based on directory structure
      let targetVideoPath = null;
      let targetAudioPath = null;

      if (videoProfileInfo.hasSubdirectories && videoProfileInfo.profiles.length > 0) {
        // Use subdirectory structure
        targetVideoPath = {
          hasSubdir: true,
          profileDir: videoProfileInfo.profiles[0],
        };
      } else if (videoProfileInfo.prefix) {
        // Use flat structure with prefix
        targetVideoPath = {
          hasSubdir: false,
          prefix: videoProfileInfo.prefix,
        };
      }

      if (audioProfileInfo.hasSubdirectories && audioProfileInfo.profiles.length > 0) {
        // Use subdirectory structure
        targetAudioPath = {
          hasSubdir: true,
          profileDir: audioProfileInfo.profiles[0],
        };
      } else if (audioProfileInfo.prefix) {
        // Use flat structure with prefix
        targetAudioPath = {
          hasSubdir: false,
          prefix: audioProfileInfo.prefix,
        };
      }

      if (!targetVideoPath && !targetAudioPath) {
        console.warn(
          "[DASH-REWRITE] No downloaded profiles found, cannot rewrite manifest",
        );
        return parsedMpd;
      }

      console.log(`[DASH-REWRITE] Target video path:`, targetVideoPath);
      console.log(`[DASH-REWRITE] Target audio path:`, targetAudioPath);

      // Rewrite BaseURL at MPD root level if present to point to our server
      // BaseURL should be empty or just "/" since segment paths already include media/video/ or media/audio/
      if (mpd.BaseURL) {
        mpd.BaseURL = `/dash/${scenarioId}/`;
        console.log(`[DASH-REWRITE] Rewrote BaseURL at MPD root to: /dash/${scenarioId}/`);
      }

      // Process periods
      const periods = Array.isArray(mpd.Period) ? mpd.Period : [mpd.Period];

      for (const period of periods) {
        if (!period) continue;

        // Rewrite BaseURL in periods to point to local server
        // BaseURL should point to the scenario root on our server
        // since segment paths already include media/video/ or media/audio/
        if (period.BaseURL) {
          period.BaseURL = `/dash/${scenarioId}/`;
          console.log(`[DASH-REWRITE] Rewrote BaseURL in period ${period["@_id"]} to: /dash/${scenarioId}/`);
        }

        // Process adaptation sets
        const adaptationSets = Array.isArray(period.AdaptationSet)
          ? period.AdaptationSet
          : [period.AdaptationSet];

        for (const adaptationSet of adaptationSets) {
          if (!adaptationSet) continue;

          const mimeType = adaptationSet["@_mimeType"];
          const contentType = adaptationSet["@_contentType"];
          const isVideo = (mimeType && mimeType.includes("video")) || contentType === "video";
          const isAudio = (mimeType && mimeType.includes("audio")) || contentType === "audio";

          // Process representations
          let representations = Array.isArray(adaptationSet.Representation)
            ? adaptationSet.Representation
            : [adaptationSet.Representation];

          // Rewrite ALL representations to point to the same downloaded segments
          for (const representation of representations) {
            if (!representation) continue;

            const segmentTemplate = representation.SegmentTemplate;
            if (!segmentTemplate) continue;

            // Get original profile directory for logging
            const initialization = segmentTemplate["@_initialization"];
            const originalProfileDir = this.extractProfileDir(initialization);

            // Determine which target path to use
            const targetPath = isVideo
              ? targetVideoPath
              : isAudio
                ? targetAudioPath
                : null;

            if (!targetPath) {
              console.log(
                `[DASH-REWRITE] No target path for ${isVideo ? "video" : "audio"}, skipping representation`,
              );
              continue;
            }

            console.log(
              `[DASH-REWRITE] Rewriting ${isVideo ? "video" : "audio"} representation ${originalProfileDir} -> ${targetPath.hasSubdir ? targetPath.profileDir : targetPath.prefix}`,
            );

            // Rewrite initialization and media paths to point to downloaded segments
            if (segmentTemplate["@_initialization"]) {
              if (targetPath.hasSubdir) {
                // With subdirectory: media/video/V_video_216384_p_0/init.m4s
                const mediaType = isVideo ? "video" : "audio";
                segmentTemplate["@_initialization"] =
                  `media/${mediaType}/${targetPath.profileDir}/init.m4s`;
              } else {
                // Without subdirectory: media/video/video4_init_r0s.m4s
                const mediaType = isVideo ? "video" : "audio";
                segmentTemplate["@_initialization"] =
                  `media/${mediaType}/${targetPath.prefix}_init_r0s.m4s`;
              }
            }

            if (segmentTemplate["@_media"]) {
              if (targetPath.hasSubdir) {
                // With subdirectory: media/video/V_video_216384_p_0/$Time$.m4s
                const mediaType = isVideo ? "video" : "audio";
                segmentTemplate["@_media"] =
                  `media/${mediaType}/${targetPath.profileDir}/$Time$.m4s`;
              } else {
                // Without subdirectory: media/video/video4_$Time$_r0s.m4s
                const mediaType = isVideo ? "video" : "audio";
                segmentTemplate["@_media"] =
                  `media/${mediaType}/${targetPath.prefix}_$Time$_r0s.m4s`;
              }
            }

            // Update SegmentTimeline to match downloaded segments
            if (segmentTemplate.SegmentTimeline && segmentTemplate.SegmentTimeline.S) {
              const mediaType = isVideo ? "video" : "audio";
              const prefix = targetPath.hasSubdir ? null : targetPath.prefix;
              
              // Only update timeline for flat structure (with r="" attribute)
              // Subdirectory structure doesn't use r="" so timeline is already correct
              if (!targetPath.hasSubdir && prefix) {
                const downloadedTimes = await this.getDownloadedSegmentTimes(
                  scenarioPath,
                  mediaType,
                  prefix
                );

                if (downloadedTimes.length > 0) {
                  // Get the duration from the original S element
                  const sElements = Array.isArray(segmentTemplate.SegmentTimeline.S)
                    ? segmentTemplate.SegmentTimeline.S
                    : [segmentTemplate.SegmentTimeline.S];
                  
                  const originalDuration = sElements[0]["@_d"];
                  
                  // Create new S element with downloaded segments
                  // Use first downloaded time as start, and count-1 as repeat value
                  const newS = {
                    "@_t": downloadedTimes[0],
                    "@_d": originalDuration,
                    "@_r": downloadedTimes.length - 1
                  };

                  segmentTemplate.SegmentTimeline.S = newS;
                  
                  console.log(
                    `[DASH-REWRITE] Updated SegmentTimeline for ${mediaType}: t=${newS["@_t"]}, d=${newS["@_d"]}, r=${newS["@_r"]} (${downloadedTimes.length} segments)`
                  );
                }
              }
            }
          }

          // Keep all representations - no filtering
        }
      }

      return parsedMpd;
    } catch (error) {
      console.error("[DASH-REWRITE] Error rewriting MPD content:", error);
      throw error;
    }
  }

  /**
   * Get list of downloaded profile directories for a media type
   * Returns { hasSubdirectories: boolean, profiles: string[], prefix: string }
   */
  async getDownloadedProfileDirs(scenarioPath, mediaType) {
    try {
      const mediaPath = path.join(scenarioPath, "media", mediaType);

      if (!(await fs.pathExists(mediaPath))) {
        return { hasSubdirectories: false, profiles: [], prefix: null };
      }

      const entries = await fs.readdir(mediaPath, { withFileTypes: true });
      const directories = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);

      // Check if segments are in subdirectories or directly in media folder
      if (directories.length > 0) {
        // Has subdirectories (e.g., V_video_216384_p_0/)
        return { hasSubdirectories: true, profiles: directories, prefix: null };
      } else {
        // No subdirectories - segments are directly in media/video or media/audio
        // Extract prefix from init file (e.g., video4_init_r0s.m4s -> video4)
        const files = entries
          .filter((entry) => entry.isFile())
          .map((entry) => entry.name);
        
        const initFile = files.find(f => f.includes("_init_") && f.endsWith(".m4s"));
        if (initFile) {
          // Extract prefix: "video4_init_r0s.m4s" -> "video4"
          const prefix = initFile.split("_init_")[0];
          return { hasSubdirectories: false, profiles: [], prefix };
        }

        return { hasSubdirectories: false, profiles: [], prefix: null };
      }
    } catch (error) {
      console.error(
        `[DASH-REWRITE] Error getting profile dirs for ${mediaType}:`,
        error,
      );
      return { hasSubdirectories: false, profiles: [], prefix: null };
    }
  }

  /**
   * Extract profile directory from path
   * e.g., "V_video_216384_p_0/init.m4s" -> "V_video_216384_p_0"
   */
  extractProfileDir(pathStr) {
    // Extract profile directory from paths like:
    // "media/video/V_video_216384_p_0/init.m4s" -> "V_video_216384_p_0"
    // "V_video_216384_p_0/init.m4s" -> "V_video_216384_p_0"
    const parts = pathStr.split("/");

    // If path has multiple parts, get the second-to-last part (before filename)
    if (parts.length > 1) {
      return parts[parts.length - 2];
    }

    return pathStr;
  }
}

module.exports = new DashRewriteService();
