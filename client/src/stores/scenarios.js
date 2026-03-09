import { defineStore } from "pinia";
import { ref, computed } from "vue";
import api from "../config/api";
import { useNotifications } from "../composables/useNotifications";

export const useScenariosStore = defineStore("scenarios", () => {
  const scenarios = ref([]);
  const currentScenario = ref(null);
  const loading = ref(false);
  const downloadLoading = ref(false);
  const error = ref(null);
  const { success, error: showError } = useNotifications();

  const scenarioCount = computed(() => scenarios.value.length);

  async function fetchScenarios() {
    console.log("Store.fetchScenarios called");
    loading.value = true;
    error.value = null;

    try {
      console.log("Making API request to /api/scenarios");
      console.log("Current api baseURL:", api.defaults.baseURL);

      const response = await api.get("/api/scenarios");
      console.log("API response status:", response.status);
      console.log("API response headers:", response.headers);
      console.log("API response data:", response.data);
      console.log("API response data type:", typeof response.data);
      console.log(
        "API response data length:",
        Array.isArray(response.data) ? response.data.length : "not array",
      );

      scenarios.value = response.data;
      console.log("Scenarios stored in reactive ref:", scenarios.value);
      console.log("Scenarios ref length:", scenarios.value.length);
    } catch (err) {
      error.value = err.response?.data?.error || "Failed to fetch scenarios";
      console.error("Error fetching scenarios:", err);
      console.error("Error details:", {
        message: err.message,
        status: err.response?.status,
        statusText: err.response?.statusText,
        data: err.response?.data,
      });
    } finally {
      loading.value = false;
      console.log("fetchScenarios completed, loading:", loading.value);
    }
  }

  async function fetchScenario(id) {
    console.log("fetchScenario called with id:", id);
    loading.value = true;
    error.value = null;

    try {
      console.log("Making API request to:", `/api/scenarios/${id}`);
      const response = await api.get(`/api/scenarios/${id}`);
      console.log("fetchScenario API response:", response.data);
      currentScenario.value = response.data;
      return response.data;
    } catch (err) {
      console.error("fetchScenario API error:", err);
      error.value = err.response?.data?.error || "Failed to fetch scenario";
      console.error("Error fetching scenario:", err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function createScenario(scenarioData) {
    console.log("Store createScenario called with:", scenarioData);
    console.log("belongsToCustomer in store:", scenarioData.belongsToCustomer);
    loading.value = true;
    error.value = null;

    try {
      console.log("Making API request to /api/scenarios");
      const response = await api.post("/api/scenarios", scenarioData);
      console.log("API response:", response.data);
      console.log(
        "API response belongsToCustomer:",
        response.data.belongsToCustomer,
      );

      // Check if scenario already exists in the store to prevent duplicates
      const existingIndex = scenarios.value.findIndex(
        (s) => s.id === response.data.id,
      );
      if (existingIndex >= 0) {
        // Update existing scenario instead of adding duplicate
        scenarios.value[existingIndex] = response.data;
      } else {
        // Add new scenario
        scenarios.value.push(response.data);
      }

      // Show success notification
      success(`Scenario "${response.data.name}" created successfully!`);

      return response.data;
    } catch (err) {
      console.error("API error:", err);
      error.value = err.response?.data?.error || "Failed to create scenario";

      // Show error notification with better message for 403 errors
      const errorMessage = error.value.includes("403")
        ? "Access denied to that URL. Please use one of the test URLs provided below the input field."
        : error.value;
      showError(errorMessage);

      console.error("Error creating scenario:", err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function cloneScenario(id, cloneData) {
    loading.value = true;
    error.value = null;

    try {
      console.log("Cloning scenario:", id, "with data:", cloneData);
      const response = await api.post(`/api/scenarios/${id}/clone`, cloneData);
      console.log("Clone response:", response.data);

      // Add to scenarios list
      scenarios.value.push(response.data);

      // Show success notification
      success(`Scenario "${response.data.name}" cloned successfully!`);

      return response.data;
    } catch (err) {
      error.value = err.response?.data?.error || "Failed to clone scenario";
      console.error("Error cloning scenario:", err);

      // Show error notification
      showError(error.value);

      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function deleteScenario(id) {
    loading.value = true;
    error.value = null;

    try {
      console.log("Deleting scenario:", id);
      await api.delete(`/api/scenarios/${id}`);

      // Remove from scenarios list
      const index = scenarios.value.findIndex((s) => s.id === id);
      if (index >= 0) {
        scenarios.value.splice(index, 1);
      }

      // Show success notification
      success("Scenario deleted successfully!");

      return true;
    } catch (err) {
      error.value = err.response?.data?.error || "Failed to delete scenario";
      console.error("Error deleting scenario:", err);

      // Show error notification
      showError(error.value);

      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function fetchManifestMap(id) {
    try {
      const response = await api.get(`/api/scenarios/${id}/manifest-map`);
      return response.data;
    } catch (err) {
      console.error("Error fetching manifest map:", err);
      throw err;
    }
  }

  async function updateManifestConfig(id, config) {
    try {
      const response = await api.post(
        `/api/scenarios/${id}/manifest-config`,
        config,
      );
      return response.data;
    } catch (err) {
      console.error("Error updating manifest config:", err);
      throw err;
    }
  }

  async function updateManifestConfigAllProfiles(id, config) {
    try {
      const response = await api.post(
        `/api/scenarios/${id}/manifest-config/all-profiles`,
        config,
      );
      return response.data;
    } catch (err) {
      console.error("Error updating manifest config all profiles:", err);
      throw err;
    }
  }

  async function resetManifestConfig(id, config) {
    try {
      const response = await api.post(
        `/api/scenarios/${id}/manifest-config/reset`,
        config,
      );
      return response.data;
    } catch (err) {
      console.error("Error resetting manifest config:", err);
      throw err;
    }
  }

  async function resetAllManifestConfigs(id, type) {
    try {
      const response = await api.post(
        `/api/scenarios/${id}/manifest-config/reset-all`,
        { type },
      );
      return response.data;
    } catch (err) {
      console.error("Error resetting all manifest configs:", err);
      throw err;
    }
  }

  async function startDownload(id, profileNumber, maxSegmentsPerFetch = 6, maxSegmentsToDownload = null, maxAudioSegmentsToDownload = null) {
    downloadLoading.value = true;
    error.value = null;

    try {
      const requestBody = {
        profileNumber,
        maxSegmentsPerFetch,
      };
      
      // Add maxSegmentsToDownload if provided
      if (maxSegmentsToDownload !== null && maxSegmentsToDownload !== undefined) {
        requestBody.maxSegmentsToDownload = maxSegmentsToDownload;
      }
      
      // Add maxAudioSegmentsToDownload if provided
      if (maxAudioSegmentsToDownload !== null && maxAudioSegmentsToDownload !== undefined) {
        requestBody.maxAudioSegmentsToDownload = maxAudioSegmentsToDownload;
      }
      
      const response = await api.post(`/api/scenarios/${id}/download`, requestBody);

      // Update scenario status
      const scenario = scenarios.value.find((s) => s.id === id);
      if (scenario) {
        scenario.downloadStatus = "downloading";
        scenario.currentProfile = profileNumber;
        scenario.maxSegmentsPerFetch = maxSegmentsPerFetch;
        if (maxSegmentsToDownload) {
          scenario.maxSegmentsToDownload = maxSegmentsToDownload;
        }
        if (maxAudioSegmentsToDownload) {
          scenario.maxAudioSegmentsToDownload = maxAudioSegmentsToDownload;
        }
      }

      if (currentScenario.value && currentScenario.value.id === id) {
        currentScenario.value.downloadStatus = "downloading";
        currentScenario.value.currentProfile = profileNumber;
        currentScenario.value.maxSegmentsPerFetch = maxSegmentsPerFetch;
        if (maxSegmentsToDownload) {
          currentScenario.value.maxSegmentsToDownload = maxSegmentsToDownload;
        }
        if (maxAudioSegmentsToDownload) {
          currentScenario.value.maxAudioSegmentsToDownload = maxAudioSegmentsToDownload;
        }
      }

      // Show success notification
      let successMessage = `Download started for profile ${profileNumber} (max ${maxSegmentsPerFetch} segments per fetch)`;
      if (maxSegmentsToDownload) {
        successMessage = `Download started - downloading first ${maxSegmentsToDownload} video segments`;
        if (maxAudioSegmentsToDownload) {
          successMessage += ` and ${maxAudioSegmentsToDownload} audio segments`;
        }
      }
      success(successMessage);

      return response.data;
    } catch (err) {
      error.value = err.response?.data?.error || "Failed to start download";

      // Show error notification
      showError(error.value);

      console.error("Error starting download:", err);
      throw err;
    } finally {
      downloadLoading.value = false;
    }
  }

  async function stopDownload(id) {
    downloadLoading.value = true;
    error.value = null;

    try {
      const response = await api.post(`/api/scenarios/${id}/stop`);

      // Update scenario status
      const scenario = scenarios.value.find((s) => s.id === id);
      if (scenario) {
        scenario.downloadStatus = "stopped";
      }

      if (currentScenario.value && currentScenario.value.id === id) {
        currentScenario.value.downloadStatus = "stopped";
      }

      // Show success notification
      success("Download stopped. ZIP file is being created in the background.");

      return response.data;
    } catch (err) {
      error.value = err.response?.data?.error || "Failed to stop download";

      // Show error notification
      showError(error.value);

      console.error("Error stopping download:", err);
      throw err;
    } finally {
      downloadLoading.value = false;
    }
  }

  async function getSegmentMap(id) {
    try {
      const response = await api.get(`/api/scenarios/${id}/segment-map`);
      return response.data;
    } catch (err) {
      error.value = err.response?.data?.error || "Failed to get segment map";
      console.error("Error getting segment map:", err);
      throw err;
    }
  }

  function clearError() {
    error.value = null;
  }

  return {
    scenarios,
    currentScenario,
    loading,
    downloadLoading,
    error,
    scenarioCount,
    fetchScenarios,
    fetchScenario,
    createScenario,
    cloneScenario,
    deleteScenario,
    startDownload,
    stopDownload,
    getSegmentMap,
    clearError,
    fetchManifestMap,
    updateManifestConfig,
    updateManifestConfigAllProfiles,
    resetManifestConfig,
    resetAllManifestConfigs,
  };
});
