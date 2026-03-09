const fs = require("fs");
const path = require("path");
const config = require("../config");

class MasterRewriter {
  constructor() {
    this.HOST = config.server.baseUrl; // Backend server URL from config
  }

  async rewriteMasterForScenario(scenarioId, useProfileManifest = false, baseDir = null) {
    try {
      // Determine base directory - default to HLS, but allow override for VOD
      const scenarioPath = baseDir 
        ? path.resolve(__dirname, baseDir, scenarioId)
        : path.resolve(__dirname, "../hls", scenarioId);
      const masterPath = path.join(scenarioPath, "master", "master.m3u8");
      const outputPath = path.join(scenarioPath, "master", "master-local.m3u8");

      // Safety check
      if (!fs.existsSync(masterPath)) {
        console.error("master.m3u8 not found:", masterPath);
        throw new Error(`Master manifest not found: ${masterPath}`);
      }

      const input = fs.readFileSync(masterPath, "utf8");
      const lines = input.split(/\r?\n/);

      let profileIndex = 0;
      let audioIndex = 0;
      let subtitleIndex = 0;
      const output = [];

      // Parse audio tracks to get variant names
      const audioTracks = this.parseAudioTracks(input);
      
      // Parse subtitle tracks to get variant names
      const subtitleTracks = this.parseSubtitleTracks(input);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // Handle audio media tags
        if (
          trimmed.startsWith("#EXT-X-MEDIA:") &&
          trimmed.includes("TYPE=AUDIO")
        ) {
          // Parse the URI from the audio media tag
          const uriMatch = trimmed.match(/URI="([^"]+)"/);
          if (uriMatch) {
            const originalUri = uriMatch[1];

            // Get the audio variant name for this audio track
            const audioTrack = audioTracks[audioIndex];
            const audioVariantName = audioTrack
              ? audioTrack.name
              : `audio${audioIndex}`;

            // Use the actual variant name in the path
            const localUri = `../audio/${audioVariantName}/audio.m3u8`;

            // Replace the URI in the line
            const rewrittenLine = trimmed.replace(
              /URI="[^"]+"/,
              `URI="${localUri}"`,
            );
            output.push(rewrittenLine);
            audioIndex++;
          } else {
            // Keep audio media tags without URI
            output.push(line);
          }
          continue;
        }

        // Handle subtitle media tags
        if (
          trimmed.startsWith("#EXT-X-MEDIA:") &&
          trimmed.includes("TYPE=SUBTITLES")
        ) {
          // Parse the URI from the subtitle media tag
          const uriMatch = trimmed.match(/URI="([^"]+)"/);
          if (uriMatch) {
            const originalUri = uriMatch[1];

            // Get the subtitle variant name for this subtitle track
            const subtitleTrack = subtitleTracks[subtitleIndex];
            const subtitleVariantName = subtitleTrack
              ? subtitleTrack.name
              : `subtitle${subtitleIndex}`;

            // Use the actual variant name in the path
            const localUri = `../subtitle/${subtitleVariantName}/subtitle.m3u8`;

            // Replace the URI in the line
            const rewrittenLine = trimmed.replace(
              /URI="[^"]+"/,
              `URI="${localUri}"`,
            );
            output.push(rewrittenLine);
            subtitleIndex++;
          } else {
            // Keep subtitle media tags without URI
            output.push(line);
          }
          continue;
        }

        // Skip I-frame and image streams (not supported yet)
        if (
          trimmed.startsWith("#EXT-X-I-FRAME-STREAM-INF") ||
          trimmed.startsWith("#EXT-X-IMAGE-STREAM-INF")
        ) {
          continue;
        }

        // Handle video profile URLs
        if (trimmed.startsWith("#EXT-X-STREAM-INF")) {
          // Keep AUDIO attribute in stream info (it references the audio group)
          output.push(line);

          // Next line should be the profile URL
          if (i + 1 < lines.length) {
            const nextLine = lines[i + 1].trim();
            if (nextLine && !nextLine.startsWith("#")) {
              // Use profileManifest.m3u8 for pointer swapping or playlist.m3u8 for static
              const manifestFile = useProfileManifest
                ? "profileManifest.m3u8"
                : "playlist.m3u8";
              const localUrl = `../profiles/${profileIndex}/${manifestFile}`;
              output.push(localUrl);
              profileIndex++;
              i++; // Skip the original URL line
              continue;
            }
          }
          continue;
        }

        // Keep all other lines (comments, empty lines, etc.)
        output.push(line);
      }

      fs.writeFileSync(outputPath, output.join("\n"));

      console.log(`master-local.m3u8 created for scenario: ${scenarioId}`);
      console.log(`   - ${profileIndex} video profiles`);
      console.log(`   - ${audioIndex} audio tracks`);
      console.log(`   - ${subtitleIndex} subtitle tracks`);
      console.log(
        `   - Using ${
          useProfileManifest
            ? "profileManifest.m3u8 (pointer swapping)"
            : "playlist.m3u8 (static)"
        }`,
      );
      return outputPath;
    } catch (error) {
      console.error("Error rewriting master manifest:", error);
      throw error;
    }
  }

  // Parse audio tracks from master manifest
  parseAudioTracks(masterContent) {
    const lines = masterContent.split(/\r?\n/);
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
            fullLine: trimmed,
          });
        }
      }
    }

    return audioTracks;
  }


    // Parse subtitle tracks from master manifest
    parseSubtitleTracks(masterContent) {
      const lines = masterContent.split(/\r?\n/);
      const subtitleTracks = [];

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
              uri: uriMatch[1],
              groupId: groupIdMatch ? groupIdMatch[1] : null,
              name: nameMatch ? nameMatch[1] : null,
              language: languageMatch ? languageMatch[1] : null,
              fullLine: trimmed,
            });
          }
        }
      }

      return subtitleTracks;
    }

}

module.exports = new MasterRewriter();
