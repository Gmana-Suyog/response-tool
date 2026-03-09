<template>
  <div>
    <div class="sm:flex sm:items-center sm:justify-between">
      <div>
        <h1 class="text-2xl font-bold text-gray-900">Scenarios</h1>
        <p class="mt-2 text-sm text-gray-700">
          Manage your response test scenarios
        </p>
      </div>
      <div class="mt-4 sm:mt-0">
        <router-link to="/create" class="btn btn-primary">
          Create New Scenario
        </router-link>
      </div>
    </div>

    <!-- Search and Filters -->
    <div class="mt-6">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">
            Search by Name
          </label>
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Search scenarios..."
            class="input"
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">
            Filter by Category
          </label>
          <select v-model="filterCategory" class="input">
            <option value="">All Categories</option>
            <option v-for="cat in availableCategories" :key="cat" :value="cat">
              {{ cat }}
            </option>
          </select>
        </div>
        <div class="flex items-end">
          <button @click="clearFilters" class="btn btn-secondary w-full">
            Clear Filters
          </button>
        </div>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="mt-8 text-center">
      <div
        class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"
      ></div>
      <p class="mt-2 text-sm text-gray-600">Loading scenarios...</p>
    </div>

    <!-- Error State -->
    <div
      v-if="error"
      class="mt-8 bg-red-50 border border-red-200 rounded-md p-4"
    >
      <div class="flex">
        <ExclamationTriangleIcon class="h-5 w-5 text-red-400" />
        <div class="ml-3">
          <h3 class="text-sm font-medium text-red-800">Error</h3>
          <p class="mt-1 text-sm text-red-700">{{ error }}</p>
        </div>
      </div>
    </div>

    <!-- Scenarios Grid -->
    <div
      v-if="!loading && filteredScenarios.length > 0"
      class="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
    >
      <div
        v-for="scenario in filteredScenarios"
        :key="scenario.id"
        class="card p-6 hover:shadow-lg transition-shadow duration-200 cursor-pointer"
        @click="$router.push(`/scenario/${scenario.id}`)"
      >
        <div class="flex items-center justify-between">
          <h3 class="text-lg font-medium text-gray-900 truncate">
            {{ scenario.name }}
          </h3>
          <span
            :class="getStatusClass(scenario.downloadStatus)"
            class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
          >
            {{ scenario.downloadStatus || "idle" }}
          </span>
        </div>

        <p class="mt-2 text-sm text-gray-600 line-clamp-2">
          {{ scenario.description || "No description" }}
        </p>

        <div
          v-if="scenario.category || scenario.approveVersion || scenario.playbackType"
          class="mt-2 flex flex-wrap gap-2"
        >
          <span
            v-if="scenario.category"
            class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800"
          >
            {{ scenario.category }}
          </span>
          <span
            v-if="scenario.approveVersion"
            class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800"
          >
            v{{ scenario.approveVersion }}
          </span>
          <span
            v-if="scenario.playbackType"
            class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
            :class="
              scenario.playbackType === 'Live'
                ? 'bg-red-100 text-red-800'
                : 'bg-green-100 text-green-800'
            "
          >
            {{ scenario.playbackType }}
          </span>
        </div>

        <div
          class="mt-4 flex items-center justify-between text-sm text-gray-500"
        >
          <span>{{ formatDate(scenario.createdAt) }}</span>
          <span v-if="scenario.segmentCount">
            {{ scenario.segmentCount }} segments
          </span>
        </div>

        <div class="mt-4 flex space-x-2">
          <button
            @click.stop="cloneScenario(scenario)"
            class="btn btn-secondary text-xs"
          >
            Clone
          </button>
          <button
            @click.stop="copyMasterManifestUrl(scenario)"
            class="btn btn-secondary text-xs"
            title="Copy Master Manifest URL"
          >
            Copy URL
          </button>
          <button
            @click.stop="deleteScenario(scenario)"
            class="btn btn-danger text-xs"
          >
            Delete
          </button>
          <button
            v-if="
              scenario.downloadStatus === 'downloading' ||
              scenario.downloadStatus === 'stopping'
            "
            @click.stop="stopDownload(scenario.id)"
            :disabled="
              downloadLoading || scenario.downloadStatus === 'stopping'
            "
            class="btn btn-danger text-xs relative"
          >
            <span
              v-if="downloadLoading || scenario.downloadStatus === 'stopping'"
              class="flex items-center justify-center"
            >
              <svg
                class="animate-spin -ml-1 mr-2 h-3 w-3 text-white"
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
              Stopping...
            </span>
            <span v-else>Stop</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <div v-if="!loading && scenarios.length === 0" class="mt-8 text-center">
      <div class="mx-auto h-12 w-12 text-gray-400">
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M7 4V2a1 1 0 011-1h8a1 1 0 011 1v2h4a1 1 0 110 2h-1v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6H3a1 1 0 110-2h4zM9 6v10h6V6H9z"
          />
        </svg>
      </div>
      <h3 class="mt-2 text-sm font-medium text-gray-900">No scenarios</h3>
      <p class="mt-1 text-sm text-gray-500">
        Get started by creating your first scenario.
      </p>
      <div class="mt-6">
        <router-link to="/create" class="btn btn-primary">
          Create Scenario
        </router-link>
      </div>
    </div>

    <!-- Clone Modal -->
    <CloneModal
      v-if="showCloneModal"
      :scenario="scenarioToClone"
      @close="showCloneModal = false"
      @clone="handleClone"
    />

    <!-- Delete Modal -->
    <DeleteModal
      v-if="showDeleteModal"
      :scenario="scenarioToDelete"
      :deleting="deleting"
      @confirm="confirmDelete"
      @cancel="cancelDelete"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onActivated } from "vue";
import { ExclamationTriangleIcon } from "@heroicons/vue/24/outline";
import { useScenariosStore } from "../stores/scenarios";
import { useNotifications } from "../composables/useNotifications";
import CloneModal from "../components/CloneModal.vue";
import DeleteModal from "../components/DeleteModal.vue";

const store = useScenariosStore();
const { success, error: showError } = useNotifications();
const searchQuery = ref("");
const filterCategory = ref("");
const showCloneModal = ref(false);
const scenarioToClone = ref(null);
const showDeleteModal = ref(false);
const scenarioToDelete = ref(null);
const deleting = ref(false);

// Don't destructure reactive refs - use store directly
const scenarios = computed(() => store.scenarios);
const loading = computed(() => store.loading);
const downloadLoading = computed(() => store.downloadLoading);
const error = computed(() => store.error);

const availableCategories = computed(() => {
  if (!scenarios.value || !Array.isArray(scenarios.value)) {
    return [];
  }
  const categories = scenarios.value
    .map((s) => s.category)
    .filter((c) => c && c.trim() !== "");
  return [...new Set(categories)].sort();
});

function clearFilters() {
  searchQuery.value = "";
  filterCategory.value = "";
}

const filteredScenarios = computed(() => {
  console.log("=== COMPUTING FILTERED SCENARIOS ===");
  console.log("scenarios computed:", scenarios.value);
  console.log("scenarios.value type:", typeof scenarios.value);
  console.log("scenarios.value is array:", Array.isArray(scenarios.value));
  console.log("scenarios.value length:", scenarios.value?.length);
  console.log("searchQuery.value:", searchQuery.value);
  console.log("filterCategory.value:", filterCategory.value);
  console.log("loading.value:", loading.value);
  console.log("error.value:", error.value);

  if (!scenarios.value || !Array.isArray(scenarios.value)) {
    console.log("scenarios.value is not a valid array, returning empty array");
    return [];
  }

  let filtered = scenarios.value;

  // Filter by search query
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase();
    filtered = filtered.filter(
      (scenario) =>
        scenario.name.toLowerCase().includes(query) ||
        scenario.description?.toLowerCase().includes(query),
    );
  }

  // Filter by category
  if (filterCategory.value) {
    filtered = filtered.filter(
      (scenario) => scenario.category === filterCategory.value,
    );
  }

  console.log("Filtered scenarios:", filtered);
  return filtered;
});

function getStatusClass(status) {
  switch (status) {
    case "downloading":
      return "bg-blue-100 text-blue-800";
    case "stopping":
      return "bg-yellow-100 text-yellow-800";
    case "stopped":
      return "bg-gray-100 text-gray-800";
    case "error":
      return "bg-red-100 text-red-800";
    default:
      return "bg-green-100 text-green-800";
  }
}

function formatDate(dateString) {
  return new Date(dateString).toLocaleDateString();
}

function cloneScenario(scenario) {
  scenarioToClone.value = scenario;
  showCloneModal.value = true;
}

async function handleClone(cloneData) {
  try {
    await store.cloneScenario(scenarioToClone.value.id, cloneData);
    showCloneModal.value = false;
    scenarioToClone.value = null;
  } catch (error) {
    // Error is handled by the store
  }
}

async function deleteScenario(scenario) {
  scenarioToDelete.value = scenario;
  showDeleteModal.value = true;
}

async function confirmDelete() {
  if (!scenarioToDelete.value) return;

  deleting.value = true;
  try {
    await store.deleteScenario(scenarioToDelete.value.id);
    showDeleteModal.value = false;
    scenarioToDelete.value = null;
  } catch (error) {
    // Error is handled by the store
  } finally {
    deleting.value = false;
  }
}

function cancelDelete() {
  showDeleteModal.value = false;
  scenarioToDelete.value = null;
}

async function stopDownload(scenarioId) {
  try {
    await store.stopDownload(scenarioId);
  } catch (error) {
    // Error is handled by the store
  }
}

function getMasterManifestUrl(scenario) {
  const backendUrl =
    import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";
  
  if (scenario.type === "DASH") {
    return `${backendUrl}/api/scenarios/${scenario.id}/dash-live-stream/manifest.mpd`;
  }
  
  return `${backendUrl}/api/scenarios/${scenario.id}/player/master/master-local.m3u8`;
}

async function copyMasterManifestUrl(scenario) {
  try {
    const url = getMasterManifestUrl(scenario);
    await navigator.clipboard.writeText(url);

    // Show success notification
    success("Master manifest URL copied to clipboard!");
  } catch (error) {
    console.error("Failed to copy URL:", error);
    showError("Failed to copy URL to clipboard");
  }
}

onMounted(() => {
  console.log("=== HOME.VUE MOUNTED ===");
  console.log("Store object:", store);
  console.log("Store scenarios ref:", store.scenarios);
  console.log("Store scenarios.value:", store.scenarios.value);
  console.log("Store loading:", store.loading);
  console.log("Store error:", store.error);
  console.log("About to call fetchScenarios...");
  store
    .fetchScenarios()
    .then(() => {
      console.log("fetchScenarios promise resolved");
      console.log("After fetch - scenarios.value:", store.scenarios.value);
      console.log("After fetch - loading:", store.loading);
      console.log("After fetch - error:", store.error);
    })
    .catch((err) => {
      console.error("fetchScenarios promise rejected:", err);
    });
});

// Also refresh when component becomes visible again (helps with navigation)
onActivated(() => {
  console.log("Home.vue activated, fetching scenarios...");
  store.fetchScenarios();
});
</script>
