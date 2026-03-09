const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");

class OtherUrlDownloadService {
  constructor() {
    this.activeDownloads = new Map();
  }

  async downloadFromUrls(scenarioId, type, sourceUrls) {
    try {
      let baseDir;
      if (type === "VMAP") {
        baseDir = path.join(__dirname, "../vmap");
      } else if (type === "VAST") {
        baseDir = path.join(__dirname, "../vast");
      } else if (type === "MP4") {
        baseDir = path.join(__dirname, "../mp4");
      } else if (type === "GIF") {
        baseDir = path.join(__dirname, "../gif");
      } else {
        throw new Error(`Unsupported type: ${type}`);
      }
      
      const scenarioPath = path.join(baseDir, scenarioId);

      await fs.ensureDir(scenarioPath);

      const urlMapping = {};
      const downloadResults = [];

      for (let i = 0; i < sourceUrls.length; i++) {
        const urlData = sourceUrls[i];
        const { url, requestHeaders } = urlData;

        try {
          console.log(
            `[${type}-${scenarioId}] Downloading from URL ${i + 1}: ${url}`,
          );

          const headers = {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          };

          // Set appropriate Accept header based on type
          if (type === "MP4") {
            headers.Accept = "video/mp4, video/*, */*";
          } else if (type === "GIF") {
            headers.Accept = "image/gif, image/*, */*";
          } else {
            headers.Accept = "application/xml, text/xml, */*";
            headers["Accept-Language"] = "en-US,en;q=0.9";
            headers["Accept-Encoding"] = "gzip, deflate, br";
            headers.Connection = "keep-alive";
          }

          if (requestHeaders && typeof requestHeaders === "object") {
            Object.assign(headers, requestHeaders);
          }

          const responseType = (type === "MP4" || type === "GIF") ? "stream" : "text";
          const response = await axios.get(url, {
            headers,
            timeout: 30000,
            responseType,
          });

          if (type === "MP4" || type === "GIF") {
            // Handle MP4/GIF file download
            const timestamp = Date.now();
            const extension = type === "GIF" ? "gif" : "mp4";
            const prefix = type === "GIF" ? "image" : "video";
            const filename = `${prefix}_${i + 1}_${timestamp}.${extension}`;
            const filePath = path.join(scenarioPath, filename);

            // Stream the MP4 file to disk
            const writer = fs.createWriteStream(filePath);
            response.data.pipe(writer);

            await new Promise((resolve, reject) => {
              writer.on('finish', resolve);
              writer.on('error', reject);
            });

            urlMapping[`url_${i + 1}`] = {
              index: i + 1,
              originalUrl: url,
              filename: filename,
              downloadedAt: new Date().toISOString(),
              status: response.status,
              headers: requestHeaders || {},
              delay: 0,
              delayPercentage: 100,
              statusCode: 200,
              statusPercentage: 100,
              isEdited: false,
            };

            downloadResults.push({
              urlIndex: i + 1,
              url,
              filename,
              success: true,
              status: response.status,
            });

            console.log(
              `[${type}-${scenarioId}] Successfully downloaded URL ${i + 1} to ${filename}`,
            );
          } else {
            // Handle XML file download (VMAP/VAST)
            const content = response.data;
            const isXml =
              content.trim().startsWith("<?xml") ||
              content.trim().startsWith("<");
            const isHtml =
              content.toLowerCase().includes("<!doctype html") ||
              content.toLowerCase().includes("<html");

            if (isHtml || !isXml) {
              throw new Error(
                `URL returned HTML or non-XML content. Please provide a direct link to a ${type} XML file.`,
              );
            }

            const timestamp = Date.now();
            const filename = `response_${i + 1}_${timestamp}.xml`;
            const filePath = path.join(scenarioPath, filename);

            await fs.writeFile(filePath, content);

            urlMapping[`url_${i + 1}`] = {
              index: i + 1,
              originalUrl: url,
              filename: filename,
              downloadedAt: new Date().toISOString(),
              status: response.status,
              headers: requestHeaders || {},
              delay: 0,
              delayPercentage: 100,
              statusCode: 200,
              statusPercentage: 100,
              isEdited: false,
              originalContent: content,
            };

            downloadResults.push({
              urlIndex: i + 1,
              url,
              filename,
              success: true,
              status: response.status,
            });

            console.log(
              `[${type}-${scenarioId}] Successfully downloaded URL ${i + 1} to ${filename}`,
            );
          }
        } catch (error) {
          console.error(
            `[${type}-${scenarioId}] Error downloading URL ${i + 1}:`,
            error.message,
          );

          urlMapping[`url_${i + 1}`] = {
            index: i + 1,
            originalUrl: url,
            filename: null,
            downloadedAt: new Date().toISOString(),
            error: error.message,
            headers: requestHeaders || {},
            delay: 0,
            delayPercentage: 100,
            statusCode: 200,
            statusPercentage: 100,
            isEdited: false,
          };

          downloadResults.push({
            urlIndex: i + 1,
            url,
            filename: null,
            success: false,
            error: error.message,
          });
        }
      }

      const mappingPath = path.join(scenarioPath, "urlMapping.json");
      await fs.writeJson(mappingPath, urlMapping, { spaces: 2 });

      console.log(
        `[${type}-${scenarioId}] URL mapping saved to urlMapping.json`,
      );

      return {
        success: true,
        scenarioId,
        type,
        totalUrls: sourceUrls.length,
        downloadResults,
        mappingFile: "urlMapping.json",
      };
    } catch (error) {
      console.error(
        `[${type}-${scenarioId}] Error in downloadFromUrls:`,
        error,
      );
      throw error;
    }
  }

  async getUrlMapping(scenarioId, type) {
    try {
      let baseDir;
      if (type === "VMAP") {
        baseDir = path.join(__dirname, "../vmap");
      } else if (type === "VAST") {
        baseDir = path.join(__dirname, "../vast");
      } else if (type === "MP4") {
        baseDir = path.join(__dirname, "../mp4");
      } else if (type === "GIF") {
        baseDir = path.join(__dirname, "../gif");
      } else {
        throw new Error(`Unsupported type: ${type}`);
      }
      
      const mappingPath = path.join(baseDir, scenarioId, "urlMapping.json");

      if (!(await fs.pathExists(mappingPath))) {
        return null;
      }

      return await fs.readJson(mappingPath);
    } catch (error) {
      console.error(`Error reading URL mapping for ${scenarioId}:`, error);
      return null;
    }
  }

  getActiveDownloads() {
    return Array.from(this.activeDownloads.values());
  }
}

module.exports = new OtherUrlDownloadService();
