const fs = require("fs-extra");
const path = require("path");

/**
 * Service to handle file operations with Windows file locking protection
 */
class FileOperationService {
  constructor() {
    this.maxRetries = 5;
    this.retryDelay = 100; // milliseconds
  }

  /**
   * Safely copy file with retry logic for Windows file locking
   */
  async safeCopy(src, dest, options = {}) {
    const maxRetries = options.maxRetries || this.maxRetries;
    const retryDelay = options.retryDelay || this.retryDelay;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await fs.copy(src, dest);
        return;
      } catch (error) {
        if (
          error.code === "EBUSY" ||
          error.code === "ENOENT" ||
          error.code === "EPERM"
        ) {
          if (attempt < maxRetries) {
            console.log(
              `File operation failed (attempt ${attempt}/${maxRetries}), retrying in ${retryDelay}ms: ${error.message}`,
            );
            await this.delay(retryDelay * attempt); // Exponential backoff
            continue;
          }
        }
        throw error;
      }
    }
  }

  /**
   * Safely write file with retry logic
   */
  async safeWriteFile(filePath, content, options = {}) {
    const maxRetries = options.maxRetries || this.maxRetries;
    const retryDelay = options.retryDelay || this.retryDelay;

    // Ensure directory exists
    await fs.ensureDir(path.dirname(filePath));

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await fs.writeFile(filePath, content);
        return;
      } catch (error) {
        if (
          error.code === "EBUSY" ||
          error.code === "ENOENT" ||
          error.code === "EPERM"
        ) {
          if (attempt < maxRetries) {
            console.log(
              `Write operation failed (attempt ${attempt}/${maxRetries}), retrying in ${retryDelay}ms: ${error.message}`,
            );
            await this.delay(retryDelay * attempt);
            continue;
          }
        }
        throw error;
      }
    }
  }

  /**
   * Safely remove file with retry logic
   */
  async safeRemove(filePath, options = {}) {
    const maxRetries = options.maxRetries || this.maxRetries;
    const retryDelay = options.retryDelay || this.retryDelay;

    if (!(await fs.pathExists(filePath))) {
      return; // File doesn't exist, nothing to remove
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await fs.remove(filePath);
        return;
      } catch (error) {
        if (
          error.code === "EBUSY" ||
          error.code === "ENOENT" ||
          error.code === "EPERM"
        ) {
          if (attempt < maxRetries) {
            console.log(
              `Remove operation failed (attempt ${attempt}/${maxRetries}), retrying in ${retryDelay}ms: ${error.message}`,
            );
            await this.delay(retryDelay * attempt);
            continue;
          }
        }
        throw error;
      }
    }
  }

  /**
   * Safely copy directory with retry logic
   */
  async safeCopyDir(src, dest, options = {}) {
    const maxRetries = options.maxRetries || this.maxRetries;
    const retryDelay = options.retryDelay || this.retryDelay;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await fs.copy(src, dest);
        return;
      } catch (error) {
        if (
          error.code === "EBUSY" ||
          error.code === "ENOENT" ||
          error.code === "EPERM"
        ) {
          if (attempt < maxRetries) {
            console.log(
              `Directory copy failed (attempt ${attempt}/${maxRetries}), retrying in ${retryDelay}ms: ${error.message}`,
            );
            await this.delay(retryDelay * attempt);
            continue;
          }
        }
        throw error;
      }
    }
  }

  /**
   * Copy files one by one to avoid locking issues
   */
  async copyFilesIndividually(srcDir, destDir, fileList) {
    await fs.ensureDir(destDir);

    const results = {
      success: [],
      failed: [],
    };

    for (const fileName of fileList) {
      try {
        const srcPath = path.join(srcDir, fileName);
        const destPath = path.join(destDir, fileName);

        if (await fs.pathExists(srcPath)) {
          await this.safeCopy(srcPath, destPath);
          results.success.push(fileName);
        }
      } catch (error) {
        console.error(`Failed to copy ${fileName}:`, error.message);
        results.failed.push({ fileName, error: error.message });
      }
    }

    return results;
  }

  /**
   * Update playlist file safely by creating new file and replacing
   */
  async updatePlaylistSafely(playlistPath, content) {
    const tempPath = `${playlistPath}.tmp`;

    try {
      // Write to temp file first
      await this.safeWriteFile(tempPath, content);

      // Remove old file if it exists
      if (await fs.pathExists(playlistPath)) {
        await this.safeRemove(playlistPath);
      }

      // Rename temp file to final name
      await fs.rename(tempPath, playlistPath);
    } catch (error) {
      // Clean up temp file if it exists
      if (await fs.pathExists(tempPath)) {
        try {
          await fs.remove(tempPath);
        } catch (cleanupError) {
          console.error("Error cleaning up temp file:", cleanupError.message);
        }
      }
      throw error;
    }
  }

  /**
   * Delay helper
   */
  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = new FileOperationService();
