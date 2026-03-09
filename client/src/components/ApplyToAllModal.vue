<template>
  <div
    class="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-[100] flex items-center justify-center"
  >
    <div
      class="relative p-5 border w-[500px] shadow-lg rounded-md bg-white animate-in fade-in zoom-in duration-200"
    >
      <div class="mt-3">
        <!-- Title -->
        <h3 class="text-lg leading-6 font-medium text-gray-900 mb-4">
          Apply Configuration to All {{ scenarioType === 'VMAP' || scenarioType === 'VAST' || scenarioType === 'MP4' || scenarioType === 'GIF' ? 'Files' : 'Manifests' }}
        </h3>

        <!-- Description -->
        <p class="text-sm text-gray-600 mb-4">
          Apply these settings to all {{ scenarioType === 'VMAP' || scenarioType === 'VAST' || scenarioType === 'MP4' || scenarioType === 'GIF' ? 'files' : (mediaType === 'video' ? 'video manifests' : 'audio manifests') }}
          <span v-if="scenarioType !== 'VMAP' && scenarioType !== 'VAST' && scenarioType !== 'MP4' && scenarioType !== 'GIF'" class="font-semibold">in {{ profileLabel }}</span>
        </p>

        <!-- Form Fields -->
        <div class="space-y-4">
          <!-- Delay -->
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">
                Delay (seconds)
              </label>
              <input
                v-model.number="formData.delay"
                type="number"
                step="0.1"
                min="0"
                class="input w-full"
                placeholder="0"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">
                Delay %
              </label>
              <input
                v-model.number="formData.delayPercentage"
                type="number"
                min="0"
                max="100"
                class="input w-full"
                placeholder="100"
              />
            </div>
          </div>

          <!-- Status -->
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">
                Status Code
              </label>
              <select v-model="formData.status" class="input w-full">
                <option
                  v-for="code in httpStatusCodes"
                  :key="code"
                  :value="code"
                >
                  {{ code }}
                </option>
              </select>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">
                Status %
              </label>
              <input
                v-model.number="formData.statusPercentage"
                type="number"
                min="0"
                max="100"
                class="input w-full"
                placeholder="100"
              />
            </div>
          </div>

          <!-- Repeat (only for HLS/DASH, not for VMAP/VAST/MP4/GIF) -->
          <div v-if="scenarioType !== 'VMAP' && scenarioType !== 'VAST' && scenarioType !== 'MP4' && scenarioType !== 'GIF'" class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">
                Repeat Count
              </label>
              <input
                v-model.number="formData.repeat"
                type="number"
                min="0"
                class="input w-full"
                placeholder="0"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">
                Repeat %
              </label>
              <input
                v-model.number="formData.repeatPercentage"
                type="number"
                min="0"
                max="100"
                class="input w-full"
                placeholder="100"
              />
            </div>
          </div>
        </div>

        <!-- Buttons -->
        <div class="flex items-center justify-end space-x-3 mt-6">
          <button
            @click="$emit('cancel')"
            class="px-4 py-2 bg-gray-100 text-gray-800 text-sm font-medium rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-300 transition-colors"
          >
            Cancel
          </button>
          <button
            @click="handleApply"
            class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
          >
            Apply to All
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from "vue";

const props = defineProps({
  mediaType: {
    type: String,
    required: true, // 'video' or 'audio'
  },
  profileLabel: {
    type: String,
    required: true, // e.g., "Profile 0" or "Audio: eng a1"
  },
  scenarioType: {
    type: String,
    default: "", // e.g., "HLS", "DASH", "VMAP", "VAST", "MP4", "GIF"
  },
});

const emit = defineEmits(["apply", "cancel"]);

const httpStatusCodes = [
  200, 201, 204, 301, 302, 304, 400, 401, 403, 404, 500, 502, 503, 504,
];

const formData = ref({
  delay: 0,
  delayPercentage: 100,
  status: 200,
  statusPercentage: 100,
  repeat: 0,
  repeatPercentage: 100,
});

function handleApply() {
  emit("apply", { ...formData.value });
}
</script>
