<template>
  <div class="fixed top-4 right-4 z-50 w-80">
    <TransitionGroup name="notification" tag="div" class="space-y-2">
      <div
        v-for="notification in notifications"
        :key="notification.id"
        :class="getNotificationClass(notification.type)"
        class="bg-white shadow-lg rounded-lg pointer-events-auto ring-1 ring-black ring-opacity-5 overflow-hidden"
      >
        <div class="p-4">
          <div class="flex items-start space-x-3">
            <div class="flex-shrink-0">
              <CheckCircleIcon
                v-if="notification.type === 'success'"
                class="h-6 w-6 text-green-400"
              />
              <ExclamationTriangleIcon
                v-else-if="notification.type === 'warning'"
                class="h-6 w-6 text-yellow-400"
              />
              <XCircleIcon
                v-else-if="notification.type === 'error'"
                class="h-6 w-6 text-red-400"
              />
              <InformationCircleIcon v-else class="h-6 w-6 text-blue-400" />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-gray-900 word-wrap">
                {{ notification.message }}
              </p>
            </div>
            <div class="flex-shrink-0">
              <button
                @click="removeNotification(notification.id)"
                class="bg-white rounded-md inline-flex text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                <span class="sr-only">Close</span>
                <XMarkIcon class="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup>
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
  InformationCircleIcon,
  XMarkIcon,
} from "@heroicons/vue/24/outline";
import { useNotifications } from "../composables/useNotifications";

const { notifications, removeNotification } = useNotifications();

function getNotificationClass(type) {
  const baseClass = "border-l-4 ";
  switch (type) {
    case "success":
      return baseClass + "border-green-400";
    case "error":
      return baseClass + "border-red-400";
    case "warning":
      return baseClass + "border-yellow-400";
    default:
      return baseClass + "border-blue-400";
  }
}
</script>

<style scoped>
.word-wrap {
  word-wrap: break-word;
  word-break: break-word;
  white-space: normal;
  overflow-wrap: break-word;
}

.notification-enter-active,
.notification-leave-active {
  transition: all 0.3s ease;
}

.notification-enter-from {
  opacity: 0;
  transform: translateX(100%);
}

.notification-leave-to {
  opacity: 0;
  transform: translateX(100%);
}

.notification-move {
  transition: transform 0.3s ease;
}
</style>
