<template>
  <div id="app" class="min-h-screen bg-gray-50">
    <nav class="bg-white shadow-sm border-b border-gray-200">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex justify-between h-16">
          <div class="flex items-center">
            <router-link to="/" class="flex items-center space-x-2">
              <h1 class="text-xl font-bold text-gray-900">Response Tool</h1>
            </router-link>
          </div>
          <div class="flex items-center space-x-4">
            <template v-if="authStore.isAuthenticated">
              <router-link
                to="/"
                class="text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium"
                :class="{ 'text-blue-600 bg-blue-50': $route.name === 'Home' }"
              >
                Scenarios
              </router-link>
              <router-link to="/create" class="btn btn-primary text-sm">
                Create Scenario
              </router-link>
              
              <!-- User Menu -->
              <div class="flex items-center ml-4 pl-4 border-l border-gray-200">
                <span class="text-sm text-gray-500 mr-4">{{ authStore.user?.fullName }}</span>
                <button @click="handleLogout" class="text-gray-600 hover:text-red-600 text-sm font-medium">
                  Logout
                </button>
              </div>
            </template>
            <template v-else>
              <router-link to="/login" class="text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium">
                Log in
              </router-link>
              <router-link to="/signup" class="btn btn-primary text-sm">
                Sign up
              </router-link>
            </template>
          </div>
        </div>
      </div>
    </nav>

    <main class="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
      <router-view />
    </main>

    <!-- Notification Container -->
    <NotificationContainer />
  </div>
</template>

<script setup>
import { useRouter } from "vue-router";
import { useAuthStore } from "./stores/auth";
import NotificationContainer from "./components/NotificationContainer.vue";

const router = useRouter();
const authStore = useAuthStore();

const handleLogout = async () => {
  await authStore.logout();
  router.push("/login");
};
</script>
