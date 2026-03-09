const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");

class ManifestService {
  async fetchAndSaveMasterManifest(
    scenarioId,
    manifestUrl,
    selectedAudioVariant = null,
    customHeaders = {},
    playbackType = "Live",
  ) {
    try {
      console.log("Fetching manifest from:", manifestUrl);
      console.log("Selected audio variant:", selectedAudioVariant);
      console.log("Custom headers:", customHeaders);
      console.log("Playback type:", playbackType);

      // Prepare headers - merge custom headers with default headers
      const headers = {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        Accept:
          "application/vnd.apple.mpegurl, application/x-mpegURL, application/octet-stream, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        Connection: "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        ...customHeaders, // Custom headers override defaults
      };

      console.log("Final headers being sent for master manifest:", headers);

      const response = await axios.get(manifestUrl, {
        headers,
        timeout: 30000,
      });

      console.log(
        "Manifest fetched successfully, length:",
        response.data.length,
      );
      const manifestContent = response.data;

      // Determine base directory based on playback type
      const baseDir = playbackType === "VOD" ? "../vod/hls" : "../hls";
      const scenarioPath = path.join(__dirname, baseDir, scenarioId);
      const masterPath = path.join(scenarioPath, "master/master.m3u8");

      await fs.ensureDir(path.dirname(masterPath));
      await fs.writeFile(masterPath, manifestContent);

      // Only create rewritten master manifest for Live playback
      if (playbackType !== "VOD") {
        // Also create rewritten master manifest for local playback using the proper rewriter
        const masterRewriter = require("./rewriteMaster");
        await masterRewriter.rewriteMasterForScenario(scenarioId, false);
      }

      // Download audio playlists if they exist and audio variant is selected
      if (selectedAudioVariant !== null && selectedAudioVariant !== undefined) {
        await this.downloadSelectedAudioPlaylist(
          scenarioId,
          manifestContent,
          manifestUrl,
          selectedAudioVariant,
          customHeaders,
          playbackType,
        );
      }

      console.log("Master manifest saved successfully");
      return manifestContent;
    } catch (error) {
      console.error("Error fetching master manifest:", error.message);
      if (error.response) {
        console.error("Response status:", error.response.status);
        console.error("Response headers:", error.response.headers);
        console.error("Response data:", error.response.data);
      }
      throw new Error(
        `Failed to fetch manifest: ${error.message} (Status: ${
          error.response?.status || "Unknown"
        })`,
      );
    }
  }

  async downloadAudioPlaylists(scenarioId, masterContent, baseUrl) {
    try {
      const audioTracks = this.parseAudioTracksFromMaster(masterContent);

      if (audioTracks.length === 0) {
        console.log("No audio tracks found in master manifest");
        return;
      }

      const scenarioPath = path.join(__dirname, "../hls", scenarioId);

      for (const track of audioTracks) {
        try {
          // Resolve audio playlist URL
          const audioUrl = this.resolveUrl(track.uri, baseUrl);
          console.log(`Downloading audio playlist ${track.index}: ${audioUrl}`);

          const response = await axios.get(audioUrl, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              Accept:
                "application/vnd.apple.mpegurl, application/x-mpegURL, text/plain, */*",
              "Accept-Language": "en-US,en;q=0.9",
              "Accept-Encoding": "gzip, deflate, br",
              Connection: "keep-alive",
            },
            timeout: 30000,
          });

          // Save original audio playlist
          const audioDir = path.join(
            scenarioPath,
            "audio",
            String(track.index),
          );
          await fs.ensureDir(audioDir);

          const originalPlaylistPath = path.join(audioDir, "original.m3u8");
          await fs.writeFile(originalPlaylistPath, response.data);

          console.log(`Audio playlist ${track.index} saved`);
        } catch (error) {
          console.error(
            `Error downloading audio playlist ${track.index}:`,
            error.message,
          );
          // Continue with other audio tracks
        }
      }
    } catch (error) {
      console.error("Error in downloadAudioPlaylists:", error);
      // Don't throw - audio is optional
    }
  }

  async downloadSelectedAudioPlaylist(
    scenarioId,
    masterContent,
    baseUrl,
    selectedAudioVariant,
    customHeaders = {},
    playbackType = "Live",
  ) {
    try {
      const audioTracks = this.parseAudioTracksFromMaster(masterContent);

      if (audioTracks.length === 0) {
        console.log("No audio tracks found in master manifest");
        return;
      }

      // Find the selected audio track
      const selectedTrack = audioTracks.find(
        (track) => track.index === parseInt(selectedAudioVariant),
      );

      if (!selectedTrack) {
        console.log(`Selected audio variant ${selectedAudioVariant} not found`);
        return;
      }

      // Determine base directory based on playback type
      const baseDir = playbackType === "VOD" ? "../vod/hls" : "../hls";
      const scenarioPath = path.join(__dirname, baseDir, scenarioId);

      try {
        // Resolve audio playlist URL
        const audioUrl = this.resolveUrl(selectedTrack.uri, baseUrl);
        console.log(`Downloading selected audio playlist: ${audioUrl}`);

        // Prepare headers - merge custom headers with default headers
        const headers = {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "application/vnd.apple.mpegurl, application/x-mpegURL, text/plain, */*",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "gzip, deflate, br",
          Connection: "keep-alive",
          ...customHeaders, // Custom headers override defaults
        };

        const response = await axios.get(audioUrl, {
          headers,
          timeout: 30000,
        });

        // Save audio playlist to variant-specific audio directory
        const audioVariantName = selectedTrack.name;
        const audioDir = path.join(scenarioPath, "audio", audioVariantName);
        await fs.ensureDir(audioDir);

        const audioPlaylistPath = path.join(audioDir, "audio.m3u8");
        await fs.writeFile(audioPlaylistPath, response.data);

        // Also save the selected audio track info for later use
        const audioInfoPath = path.join(scenarioPath, "audioInfo.json");
        await fs.writeJson(
          audioInfoPath,
          {
            selectedVariant: selectedAudioVariant,
            trackInfo: selectedTrack,
            playlistUrl: audioUrl,
          },
          { spaces: 2 },
        );

        console.log(
          `Selected audio playlist saved to audio/${audioVariantName}/audio.m3u8`,
        );
      } catch (error) {
        console.error(
          `Error downloading selected audio playlist:`,
          error.message,
        );
        throw error;
      }
    } catch (error) {
      console.error("Error in downloadSelectedAudioPlaylist:", error);
      throw error;
    }
  }

  async downloadSubtitlePlaylists(
    scenarioId,
    masterContent,
    baseUrl,
    customHeaders = {},
    playbackType = "VOD",
  ) {
    try {
      const subtitleTracks = this.parseSubtitleTracksFromMaster(masterContent);

      if (subtitleTracks.length === 0) {
        console.log("No subtitle tracks found in master manifest");
        return;
      }

      // Determine base directory based on playback type
      const baseDir = playbackType === "VOD" ? "../vod/hls" : "../hls";
      const originalScenarioPath = path.join(__dirname, baseDir, `${scenarioId}_original`);

      console.log(`Found ${subtitleTracks.length} subtitle tracks to download`);

      for (const track of subtitleTracks) {
        try {
          // Resolve subtitle playlist URL
          const subtitleUrl = this.resolveUrl(track.uri, baseUrl);
          console.log(`Downloading subtitle playlist ${track.name}: ${subtitleUrl}`);

          // Prepare headers - merge custom headers with default headers
          const headers = {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept:
              "application/vnd.apple.mpegurl, application/x-mpegURL, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            Connection: "keep-alive",
            ...customHeaders, // Custom headers override defaults
          };

          const response = await axios.get(subtitleUrl, {
            headers,
            timeout: 30000,
          });

          // Save subtitle playlist to subtitle directory
          const subtitleVariantName = track.name;
          const subtitleDir = path.join(
            originalScenarioPath,
            "subtitle",
            subtitleVariantName,
          );
          await fs.ensureDir(subtitleDir);

          const subtitlePlaylistPath = path.join(subtitleDir, "subtitle.m3u8");
          await fs.writeFile(subtitlePlaylistPath, response.data);

          console.log(
            `Subtitle playlist saved to subtitle/${subtitleVariantName}/subtitle.m3u8`,
          );
        } catch (error) {
          console.error(
            `Error downloading subtitle playlist ${track.name}:`,
            error.message,
          );
          // Continue with other subtitle tracks
        }
      }

      console.log(`Successfully downloaded ${subtitleTracks.length} subtitle playlists`);
    } catch (error) {
      console.error("Error in downloadSubtitlePlaylists:", error);
      // Don't throw - subtitles are optional
    }
  }

  parseSubtitleTracksFromMaster(masterContent) {
    const lines = masterContent.split(/\r?\n/);
    const subtitleTracks = [];
    let subtitleIndex = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (
        trimmed.startsWith("#EXT-X-MEDIA:") &&
        trimmed.includes("TYPE=SUBTITLES")
      ) {
        const uriMatch = trimmed.match(/URI="([^"]+)"/);
        const groupIdMatch = trimmed.match(/GROUP-ID="([^"]+)"/);
        const nameMatch = trimmed.match(/NAME="([^"]+)"/);
        const languageMatch = trimmed.match(/LANGUAGE="([^"]+)"/);

        if (uriMatch) {
          subtitleTracks.push({
            index: subtitleIndex,
            uri: uriMatch[1],
            groupId: groupIdMatch ? groupIdMatch[1] : null,
            name: nameMatch ? nameMatch[1] : null,
            language: languageMatch ? languageMatch[1] : null,
          });
          subtitleIndex++;
        }
      }
    }

    return subtitleTracks;
  }

  async downloadSubtitlePlaylists(
    scenarioId,
    masterContent,
    baseUrl,
    customHeaders = {},
    playbackType = "VOD",
  ) {
    try {
      const subtitleTracks = this.parseSubtitleTracksFromMaster(masterContent);

      if (subtitleTracks.length === 0) {
        console.log("No subtitle tracks found in master manifest");
        return;
      }

      // Determine base directory based on playback type
      const baseDir = playbackType === "VOD" ? "../vod/hls" : "../hls";
      const originalScenarioPath = path.join(__dirname, baseDir, `${scenarioId}_original`);

      console.log(`Found ${subtitleTracks.length} subtitle tracks to download`);

      for (const track of subtitleTracks) {
        try {
          // Resolve subtitle playlist URL
          const subtitleUrl = this.resolveUrl(track.uri, baseUrl);
          console.log(`Downloading subtitle playlist ${track.name}: ${subtitleUrl}`);

          // Prepare headers - merge custom headers with default headers
          const headers = {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept:
              "application/vnd.apple.mpegurl, application/x-mpegURL, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            Connection: "keep-alive",
            ...customHeaders, // Custom headers override defaults
          };

          const response = await axios.get(subtitleUrl, {
            headers,
            timeout: 30000,
          });

          // Save subtitle playlist to subtitle directory
          const subtitleVariantName = track.name;
          const subtitleDir = path.join(
            originalScenarioPath,
            "subtitle",
            subtitleVariantName,
          );
          await fs.ensureDir(subtitleDir);

          const subtitlePlaylistPath = path.join(subtitleDir, "subtitle.m3u8");
          await fs.writeFile(subtitlePlaylistPath, response.data);

          console.log(
            `Subtitle playlist saved to subtitle/${subtitleVariantName}/subtitle.m3u8`,
          );

          // Download subtitle segments (webvtt files)
          await this.downloadSubtitleSegments(
            scenarioId,
            response.data,
            subtitleUrl,
            subtitleVariantName,
            customHeaders,
            playbackType,
          );
        } catch (error) {
          console.error(
            `Error downloading subtitle playlist ${track.name}:`,
            error.message,
          );
          // Continue with other subtitle tracks
        }
      }

      console.log(`Successfully downloaded ${subtitleTracks.length} subtitle playlists`);
    } catch (error) {
      console.error("Error in downloadSubtitlePlaylists:", error);
      // Don't throw - subtitles are optional
    }
  }

  async downloadSubtitleSegments(
    scenarioId,
    manifestContent,
    manifestUrl,
    subtitleVariantName,
    customHeaders = {},
    playbackType = "VOD",
  ) {
    try {
      console.log(`Downloading subtitle segments for ${subtitleVariantName}`);

      // Parse manifest to get subtitle segments
      const segments = this.parseSubtitleManifestSegments(manifestContent);

      if (segments.length === 0) {
        console.log(`No subtitle segments found in manifest for ${subtitleVariantName}`);
        return;
      }

      // Determine base directory
      const baseDir = playbackType === "VOD" ? "../vod/hls" : "../hls";
      const originalScenarioPath = path.join(__dirname, baseDir, `${scenarioId}_original`);

      // Create media/subtitle directory
      const mediaSubtitleDir = path.join(
        originalScenarioPath,
        "media/subtitle",
        subtitleVariantName,
      );
      await fs.ensureDir(mediaSubtitleDir);

      // Prepare headers
      const headers = {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        Connection: "keep-alive",
        ...customHeaders,
      };

      // Download each segment
      for (const segment of segments) {
        try {
          const segmentUrl = this.resolveUrl(segment.uri, manifestUrl);
          console.log(`Downloading subtitle segment: ${segment.uri}`);

          const response = await axios.get(segmentUrl, {
            headers,
            timeout: 30000,
            responseType: "arraybuffer", // Important for binary data
          });

          // Save segment to media/subtitle directory
          const segmentPath = path.join(mediaSubtitleDir, segment.uri);
          await fs.writeFile(segmentPath, response.data);

          console.log(`Saved subtitle segment: ${segment.uri}`);
        } catch (error) {
          console.error(
            `Error downloading subtitle segment ${segment.uri}:`,
            error.message,
          );
          // Continue with other segments
        }
      }

      console.log(
        `Successfully downloaded ${segments.length} subtitle segments for ${subtitleVariantName}`,
      );
    } catch (error) {
      console.error(
        `Error downloading subtitle segments for ${subtitleVariantName}:`,
        error,
      );
      // Don't throw - subtitles are optional
    }
  }

  parseSubtitleManifestSegments(manifestContent) {
    const lines = manifestContent.split(/\r?\n/);
    const segments = [];
    let currentExtinf = null;
    let currentByteRange = null;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();

      // Parse EXTINF line to get duration
      if (trimmed.startsWith("#EXTINF:")) {
        const match = trimmed.match(/#EXTINF:([\d.]+)/);
        if (match) {
          currentExtinf = parseFloat(match[1]);
        }
      } else if (trimmed.startsWith("#EXT-X-BYTERANGE:")) {
        // Parse byte range if present
        const match = trimmed.match(/#EXT-X-BYTERANGE:(.+)/);
        if (match) {
          currentByteRange = match[1];
        }
      } else if (trimmed && !trimmed.startsWith("#")) {
        // This is a segment URI
        segments.push({
          uri: trimmed,
          extinf: currentExtinf,
          byteRange: currentByteRange,
        });
        currentExtinf = null;
        currentByteRange = null;
      }
    }

    return segments;
  }

  resolveUrl(url, baseUrl) {
    if (url.startsWith("http")) {
      return url;
    }
    const base = new URL(baseUrl);
    return new URL(url, base).href;
  }

  // REMOVED: This method was broken and stripped audio tracks.
  // All functionality moved to rewriteMaster.js
  rewriteMasterManifest(originalManifest, scenarioId) {
    console.error(
      "❌ CRITICAL ERROR: Attempted to use deprecated rewriteMasterManifest method!",
    );
    console.error("This method strips audio tracks and creates broken URLs.");
    console.error("Use rewriteMaster.js service instead.");
    console.error("Stack trace:", new Error().stack);
    throw new Error(
      "DEPRECATED METHOD: This method is broken and should not be used. Use rewriteMaster.js instead.",
    );
  }

  extractProfileNumber(streamInfoLine, fallbackIndex) {
    // Try to extract bandwidth or other identifier to determine profile number
    // For now, use the fallback index
    return fallbackIndex;
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

    console.log(`Found ${profiles.length} profiles in master manifest`);
    return profiles;
  }

  parseAudioTracksFromMaster(masterContent) {
    const lines = masterContent.split("\n");
    const audioTracks = [];
    let audioIndex = 0;

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
            index: audioIndex,
            uri: uriMatch[1],
            groupId: groupIdMatch ? groupIdMatch[1] : null,
            name: nameMatch ? nameMatch[1] : null,
            language: languageMatch ? languageMatch[1] : null,
          });
          audioIndex++;
        }
      }
    }

    console.log(`Found ${audioTracks.length} audio tracks in master manifest`);
    return audioTracks;
  }

  // New method to detect audio variants without saving
  async detectAudioVariantsFromUrl(manifestUrl, customHeaders = {}) {
    try {
      console.log("Detecting audio variants from:", manifestUrl);
      console.log("Using custom headers:", customHeaders);

      // Prepare headers - merge custom headers with default headers
      const headers = {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        Accept:
          "application/vnd.apple.mpegurl, application/x-mpegURL, application/octet-stream, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        Connection: "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        ...customHeaders, // Custom headers override defaults
      };

      console.log("Final headers being sent:", headers);

      const response = await axios.get(manifestUrl, {
        headers,
        timeout: 30000,
      });

      const manifestContent = response.data;
      const audioTracks = this.parseAudioTracksFromMaster(manifestContent);

      return {
        hasAudio: audioTracks.length > 0,
        audioVariants: audioTracks.map((track) => ({
          name: track.name,
          language: track.language,
          groupId: track.groupId,
          uri: track.uri,
          index: track.index,
        })),
      };
    } catch (error) {
      console.error("Error detecting audio variants:", error.message);
      throw new Error(`Failed to detect audio variants: ${error.message}`);
    }
  }

  rewriteManifest(originalManifest, segmentMap) {
    const lines = originalManifest.split("\n");
    const rewrittenLines = [];

    for (const line of lines) {
      if (line.trim() && !line.startsWith("#")) {
        // This is a segment URL
        const segmentName = path.basename(line.trim());
        const localSegmentName = segmentMap[segmentName];

        if (localSegmentName) {
          // Point to local media file
          rewrittenLines.push(`../media/video/${localSegmentName}`);
        } else {
          // Keep original if not found in map (shouldn't happen)
          rewrittenLines.push(line);
        }
      } else {
        // Keep all other lines (headers, comments, etc.)
        rewrittenLines.push(line);
      }
    }

    return rewrittenLines.join("\n");
  }

  async createPlaylistManifest(scenarioId, profileNumber, segmentMap) {
    try {
      const scenarioPath = path.join(__dirname, "../hls", scenarioId);
      const profileDir = path.join(
        scenarioPath,
        "profiles",
        String(profileNumber),
      );

      // Find the latest timestamped manifest for this profile
      const manifestFiles = await fs.readdir(profileDir);
      const timestampedManifests = manifestFiles
        .filter((file) => file.endsWith(".m3u8"))
        .sort((a, b) => {
          const timestampA = parseInt(a.split("-")[0]);
          const timestampB = parseInt(b.split("-")[0]);
          return timestampB - timestampA; // Latest first
        });

      if (timestampedManifests.length === 0) {
        throw new Error(`No manifests found for profile ${profileNumber}`);
      }

      // Copy the latest manifest as playlist.m3u8 for easy access
      const latestManifest = timestampedManifests[0];
      const latestManifestPath = path.join(profileDir, latestManifest);
      const playlistPath = path.join(profileDir, "playlist.m3u8");

      await fs.copy(latestManifestPath, playlistPath);

      return playlistPath;
    } catch (error) {
      console.error("Error creating playlist manifest:", error);
      throw error;
    }
  }

  async copyManifestsToAllProfiles(scenarioId, sourceProfileNumber, profiles) {
    try {
      const scenarioPath = path.join(__dirname, "../hls", scenarioId);
      const sourceProfileDir = path.join(
        scenarioPath,
        "profiles",
        String(sourceProfileNumber),
      );

      // Check if source profile directory exists and has manifests
      if (!(await fs.pathExists(sourceProfileDir))) {
        console.log(
          `Source profile ${sourceProfileNumber} directory not found, skipping copy`,
        );
        return;
      }

      // Get all manifest files from source profile
      const sourceFiles = await fs.readdir(sourceProfileDir);
      const manifestFiles = sourceFiles.filter((file) =>
        file.endsWith(".m3u8"),
      );

      if (manifestFiles.length === 0) {
        console.log(
          `No manifest files found in source profile ${sourceProfileNumber}, skipping copy`,
        );
        return;
      }

      console.log(
        `Copying ${manifestFiles.length} manifest files to ${profiles.length} profiles`,
      );

      // Copy to each profile (except the source profile)
      for (const profile of profiles) {
        if (profile.index === sourceProfileNumber) {
          continue; // Skip source profile
        }

        const targetProfileDir = path.join(
          scenarioPath,
          "profiles",
          String(profile.index),
        );
        await fs.ensureDir(targetProfileDir);

        // Copy ALL manifest files (timestamped + playlist.m3u8)
        for (const manifestFile of manifestFiles) {
          const sourceManifestPath = path.join(sourceProfileDir, manifestFile);

          // Read manifest content
          const manifestContent = await fs.readFile(sourceManifestPath, "utf8");

          // Update the filename to reflect the target profile number
          let targetFileName = manifestFile;

          // Check if it's a timestamped manifest (format: timestamp-profile-HH-MM-SS.m3u8)
          const timestampMatch = manifestFile.match(
            /^(\d+)-(\d+)-(\d+)-(\d+)-(\d+)\.m3u8$/,
          );
          if (timestampMatch) {
            // Replace the profile number in the filename
            const timestamp = timestampMatch[1];
            const hours = timestampMatch[3];
            const minutes = timestampMatch[4];
            const seconds = timestampMatch[5];
            targetFileName = `${timestamp}-${profile.index}-${hours}-${minutes}-${seconds}.m3u8`;
            console.log(
              `Renaming ${manifestFile} → ${targetFileName} for profile ${profile.index}`,
            );
          }

          const targetManifestPath = path.join(
            targetProfileDir,
            targetFileName,
          );

          // Write the manifest with updated filename
          await fs.writeFile(targetManifestPath, manifestContent);
        }

        console.log(
          `Copied ${manifestFiles.length} manifests to profile ${profile.index} with updated filenames`,
        );
      }

      console.log("Successfully copied all manifests to all profiles");
    } catch (error) {
      console.error("Error copying manifests to profiles:", error);
      throw error;
    }
  }

  parseM3U8(content) {
    const lines = content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line);
    const playlist = {
      version: null,
      targetDuration: null,
      mediaSequence: null,
      segments: [],
      isLive: false,
    };

    let currentSegment = null;

    for (const line of lines) {
      if (line.startsWith("#EXT-X-VERSION:")) {
        playlist.version = parseInt(line.split(":")[1]);
      } else if (line.startsWith("#EXT-X-TARGETDURATION:")) {
        playlist.targetDuration = parseInt(line.split(":")[1]);
      } else if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
        playlist.mediaSequence = parseInt(line.split(":")[1]);
      } else if (line.startsWith("#EXTINF:")) {
        const duration = parseFloat(line.split(":")[1].split(",")[0]);
        currentSegment = { duration };
      } else if (line && !line.startsWith("#")) {
        if (currentSegment) {
          currentSegment.url = line;
          playlist.segments.push(currentSegment);
          currentSegment = null;
        }
      } else if (line === "#EXT-X-ENDLIST") {
        playlist.isLive = false;
      }
    }

    if (!playlist.segments.length) {
      playlist.isLive = true; // Assume live if no end list
    }

    return playlist;
  }
}

module.exports = new ManifestService();
