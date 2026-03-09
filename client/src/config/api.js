import axios from "axios";

// API configuration
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";

// Create axios instance with base configuration
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000, // 30 seconds timeout
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

// Request interceptor for logging
api.interceptors.request.use(
  (config) => {
    console.log(
      `Making ${config.method?.toUpperCase()} request to:`,
      config.url,
    );
    return config;
  },
  (error) => {
    console.error("Request error:", error);
    return Promise.reject(error);
  },
);

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => {
    console.log(`Response from ${response.config.url}:`, response.status);
    return response;
  },
  (error) => {
    // Don't log expected 404s for download-stats (when no active download)
    const isDownloadStats404 =
      error.response?.status === 404 &&
      error.config?.url?.includes("/download-stats");

    if (!isDownloadStats404) {
      console.error("Response error:", error);
    }

    // Handle common errors
    if (error.code === "ECONNREFUSED") {
      console.error("Backend server is not running on", API_BASE_URL);
    } else if (error.response?.status === 404 && !isDownloadStats404) {
      console.error("API endpoint not found:", error.config?.url);
    } else if (error.response?.status >= 500) {
      console.error("Server error:", error.response?.data);
    }

    return Promise.reject(error);
  },
);

export default api;
export { API_BASE_URL };
