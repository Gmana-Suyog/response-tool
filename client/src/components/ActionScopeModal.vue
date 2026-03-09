<template>
  <div
    class="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-[100] flex items-center justify-center"
  >
    <div
      class="relative p-5 border w-96 shadow-lg rounded-md bg-white animate-in fade-in zoom-in duration-200"
    >
      <div class="mt-3 text-center">
        <!-- Icon -->
        <div
          class="mx-auto flex items-center justify-center h-12 w-12 rounded-full"
          :class="actionType === 'save' ? 'bg-blue-100' : 'bg-gray-100'"
        >
          <svg
            v-if="actionType === 'save'"
            class="h-6 w-6 text-blue-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"
            />
          </svg>
          <svg
            v-else
            class="h-6 w-6 text-gray-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </div>

        <!-- Title -->
        <h3 class="text-lg leading-6 font-medium text-gray-900 mt-4">
          {{ title }}
        </h3>

        <!-- Message -->
        <div class="mt-2 px-7 py-3">
          <p class="text-sm text-gray-500">
            {{ message }}
          </p>
        </div>

        <!-- Action Buttons -->
        <div class="flex flex-col items-center space-y-2 mt-4">
          <button
            @click="$emit('action', 'current')"
            :class="[
              actionType === 'save'
                ? 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500'
                : 'bg-red-600 hover:bg-red-700 focus:ring-gray-500',
              'w-full px-4 py-2 text-white text-sm font-medium rounded-md shadow-sm focus:outline-none focus:ring-2 transition-colors',
            ]"
          >
            {{ currentProfileText }}
          </button>
          <button
            @click="$emit('action', 'all')"
            :class="[
              actionType === 'save'
                ? 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500'
                : 'bg-red-600 hover:bg-red-700 focus:ring-red-500',
              'w-full px-4 py-2 text-white text-sm font-medium rounded-md shadow-sm focus:outline-none focus:ring-2 transition-colors',
            ]"
          >
            {{ allProfilesText }}
          </button>
          <button
            @click="$emit('cancel')"
            class="w-full px-4 py-2 bg-gray-100 text-gray-800 text-sm font-medium rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-300 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
  actionType: {
    type: String,
    required: true,
    validator: (value) => ["save", "reset"].includes(value),
  },
  mediaType: {
    type: String,
    required: true,
    validator: (value) => ["video", "audio"].includes(value),
  },
});

defineEmits(["action", "cancel"]);

const title = computed(() => {
  const action = props.actionType === "save" ? "Save" : "Reset";
  const media = props.mediaType === "video" ? "Video" : "Audio";
  return `${action} ${media} Configuration`;
});

const message = computed(() => {
  const action = props.actionType === "save" ? "save" : "reset";
  return `Choose the scope for this ${action} operation:`;
});

const currentProfileText = computed(() => {
  const action = props.actionType === "save" ? "Save" : "Reset";
  return `${action} for Current Profile`;
});

const allProfilesText = computed(() => {
  const action = props.actionType === "save" ? "Save" : "Reset";
  return `${action} for All Profiles`;
});
</script>
