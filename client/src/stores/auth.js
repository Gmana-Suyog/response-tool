import { defineStore } from "pinia";
import axios from "axios";
import { getUserFromToken } from "../utils/jwt";

const API_BASE_URL = "/api/auth";

export const useAuthStore = defineStore("auth", {
  state: () => ({
    user: null,
    loading: false,
    initialized: false,
    error: null,
  }),

  getters: {
    isAuthenticated: (state) => !!state.user,
    isAdmin: (state) => state.user?.role === "admin",
  },

  actions: {
    /**
     * Initialize auth state from existing token
     * This replaces the old fetchUser() that called /auth/me
     */
    initializeAuth() {
      // Try to get user from token stored in cookie
      // The token is httpOnly, so we can't access it directly
      // Instead, we'll make a refresh call which will validate the token
      // and return user info if valid
      this.initialized = true;
    },

    async signup(fullName, password) {
      this.loading = true;
      this.error = null;
      try {
        const response = await axios.post(
          `${API_BASE_URL}/signup`,
          { fullName, password },
          { withCredentials: true },
        );
        this.setAuth(response.data);
        return response.data;
      } catch (error) {
        this.error = error.response?.data?.error || "Signup failed";
        throw error;
      } finally {
        this.loading = false;
      }
    },

    async login(fullName, password) {
      this.loading = true;
      this.error = null;
      try {
        const response = await axios.post(
          `${API_BASE_URL}/login`,
          { fullName, password },
          { withCredentials: true },
        );
        this.setAuth(response.data);
        return response.data;
      } catch (error) {
        this.error = error.response?.data?.error || "Login failed";
        throw error;
      } finally {
        this.loading = false;
      }
    },

    async refreshTokens() {
      try {
        const response = await axios.post(
          `${API_BASE_URL}/refresh`,
          {},
          { withCredentials: true },
        );
        // Update user info from refresh response
        if (response.data.user) {
          this.user = response.data.user;
        }
        return response.data;
      } catch (error) {
        this.clearAuth();
        throw error;
      }
    },

    async logout() {
      try {
        await axios.post(
          `${API_BASE_URL}/logout`,
          {},
          { withCredentials: true },
        );
      } catch (error) {
        console.error("Logout error:", error);
      } finally {
        this.clearAuth();
      }
    },

    setAuth({ user }) {
      if (user) {
        this.user = user;
      }
    },

    clearAuth() {
      this.user = null;
    },
  },
});
