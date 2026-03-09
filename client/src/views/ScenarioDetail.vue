<template>
  <div v-if="scenario">
    <!-- Header -->
    <ScenarioDetailHeader
      :scenario="scenario"
      :scenario-id="props.id || route.params.id"
      @stop-download="stopDownload"
    />

    <!-- Tabs -->
    <ScenarioDetailTabs
      v-model="activeTab"
      :scenario="scenario"
    />

    <!-- Download Tab Content -->
    <ScenarioDetailDownloadTab
      :scenario="scenario"
      :active-tab="activeTab"
      @update:showCloneModal="showCloneModal = $event"
      @update:showDeleteModal="showDeleteModal = $event"
    />
     
    <!-- Playback Tab Content -->
    <ScenarioDetailPlaybackTab
      :scenario="scenario"
      :active-tab="activeTab"
      :segment-map="segmentMap"
      :download-stats="downloadStats"
      @update:showActionScopeModal="handleActionScopeModalUpdate"
      @update:showApplyToAllModal="handleApplyToAllModalUpdate"
    />

    <!-- Edit Tab Content -->
    <ScenarioDetailEditTab
      :scenario="scenario"
      :active-tab="activeTab"
      :manifest-map-data="manifestMapData"
      :available-profiles="availableProfiles"
      :available-audio-variants="availableAudioVariants"
      @update:manifestMapData="manifestMapData = $event"
      @update:showResetAllModal="showResetAllModal = $event"
      @update:showResetVmapVastModal="showResetVmapVastModal = $event"
      @update:fileToReset="fileToReset = $event"
      @update:showEditActionScopeModal="showEditActionScopeModal = $event"
      @update:editActionScopeModalConfig="editActionScopeModalConfig = $event"
      @loadManifestMap="loadManifestMap"
    />

    <!-- History Tab Content -->
    <ScenarioDetailHistoryTab
      :active-tab="activeTab"
      :scenario-id="props.id || route.params.id"
    />

    <!-- Clone Modal -->
    <CloneModal
      v-if="showCloneModal"
      :scenario="scenario"
      @close="showCloneModal = false"
      @clone="handleClone"
    />

    <!-- Delete Modal -->
    <DeleteModal
      v-if="showDeleteModal"
      :scenario="scenario"
      :deleting="deleting"
      @confirm="deleteCurrentScenario"
      @cancel="cancelDelete"
    />

    <!-- Reset All Confirmation Modal -->
    <ConfirmModal
      v-if="showResetAllModal"
      title="Reset All Configurations"
      message="Are you sure you want to reset ALL delays and status codes across ALL profiles? This action cannot be undone."
      confirm-text="Reset All"
      type="danger"
      @confirm="handleConfirmResetAll"
      @cancel="showResetAllModal = false"
    />

    <!-- Reset VMAP/VAST File Confirmation Modal -->
    <ConfirmModal
      v-if="showResetVmapVastModal"
      title="Reset File"
      :message="`Are you sure you want to reset '${fileToReset?.filename}' to its original content?`"
      confirm-text="Reset"
      type="danger"
      @confirm="confirmResetVmapVastFile"
      @cancel="cancelResetVmapVastFile"
    />

    <!-- Action Scope Modal (Save/Reset for Current/All Profiles) -->
    <ActionScopeModal
      v-if="showActionScopeModal"
      :action-type="actionScopeModalConfig.actionType"
      :media-type="actionScopeModalConfig.mediaType"
      @action="handleActionScopeSelection"
      @cancel="closeActionScopeModal"
    />

    <!-- Edit Action Scope Modal (Reset for Current/All Profiles in Edit section) -->
    <ActionScopeModal
      v-if="showEditActionScopeModal"
      :action-type="editActionScopeModalConfig.actionType"
      :media-type="editActionScopeModalConfig.mediaType"
      @action="handleEditActionScopeSelection"
      @cancel="closeEditActionScopeModal"
    />

    <!-- Apply to All Modal -->
    <ApplyToAllModal
      v-if="showApplyToAllModal"
      :media-type="applyToAllModalConfig.mediaType"
      :profile-label="applyToAllModalConfig.profileLabel"
      :scenario-type="scenario?.type || ''"
      @apply="handleApplyToAll"
      @cancel="closeApplyToAllModal"
    />
  </div>

  <!-- Loading State -->
  <div v-else-if="loading" class="text-center py-12">
    <div
      class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"
    ></div>
    <p class="mt-2 text-sm text-gray-600">Loading scenario...</p>
  </div>

  <!-- Error State -->
  <div v-else-if="error" class="text-center py-12">
    <div
      class="bg-red-50 border border-red-200 rounded-md p-4 max-w-md mx-auto"
    >
      <div class="flex">
        <ExclamationTriangleIcon class="h-5 w-5 text-red-400" />
        <div class="ml-3">
          <h3 class="text-sm font-medium text-red-800">Error</h3>
          <p class="mt-1 text-sm text-red-700">{{ error }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ExclamationTriangleIcon } from "@heroicons/vue/24/outline";
import Hls from "hls.js";
import dashjs from "dashjs";
import { useScenariosStore } from "../stores/scenarios";
import api from "../config/api";
import { useNotifications } from "../composables/useNotifications";
import ScenarioDetailHeader from "../components/ScenarioDetailHeader.vue";
import ScenarioDetailTabs from "../components/ScenarioDetailTabs.vue";
import ScenarioDetailDownloadTab from "../components/ScenarioDetailDownloadTab.vue";
import ScenarioDetailPlaybackTab from "../components/ScenarioDetailPlaybackTab.vue";
import ScenarioDetailEditTab from "../components/ScenarioDetailEditTab.vue";
import ScenarioDetailHistoryTab from "../components/ScenarioDetailHistoryTab.vue";
import ActionScopeModal from "../components/ActionScopeModal.vue";
import ApplyToAllModal from "../components/ApplyToAllModal.vue";
import CloneModal from "../components/CloneModal.vue";
import DeleteModal from "../components/DeleteModal.vue";
import ConfirmModal from "../components/ConfirmModal.vue";

const props = defineProps(["id"]);
const route = useRoute();
const router = useRouter();
const store = useScenariosStore();
const { success, error: showError } = useNotifications();

// Don't destructure reactive refs - use computed properties
const scenario = computed(() => store.currentScenario);
const loading = computed(() => store.loading);
const error = computed(() => store.error);

const selectedPlaybackProfile = ref(0);
const externalHlsUrl = ref("");
const activeTab = ref("download");
const segmentMap = ref({});
const downloadStats = ref(null);
const showCloneModal = ref(false);
const showDeleteModal = ref(false);
const showResetVmapVastModal = ref(false);
const fileToReset = ref(null);
const deleting = ref(false);
const videoElement = ref(null);
const playbackStatus = ref(null);
const stopPlaybackLoading = ref(false);

// Configuration section refs
const selectedConfigProfile = ref(0);
const selectedConfigAudio = ref("");
const manifestMapData = ref(null);
const httpStatusCodes = [
  200, 400, 401, 403, 404, 408, 410, 416, 422, 429, 500, 502, 503, 504,
];

const activeDropdown = ref(null); // For dropdowns in playback tab
const showResetAllModal = ref(false);

// Apply to All modal state
const showApplyToAllModal = ref(false);
const applyToAllModalConfig = ref({
  mediaType: "video", // 'video' or 'audio'
  profileLabel: "",
});

// Action scope modal state
const showActionScopeModal = ref(false);
const actionScopeModalConfig = ref({
  actionType: "save", // 'save' or 'reset'
  mediaType: "video", // 'video' or 'audio'
  manifest: null,
});

// Edit action scope modal state
const showEditActionScopeModal = ref(false);
const editActionScopeModalConfig = ref({
  actionType: "reset", // only 'reset' for edit section
  mediaType: "video", // 'video' or 'audio'
  manifest: null,
});

// Cookie validation toggle
const cookieValidationEnabled = ref(true);

const availableAudioVariants = computed(() => {
  if (scenario.value?.audioVariants?.length > 0) {
    return scenario.value.audioVariants;
  }
  // Try to extract from manifestMapData if meta-variants doesn't exist
  if (manifestMapData.value?.audio) {
    return Object.keys(manifestMapData.value.audio).map((name) => ({
      name,
      language: "",
    }));
  }
  return [];
});

const availableProfiles = computed(() => {
  // For DASH, always return just profile 0
  if (scenario.value?.type === "DASH") {
    return [0];
  }

  // First, try to get profiles from manifestMapData (most accurate for VOD)
  if (manifestMapData.value?.profile) {
    const profileKeys = Object.keys(manifestMapData.value.profile)
      .map(Number)
      .filter((n) => !isNaN(n))
      .sort((a, b) => a - b);
    
    if (profileKeys.length > 0) {
      return profileKeys;
    }
  }

  // Fallback to scenario.profileCount
  if (scenario.value?.profileCount) {
    return Array.from({ length: scenario.value.profileCount }, (_, i) => i);
  }

  // Default to just profile 0
  return [0];
});

const filteredManifests = computed(() => {
  if (!manifestMapData.value) return [];

  // For DASH, always use profile "0" since DASH doesn't have multiple profiles
  const profileKey =
    scenario.value?.type === "DASH" ? "0" : selectedConfigProfile.value;

  const videoManifests = manifestMapData.value.profile?.[profileKey] || {};
  const audioManifests = selectedConfigAudio.value
    ? manifestMapData.value.audio?.[selectedConfigAudio.value] || {}
    : {};

  // Group by manifestNumber
  const grouped = {};

  Object.entries(videoManifests).forEach(([key, m]) => {
    if (!grouped[m.manifestNumber]) {
      grouped[m.manifestNumber] = { manifestNumber: m.manifestNumber };
    }
    grouped[m.manifestNumber].video = {
      key,
      ...m,
      delay: m.delay !== undefined ? m.delay : 0,
      delayPercentage:
        m.delayPercentage !== undefined ? m.delayPercentage : 100,
      status: m.status !== undefined ? m.status : 200,
      statusPercentage:
        m.statusPercentage !== undefined ? m.statusPercentage : 100,
      isEdited: m.isEdited || false,
      isEditedForAll: m.isEditedForAll || false,
      repeat: m.repeat !== undefined ? m.repeat : 0,
      repeatPercentage:
        m.repeatPercentage !== undefined ? m.repeatPercentage : 100,
    };
  });

  if (selectedConfigAudio.value) {
    Object.entries(audioManifests).forEach(([key, m]) => {
      if (!grouped[m.manifestNumber]) {
        grouped[m.manifestNumber] = { manifestNumber: m.manifestNumber };
      }
      grouped[m.manifestNumber].audio = {
        key,
        ...m,
        delay: m.delay !== undefined ? m.delay : 0,
        delayPercentage:
          m.delayPercentage !== undefined ? m.delayPercentage : 100,
        status: m.status !== undefined ? m.status : 200,
        statusPercentage:
          m.statusPercentage !== undefined ? m.statusPercentage : 100,
        isEdited: m.isEdited || false,
        isEditedForAll: m.isEditedForAll || false,
        repeat: m.repeat !== undefined ? m.repeat : 0,
        repeatPercentage:
          m.repeatPercentage !== undefined ? m.repeatPercentage : 100,
      };
    });
  }

  return Object.values(grouped).sort(
    (a, b) => a.manifestNumber - b.manifestNumber,
  );
});

// VMAP/VAST/MP4/GIF files computed property
const vmapVastFiles = computed(() => {
  if (!manifestMapData.value) return {};
  if (scenario.value?.type !== "VMAP" && scenario.value?.type !== "VAST" && scenario.value?.type !== "MP4" && scenario.value?.type !== "GIF")
    return {};

  // manifestMapData for VMAP/VAST/MP4/GIF contains urlMapping.json structure
  const files = {};
  Object.entries(manifestMapData.value).forEach(([key, fileData]) => {
    if (fileData.filename && !fileData.error) {
      files[key] = {
        ...fileData,
        delay: fileData.delay !== undefined ? fileData.delay : 0,
        delayPercentage:
          fileData.delayPercentage !== undefined
            ? fileData.delayPercentage
            : 100,
        statusCode:
          fileData.statusCode !== undefined ? fileData.statusCode : 200,
        statusPercentage:
          fileData.statusPercentage !== undefined
            ? fileData.statusPercentage
            : 100,
        repeat: fileData.repeat !== undefined ? fileData.repeat : 0,
        repeatPercentage:
          fileData.repeatPercentage !== undefined
            ? fileData.repeatPercentage
            : 100,
        isEdited: fileData.isEdited || false,
      };
    }
  });
  return files;
});

// Load VMAP/VAST mapping (for Edit tab)
async function loadVmapVastMapping() {
  const scenarioId = props.id || route.params.id;
  try {
    const response = await api.get(
      `/api/scenarios/${scenarioId}/vmap-vast-mapping`,
    );
    manifestMapData.value = response.data;
  } catch (err) {
    console.error("Error loading VMAP/VAST mapping:", err);
  }
}

// Confirm reset VMAP/VAST file (called from modal)
async function confirmResetVmapVastFile() {
  const scenarioId = props.id || route.params.id;

  try {
    await api.post(`/api/scenarios/${scenarioId}/vmap-vast-reset`, {
      filename: fileToReset.value.filename,
    });

    success("File reset successfully");

    // Reload manifest map to update edit status
    await loadVmapVastMapping();
  } catch (error) {
    console.error("Error resetting VMAP/VAST file:", error);
    showError("Failed to reset file");
  } finally {
    showResetVmapVastModal.value = false;
    fileToReset.value = null;
  }
}

function cancelResetVmapVastFile() {
  showResetVmapVastModal.value = false;
  fileToReset.value = null;
}

// Load MP4 mapping (for Configuration tab)
async function loadMp4Mapping() {
  const scenarioId = props.id || route.params.id;
  try {
    const response = await api.get(
      `/api/scenarios/${scenarioId}/mp4-mapping`,
    );
    manifestMapData.value = response.data;
  } catch (err) {
    console.error("Error loading MP4 mapping:", err);
  }
}

// Load GIF mapping (for Configuration tab)
async function loadGifMapping() {
  const scenarioId = props.id || route.params.id;
  try {
    const response = await api.get(
      `/api/scenarios/${scenarioId}/gif-mapping`,
    );
    manifestMapData.value = response.data;
  } catch (err) {
    console.error("Error loading GIF mapping:", err);
  }
}

async function loadManifestMap() {
  const scenarioId = props.id || route.params.id;
  try {
    // Load different mapping based on scenario type
    if (scenario.value?.type === "VMAP" || scenario.value?.type === "VAST") {
      console.log("[VMAP/VAST] Loading file mapping for scenario:", scenarioId);
      await loadVmapVastMapping();
    } else if (scenario.value?.type === "MP4") {
      console.log("[MP4] Loading file mapping for scenario:", scenarioId);
      await loadMp4Mapping();
    } else if (scenario.value?.type === "GIF") {
      console.log("[GIF] Loading file mapping for scenario:", scenarioId);
      await loadGifMapping();
    } else {
      console.log("[HLS/DASH] Loading manifest map for scenario:", scenarioId);
      manifestMapData.value = await store.fetchManifestMap(scenarioId);
      console.log("[HLS/DASH] Manifest map loaded:", manifestMapData.value);

      // Auto-select first audio variant if not set and available
      if (
        !selectedConfigAudio.value &&
        availableAudioVariants.value.length > 0
      ) {
        selectedConfigAudio.value = availableAudioVariants.value[0].name;
      }
    }
  } catch (err) {
    console.error("Error loading manifest map:", err);
  }
}

async function loadSegmentMap() {
  const scenarioId = props.id || route.params.id;
  
  // Only load segment map for HLS scenarios (not DASH, VMAP, VAST, MP4, GIF)
  if (scenario.value?.type !== "HLS") {
    console.log(
      `[${scenario.value?.type}] Skipping segment map load - not applicable for this scenario type`,
    );
    segmentMap.value = {};
    return;
  }

  try {
    console.log("[HLS] Loading segment map for scenario:", scenarioId);
    segmentMap.value = await store.getSegmentMap(scenarioId);
    console.log("[HLS] Segment map loaded:", Object.keys(segmentMap.value).length, "segments");
  } catch (error) {
    console.error("Error loading segment map:", error);
    segmentMap.value = {};
  }
}

async function saveManifestConfig(scope) {
  const scenarioId = props.id || route.params.id;
  try {
    // Collect all changes from filteredManifests
    for (const m of filteredManifests.value) {
      // Save video
      if (m.video) {
        const videoConfig = {
          manifestKey: m.video.key,
          sectionKey: `profile.${selectedConfigProfile.value}`,
          delay: m.video.delay,
          status: m.video.status,
        };

        if (scope === "all") {
          await store.updateManifestConfigAllProfiles(scenarioId, videoConfig);
        } else {
          await store.updateManifestConfig(scenarioId, videoConfig);
        }
      }

      // Save audio
      if (selectedConfigAudio.value && m.audio) {
        const audioConfig = {
          manifestKey: m.audio.key,
          sectionKey: `audio.${selectedConfigAudio.value}`,
          delay: m.audio.delay,
          status: m.audio.status,
        };
        if (scope === "all") {
          await store.updateManifestConfigAllProfiles(scenarioId, audioConfig);
        } else {
          await store.updateManifestConfig(scenarioId, audioConfig);
        }
      }
    }
    success(
      `Configuration saved for ${scope === "all" ? "all profiles" : "current profile"}`,
    );
    activeDropdown.value = null;
    await loadManifestMap();
  } catch (err) {
    showError("Failed to save configuration");
  }
}

async function saveManifestConfigForRow(m, scope, type = "video") {
  const scenarioId = props.id || route.params.id;
  try {
    const item = m[type];
    if (!item) return;

    const isDash = scenario.value?.type === "DASH";

    // For DASH, always use profile "0" and ignore scope (no "all profiles" concept)
    const profileKey = isDash ? "0" : selectedConfigProfile.value;
    const actualScope = isDash ? "current" : scope;

    const config = {
      manifestKey: item.key,
      sectionKey:
        type === "video"
          ? `profile.${profileKey}`
          : `audio.${selectedConfigAudio.value}`,
      delay: item.delay,
      delayPercentage:
        item.delayPercentage !== undefined ? item.delayPercentage : 100,
      status: item.status,
      statusPercentage:
        item.statusPercentage !== undefined ? item.statusPercentage : 100,
      repeat: item.repeat,
      repeatPercentage:
        item.repeatPercentage !== undefined ? item.repeatPercentage : 100,
    };

    if (actualScope === "all" && !isDash) {
      await store.updateManifestConfigAllProfiles(scenarioId, config);
    } else {
      await store.updateManifestConfig(scenarioId, config);
    }

    const scopeText = isDash
      ? ""
      : ` for ${scope === "all" ? "all" : "current"}`;
    success(
      `${type === "video" ? "Video" : "Audio"} Manifest #${m.manifestNumber} saved${scopeText}`,
    );
    activeDropdown.value = null;
    await loadManifestMap();
  } catch (err) {
    showError("Failed to save configuration");
  }
}

async function resetManifestConfig(scope) {
  const scenarioId = props.id || route.params.id;
  try {
    if (scope === "all") {
      // For each manifest in current view, reset it across all profiles
      for (const m of filteredManifests.value) {
        if (m.video) {
          await store.resetManifestConfig(scenarioId, {
            manifestKey: m.video.key,
            allProfiles: true,
          });
        }
        if (m.audio) {
          await store.resetManifestConfig(scenarioId, {
            manifestKey: m.audio.key,
            allProfiles: true,
          });
        }
      }
    } else {
      // Reset only for current profile
      for (const m of filteredManifests.value) {
        if (m.video) {
          await store.resetManifestConfig(scenarioId, {
            manifestKey: m.video.key,
            sectionKey: `profile.${selectedConfigProfile.value}`,
            allProfiles: false,
          });
        }
        if (selectedConfigAudio.value && m.audio) {
          await store.resetManifestConfig(scenarioId, {
            manifestKey: m.audio.key,
            sectionKey: `audio.${selectedConfigAudio.value}`,
            allProfiles: false,
          });
        }
      }
    }
    success(
      `Configuration reset for ${scope === "all" ? "all profiles" : "current profile"}`,
    );
    activeDropdown.value = null;
    await loadManifestMap();
  } catch (err) {
    showError("Failed to reset configuration");
  }
}

async function resetManifestConfigForRow(m, scope, type = "video") {
  const scenarioId = props.id || route.params.id;
  try {
    const item = m[type];
    if (!item) return;

    const isDash = scenario.value?.type === "DASH";

    // For DASH, always use profile "0" and ignore scope (no "all profiles" concept)
    const profileKey = isDash ? "0" : selectedConfigProfile.value;
    const actualScope = isDash ? "current" : scope;

    if (actualScope === "all" && !isDash) {
      await store.resetManifestConfig(scenarioId, {
        manifestKey: item.key,
        sectionKey:
          type === "video"
            ? `profile.${profileKey}`
            : `audio.${selectedConfigAudio.value}`,
        allProfiles: true,
      });
    } else {
      await store.resetManifestConfig(scenarioId, {
        manifestKey: item.key,
        sectionKey:
          type === "video"
            ? `profile.${profileKey}`
            : `audio.${selectedConfigAudio.value}`,
        allProfiles: false,
      });
    }

    const scopeText = isDash
      ? ""
      : ` for ${scope === "all" ? "all profiles" : "current profile"}`;
    success(
      `${type === "video" ? "Video" : "Audio"} Manifest #${m.manifestNumber} reset${scopeText}`,
    );
    activeDropdown.value = null;
    await loadManifestMap();
  } catch (err) {
    showError("Failed to reset configuration");
  }
}

async function resetAllConfigs() {
  showResetAllModal.value = true;
}

async function resetAllConfigsForType(mediaType) {
  const scenarioId = props.id || route.params.id;
  
  try {
    if (mediaType === "video") {
      // Reset all video manifests in the selected profile
      const profileKey = selectedConfigProfile.value;
      const videoManifests = manifestMapData.value.profile?.[profileKey] || {};
      
      for (const [key, manifest] of Object.entries(videoManifests)) {
        await store.resetManifestConfig(scenarioId, {
          manifestKey: key,
          sectionKey: `profile.${profileKey}`,
          allProfiles: false,
        });
      }
      
      success(`Reset all video manifests in Profile ${profileKey}`);
    } else {
      // Reset all audio manifests in the selected audio variant
      const audioVariant = selectedConfigAudio.value;
      const audioManifests = manifestMapData.value.audio?.[audioVariant] || {};
      
      for (const [key, manifest] of Object.entries(audioManifests)) {
        await store.resetManifestConfig(scenarioId, {
          manifestKey: key,
          sectionKey: `audio.${audioVariant}`,
          allProfiles: false,
        });
      }
      
      success(`Reset all audio manifests in ${audioVariant}`);
    }
    
    // Reload manifest map to reflect changes
    await loadManifestMap();
  } catch (err) {
    console.error(`Error resetting all ${mediaType} configurations:`, err);
    showError(`Failed to reset all ${mediaType} configurations`);
  }
}

async function handleConfirmResetAll() {
  const scenarioId = props.id || route.params.id;
  showResetAllModal.value = false;

  try {
    if (scenario.value?.type === "GIF" || scenario.value?.type === "MP4") {
      // For GIF/MP4, reset all files individually
      const files = vmapVastFiles.value;
      for (const [key, fileData] of Object.entries(files)) {
        await resetVmapVastConfig(key);
      }
      success("All configurations reset successfully");
    } else {
      // For HLS/DASH/VMAP/VAST, use the store method
      await store.resetAllManifestConfigs(scenarioId);
      success("All configurations reset successfully");
      await loadManifestMap();
    }
  } catch (err) {
    showError("Failed to reset all configurations");
  }
}

// VMAP/VAST/MP4/GIF configuration methods
async function saveVmapVastConfig(key, fileData) {
  const scenarioId = props.id || route.params.id;
  try {
    if (scenario.value?.type === "GIF") {
      // Use GIF-specific endpoint
      const response = await api.post(
        `/api/scenarios/${scenarioId}/gif-config`,
        {
          urlKey: key,
          delay: fileData.delay,
          delayPercentage: fileData.delayPercentage,
          statusCode: fileData.statusCode,
          statusPercentage: fileData.statusPercentage,
        }
      );
      success(`Configuration saved for ${fileData.filename}`);
      await loadManifestMap();
    } else if (scenario.value?.type === "MP4") {
      // Use MP4-specific endpoint
      const response = await api.post(
        `/api/scenarios/${scenarioId}/mp4-config`,
        {
          urlKey: key,
          delay: fileData.delay,
          delayPercentage: fileData.delayPercentage,
          statusCode: fileData.statusCode,
          statusPercentage: fileData.statusPercentage,
        }
      );
      success(`Configuration saved for ${fileData.filename}`);
      await loadManifestMap();
    } else {
      // Use generic manifest-config endpoint for VMAP/VAST
      const config = {
        manifestKey: key,
        sectionKey: "", // Not used for VMAP/VAST
        delay: fileData.delay,
        delayPercentage: fileData.delayPercentage,
        status: fileData.statusCode,
        statusPercentage: fileData.statusPercentage,
      };

      await store.updateManifestConfig(scenarioId, config);
      success(`Configuration saved for ${fileData.filename}`);
      await loadManifestMap();
    }
  } catch (err) {
    showError(`Failed to save configuration: ${err.message}`);
  }
}

async function resetVmapVastConfig(key) {
  const scenarioId = props.id || route.params.id;
  try {
    if (scenario.value?.type === "GIF") {
      // Reset to defaults for GIF
      const response = await api.post(
        `/api/scenarios/${scenarioId}/gif-config`,
        {
          urlKey: key,
          delay: 0,
          delayPercentage: 100,
          statusCode: 200,
          statusPercentage: 100,
        }
      );
      success("Configuration reset successfully");
      await loadManifestMap();
    } else if (scenario.value?.type === "MP4") {
      // Reset to defaults for MP4
      const response = await api.post(
        `/api/scenarios/${scenarioId}/mp4-config`,
        {
          urlKey: key,
          delay: 0,
          delayPercentage: 100,
          statusCode: 200,
          statusPercentage: 100,
        }
      );
      success("Configuration reset successfully");
      await loadManifestMap();
    } else {
      // Use generic reset endpoint for VMAP/VAST
      const config = {
        manifestKey: key,
        sectionKey: "", // Not used for VMAP/VAST
        allProfiles: false,
      };

      await store.resetManifestConfig(scenarioId, config);
      success("Configuration reset successfully");
      await loadManifestMap();
    }
  } catch (err) {
    showError(`Failed to reset configuration: ${err.message}`);
  }
}

async function copyConfigEntry(key) {
  const scenarioId = props.id || route.params.id;
  try {
    const response = await api.post(
      `/api/scenarios/${scenarioId}/config-copy`,
      { configKey: key }
    );
    success("Configuration copied successfully");
    await loadManifestMap();
  } catch (err) {
    showError(`Failed to copy configuration: ${err.message}`);
  }
}

async function removeConfigEntry(key) {
  const scenarioId = props.id || route.params.id;
  try {
    const response = await api.delete(
      `/api/scenarios/${scenarioId}/config-remove`,
      { data: { configKey: key } }
    );
    success("Configuration removed successfully");
    await loadManifestMap();
  } catch (err) {
    showError(`Failed to remove configuration: ${err.message}`);
  }
}

function getConfigIndex(key) {
  // Return sequential index for configurations
  // url_1 = index 1
  // url_1_copy_1 = index 2
  // url_1_copy_2 = index 3, etc.
  
  // Check if this is a base entry (url_1, url_2, etc.)
  if (key.match(/^url_\d+$/) && !key.includes('_copy_')) {
    return 1;
  }
  
  // Check if this is a copy entry (url_1_copy_1, url_1_copy_2, etc.)
  const copyMatch = key.match(/^url_\d+_copy_(\d+)$/);
  if (copyMatch) {
    return parseInt(copyMatch[1]) + 1; // +1 because copy_1 is actually config index 2
  }
  
  return key;
}

function toggleDropdown(id) {
  if (activeDropdown.value === id) {
    activeDropdown.value = null;
  } else {
    activeDropdown.value = id;
  }
}

// Open action scope modal for save/reset operations
function openActionScopeModal(actionType, mediaType, manifest) {
  actionScopeModalConfig.value = {
    actionType,
    mediaType,
    manifest,
  };
  showActionScopeModal.value = true;
}

// Handle action scope modal selection
async function handleActionScopeSelection(scope) {
  const { actionType, mediaType, manifest } = actionScopeModalConfig.value;
  showActionScopeModal.value = false;

  if (actionType === "save") {
    await saveManifestConfigForRow(manifest, scope, mediaType);
  } else if (actionType === "reset") {
    await resetManifestConfigForRow(manifest, scope, mediaType);
  }
}

// Close action scope modal
function closeActionScopeModal() {
  showActionScopeModal.value = false;
  actionScopeModalConfig.value = {
    actionType: "save",
    mediaType: "video",
    manifest: null,
  };
}

// Open edit action scope modal for reset operations
function openEditActionScopeModal(actionType, mediaType, manifest) {
  editActionScopeModalConfig.value = {
    actionType,
    mediaType,
    manifest,
  };
  showEditActionScopeModal.value = true;
}

// Handle edit action scope modal selection
async function handleEditActionScopeSelection(scope) {
  const { actionType, mediaType, manifest } = editActionScopeModalConfig.value;
  showEditActionScopeModal.value = false;

  if (actionType === "reset") {
    await resetManifestContentForRow(manifest, scope, mediaType);
  }
}

// Close edit action scope modal
function closeEditActionScopeModal() {
  showEditActionScopeModal.value = false;
  editActionScopeModalConfig.value = {
    actionType: "reset",
    mediaType: "video",
    manifest: null,
  };
}

// Open Apply to All modal
function openApplyToAllModal(mediaType = null) {
  // If mediaType is explicitly provided, use it
  // Otherwise, determine based on selection (for backward compatibility)
  let finalMediaType = mediaType;
  
  if (!finalMediaType) {
    const hasAudioSelected = selectedConfigAudio.value && selectedConfigAudio.value !== "";
    finalMediaType = hasAudioSelected ? "audio" : "video";
  }
  
  let profileLabel = "";
  if (finalMediaType === "video") {
    // For DASH, always use profile "0" since DASH doesn't have multiple profiles
    const profileKey = scenario.value?.type === "DASH" ? "0" : selectedConfigProfile.value;
    profileLabel = `Profile ${profileKey}`;
  } else {
    profileLabel = `Audio: ${selectedConfigAudio.value}`;
  }

  applyToAllModalConfig.value = {
    mediaType: finalMediaType,
    profileLabel,
  };
  
  showApplyToAllModal.value = true;
}

// Handle Apply to All action
async function handleApplyToAll(config) {
  const scenarioId = props.id || route.params.id;
  showApplyToAllModal.value = false;

  try {
    const { mediaType } = applyToAllModalConfig.value;
    
    // Handle VMAP/VAST/MP4/GIF scenarios
    if (scenario.value?.type === "VMAP" || scenario.value?.type === "VAST" || scenario.value?.type === "MP4" || scenario.value?.type === "GIF") {
      const files = vmapVastFiles.value;
      
      for (const [key, fileData] of Object.entries(files)) {
        if (scenario.value?.type === "GIF") {
          // Use GIF-specific endpoint
          await api.post(`/api/scenarios/${scenarioId}/gif-config`, {
            urlKey: key,
            delay: config.delay,
            delayPercentage: config.delayPercentage,
            statusCode: config.status,
            statusPercentage: config.statusPercentage,
          });
        } else if (scenario.value?.type === "MP4") {
          // Use MP4-specific endpoint
          await api.post(`/api/scenarios/${scenarioId}/mp4-config`, {
            urlKey: key,
            delay: config.delay,
            delayPercentage: config.delayPercentage,
            statusCode: config.status,
            statusPercentage: config.statusPercentage,
          });
        } else {
          // Use generic manifest-config endpoint for VMAP/VAST
          const updateConfig = {
            manifestKey: key,
            sectionKey: "", // Not used for VMAP/VAST
            delay: config.delay,
            delayPercentage: config.delayPercentage,
            status: config.status,
            statusPercentage: config.statusPercentage,
          };
          await store.updateManifestConfig(scenarioId, updateConfig);
        }
      }
      
      success(`Applied configuration to all ${scenario.value?.type} files`);
      await loadManifestMap();
      return;
    }
    
    // Handle HLS/DASH scenarios
    if (mediaType === "video") {
      // Apply to all video manifests in the selected profile
      // For DASH, always use profile "0" since DASH doesn't have multiple profiles
      const profileKey = scenario.value?.type === "DASH" ? "0" : selectedConfigProfile.value;
      const videoManifests = manifestMapData.value.profile?.[profileKey] || {};
      
      for (const [key, manifest] of Object.entries(videoManifests)) {
        const updateConfig = {
          manifestKey: key,
          sectionKey: `profile.${profileKey}`,
          delay: config.delay,
          delayPercentage: config.delayPercentage,
          status: config.status,
          statusPercentage: config.statusPercentage,
          repeat: config.repeat,
          repeatPercentage: config.repeatPercentage,
        };
        
        await store.updateManifestConfig(scenarioId, updateConfig);
      }
      
      success(`Applied configuration to all ${scenario.value?.type === "DASH" ? "DASH" : "video"} manifests in Profile ${profileKey}`);
    } else {
      // Apply to all audio manifests in the selected audio variant
      const audioVariant = selectedConfigAudio.value;
      const audioManifests = manifestMapData.value.audio?.[audioVariant] || {};
      
      for (const [key, manifest] of Object.entries(audioManifests)) {
        const updateConfig = {
          manifestKey: key,
          sectionKey: `audio.${audioVariant}`,
          delay: config.delay,
          delayPercentage: config.delayPercentage,
          status: config.status,
          statusPercentage: config.statusPercentage,
          repeat: config.repeat,
          repeatPercentage: config.repeatPercentage,
        };
        
        await store.updateManifestConfig(scenarioId, updateConfig);
      }
      
      success(`Applied configuration to all audio manifests in ${audioVariant}`);
    }
    
    // Reload manifest map to reflect changes
    await loadManifestMap();
  } catch (err) {
    console.error("Error applying configuration to all:", err);
    showError("Failed to apply configuration to all manifests");
  }
}

// Close Apply to All modal
function closeApplyToAllModal() {
  showApplyToAllModal.value = false;
  applyToAllModalConfig.value = {
    mediaType: "video",
    profileLabel: "",
  };
}

// Close dropdowns on outside click
function handleGlobalClick(e) {
  if (!e.target.closest(".dropdown-container")) {
    activeDropdown.value = null;
  }
}

let hls = null;
let dashPlayer = null;
let statsInterval = null;
let stopPollInterval = null;

// Computed properties for local file availability
const hasLocalMasterManifest = computed(() => {
  // Check if local master manifest exists
  return scenario.value && !scenario.value.isPlaceholder;
});

const hasLocalProfileManifest = computed(() => {
  return (profileIndex) => {
    // Check if the profile has been downloaded and has local manifests
    return (
      scenario.value &&
      !scenario.value.isPlaceholder &&
      Object.keys(segmentMap.value).length > 0
    );
  };
});

const hasAnyDownloadedContent = computed(() => {
  if (scenario.value?.type === "DASH") {
    // For DASH, check if manifestMap has manifests
    const hasManifests =
      manifestMapData.value &&
      manifestMapData.value.profile &&
      Object.keys(manifestMapData.value.profile).length > 0 &&
      Object.keys(manifestMapData.value.profile["0"] || {}).length > 0;
    console.log("[DASH] hasAnyDownloadedContent check:", {
      manifestMapData: manifestMapData.value,
      hasManifests,
    });
    return hasManifests;
  }
  // For HLS, check segmentMap
  return Object.keys(segmentMap.value).length > 0;
});

const hasAudioVariant = computed(() => {
  // Check if scenario has audioInfo.json (indicates separate audio was selected)
  return scenario.value?.selectedAudioVariant !== null && 
         scenario.value?.selectedAudioVariant !== undefined;
});

// Check if playback is being processed (rewrite/ZIP creation)
const isProcessingPlayback = computed(() => {
  // Only for HLS and DASH scenarios
  if (scenario.value?.type !== 'HLS' && scenario.value?.type !== 'DASH') {
    return false;
  }
  
  // Show loader if download is in progress or stopping
  if (scenario.value?.downloadStatus === 'downloading' || 
      scenario.value?.downloadStatus === 'stopping') {
    return true;
  }
  
  // Show loader if download just completed but content not yet available
  if (scenario.value?.downloadStatus === 'completed' && !hasAnyDownloadedContent.value) {
    return true;
  }
  
  return false;
});

// Loading message for playback processing
const playbackLoadingMessage = computed(() => {
  if (scenario.value?.downloadStatus === 'downloading') {
    return 'Downloading content and preparing manifests for playback...';
  }
  if (scenario.value?.downloadStatus === 'stopping') {
    return 'Finalizing download and creating ZIP archive...';
  }
  if (scenario.value?.downloadStatus === 'completed' && !hasAnyDownloadedContent.value) {
    return 'Processing downloaded content and rewriting manifests...';
  }
  return 'Preparing content for playback...';
});

const hasDashManifests = computed(() => {
  // Check if DASH manifests exist (for DASH scenarios)
  const result =
    scenario.value &&
    scenario.value.type === "DASH" &&
    !scenario.value.isPlaceholder &&
    manifestMapData.value &&
    manifestMapData.value.profile &&
    Object.keys(manifestMapData.value.profile).length > 0 &&
    Object.keys(manifestMapData.value.profile["0"] || {}).length > 0;

  console.log("[DASH] hasDashManifests check:", {
    scenarioType: scenario.value?.type,
    isPlaceholder: scenario.value?.isPlaceholder,
    manifestMapData: manifestMapData.value,
    result,
  });

  return result;
});

const hasLocalAudioManifest = computed(() => {
  return (variantName) => {
    // Check if audio manifests exist in manifestMap for this variant
    return (
      scenario.value &&
      !scenario.value.isPlaceholder &&
      manifestMapData.value?.audio?.[variantName] &&
      Object.keys(manifestMapData.value.audio[variantName]).length > 0
    );
  };
});

async function stopDownload() {
  const scenarioId = props.id || route.params.id;
  try {
    await store.stopDownload(scenarioId);

    // Stop polling for download stats immediately
    if (statsInterval) {
      clearInterval(statsInterval);
      statsInterval = null;
    }

    // Clear any existing stop poll interval
    if (stopPollInterval) {
      clearInterval(stopPollInterval);
      stopPollInterval = null;
    }

    // Poll scenario status to detect when stopping completes
    stopPollInterval = setInterval(async () => {
      try {
        await store.fetchScenario(scenarioId);
        
        // Check if status changed from "stopping" to "stopped" or any other status
        if (scenario.value?.downloadStatus !== "stopping") {
          clearInterval(stopPollInterval);
          stopPollInterval = null;
          console.log("Stop process completed, status:", scenario.value?.downloadStatus);
        }
      } catch (error) {
        console.error("Error polling scenario status:", error);
        // Continue polling even on error
      }
    }, 2000); // Poll every 2 seconds

    // Set a timeout to stop polling after 5 minutes (safety measure)
    setTimeout(() => {
      if (stopPollInterval) {
        clearInterval(stopPollInterval);
        stopPollInterval = null;
        console.log("Stop polling timeout reached");
      }
    }, 300000); // 5 minutes

  } catch (error) {
    // Error handled by store, but still clear polling
    if (statsInterval) {
      clearInterval(statsInterval);
      statsInterval = null;
    }
    if (stopPollInterval) {
      clearInterval(stopPollInterval);
      stopPollInterval = null;
    }
  }
}

async function loadLocalMasterManifest() {
  const scenarioId = props.id || route.params.id;

  if (!hasLocalMasterManifest.value) {
    setPlaybackStatus(
      "error",
      "Local master manifest not available. Please download the scenario first.",
    );
    return;
  }

  try {
    // Only reset live stream states for Live scenarios
    if (scenario.value.playbackType !== "VOD") {
      console.log("Resetting all live stream states for fresh playback...");
      await api.post(`/api/scenarios/${scenarioId}/live-stream/reset`, {
        resetAll: true,
      });
    } else {
      console.log("VOD scenario - no live stream reset needed");
    }

    // Use the backend server URL directly
    const backendUrl =
      import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";
    const manifestUrl = `${backendUrl}/api/scenarios/${scenarioId}/player/master/master-local.m3u8`;
    console.log("Loading local master manifest from:", manifestUrl);
    setPlaybackStatus("info", "Loading local master manifest...");
    loadHLS(manifestUrl);
  } catch (error) {
    console.error("Error in loadLocalMasterManifest:", error);
    // Continue with playback even if reset fails
    const backendUrl =
      import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";
    const manifestUrl = `${backendUrl}/api/scenarios/${scenarioId}/player/master/master-local.m3u8`;
    console.log("Loading local master manifest from:", manifestUrl);
    setPlaybackStatus("info", "Loading local master manifest...");
    loadHLS(manifestUrl);
  }
}

async function loadLocalProfileManifest() {
  const scenarioId = props.id || route.params.id;

  if (!hasLocalProfileManifest.value(selectedPlaybackProfile.value)) {
    setPlaybackStatus(
      "error",
      `Local profile ${selectedPlaybackProfile.value} manifest not available. Please download this profile first.`,
    );
    return;
  }

  try {
    // Only reset live stream state for Live scenarios
    if (scenario.value.playbackType !== "VOD") {
      console.log(
        `Resetting live stream state for profile ${selectedPlaybackProfile.value}...`,
      );
      await api.post(`/api/scenarios/${scenarioId}/live-stream/reset`, {
        profileNumber: selectedPlaybackProfile.value,
      });
    } else {
      console.log("VOD scenario - no live stream reset needed");
    }

    // Use the backend server URL directly
    const backendUrl =
      import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";
    const manifestUrl = `${backendUrl}/api/scenarios/${scenarioId}/player/profiles/${selectedPlaybackProfile.value}/playlist.m3u8`;
    console.log("Loading local profile manifest from:", manifestUrl);
    setPlaybackStatus(
      "info",
      `Loading local profile ${selectedPlaybackProfile.value} manifest...`,
    );
    loadHLS(manifestUrl);
  } catch (error) {
    console.error("Error in loadLocalProfileManifest:", error);
    // Continue with playback even if reset fails
    const backendUrl =
      import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";
    const manifestUrl = `${backendUrl}/api/scenarios/${scenarioId}/player/profiles/${selectedPlaybackProfile.value}/playlist.m3u8`;
    console.log("Loading local profile manifest from:", manifestUrl);
    setPlaybackStatus(
      "info",
      `Loading local profile ${selectedPlaybackProfile.value} manifest...`,
    );
    loadHLS(manifestUrl);
  }
}

function loadExternalHlsUrl() {
  const url = externalHlsUrl.value.trim();
  
  if (!url) {
    setPlaybackStatus("error", "Please enter a valid HLS URL");
    return;
  }

  // Basic URL validation
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    setPlaybackStatus("error", "URL must start with http:// or https://");
    return;
  }

  console.log("Loading external HLS URL:", url);
  setPlaybackStatus("info", `Loading HLS from external URL...`);
  loadHLS(url);
}

async function stopVodPlayback() {
  const scenarioId = props.id || route.params.id;
  stopPlaybackLoading.value = true;

  try {
    console.log("Stopping VOD playback...");
    
    // Stop the video player
    if (videoElement.value) {
      videoElement.value.pause();
      videoElement.value.currentTime = 0;
    }

    // Destroy HLS instance
    if (hls) {
      hls.destroy();
      hls = null;
    }

    setPlaybackStatus("success", "Playback stopped successfully.");
    success("VOD playback stopped");
  } catch (error) {
    console.error("Error stopping VOD playback:", error);
    setPlaybackStatus("error", "Failed to stop playback. Please try again.");
    showError("Failed to stop VOD playback");
  } finally {
    stopPlaybackLoading.value = false;
  }
}

function setPlaybackStatus(type, message) {
  playbackStatus.value = { type, message };

  // Clear status after 5 seconds for non-error messages
  if (type !== "error") {
    setTimeout(() => {
      if (playbackStatus.value && playbackStatus.value.message === message) {
        playbackStatus.value = null;
      }
    }, 5000);
  }
}

function getProfileInfo(profileIndex) {
  if (
    scenario.value &&
    scenario.value.profiles &&
    scenario.value.profiles[profileIndex]
  ) {
    const profile = scenario.value.profiles[profileIndex];
    return `${profile.resolution || "Unknown"} - ${(
      profile.bandwidth / 1000000
    ).toFixed(1)}Mbps`;
  }
  return "Unknown";
}

function loadHLS(url) {
  console.log("=== Loading Local HLS Content ===");
  console.log("URL:", url);

  // Properly destroy existing HLS instance
  if (hls) {
    console.log("Destroying existing HLS instance...");
    hls.destroy();
    hls = null;
  }

  // Reset video element
  if (videoElement.value) {
    videoElement.value.src = "";
    videoElement.value.load();
  }

  if (Hls.isSupported()) {
    hls = new Hls({
      debug: false, // Disable debug to reduce console noise
      enableWorker: true,
      xhrSetup: function (xhr, url) {
        console.log("HLS.js requesting local file:", url);
        // Enable credentials for cookie support
        xhr.withCredentials = true;
      },
    });

    hls.loadSource(url);
    hls.attachMedia(videoElement.value);

    hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
      console.log("Local HLS manifest loaded successfully");
      console.log("Levels:", data.levels);
      console.log("Audio tracks:", data.audioTracks);
      setPlaybackStatus(
        "success",
        `Manifest loaded successfully. ${data.levels.length} quality levels available.`,
      );
    });

    hls.on(Hls.Events.LEVEL_LOADED, (event, data) => {
      console.log("Level loaded:", data.level);
      console.log("Segments:", data.details.fragments.length);
      setPlaybackStatus(
        "success",
        `Quality level loaded with ${data.details.fragments.length} segments.`,
      );
    });

    hls.on(Hls.Events.FRAG_LOADING, (event, data) => {
      console.log("Loading local segment:", data.frag.url);
    });

    hls.on(Hls.Events.FRAG_LOADED, (event, data) => {
      console.log("Local segment loaded successfully:", data.frag.url);
    });

    hls.on(Hls.Events.ERROR, (event, data) => {
      console.error("HLS error:", data);

      let errorMessage = "Playback error occurred";

      if (data.fatal) {
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            errorMessage =
              "Network error: Cannot load local files. Make sure the scenario has been downloaded.";
            console.error("Fatal network error encountered");
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            errorMessage = "Media error: Problem with video/audio content.";
            console.error("Fatal media error encountered, trying to recover");
            hls.recoverMediaError();
            return; // Don't show error message if we're trying to recover
          default:
            errorMessage = "Fatal playback error: Cannot continue playback.";
            console.error("Fatal error, cannot recover");
            if (hls) {
              hls.destroy();
              hls = null;
            }
            break;
        }
      } else {
        // Non-fatal error
        errorMessage = `Playback warning: ${data.details || "Unknown error"}`;
      }

      setPlaybackStatus("error", errorMessage);
    });

    // Success event when playback starts
    hls.on(Hls.Events.FRAG_BUFFERED, () => {
      setPlaybackStatus("success", "Local content is playing successfully.");
    });

    // Handle media ended event to show completion status
    if (videoElement.value) {
      videoElement.value.addEventListener("ended", () => {
        console.log("Video playback ended");
        setPlaybackStatus(
          "success",
          "Playback completed. Click 'Load Local Master Manifest' to play again.",
        );
      });
    }
  } else if (videoElement.value.canPlayType("application/vnd.apple.mpegurl")) {
    // Native HLS support (Safari)
    console.log("Using native HLS support for local content");
    videoElement.value.src = url;
    setPlaybackStatus("info", "Loading with native HLS support...");

    videoElement.value.addEventListener("loadeddata", () => {
      setPlaybackStatus(
        "success",
        "Local content loaded with native HLS support.",
      );
    });

    videoElement.value.addEventListener("error", (e) => {
      console.error("Native HLS error:", e);
      setPlaybackStatus(
        "error",
        "Error loading local content with native HLS support.",
      );
    });

    videoElement.value.addEventListener("ended", () => {
      console.log("Video playback ended (native HLS)");
      setPlaybackStatus(
        "success",
        "Playback completed. Click 'Load Local Master Manifest' to play again.",
      );
    });
  } else {
    console.error("HLS is not supported in this browser");
    setPlaybackStatus(
      "error",
      "HLS playback is not supported in this browser.",
    );
  }
}

function loadDashManifest() {
  const scenarioId = props.id || route.params.id;

  if (!hasDashManifests.value) {
    setPlaybackStatus(
      "error",
      "DASH manifests not available. Please download the scenario first.",
    );
    return;
  }

  try {
    // Initialize DASH livestream
    setPlaybackStatus("info", "Initializing DASH livestream...");

    api
      .post(`/api/scenarios/${scenarioId}/dash-live-stream/init`, {
        profileNumber: 0,
      })
      .then((response) => {
        console.log("DASH livestream initialized:", response.data);

        // Use the livestream endpoint
        const backendUrl =
          import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";
        const manifestUrl = `${backendUrl}/api/scenarios/${scenarioId}/dash-live-stream/manifest.mpd`;

        console.log("Loading DASH livestream from:", manifestUrl);
        setPlaybackStatus("info", "Loading DASH livestream...");
        loadDASH(manifestUrl);
      })
      .catch((error) => {
        console.error("Error initializing DASH livestream:", error);
        setPlaybackStatus("error", "Failed to initialize DASH livestream");
      });
  } catch (error) {
    console.error("Error loading DASH manifest:", error);
    setPlaybackStatus("error", "Failed to load DASH manifest");
  }
}

function loadDASH(url) {
  console.log("=== Loading DASH Content ===");
  console.log("URL:", url);

  // Properly destroy existing players
  if (dashPlayer) {
    console.log("Destroying existing DASH player...");
    dashPlayer.reset();
    dashPlayer = null;
  }

  if (hls) {
    console.log("Destroying existing HLS instance...");
    hls.destroy();
    hls = null;
  }

  // Reset video element
  if (videoElement.value) {
    videoElement.value.src = "";
    videoElement.value.load();
  }

  try {
    // Create DASH player
    dashPlayer = dashjs.MediaPlayer().create();

    console.log("DASH player created");

    // Configure player with debug logging
    dashPlayer.updateSettings({
      debug: {
        logLevel: dashjs.Debug.LOG_LEVEL_DEBUG,
      },
      streaming: {
        buffer: {
          fastSwitchEnabled: true,
        },
        liveDelay: 4,
      },
    });

    console.log("DASH player configured");

    // Initialize player (autoplay = true)
    dashPlayer.initialize(videoElement.value, url, true);

    console.log("DASH player initialized with URL:", url);

    // Event listeners
    dashPlayer.on(dashjs.MediaPlayer.events.MANIFEST_LOADED, (e) => {
      console.log("DASH manifest loaded:", e);
      setPlaybackStatus("info", "DASH manifest loaded, initializing stream...");
    });

    dashPlayer.on(dashjs.MediaPlayer.events.STREAM_INITIALIZED, () => {
      console.log("DASH stream initialized");
      setPlaybackStatus(
        "success",
        "DASH stream initialized, starting playback...",
      );

      // Explicitly start playback
      if (videoElement.value) {
        videoElement.value.play().catch((err) => {
          console.error("Error starting playback:", err);
          setPlaybackStatus(
            "error",
            "Failed to start playback. Click the play button to start.",
          );
        });
      }
    });

    dashPlayer.on(dashjs.MediaPlayer.events.PLAYBACK_STARTED, () => {
      console.log("DASH playback started");
      setPlaybackStatus("success", "DASH content is playing successfully");
    });

    dashPlayer.on(dashjs.MediaPlayer.events.PLAYBACK_ENDED, () => {
      console.log("DASH playback ended");
      setPlaybackStatus(
        "success",
        "Playback completed. Click 'Load DASH Manifest' to play again.",
      );
    });

    dashPlayer.on(dashjs.MediaPlayer.events.ERROR, (e) => {
      console.error("DASH error:", e);
      let errorMessage = "DASH playback error occurred";

      if (e.error) {
        if (
          e.error.code ===
          dashjs.MediaPlayer.errors.DOWNLOAD_ERROR_ID_MANIFEST_CODE
        ) {
          errorMessage =
            "Cannot load DASH manifest. Make sure the scenario has been downloaded.";
        } else if (
          e.error.code ===
          dashjs.MediaPlayer.errors.DOWNLOAD_ERROR_ID_CONTENT_CODE
        ) {
          errorMessage =
            "Cannot load DASH segments. Make sure the scenario has been downloaded.";
        } else {
          errorMessage = `DASH error: ${e.error.message || "Unknown error"}`;
        }
      }

      setPlaybackStatus("error", errorMessage);
    });

    // Handle media ended event
    if (videoElement.value) {
      videoElement.value.addEventListener("ended", () => {
        console.log("Video playback ended");
        setPlaybackStatus(
          "success",
          "Playback completed. Click 'Load DASH Manifest' to play again.",
        );
      });
    }
  } catch (error) {
    console.error("Error initializing DASH player:", error);
    setPlaybackStatus("error", "Failed to initialize DASH player");
  }
}

async function handleClone(cloneData) {
  const scenarioId = props.id || route.params.id;
  try {
    const newScenario = await store.cloneScenario(scenarioId, cloneData);
    showCloneModal.value = false;
    router.push(`/scenario/${newScenario.id}`);
  } catch (error) {
    // Error handled by store
  }
}

async function deleteCurrentScenario() {
  const scenarioId = props.id || route.params.id;

  deleting.value = true;
  try {
    await store.deleteScenario(scenarioId);
    // Navigate back to home after successful deletion
    showDeleteModal.value = false;
function cancelDelete() {
  showDeleteModal.value = false;
}

// Handler functions for playback tab emits
function handleActionScopeModalUpdate(data) {
  if (data.show) {
    showActionScopeModal.value = true;
    actionScopeModalConfig.value = {
      actionType: data.actionType,
      mediaType: data.mediaType,
      manifest: data.manifest,
    };
  }
}

function handleApplyToAllModalUpdate(data) {
  if (data.show) {
    showApplyToAllModal.value = true;
    applyToAllModalConfig.value = {
      mediaType: data.mediaType,
      profileLabel: data.profileLabel,
    };
  }
}   // Error handled by store
  } finally {
    deleting.value = false;
  }
}

function cancelDelete() {
  showDeleteModal.value = false;
}

// Watch for route changes to reload scenario data
watch(
  () => route.params.id,
  async (newId) => {
    if (newId && newId !== (props.id || route.params.id)) {
      console.log("Route changed, loading new scenario:", newId);
      store.currentScenario = null;
      try {
        await store.fetchScenario(newId);
      } catch (error) {
        console.error("Error loading scenario after route change:", error);
      }
    }
  },
);

// Watch for tab changes to refresh data when switching to playback
watch(activeTab, async (newTab) => {
  if (newTab === "playback") {
    // Clear previous playback status
    playbackStatus.value = null;

    // Load configuration
    loadManifestMap();

    // Load segment map for HLS scenarios
    if (scenario.value?.type === "HLS") {
      await loadSegmentMap();
    }

    // Stop any existing HLS playback and clean up
    if (hls) {
      console.log("Cleaning up HLS instance on tab switch...");
      hls.destroy();
      hls = null;
    }

    // Reset video element
    if (videoElement.value) {
      videoElement.value.src = "";
      videoElement.value.load();
    }
  } else if (newTab === "edit") {
    loadManifestMap();
  }
});

async function toggleCookieValidation() {
  const scenarioId = props.id || route.params.id;
  try {
    await api.post(`/api/scenarios/${scenarioId}/cookie-validation`, {
      enabled: cookieValidationEnabled.value,
    });
    
    success(
      cookieValidationEnabled.value
        ? "Cookie validation enabled - external players must send valid cookies"
        : "Cookie validation disabled - external players can play without validation"
    );
  } catch (err) {
    showError(`Failed to toggle cookie validation: ${err.response?.data?.error || err.message}`);
    // Revert the toggle on error
    cookieValidationEnabled.value = !cookieValidationEnabled.value;
  }
}

onMounted(async () => {
  window.addEventListener("click", handleGlobalClick);
  // Get scenario ID from props (passed by router) or route params as fallback
  const scenarioId = props.id || route.params.id;
  console.log("=== ScenarioDetail onMounted ===");
  console.log("ScenarioDetail mounted with scenarioId:", scenarioId);
  console.log("Props:", props);
  console.log("Route params:", route.params);
  console.log("Current route path:", route.path);
  console.log("Current scenario in store:", scenario.value);

  if (!scenarioId) {
    console.error("No scenario ID provided");
    store.error = "No scenario ID provided";
    return;
  }

  // Clear any existing scenario data before fetching new one
  console.log("Clearing current scenario and fetching new one...");
  store.currentScenario = null;

  try {
    const fetchedScenario = await store.fetchScenario(scenarioId);
    console.log("Scenario fetched successfully:", fetchedScenario);
    console.log("Store scenario after fetch:", scenario.value);
    
    // Initialize cookie validation state
    if (fetchedScenario.cookieValidationEnabled !== undefined) {
      cookieValidationEnabled.value = fetchedScenario.cookieValidationEnabled;
    }
    
    await loadManifestMap();
    
    // Load segment map for HLS scenarios
    if (fetchedScenario.type === "HLS") {
      await loadSegmentMap();
    }
  } catch (error) {
    console.error("Error loading scenario:", error);
  }
});

onUnmounted(() => {
  window.removeEventListener("click", handleGlobalClick);
  console.log("ScenarioDetail component unmounting, cleaning up...");
  if (hls) {
    hls.destroy();
    hls = null;
  }
  if (statsInterval) {
    clearInterval(statsInterval);
    statsInterval = null;
  }
  if (stopPollInterval) {
    clearInterval(stopPollInterval);
    stopPollInterval = null;
  }
  // Clear playback status
  playbackStatus.value = null;
});
</script>
