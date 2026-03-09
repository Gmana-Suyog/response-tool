<template>
  <div class="mb-8">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-gray-900">{{ scenario.name }}</h1>
        <p class="mt-1 text-sm text-gray-600">{{ scenario.description }}</p>
      </div>
      <div class="flex items-center space-x-3">
        <span
          :class="getStatusClass(scenario.downloadStatus)"
          class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium"
        >
          {{ scenario.downloadStatus || "idle" }}
        </span>
        <button
          v-if="
            scenario.downloadStatus === 'downloading' ||
            scenario.downloadStatus === 'stopping'
          "
          @click="handleStopDownload"
          :disabled="
            downloadLoading || scenario.downloadStatus === 'stopping'
          "
          class="btn btn-danger relative"
        >
          <span
            v-if="downloadLoading || scenario.downloadStatus === 'stopping'"
            class="flex items-center justify-center"
          >
            <svg
              class="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
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
          <span v-else>Stop Download</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { useScenariosStore } from "../stores/scenarios";

const props = defineProps({
  scenario: {
    type: Object,
    required: true,
  },
  scenarioId: {
    type: String,
    required: true,
  },
});

const emit = defineEmits(["stopDownload"]);

const store = useScenariosStore();

const downloadLoading = computed(() => store.downloadLoading);

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

function handleStopDownload() {
  emit("stopDownload");
}
</script>
