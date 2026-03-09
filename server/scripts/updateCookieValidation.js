require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const mongoose = require("mongoose");
const Scenario = require("../models/Scenario");

async function updateCookieValidation() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017/hls-qa-tool";
    await mongoose.connect(mongoUri);
    console.log("Connected to MongoDB");

    // Update all scenarios to have cookieValidationEnabled = true (default)
    const result = await Scenario.updateMany(
      { cookieValidationEnabled: { $exists: false } },
      { $set: { cookieValidationEnabled: true } }
    );

    console.log(`Updated ${result.modifiedCount} scenarios with cookieValidationEnabled field`);

    // Also update details.json files for file-system based scenarios
    const fs = require("fs-extra");
    const path = require("path");
    const HLS_DIR = path.join(__dirname, "../hls");
    const DASH_DIR = path.join(__dirname, "../dash");

    let fileUpdates = 0;

    for (const baseDir of [HLS_DIR, DASH_DIR]) {
      if (await fs.pathExists(baseDir)) {
        const scenarios = await fs.readdir(baseDir);
        
        for (const scenarioId of scenarios) {
          const detailsPath = path.join(baseDir, scenarioId, "details.json");
          
          if (await fs.pathExists(detailsPath)) {
            const details = await fs.readJson(detailsPath);
            
            if (details.cookieValidationEnabled === undefined) {
              details.cookieValidationEnabled = true;
              await fs.writeJson(detailsPath, details, { spaces: 2 });
              fileUpdates++;
              console.log(`Updated ${scenarioId}/details.json`);
            }
          }
        }
      }
    }

    console.log(`Updated ${fileUpdates} details.json files`);
    console.log("Migration completed successfully!");

  } catch (error) {
    console.error("Migration failed:", error);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB");
  }
}

updateCookieValidation();
