const fs = require("fs-extra");
const path = require("path");

/**
 * VOD HLS Rewrite Service
 * 
 * Handles the simplified rewrite process for VOD HLS scenarios:
 * 1. Renames only downloaded segments sequentially (1.ts, 2.ts, 3.ts, etc.)
 * 2. Creates segmentMap.json and segmentTiming.json
 * 3. Rewrites manifest to point to local segments for downloaded segments only
 * 4. Keeps original paths for segments that weren't downloaded
 * 5. No dynamic renaming during playback - segments are served statically
 */
class VodRewriteService {
  async rewriteVodScenario(scenarioId) {
    try {
      console.log(`Starting VOD rewrite process for scenario ${scenarioId}`);

      const scenarioPath = path.join(__dirname, "../vod/hls", scenarioId);
      const originalScenarioPath = path.join(
        __dirname,
        "../vod/hls",
        `${scenarioId}_original`,
      );

      // Ensure main scenario folder structure exists
      await fs.ensureDir(path.join(scenarioPath, "master"));
      await fs.ensureDir(path.join(scenarioPath, "media/video"));
      await fs.ensureDir(path.join(scenarioPath, "media/audio"));
      await fs.ensureDir(path.join(scenarioPath, "media/subtitle"));
      await fs.ensureDir(path.join(scenarioPath, "profiles"));
      await fs.ensureDir(path.join(scenarioPath, "subtitle"));

      // Copy master manifest to main folder
      const originalMasterPath = path.join(
        originalScenarioPath,
        "master/master.m3u8",
      );
      const mainMasterPath = path.join(scenarioPath, "master/master.m3u8");

      if (await fs.pathExists(originalMasterPath)) {
        await fs.copy(originalMasterPath, mainMasterPath);
      }

      // Load scenario details to get maxSegmentsToDownload
      const detailsPath = path.join(scenarioPath, "details.json");
      const details = await fs.readJson(detailsPath);
      const maxSegmentsToDownload = details.maxSegmentsToDownload || null;

      // Process video segment renaming
      await this.processVodSegmentRenaming(
        scenarioId,
        originalScenarioPath,
        scenarioPath,
        maxSegmentsToDownload,
      );

      // Process video manifest rewriting
      await this.processVodManifestRewriting(
        scenarioId,
        originalScenarioPath,
        scenarioPath,
        maxSegmentsToDownload,
      );

      // Process audio if it exists
      await this.processVodAudioRenaming(
        scenarioId,
        originalScenarioPath,
        scenarioPath,
        maxSegmentsToDownload,
      );

      await this.processVodAudioManifestRewriting(
        scenarioId,
        originalScenarioPath,
        scenarioPath,
        maxSegmentsToDownload,
      );

      // Copy profile 0 manifests to all other profiles
      await this.copyProfile0ToAllProfiles(scenarioId, scenarioPath);

      // Copy selected audio variant to all other audio variants
      await this.copySelectedAudioVariantToAllVariants(scenarioId, scenarioPath);

      // Copy subtitle manifests from original to main folder
      await this.copySubtitleManifests(scenarioId, originalScenarioPath, scenarioPath);

      // Rewrite master manifest
      const masterRewriter = require("./rewriteMaster");
      await masterRewriter.rewriteMasterForScenario(scenarioId, false, "../vod/hls");

      // Update scenario details with profile information
      await this.updateScenarioProfileInfo(scenarioId, scenarioPath);

      // Create manifestMap.json for VOD scenarios
      await this.createVodManifestMap(scenarioId, scenarioPath);

      console.log(
        `Successfully completed VOD rewrite for scenario ${scenarioId}`,
      );
    } catch (error) {
      console.error(
        `Error in VOD rewrite for scenario ${scenarioId}:`,
        error,
      );
      throw error;
    }
  }

  async processVodSegmentRenaming(
    scenarioId,
    originalScenarioPath,
    scenarioPath,
    maxSegmentsToDownload,
  ) {
    try {
      const originalVideoDir = path.join(originalScenarioPath, "media/video");
      const mainVideoDir = path.join(scenarioPath, "media/video");

      if (!(await fs.pathExists(originalVideoDir))) {
        console.log("No original video segments found");
        return;
      }

      // Load segmentRecord.json to get the downloaded segments
      const segmentRecordPath = path.join(
        originalScenarioPath,
        "segmentRecord.json",
      );
      if (!(await fs.pathExists(segmentRecordPath))) {
        console.log("No segmentRecord.json found");
        return;
      }

      const segmentRecord = await fs.readJson(segmentRecordPath);
      const downloadedSegments = segmentRecord.downloadedSegments || {};

      // Get the manifest to determine segment order
      const profileDir = path.join(originalScenarioPath, "profiles", "0");
      if (!(await fs.pathExists(profileDir))) {
        console.log("No profile 0 directory found");
        return;
      }

      const manifestFiles = await fs.readdir(profileDir);
      const m3u8Files = manifestFiles.filter((f) => f.endsWith(".m3u8"));

      if (m3u8Files.length === 0) {
        console.log("No manifest files found");
        return;
      }

      // Use the first (and only) manifest for VOD
      const manifestPath = path.join(profileDir, m3u8Files[0]);
      const manifestContent = await fs.readFile(manifestPath, "utf8");

      // Parse manifest to get segments in order with EXTINF values
      const segmentsInOrder = this.parseManifestSegmentsWithExtinf(manifestContent);

      console.log(`Found ${segmentsInOrder.length} segments in manifest`);

      // Identify which segments were downloaded
      const downloadedSegmentNames = Object.keys(downloadedSegments).filter(
        (name) => downloadedSegments[name].type === "video",
      );

      console.log(`Downloaded ${downloadedSegmentNames.length} video segments`);

      // Ensure main video directory is clean
      if (await fs.pathExists(mainVideoDir)) {
        await fs.remove(mainVideoDir);
      }
      await fs.ensureDir(mainVideoDir);

      // Create segment mapping and timing - only for downloaded segments
      const segmentMap = {};
      const segmentTiming = {};
      let segmentCounter = 1;

      // Only rename the first N segments that were actually downloaded
      for (const segment of segmentsInOrder) {
        const originalFileName = segment.relativePath;

        // Check if this segment was actually downloaded
        if (!downloadedSegmentNames.includes(originalFileName)) {
          continue;
        }

        const originalPath = path.join(originalVideoDir, originalFileName);

        if (!(await fs.pathExists(originalPath))) {
          console.warn(`Segment file not found: ${originalFileName}, skipping`);
          continue;
        }

        // Preserve the original file extension
        const originalExtension = path.extname(originalFileName);
        const newFileName = `${segmentCounter}${originalExtension}`;
        const newPath = path.join(mainVideoDir, newFileName);

        // Copy segment with new name
        await fs.copy(originalPath, newPath);

        // Add to segment mapping
        segmentMap[originalFileName] = newFileName;

        // Add to segment timing
        segmentTiming[newFileName] = {
          extinf: segment.extinf,
          originalName: originalFileName,
        };

        console.log(
          `Renamed segment: ${originalFileName} → ${newFileName} (EXTINF: ${segment.extinf})`,
        );
        segmentCounter++;
      }

      // Save segment mapping
      const segmentMapPath = path.join(scenarioPath, "segmentMap.json");
      await fs.writeJson(segmentMapPath, segmentMap, { spaces: 2 });

      // Save segment timing
      const segmentTimingPath = path.join(scenarioPath, "segmentTiming.json");
      await fs.writeJson(segmentTimingPath, segmentTiming, { spaces: 2 });

      // Copy initialization segment (EXT-X-MAP) if it exists
      await this.copyInitSegmentIfExists(
        manifestContent,
        originalVideoDir,
        mainVideoDir,
        "video",
      );

      console.log(
        `Processed ${Object.keys(segmentMap).length} segments and created segmentMap.json and segmentTiming.json`,
      );
    } catch (error) {
      console.error("Error processing VOD segment renaming:", error);
      throw error;
    }
  }

  async processVodManifestRewriting(
    scenarioId,
    originalScenarioPath,
    scenarioPath,
    maxSegmentsToDownload,
  ) {
    try {
      const originalProfileDir = path.join(
        originalScenarioPath,
        "profiles",
        "0",
      );
      const mainProfileDir = path.join(scenarioPath, "profiles", "0");

      if (!(await fs.pathExists(originalProfileDir))) {
        console.log("No original profile 0 manifests found");
        return;
      }

      // Load segment mapping and timing
      const segmentMapPath = path.join(scenarioPath, "segmentMap.json");
      const segmentTimingPath = path.join(scenarioPath, "segmentTiming.json");

      if (!(await fs.pathExists(segmentMapPath))) {
        console.log("No segmentMap.json found, cannot rewrite manifests");
        return;
      }

      if (!(await fs.pathExists(segmentTimingPath))) {
        console.log("No segmentTiming.json found, cannot rewrite manifests");
        return;
      }

      const segmentMap = await fs.readJson(segmentMapPath);
      const segmentTiming = await fs.readJson(segmentTimingPath);

      // Get the manifest file
      const manifestFiles = await fs.readdir(originalProfileDir);
      const m3u8Files = manifestFiles.filter((f) => f.endsWith(".m3u8"));

      if (m3u8Files.length === 0) {
        console.log("No manifest files found");
        return;
      }

      // Ensure main profile directory exists
      await fs.ensureDir(mainProfileDir);

      // Use the first (and only) manifest for VOD
      const originalManifestFile = m3u8Files[0];
      const originalManifestPath = path.join(
        originalProfileDir,
        originalManifestFile,
      );
      const originalContent = await fs.readFile(originalManifestPath, "utf8");

      // Rewrite the manifest with sequential numbering
      const rewriteResult = this.rewriteVodManifest(
        originalContent,
        segmentMap,
        segmentTiming,
        maxSegmentsToDownload,
        "video",
      );

      const rewrittenContent = rewriteResult.content;

      // Save rewritten manifest as playlist.m3u8
      const playlistPath = path.join(mainProfileDir, "playlist.m3u8");
      await fs.writeFile(playlistPath, rewrittenContent);

      console.log("Rewritten VOD manifest saved as playlist.m3u8");
    } catch (error) {
      console.error("Error in VOD manifest rewriting:", error);
      throw error;
    }
  }

  rewriteVodManifest(
    originalContent,
    segmentMap,
    segmentTiming,
    maxSegmentsToDownload,
    mediaType = "video",
  ) {
    const lines = originalContent.split("\n");
    const rewrittenLines = [];
    let currentExtinf = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Handle #EXT-X-MAP:URI if present
      if (trimmed.startsWith("#EXT-X-MAP:URI=")) {
        const uriMatch = trimmed.match(/#EXT-X-MAP:URI="([^"]+)"/);
        if (uriMatch) {
          const originalMapUri = uriMatch[1];
          // Rewrite to point to local media path
          const rewrittenMapUri = `../../media/${mediaType}/${originalMapUri}`;
          const rewrittenLine = trimmed.replace(
            /URI="[^"]+"/,
            `URI="${rewrittenMapUri}"`,
          );
          rewrittenLines.push(rewrittenLine);
        } else {
          // Keep original if URI pattern doesn't match
          rewrittenLines.push(line);
        }
        continue;
      }

      // Parse EXTINF line
      if (trimmed.startsWith("#EXTINF:")) {
        rewrittenLines.push("#EXT-X-DISCONTINUITY")
        const match = trimmed.match(/#EXTINF:([\d.]+)/);
        if (match) {
          currentExtinf = parseFloat(match[1]);
        }
        rewrittenLines.push(line);
      } else if (trimmed && !trimmed.startsWith("#")) {
        // This is a segment URL
        const originalSegmentPath = trimmed;
        
        // Check if this segment was downloaded and renamed
        if (segmentMap[originalSegmentPath]) {
          // Rewrite to local path
          const newSegmentName = segmentMap[originalSegmentPath];
          const rewrittenSegmentPath = `../../media/${mediaType}/${newSegmentName}`;
          rewrittenLines.push(rewrittenSegmentPath);
        } else {
          // Keep original path for segments that weren't downloaded
          rewrittenLines.push(line);
        }
        currentExtinf = null;
      } else {
        // Keep all other lines (headers, comments, etc.)
        rewrittenLines.push(line);
      }
    }

    return {
      content: rewrittenLines.join("\n"),
    };
  }

  async processVodAudioRenaming(
    scenarioId,
    originalScenarioPath,
    scenarioPath,
    maxSegmentsToDownload,
  ) {
    try {
      // Check if audio exists
      const scenarioMainPath = path.join(__dirname, "../vod/hls", scenarioId);
      const audioInfoPath = path.join(scenarioMainPath, "audioInfo.json");

      if (!(await fs.pathExists(audioInfoPath))) {
        console.log("No audio variant selected for VOD");
        return;
      }

      const audioInfo = await fs.readJson(audioInfoPath);
      const audioVariantName = audioInfo.trackInfo.name;

      const originalAudioDir = path.join(
        originalScenarioPath,
        "media/audio",
      );
      const mainAudioDir = path.join(scenarioPath, "media/audio");

      if (!(await fs.pathExists(originalAudioDir))) {
        console.log("No original audio segments found");
        return;
      }

      // Load segmentRecord.json
      const segmentRecordPath = path.join(
        originalScenarioPath,
        "segmentRecord.json",
      );
      if (!(await fs.pathExists(segmentRecordPath))) {
        console.log("No segmentRecord.json found");
        return;
      }

      const segmentRecord = await fs.readJson(segmentRecordPath);
      const downloadedSegments = segmentRecord.downloadedSegments || {};

      // Get the audio manifest
      const audioDir = path.join(
        originalScenarioPath,
        "audio",
        audioVariantName,
      );
      if (!(await fs.pathExists(audioDir))) {
        console.log("No audio directory found");
        return;
      }

      const manifestFiles = await fs.readdir(audioDir);
      const m3u8Files = manifestFiles.filter((f) => f.endsWith(".m3u8"));

      if (m3u8Files.length === 0) {
        console.log("No audio manifest files found");
        return;
      }

      // Use the first (and only) manifest for VOD
      const manifestPath = path.join(audioDir, m3u8Files[0]);
      const manifestContent = await fs.readFile(manifestPath, "utf8");

      // Parse manifest to get segments in order with EXTINF values
      const segmentsInOrder = this.parseManifestSegmentsWithExtinf(manifestContent);

      console.log(`Found ${segmentsInOrder.length} audio segments in manifest`);

      // Identify which audio segments were downloaded
      const downloadedAudioSegmentNames = Object.keys(downloadedSegments).filter(
        (name) => name.startsWith("audio_"),
      );

      console.log(`Downloaded ${downloadedAudioSegmentNames.length} audio segments`);

      // Ensure main audio directory is clean
      if (await fs.pathExists(mainAudioDir)) {
        await fs.remove(mainAudioDir);
      }
      await fs.ensureDir(mainAudioDir);

      // Create audio segment mapping and timing - only for downloaded segments
      const audioSegmentMap = {};
      const audioSegmentTiming = {};
      let segmentCounter = 1;

      // Only rename audio segments that were actually downloaded
      for (const segment of segmentsInOrder) {
        const originalFileName = segment.relativePath;
        const audioSegmentKey = `audio_${originalFileName}`;

        // Check if this segment was actually downloaded
        if (!downloadedAudioSegmentNames.includes(audioSegmentKey)) {
          continue;
        }

        const originalPath = path.join(originalAudioDir, originalFileName);

        if (!(await fs.pathExists(originalPath))) {
          console.warn(`Audio segment file not found: ${originalFileName}, skipping`);
          continue;
        }

        // Preserve the original file extension
        const originalExtension = path.extname(originalFileName);
        const newFileName = `${segmentCounter}${originalExtension}`;
        const newPath = path.join(mainAudioDir, newFileName);

        // Copy segment with new name
        await fs.copy(originalPath, newPath);

        // Add to audio segment mapping
        audioSegmentMap[originalFileName] = newFileName;

        // Add to audio segment timing
        audioSegmentTiming[newFileName] = {
          extinf: segment.extinf,
          originalName: originalFileName,
        };

        console.log(
          `Renamed audio segment: ${originalFileName} → ${newFileName} (EXTINF: ${segment.extinf})`,
        );
        segmentCounter++;
      }

      // Save audio segment mapping
      const audioSegmentMapPath = path.join(
        scenarioPath,
        "audioSegmentMap.json",
      );
      await fs.writeJson(audioSegmentMapPath, audioSegmentMap, { spaces: 2 });

      // Save audio segment timing
      const audioSegmentTimingPath = path.join(
        scenarioPath,
        "audioSegmentTiming.json",
      );
      await fs.writeJson(audioSegmentTimingPath, audioSegmentTiming, {
        spaces: 2,
      });

      // Copy initialization segment (EXT-X-MAP) if it exists for audio
      await this.copyInitSegmentIfExists(
        manifestContent,
        originalAudioDir,
        mainAudioDir,
        "audio",
      );

      console.log(
        `Processed ${Object.keys(audioSegmentMap).length} audio segments`,
      );
    } catch (error) {
      console.error("Error processing VOD audio renaming:", error);
      // Don't throw - audio is optional
    }
  }

  async processVodAudioManifestRewriting(
    scenarioId,
    originalScenarioPath,
    scenarioPath,
    maxSegmentsToDownload,
  ) {
    try {
      // Check if audio exists
      const scenarioMainPath = path.join(__dirname, "../vod/hls", scenarioId);
      const audioInfoPath = path.join(scenarioMainPath, "audioInfo.json");

      if (!(await fs.pathExists(audioInfoPath))) {
        console.log("No audio variant selected for VOD");
        return;
      }

      const audioInfo = await fs.readJson(audioInfoPath);
      const audioVariantName = audioInfo.trackInfo.name;

      // Load audio segment mapping and timing
      const audioSegmentMapPath = path.join(
        scenarioPath,
        "audioSegmentMap.json",
      );
      const audioSegmentTimingPath = path.join(
        scenarioPath,
        "audioSegmentTiming.json",
      );

      if (!(await fs.pathExists(audioSegmentMapPath))) {
        console.log("No audioSegmentMap.json found, skipping audio manifest rewriting");
        return;
      }

      if (!(await fs.pathExists(audioSegmentTimingPath))) {
        console.log("No audioSegmentTiming.json found, skipping audio manifest rewriting");
        return;
      }

      const audioSegmentMap = await fs.readJson(audioSegmentMapPath);
      const audioSegmentTiming = await fs.readJson(audioSegmentTimingPath);

      // Get the audio manifest
      const originalAudioDir = path.join(
        originalScenarioPath,
        "audio",
        audioVariantName,
      );
      if (!(await fs.pathExists(originalAudioDir))) {
        console.log("No audio directory found");
        return;
      }

      const manifestFiles = await fs.readdir(originalAudioDir);
      const m3u8Files = manifestFiles.filter((f) => f.endsWith(".m3u8"));

      if (m3u8Files.length === 0) {
        console.log("No audio manifest files found");
        return;
      }

      // Use the first (and only) manifest for VOD
      const originalManifestFile = m3u8Files[0];
      const originalManifestPath = path.join(
        originalAudioDir,
        originalManifestFile,
      );
      const originalContent = await fs.readFile(originalManifestPath, "utf8");

      // Rewrite the audio manifest with sequential numbering
      const rewriteResult = this.rewriteVodManifest(
        originalContent,
        audioSegmentMap,
        audioSegmentTiming,
        maxSegmentsToDownload,
        "audio",
      );

      const rewrittenContent = rewriteResult.content;

      // Save rewritten audio manifest
      const mainAudioDir = path.join(scenarioPath, "audio", audioVariantName);
      await fs.ensureDir(mainAudioDir);

      const audioPlaylistPath = path.join(mainAudioDir, "audio.m3u8");
      await fs.writeFile(audioPlaylistPath, rewrittenContent);

      console.log("Rewritten VOD audio manifest saved as audio.m3u8");
    } catch (error) {
      console.error("Error in VOD audio manifest rewriting:", error);
      // Don't throw - audio is optional
    }
  }

  parseManifestSegmentsWithExtinf(manifestContent) {
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
          relativePath: trimmed,
          extinf: currentExtinf,
        });
        currentExtinf = null;
      }
    }

    return segments;
  }

  async copyInitSegmentIfExists(
    manifestContent,
    originalDir,
    mainDir,
    mediaType = "video",
  ) {
    try {
      // Check if manifest contains EXT-X-MAP
      const mapMatch = manifestContent.match(/#EXT-X-MAP:URI="([^"]+)"/);
      
      if (!mapMatch) {
        console.log(`[VOD] No EXT-X-MAP found in ${mediaType} manifest, skipping init segment copy`);
        return;
      }

      const initSegmentFileName = mapMatch[1];
      console.log(`[VOD] Found EXT-X-MAP:URI="${initSegmentFileName}" in ${mediaType} manifest`);

      // Check if init segment exists in original directory
      const originalInitPath = path.join(originalDir, initSegmentFileName);
      
      if (!(await fs.pathExists(originalInitPath))) {
        console.warn(`[VOD] Init segment not found: ${initSegmentFileName}, skipping copy`);
        return;
      }

      // Copy init segment to main directory (no renaming)
      const mainInitPath = path.join(mainDir, initSegmentFileName);
      await fs.copy(originalInitPath, mainInitPath);

      console.log(`[VOD] Copied ${mediaType} init segment: ${initSegmentFileName}`);
    } catch (error) {
      console.error(`[VOD] Error copying ${mediaType} init segment:`, error);
      // Don't throw - init segment might not be critical
    }
  }

  async copyProfile0ToAllProfiles(scenarioId, scenarioPath) {
    try {
      console.log(
        `[VOD] Copying Profile 0 manifests to all other profiles for scenario ${scenarioId}`,
      );

      // Get profile count from master manifest
      const masterManifestPath = path.join(
        scenarioPath,
        "master/master.m3u8",
      );
      if (!(await fs.pathExists(masterManifestPath))) {
        console.log("No master manifest found, skipping profile copying");
        return;
      }

      const masterContent = await fs.readFile(masterManifestPath, "utf8");
      const profileCount = this.countProfilesInMaster(masterContent);

      // Only proceed if we have more than 1 profile
      if (profileCount <= 1) {
        console.log("Only 1 profile detected, no copying needed");
        return;
      }

      console.log(
        `Found ${profileCount} profiles in master manifest, copying Profile 0 to profiles 1-${profileCount - 1}`,
      );

      // Check if Profile 0 directory exists
      const profile0Dir = path.join(scenarioPath, "profiles", "0");
      if (!(await fs.pathExists(profile0Dir))) {
        console.log("Profile 0 directory not found, skipping profile copying");
        return;
      }

      // Get all manifest files from Profile 0
      const profile0Files = await fs.readdir(profile0Dir);
      const manifestFiles = profile0Files.filter((file) =>
        file.endsWith(".m3u8"),
      );

      if (manifestFiles.length === 0) {
        console.log(
          "No manifest files found in Profile 0, skipping profile copying",
        );
        return;
      }

      console.log(
        `Found ${manifestFiles.length} manifest files in Profile 0 to copy`,
      );

      // Copy to all other profiles (1, 2, 3, etc.)
      for (
        let targetProfile = 1;
        targetProfile < profileCount;
        targetProfile++
      ) {
        const targetProfileDir = path.join(
          scenarioPath,
          "profiles",
          String(targetProfile),
        );

        // Ensure target profile directory exists
        await fs.ensureDir(targetProfileDir);

        console.log(`[VOD] Copying manifests to Profile ${targetProfile}`);

        // Copy each manifest file
        let successCount = 0;
        let failCount = 0;

        for (const manifestFile of manifestFiles) {
          try {
            const sourcePath = path.join(profile0Dir, manifestFile);
            const targetPath = path.join(targetProfileDir, manifestFile);

            // Copy the manifest file
            await fs.copy(sourcePath, targetPath);
            console.log(`  Copied: ${manifestFile} to Profile ${targetProfile}`);
            successCount++;
          } catch (error) {
            console.warn(
              `Failed to copy ${manifestFile} to Profile ${targetProfile}:`,
              error.message,
            );
            failCount++;
          }
        }

        if (failCount > 0) {
          console.warn(
            `Failed to copy ${failCount} files to Profile ${targetProfile}`,
          );
        }

        console.log(
          `Successfully copied ${successCount} manifests to Profile ${targetProfile}`,
        );
      }

      console.log(
        `[VOD] Successfully copied Profile 0 manifests to all ${profileCount - 1} other profiles`,
      );
    } catch (error) {
      console.error(
        `Error copying Profile 0 to all profiles for VOD scenario ${scenarioId}:`,
        error.message,
      );
      // Don't throw error - profile copying is not critical for basic functionality
      console.log("Continuing despite profile copying errors...");
    }
  }

  countProfilesInMaster(masterContent) {
    const lines = masterContent.split("\n");
    let profileCount = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      // Count EXT-X-STREAM-INF lines (each represents a video profile)
      if (trimmed.startsWith("#EXT-X-STREAM-INF")) {
        profileCount++;
      }
    }

    console.log(`Counted ${profileCount} profiles in master manifest`);
    return profileCount;
  }

  async copySelectedAudioVariantToAllVariants(scenarioId, scenarioPath) {
    try {
      // Check if audio info exists (indicates separate audio was downloaded)
      const audioInfoPath = path.join(scenarioPath, "audioInfo.json");

      if (!(await fs.pathExists(audioInfoPath))) {
        console.log("[VOD] No audio info found, skipping audio variant copying");
        return;
      }

      const audioInfo = await fs.readJson(audioInfoPath);
      const selectedAudioVariantName = audioInfo.trackInfo.name;

      console.log(
        `[VOD] Copying selected audio variant ${selectedAudioVariantName} manifests to all other audio variants for scenario ${scenarioId}`,
      );

      // Get all audio variants from master manifest
      const masterManifestPath = path.join(scenarioPath, "master/master.m3u8");
      if (!(await fs.pathExists(masterManifestPath))) {
        console.log("[VOD] No master manifest found, skipping audio variant copying");
        return;
      }

      const masterContent = await fs.readFile(masterManifestPath, "utf8");
      const audioTracks = this.parseAudioTracksFromMaster(masterContent);

      if (audioTracks.length <= 1) {
        console.log("[VOD] Only 1 or no audio variants detected, no copying needed");
        return;
      }

      console.log(
        `[VOD] Found ${audioTracks.length} audio variants, copying ${selectedAudioVariantName} to other variants`,
      );

      // Check if selected audio variant directory exists
      const selectedAudioDir = path.join(
        scenarioPath,
        "audio",
        selectedAudioVariantName,
      );
      if (!(await fs.pathExists(selectedAudioDir))) {
        console.log(
          "[VOD] Selected audio variant directory not found, skipping audio variant copying",
        );
        return;
      }

      // Get all manifest files from selected audio variant
      const selectedAudioFiles = await fs.readdir(selectedAudioDir);
      const manifestFiles = selectedAudioFiles.filter((file) =>
        file.endsWith(".m3u8"),
      );

      if (manifestFiles.length === 0) {
        console.log(
          "[VOD] No manifest files found in selected audio variant, skipping audio variant copying",
        );
        return;
      }

      console.log(
        `[VOD] Found ${manifestFiles.length} manifest files in selected audio variant to copy`,
      );

      // Copy to all other audio variants
      for (const audioTrack of audioTracks) {
        const targetAudioVariantName = audioTrack.name;

        if (targetAudioVariantName === selectedAudioVariantName) {
          continue; // Skip the source variant
        }

        const targetAudioDir = path.join(
          scenarioPath,
          "audio",
          targetAudioVariantName,
        );

        // Ensure target audio variant directory exists
        await fs.ensureDir(targetAudioDir);

        console.log(
          `[VOD] Copying audio manifests to variant ${targetAudioVariantName}`,
        );

        // Copy each manifest file
        let successCount = 0;
        let failCount = 0;

        for (const manifestFile of manifestFiles) {
          try {
            const sourcePath = path.join(selectedAudioDir, manifestFile);
            const targetPath = path.join(targetAudioDir, manifestFile);

            // Copy the manifest file
            await fs.copy(sourcePath, targetPath);
            console.log(
              `  Copied: ${manifestFile} to variant ${targetAudioVariantName}`,
            );
            successCount++;
          } catch (error) {
            console.warn(
              `Failed to copy ${manifestFile} to variant ${targetAudioVariantName}:`,
              error.message,
            );
            failCount++;
          }
        }

        if (failCount > 0) {
          console.warn(
            `Failed to copy ${failCount} files to variant ${targetAudioVariantName}`,
          );
        }

        console.log(
          `Successfully copied ${successCount} manifests to variant ${targetAudioVariantName}`,
        );
      }

      console.log(
        `[VOD] Successfully copied selected audio variant to all ${audioTracks.length - 1} other variants`,
      );
    } catch (error) {
      console.error(
        `Error copying audio variant to all variants for VOD scenario ${scenarioId}:`,
        error.message,
      );
      // Don't throw error - audio variant copying is not critical
      console.log("Continuing despite audio variant copying errors...");
    }
  }

  parseAudioTracksFromMaster(masterContent) {
    const lines = masterContent.split("\n");
    const audioTracks = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (
        trimmed.startsWith("#EXT-X-MEDIA:") &&
        trimmed.includes("TYPE=AUDIO")
      ) {
        const uriMatch = trimmed.match(/URI="([^"]+)"/);
        const groupIdMatch = trimmed.match(/GROUP-ID="([^"]+)"/);
        const nameMatch = trimmed.match(/NAME="([^"]+)"/);
        const languageMatch = trimmed.match(/LANGUAGE="([^"]+)"/);

        if (uriMatch) {
          audioTracks.push({
            uri: uriMatch[1],
            groupId: groupIdMatch ? groupIdMatch[1] : null,
            name: nameMatch ? nameMatch[1] : null,
            language: languageMatch ? languageMatch[1] : null,
          });
        }
      }
    }

    console.log(`[VOD] Parsed ${audioTracks.length} audio tracks from master manifest`);
    return audioTracks;
  }

  async copySubtitleManifests(scenarioId, originalScenarioPath, scenarioPath) {
    try {
      console.log(`[VOD] Copying and rewriting subtitle manifests for scenario ${scenarioId}`);

      // Check if subtitle directory exists in original folder
      const originalSubtitleDir = path.join(originalScenarioPath, "subtitle");
      if (!(await fs.pathExists(originalSubtitleDir))) {
        console.log("[VOD] No subtitle directory found in original folder, skipping");
        return;
      }

      // Get all subtitle variant directories
      const subtitleVariants = await fs.readdir(originalSubtitleDir);

      if (subtitleVariants.length === 0) {
        console.log("[VOD] No subtitle variants found, skipping");
        return;
      }

      console.log(`[VOD] Found ${subtitleVariants.length} subtitle variants to process`);

      // Process each subtitle variant
      for (const variantName of subtitleVariants) {
        const originalVariantDir = path.join(originalSubtitleDir, variantName);
        const mainVariantDir = path.join(scenarioPath, "subtitle", variantName);

        // Check if it's a directory
        const stats = await fs.stat(originalVariantDir);
        if (!stats.isDirectory()) {
          continue;
        }

        // Ensure target directory exists
        await fs.ensureDir(mainVariantDir);

        // Check if subtitle manifest exists
        const originalManifestPath = path.join(originalVariantDir, "subtitle.m3u8");
        if (!(await fs.pathExists(originalManifestPath))) {
          console.log(`[VOD] No subtitle manifest found for ${variantName}, skipping`);
          continue;
        }

        // Read original manifest
        const originalManifestContent = await fs.readFile(originalManifestPath, "utf8");

        // Rewrite subtitle manifest to point to local media files
        const rewrittenManifestContent = this.rewriteSubtitleManifest(
          originalManifestContent,
          variantName,
        );

        // Save rewritten manifest
        const mainManifestPath = path.join(mainVariantDir, "subtitle.m3u8");
        await fs.writeFile(mainManifestPath, rewrittenManifestContent);

        console.log(`[VOD] Processed subtitle variant: ${variantName}`);

        // Copy subtitle segments from media/subtitle to main folder
        await this.copySubtitleSegments(
          scenarioId,
          originalScenarioPath,
          scenarioPath,
          variantName,
        );
      }

      console.log(`[VOD] Successfully processed ${subtitleVariants.length} subtitle variants`);
    } catch (error) {
      console.error(`[VOD] Error copying subtitle manifests for scenario ${scenarioId}:`, error);
      // Don't throw - subtitles are optional
    }
  }

  rewriteSubtitleManifest(originalContent, variantName) {
    const lines = originalContent.split(/\r?\n/);
    const rewrittenLines = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Check if this is a segment URI (not a comment or empty line)
      if (trimmed && !trimmed.startsWith("#")) {
        // Rewrite to point to local media/subtitle path
        const localPath = `../../media/subtitle/${variantName}/${trimmed}`;
        rewrittenLines.push(localPath);
      } else {
        // Keep all other lines (headers, comments, etc.)
        rewrittenLines.push(line);
      }
    }

    return rewrittenLines.join("\n");
  }

  async copySubtitleSegments(
    scenarioId,
    originalScenarioPath,
    scenarioPath,
    variantName,
  ) {
    try {
      // Check if media/subtitle directory exists for this variant in original folder
      const originalMediaSubtitleDir = path.join(
        originalScenarioPath,
        "media/subtitle",
        variantName,
      );

      if (!(await fs.pathExists(originalMediaSubtitleDir))) {
        console.log(`[VOD] No subtitle segments found for ${variantName}, skipping`);
        return;
      }

      // Create target directory in main folder
      const mainMediaSubtitleDir = path.join(
        scenarioPath,
        "media/subtitle",
        variantName,
      );
      await fs.ensureDir(mainMediaSubtitleDir);

      // Copy all subtitle segments
      await fs.copy(originalMediaSubtitleDir, mainMediaSubtitleDir);

      console.log(`[VOD] Copied subtitle segments for ${variantName}`);
    } catch (error) {
      console.error(
        `[VOD] Error copying subtitle segments for ${variantName}:`,
        error,
      );
      // Don't throw - continue with other variants
    }
  }

  async createVodManifestMap(scenarioId, scenarioPath) {
    try {
      console.log(`[VOD] Creating manifestMap.json for scenario ${scenarioId}`);

      const manifestMapPath = path.join(scenarioPath, "manifestMap.json");
      const detailsPath = path.join(scenarioPath, "details.json");
      const details = await fs.readJson(detailsPath);

      const manifestMap = {
        profile: {},
        audio: {},
      };

      // For VOD, we have one static playlist per profile
      // Create a single entry for each profile's playlist.m3u8
      const profileCount = details.profileCount || 0;

      for (let profileNumber = 0; profileNumber < profileCount; profileNumber++) {
        const profileKey = String(profileNumber);
        manifestMap.profile[profileKey] = {
          "playlist.m3u8": {
            rewrittenFilename: "playlist.m3u8",
            timestamp: new Date().toISOString(),
            mediaSequence: 0,
            manifestNumber: 1,
            type: "video",
            profileNumber: profileNumber,
            delay: 0,
            delayPercentage: 100,
            status: 200,
            statusPercentage: 100,
            isEdited: false,
            isEditedForAll: false,
            repeat: 0,
            repeatPercentage: 100,
          },
        };
      }

      // Check if audio exists
      const audioInfoPath = path.join(scenarioPath, "audioInfo.json");
      if (await fs.pathExists(audioInfoPath)) {
        const audioInfo = await fs.readJson(audioInfoPath);
        const audioVariantName = audioInfo.trackInfo.name;

        // Parse audio tracks from master manifest
        const masterManifestPath = path.join(scenarioPath, "master/master.m3u8");
        if (await fs.pathExists(masterManifestPath)) {
          const masterContent = await fs.readFile(masterManifestPath, "utf8");
          const audioTracks = this.parseAudioTracksFromMaster(masterContent);

          // Create entry for each audio variant
          for (const audioTrack of audioTracks) {
            const variantName = audioTrack.name;
            manifestMap.audio[variantName] = {
              "audio.m3u8": {
                rewrittenFilename: "audio.m3u8",
                timestamp: new Date().toISOString(),
                manifestNumber: 1,
                type: "audio",
                variantName: variantName,
                delay: 0,
                delayPercentage: 100,
                status: 200,
                statusPercentage: 100,
                isEdited: false,
                isEditedForAll: false,
                repeat: 0,
                repeatPercentage: 100,
              },
            };
          }
        }
      }

      // Save manifestMap.json
      await fs.writeJson(manifestMapPath, manifestMap, { spaces: 2 });

      console.log(
        `[VOD] Created manifestMap.json with ${profileCount} profiles and ${Object.keys(manifestMap.audio).length} audio variants`,
      );
    } catch (error) {
      console.error(
        `[VOD] Error creating manifestMap.json for scenario ${scenarioId}:`,
        error,
      );
      // Don't throw - manifestMap is not critical for basic playback
    }
  }

  async updateScenarioProfileInfo(scenarioId, scenarioPath) {
    try {
      console.log(`[VOD] Updating profile information for scenario ${scenarioId}`);

      const masterManifestPath = path.join(scenarioPath, "master/master.m3u8");
      if (!(await fs.pathExists(masterManifestPath))) {
        console.log("[VOD] Master manifest not found, cannot update profile info");
        return;
      }

      const masterContent = await fs.readFile(masterManifestPath, "utf8");
      const profiles = this.parseProfilesFromMaster(masterContent);

      console.log(`[VOD] Found ${profiles.length} profiles in master manifest`);

      // Update scenario details with profile information
      const detailsPath = path.join(scenarioPath, "details.json");
      const details = await fs.readJson(detailsPath);

      details.profiles = profiles;
      details.profileCount = profiles.length;

      await fs.writeJson(detailsPath, details, { spaces: 2 });

      console.log(`[VOD] Successfully updated profile information: ${profiles.length} profiles`);
    } catch (error) {
      console.error(`[VOD] Error updating profile info for scenario ${scenarioId}:`, error);
      // Don't throw - profile info is not critical for basic functionality
    }
  }

  parseProfilesFromMaster(masterContent) {
    const lines = masterContent.split("\n");
    const profiles = [];
    let profileIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith("#EXT-X-STREAM-INF")) {
        // Extract bandwidth and resolution info
        const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
        const resolutionMatch = line.match(/RESOLUTION=([^,\s]+)/);

        profiles.push({
          index: profileIndex,
          bandwidth: bandwidthMatch ? parseInt(bandwidthMatch[1]) : null,
          resolution: resolutionMatch ? resolutionMatch[1] : null,
          streamInfo: line,
        });
        profileIndex++;
      }
    }

    console.log(`[VOD] Parsed ${profiles.length} profiles from master manifest`);
    return profiles;
  }


    async rewriteSingleVodManifest(
      scenarioId,
      originalManifestFileName,
      type,
      identifier,
      targetPath,
    ) {
      try {
        const originalScenarioPath = path.join(
          __dirname,
          "../vod/hls",
          `${scenarioId}_original`,
        );
        const scenarioPath = path.join(__dirname, "../vod/hls", scenarioId);

        const isVideo = type === "video";
        const subDir = isVideo ? "profiles" : "audio";

        // Load manifestRecord.json to find the actual original filename
        const manifestRecordPath = path.join(
          originalScenarioPath,
          "manifestRecord.json",
        );

        if (!(await fs.pathExists(manifestRecordPath))) {
          throw new Error("manifestRecord.json not found in original folder");
        }

        const manifestRecord = await fs.readJson(manifestRecordPath);
        const section = isVideo ? manifestRecord.profile : manifestRecord.audio;

        // Find the original filename by looking for manifestNumber 1 in the identifier's section
        // For VOD, there's typically only one manifest per profile
        let actualOriginalFilename = null;
        let sourceIdentifier = identifier;
        
        if (section && section[identifier]) {
          // Get the first (and typically only) manifest file for this profile/variant
          const manifestFiles = Object.keys(section[identifier]);
          if (manifestFiles.length > 0) {
            actualOriginalFilename = manifestFiles[0];
          }
        }

        // Fallback: For VOD, only profile 0 is downloaded, so use it as template for other profiles
        if (!actualOriginalFilename && isVideo && identifier !== "0" && section && section["0"]) {
          console.log(
            `Fallback: Using Profile 0 as template for Profile ${identifier}`,
          );
          sourceIdentifier = "0";
          const manifestFiles = Object.keys(section["0"]);
          if (manifestFiles.length > 0) {
            actualOriginalFilename = manifestFiles[0];
          }
        }

        if (!actualOriginalFilename) {
          throw new Error(
            `No original manifest found in manifestRecord.json for ${type} ${identifier}`,
          );
        }

        // Get the original manifest path using the actual original filename and source identifier
        const originalPath = path.join(
          originalScenarioPath,
          subDir,
          String(sourceIdentifier),
          actualOriginalFilename,
        );

        if (!(await fs.pathExists(originalPath))) {
          throw new Error(`Original manifest file not found: ${originalPath}`);
        }

        const originalContent = await fs.readFile(originalPath, "utf8");

        // Load segment mapping and timing
        const segmentMapFile = isVideo
          ? "segmentMap.json"
          : "audioSegmentMap.json";
        const segmentTimingFile = isVideo
          ? "segmentTiming.json"
          : "audioSegmentTiming.json";

        const segmentMapPath = path.join(scenarioPath, segmentMapFile);
        const segmentTimingPath = path.join(scenarioPath, segmentTimingFile);

        if (!(await fs.pathExists(segmentMapPath))) {
          throw new Error(`${segmentMapFile} not found`);
        }

        if (!(await fs.pathExists(segmentTimingPath))) {
          throw new Error(`${segmentTimingFile} not found`);
        }

        const segmentMap = await fs.readJson(segmentMapPath);
        const segmentTiming = await fs.readJson(segmentTimingPath);

        // Load details to get maxSegmentsToDownload
        const detailsPath = path.join(scenarioPath, "details.json");
        const details = await fs.readJson(detailsPath);
        const maxSegmentsToDownload = details.maxSegmentsToDownload || null;

        // Rewrite the manifest
        const mediaType = isVideo ? "video" : "audio";
        const rewrittenContent = this.rewriteVodManifest(
          originalContent,
          segmentMap,
          segmentTiming,
          maxSegmentsToDownload,
          mediaType,
        );

        await fs.writeFile(targetPath, rewrittenContent);
        console.log(
          `Successfully reset VOD manifest ${actualOriginalFilename} (rewritten as ${path.basename(targetPath)})`,
        );
        return true;
      } catch (error) {
        console.error(
          `Error rewriting single VOD manifest for ${type} ${identifier}:`,
          error,
        );
        throw error;
      }
    }

}

module.exports = new VodRewriteService();
