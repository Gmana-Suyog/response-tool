<template>
  <div v-show="activeTab === 'history'" class="space-y-6">
    <div class="card p-6">
      <div class="flex items-center justify-between mb-6">
        <h2 class="text-lg font-medium text-gray-900">Change History</h2>
        <button
          @click="refreshHistory"
          :disabled="loadingHistory"
          class="btn btn-secondary text-sm"
        >
          <svg
            v-if="loadingHistory"
            class="animate-spin -ml-1 mr-2 h-4 w-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              class="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              stroke-width="4"
            ></circle>
            <path
              class="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
          Refresh
        </button>
      </div>

      <!-- No History Message -->
      <div
        v-if="
          !loadingHistory && (!changeHistory || changeHistory.length === 0)
        "
        class="text-center py-12"
      >
        <svg
          class="mx-auto h-12 w-12 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <h3 class="mt-2 text-sm font-medium text-gray-900">
          No history available
        </h3>
        <p class="mt-1 text-sm text-gray-500">
          No changes have been recorded for this scenario yet.
        </p>
      </div>

      <!-- History Table -->
      <div v-else-if="!loadingHistory" class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th
                scope="col"
                class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                Manifest #
              </th>
              <th
                scope="col"
                class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                Filename
              </th>
              <th
                scope="col"
                class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                Original File
              </th>
              <th
                scope="col"
                class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                Timestamp
              </th>
              <th
                scope="col"
                class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                User
              </th>
              <th
                scope="col"
                class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                Profiles
              </th>
              <th
                scope="col"
                class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                Status
              </th>
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">
            <tr
              v-for="(change, idx) in changeHistory"
              :key="idx"
              class="hover:bg-gray-50"
            >
              <td
                class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900"
              >
                {{ change.manifestNumber || "-" }}
              </td>
              <td class="px-6 py-4 text-sm text-gray-900">
                <div class="max-w-xs truncate" :title="change.filename">
                  {{ change.filename || "-" }}
                </div>
              </td>
              <td class="px-6 py-4 text-sm text-gray-500">
                <div class="max-w-xs truncate" :title="change.originalfile">
                  {{ change.originalfile || "-" }}
                </div>
              </td>
              <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                <div class="flex flex-col">
                  <span>{{ formatHistoryDate(change.timestamp) }}</span>
                  <span class="text-xs text-gray-400">
                    {{ formatFullDate(change.timestamp) }}
                  </span>
                </div>
              </td>
              <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                {{ change.User || "-" }}
              </td>
              <td class="px-6 py-4 text-sm text-gray-500">
                <div class="space-y-1">
                  <div
                    v-if="
                      change.profiles?.videoProfiles &&
                      change.profiles.videoProfiles.length > 0
                    "
                  >
                    <span
                      class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800"
                    >
                      Video: {{ change.profiles.videoProfiles.join(", ") }}
                    </span>
                  </div>
                  <div
                    v-if="
                      change.profiles?.audioProfiles &&
                      change.profiles.audioProfiles.length > 0
                    "
                  >
                    <span
                      class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800"
                    >
                      Audio: {{ change.profiles.audioProfiles.join(", ") }}
                    </span>
                  </div>
                  <div
                    v-if="
                      !change.profiles ||
                      (!change.profiles.videoProfiles?.length &&
                        !change.profiles.audioProfiles?.length)
                    "
                  >
                    <span class="text-gray-400">-</span>
                  </div>
                </div>
              </td>
              <td class="px-6 py-4 whitespace-nowrap">
                <span
                  v-if="change.isEditedAll"
                  class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800"
                >
                  Edited (All)
                </span>
                <span
                  v-else-if="change.isEdited"
                  class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800"
                >
                  Edited
                </span>
                <span
                  v-else
                  class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800"
                >
                  Updated
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Loading State -->
      <div v-else class="text-center py-12">
        <div
          class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"
        ></div>
        <p class="mt-2 text-sm text-gray-600">Loading history...</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from "vue";
import { useRoute } from "vue-router";
import api from "../config/api";

const props = defineProps({
  activeTab: {
    type: String,
    required: true,
  },
  scenarioId: {
    type: String,
    required: true,
  },
});

const route = useRoute();

// History section refs
const changeHistory = ref([]);
const loadingHistory = ref(false);

// History methods
async function fetchChangeHistory() {
  loadingHistory.value = true;
  try {
    const scenarioId = props.scenarioId || route.params.id;
    const response = await api.get(`/api/scenarios/${scenarioId}/history`);
    changeHistory.value = response.data.changes || [];
  } catch (error) {
    console.error("Error fetching change history:", error);
    changeHistory.value = [];
  } finally {
    loadingHistory.value = false;
  }
}

function refreshHistory() {
  fetchChangeHistory();
}

function getChangeTypeColor(type) {
  // Handle manifest edit format
  if (type === undefined && arguments[0]?.isEdited !== undefined) {
    return "bg-purple-500";
  }

  const colors = {
    created: "bg-green-500",
    download_started: "bg-blue-500",
    download_stopped: "bg-gray-500",
    manifest_edited: "bg-purple-500",
    config_updated: "bg-yellow-500",
    cloned: "bg-indigo-500",
  };
  return colors[type] || "bg-gray-500";
}

function getChangeTitle(change) {
  // Handle manifest edit format
  if (change.manifestNumber && change.filename) {
    if (change.isEditedAll) {
      return "Manifest Edited (All Profiles)";
    } else if (change.isEdited) {
      return "Manifest Edited";
    }
    return "Manifest Updated";
  }

  const titles = {
    created: "Scenario Created",
    download_started: "Download Started",
    download_stopped: "Download Stopped",
    manifest_edited: "Manifest Edited",
    config_updated: "Configuration Updated",
    cloned: "Scenario Cloned",
  };
  return titles[change.type] || change.type;
}

function formatDetailKey(key) {
  return key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

function formatDetailValue(value) {
  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

function formatHistoryDate(timestamp) {
  if (!timestamp) return "Unknown";
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? "s" : ""} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;

  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatFullDate(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// Watch for tab changes to fetch history when switching to history tab
watch(
  () => props.activeTab,
  (newTab) => {
    if (newTab === "history") {
      fetchChangeHistory();
    }
  }
);

// Fetch history on mount if history tab is active
onMounted(() => {
  if (props.activeTab === "history") {
    fetchChangeHistory();
  }
});
</script>