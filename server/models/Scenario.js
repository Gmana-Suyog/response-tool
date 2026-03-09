const mongoose = require("mongoose");

const profileSchema = new mongoose.Schema(
  {
    index: {
      type: Number,
      required: true,
    },
    bandwidth: Number,
    resolution: String,
    streamInfo: String,
  },
  { _id: false },
);

const scenarioSchema = new mongoose.Schema(
  {
    scenarioId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
    },
    description: String,
    sourceManifestUrl: {
      type: String,
      required: function () {
        // sourceManifestUrl is not required for VMAP, VAST, MP4, and GIF types
        return (
          this.type !== "VMAP" &&
          this.type !== "VAST" &&
          this.type !== "MP4" &&
          this.type !== "GIF"
        );
      },
    },
    type: {
      type: String,
      enum: ["HLS", "DASH", "VMAP", "VAST", "MP4", "GIF"],
      default: "HLS",
    },
    playbackType: {
      type: String,
      enum: ["Live", "VOD", null],
      default: "Live",
    },
    belongsToCustomer: String,
    specialNotes: String,
    category: String,
    approveVersion: String,
    debug: String,
    selectedAudioVariant: {
      type: Number,
      default: null,
    },
    requestHeaders: {
      type: Map,
      of: String,
      default: () => new Map(),
    },
    addCookie: {
      type: String,
      enum: ["YES", "NO"],
      default: "NO",
    },
    cookieValidationEnabled: {
      type: Boolean,
      default: true,
    },
    downloadStatus: {
      type: String,
      enum: ["idle", "downloading", "stopped", "error"],
      default: "idle",
    },
    currentProfile: Number,
    maxSegmentsPerFetch: {
      type: Number,
      default: 6,
      min: 1,
      max: 50,
    },
    maxSegmentsToDownload: {
      type: Number,
      default: null,
    },
    maxAudioSegmentsToDownload: {
      type: Number,
      default: null,
    },
    profiles: [profileSchema],
    profileCount: Number,
    segmentCount: {
      type: Number,
      default: 0,
    },
    isPlaceholder: {
      type: Boolean,
      default: false,
    },
    manifestFetchError: String,
    // File system paths (for reference)
    scenarioPath: String,
    // Metadata
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: function (doc, ret) {
        // Transform the document for API responses
        ret.id = ret.scenarioId;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  },
);

// Update the updatedAt field before saving
scenarioSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

// Index for faster queries
scenarioSchema.index({ createdAt: -1 });
// Note: name index removed - not needed for this model
scenarioSchema.index({ category: 1 });

module.exports = mongoose.model("Scenario", scenarioSchema);
