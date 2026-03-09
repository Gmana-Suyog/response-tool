import { createApp } from "vue";
import { createPinia } from "pinia";
import { createRouter, createWebHistory } from "vue-router";
import App from "./App.vue";
import axios from "axios";
import "./style.css";

// Import views
import Home from "./views/Home.vue";
import ScenarioDetail from "./views/ScenarioDetail.vue";
import CreateScenario from "./views/CreateScenario.vue";
import Login from "./views/Login.vue";
import Signup from "./views/Signup.vue";
import AdminDashboard from "./views/AdminDashboard.vue";
import { useAuthStore } from "./stores/auth";

const routes = [
  { path: "/login", name: "Login", component: Login, meta: { guest: true } },
  { path: "/signup", name: "Signup", component: Signup, meta: { guest: true } },
  { path: "/", name: "Home", component: Home, meta: { requiresAuth: true } },
  {
    path: "/create",
    name: "CreateScenario",
    component: CreateScenario,
    meta: { requiresAuth: true },
  },
  {
    path: "/scenario/:id",
    name: "ScenarioDetail",
    component: ScenarioDetail,
    props: true,
    meta: { requiresAuth: true },
  },
  {
    path: "/admin-dashboard/",
    name: "AdminDashboard",
    component: AdminDashboard,
    meta: { requiresAuth: true, requiresAdmin: true },
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

const pinia = createPinia();
const app = createApp(App);

app.use(pinia);

// Axios configuration for cookies
axios.defaults.withCredentials = true;

axios.interceptors.response.use(
  (response) => response,
  async (error) => {
    const authStore = useAuthStore();
    const originalRequest = error.config;

    // Check if the request is for an auth endpoint to prevent infinite loops
    // Exclude all auth endpoints: login, signup, refresh, logout
    const isAuthEndpoint = originalRequest.url.includes("/api/auth/");

    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !isAuthEndpoint
    ) {
      originalRequest._retry = true;
      try {
        await authStore.refreshTokens();
        return axios(originalRequest);
      } catch (refreshError) {
        authStore.logout();
        router.push({ name: "Login" });
        return Promise.reject(refreshError);
      }
    }

    // If it's a 401 on the refresh endpoint specifically, clear auth state
    if (
      error.response?.status === 401 &&
      originalRequest.url.includes("/api/auth/refresh")
    ) {
      authStore.clearAuth();
    }

    return Promise.reject(error);
  },
);

// Router Guards
router.beforeEach(async (to, from, next) => {
  const authStore = useAuthStore();

  // Try to refresh token to restore session if not authenticated
  // Skip for guest routes (login/signup) to avoid unnecessary requests
  if (
    !authStore.isAuthenticated &&
    !authStore.initialized &&
    !authStore.loading &&
    !to.meta.guest
  ) {
    try {
      await authStore.refreshTokens();
    } catch (error) {
      console.warn("Initial session restore failed:", error.message);
    }
    authStore.initialized = true;
  }

  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    next({ name: "Login" });
  } else if (to.meta.requiresAdmin && !authStore.isAdmin) {
    next({ name: "Home" });
  } else if (to.meta.guest && authStore.isAuthenticated) {
    next({ name: "Home" });
  } else {
    next();
  }
});

app.use(router);
app.mount("#app");
