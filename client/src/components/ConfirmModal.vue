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
          v-if="type === 'danger'"
          class="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100"
        >
          <ExclamationTriangleIcon class="h-6 w-6 text-red-600" />
        </div>
        <div
          v-else
          class="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-blue-100"
        >
          <InformationCircleIcon class="h-6 w-6 text-blue-600" />
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

        <!-- Buttons -->
        <div class="flex items-center justify-center space-x-3 mt-4">
          <button
            @click="$emit('cancel')"
            class="px-4 py-2 bg-gray-100 text-gray-800 text-sm font-medium rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-300 transition-colors"
          >
            {{ cancelText }}
          </button>
          <button
            @click="$emit('confirm')"
            :class="[
              type === 'danger'
                ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500'
                : 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500',
              'px-4 py-2 text-white text-sm font-medium rounded-md shadow-sm focus:outline-none focus:ring-2 transition-colors',
            ]"
          >
            {{ confirmText }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import {
  ExclamationTriangleIcon,
  InformationCircleIcon,
} from "@heroicons/vue/24/outline";

defineProps({
  title: {
    type: String,
    default: "Confirm Action",
  },
  message: {
    type: String,
    default: "Are you sure you want to proceed?",
  },
  confirmText: {
    type: String,
    default: "Confirm",
  },
  cancelText: {
    type: String,
    default: "Cancel",
  },
  type: {
    type: String,
    default: "info", // 'info' or 'danger'
  },
});

defineEmits(["confirm", "cancel"]);
</script>
