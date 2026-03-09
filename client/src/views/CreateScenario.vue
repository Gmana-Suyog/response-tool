<template>
  <div class="max-w-2xl mx-auto">
    <div class="mb-8">
      <h1 class="text-2xl font-bold text-gray-900">Create New Scenario</h1>
      <p class="mt-2 text-sm text-gray-600">
        Set up a new streaming test scenario
      </p>
    </div>

    <form @submit.prevent="handleSubmit" class="space-y-6">
      <div class="card p-6">
        <h2 class="text-lg font-medium text-gray-900 mb-4">
          Basic Information
        </h2>

        <div class="space-y-4">
          <div>
            <label for="name" class="block text-sm font-medium text-gray-700">
              Scenario Name *
            </label>
            <input
              id="name"
              v-model="form.name"
              type="text"
              required
              class="mt-1 input"
              :class="{ 'border-red-500': validationErrors.name }"
              placeholder="e.g., Parse Error Test"
            />
            <p v-if="validationErrors.name" class="mt-1 text-sm text-red-600">
              {{ validationErrors.name }}
            </p>
          </div>

          <div>
            <label
              for="description"
              class="block text-sm font-medium text-gray-700"
            >
              Description
            </label>
            <textarea
              id="description"
              v-model="form.description"
              rows="3"
              class="mt-1 input"
              :class="{ 'border-red-500': validationErrors.description }"
              placeholder="Describe what this scenario tests..."
            ></textarea>
            <p
              v-if="validationErrors.description"
              class="mt-1 text-sm text-red-600"
            >
              {{ validationErrors.description }}
            </p>
          </div>

          <div>
            <label for="type" class="block text-sm font-medium text-gray-700">
              Type *
            </label>
            <select
              id="type"
              v-model="form.type"
              required
              class="mt-1 input"
              :class="{ 'border-red-500': validationErrors.type }"
              @change="onTypeChange"
            >
              <option value="">Select a type</option>
              <option value="HLS">HLS</option>
              <option value="DASH">DASH</option>
              <option value="VMAP">VMAP</option>
              <option value="VAST">VAST</option>
              <option value="MP4">MP4</option>
              <option value="GIF">GIF</option>
            </select>
            <p v-if="validationErrors.type" class="mt-1 text-sm text-red-600">
              {{ validationErrors.type }}
            </p>
            <p class="mt-1 text-xs text-gray-500">
              Select the type of scenario you want to create
            </p>
          </div>

          <div>
            <label
              for="category"
              class="block text-sm font-medium text-gray-700"
            >
              Category
            </label>
            <div class="mt-1 flex space-x-2">
              <select
                id="category"
                v-model="form.category"
                class="input flex-1"
                :disabled="!form.type"
                :class="{ 'opacity-50 cursor-not-allowed': !form.type }"
              >
                <option value="">
                  {{ form.type ? "Select a category" : "Select type first" }}
                </option>
                <option
                  v-for="cat in categories"
                  :key="cat._id"
                  :value="cat.name"
                >
                  {{ cat.name }}
                </option>
              </select>
              <button
                type="button"
                @click="showCategoryModal = true"
                class="btn btn-secondary"
                title="Manage categories"
                :disabled="!form.type"
                :class="{ 'opacity-50 cursor-not-allowed': !form.type }"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                  />
                </svg>
              </button>
            </div>
            <p class="mt-1 text-xs text-gray-500">
              Categories are specific to the selected type
            </p>
          </div>

          <div>
            <label
              for="approveVersion"
              class="block text-sm font-medium text-gray-700"
            >
              Approve Version
            </label>
            <input
              id="approveVersion"
              v-model="form.approveVersion"
              type="text"
              class="mt-1 input"
              placeholder="e.g., v1.0.0"
            />
          </div>

          <div>
            <label for="debug" class="block text-sm font-medium text-gray-700">
              Debug
            </label>
            <textarea
              id="debug"
              v-model="form.debug"
              rows="3"
              class="mt-1 input"
              placeholder="Debug information"
            ></textarea>
          </div>

          <!-- Show these fields in Basic Information for VMAP/VAST/MP4/GIF -->
          <div v-if="form.type === 'VMAP' || form.type === 'VAST' || form.type === 'MP4' || form.type === 'GIF'">
            <label
              for="belongsToCustomer"
              class="block text-sm font-medium text-gray-700"
            >
              Belongs to Customer
            </label>
            <input
              id="belongsToCustomer"
              v-model="form.belongsToCustomer"
              type="text"
              class="mt-1 input"
              :class="{ 'border-red-500': validationErrors.belongsToCustomer }"
              placeholder="e.g., Customer ABC"
            />
            <p
              v-if="validationErrors.belongsToCustomer"
              class="mt-1 text-sm text-red-600"
            >
              {{ validationErrors.belongsToCustomer }}
            </p>
            <p v-else class="mt-1 text-xs text-gray-500">
              Optional: Specify which customer this scenario belongs to
            </p>
          </div>

          <div v-if="form.type === 'VMAP' || form.type === 'VAST' || form.type === 'MP4' || form.type === 'GIF'">
            <label
              for="specialNotes"
              class="block text-sm font-medium text-gray-700"
            >
              Special Notes
            </label>
            <textarea
              id="specialNotes"
              v-model="form.specialNotes"
              rows="2"
              class="mt-1 input"
              :class="{ 'border-red-500': validationErrors.specialNotes }"
              placeholder="Any special considerations or notes for QA..."
            ></textarea>
            <p
              v-if="validationErrors.specialNotes"
              class="mt-1 text-sm text-red-600"
            >
              {{ validationErrors.specialNotes }}
            </p>
          </div>
        </div>
      </div>

      <!-- Streaming Configuration - Hide for VMAP/VAST/MP4/GIF -->
      <div v-if="form.type !== 'VMAP' && form.type !== 'VAST' && form.type !== 'MP4' && form.type !== 'GIF'" class="card p-6">
        <h2 class="text-lg font-medium text-gray-900 mb-4">
          Streaming Configuration
        </h2>

        <div class="space-y-4">
          <div>
            <label
              for="sourceManifestUrl"
              class="block text-sm font-medium text-gray-700"
            >
              Source Manifest URL *
            </label>
            <input
              id="sourceManifestUrl"
              v-model="form.sourceManifestUrl"
              type="url"
              required
              class="mt-1 input"
              :class="{ 'border-red-500': validationErrors.sourceManifestUrl }"
              placeholder="https://example.com/master.m3u8 or https://example.com/manifest.mpd"
              @input="detectTypeFromUrl"
              @paste="handleManifestUrlPaste"
            />
            <p
              v-if="validationErrors.sourceManifestUrl"
              class="mt-1 text-sm text-red-600"
            >
              {{ validationErrors.sourceManifestUrl }}
            </p>
            <div
              v-if="audioDetectionLoading"
              class="mt-2 flex items-center text-sm text-blue-600"
            >
              <svg
                class="animate-spin -ml-1 mr-2 h-4 w-4"
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
              Detecting audio variants...
            </div>
          </div>

          <!-- Request Headers -->
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">
              Request Headers
            </label>
            <div class="space-y-2">
              <div
                v-for="(header, index) in form.requestHeaders"
                :key="index"
                class="flex items-center space-x-2"
              >
                <input
                  v-model="header.name"
                  type="text"
                  placeholder="Header Name"
                  class="input flex-1"
                  :class="{
                    'border-red-500': validationErrors[`header_name_${index}`],
                  }"
                />
                <input
                  v-model="header.value"
                  type="text"
                  placeholder="Header Value"
                  class="input flex-1"
                  :class="{
                    'border-red-500': validationErrors[`header_value_${index}`],
                  }"
                />
                <button
                  type="button"
                  @click="removeHeader(index)"
                  class="text-red-600 hover:text-red-800 p-2"
                  title="Remove header"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-5 w-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M20 12H4"
                    />
                  </svg>
                </button>
              </div>
              <button
                type="button"
                @click="addHeader"
                class="flex items-center space-x-2 text-blue-600 hover:text-blue-800"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                  />
                </svg>
                <span class="text-sm">Add Header</span>
              </button>
            </div>
            <p class="mt-1 text-xs text-gray-500">
              Optional: Add custom headers to be sent with all manifest and
              segment requests
            </p>
          </div>

          <!-- Audio Profile Selection (shown only if separate audio detected) -->
          <div v-if="audioVariants.length > 0">
            <label
              for="selectedAudioVariant"
              class="block text-sm font-medium text-gray-700"
            >
              Select Audio Profile *
            </label>
            <select
              id="selectedAudioVariant"
              v-model="form.selectedAudioVariant"
              required
              class="mt-1 input"
              :class="{
                'border-red-500': validationErrors.selectedAudioVariant,
              }"
            >
              <option value="">Select an audio variant</option>
              <option
                v-for="variant in audioVariants"
                :key="variant.index"
                :value="variant.index"
              >
                {{ variant.name
                }}{{ variant.language ? ` (${variant.language})` : "" }}
              </option>
            </select>
            <p
              v-if="validationErrors.selectedAudioVariant"
              class="mt-1 text-sm text-red-600"
            >
              {{ validationErrors.selectedAudioVariant }}
            </p>
            <p class="mt-1 text-xs text-gray-500">
              This manifest contains separate audio tracks. Select which audio
              variant to download.
            </p>
          </div>

          <div>
            <label
              for="playbackType"
              class="block text-sm font-medium text-gray-700"
            >
              Playback Type *
            </label>
            <select
              id="playbackType"
              v-model="form.playbackType"
              required
              class="mt-1 input"
              :class="{ 'border-red-500': validationErrors.playbackType }"
            >
              <option value="Live">Live</option>
              <option value="VOD">VOD</option>
            </select>
            <p
              v-if="validationErrors.playbackType"
              class="mt-1 text-sm text-red-600"
            >
              {{ validationErrors.playbackType }}
            </p>
            <p class="mt-1 text-xs text-gray-500">
              Select whether this is a live stream or video on demand
            </p>
          </div>

          <div v-if="form.type === 'HLS' && form.playbackType === 'Live'">
            <label
              for="addCookie"
              class="block text-sm font-medium text-gray-700"
            >
              Add Cookie
            </label>
            <select
              id="addCookie"
              v-model="form.addCookie"
              class="mt-1 input"
              :class="{ 'border-red-500': validationErrors.addCookie }"
            >
              <option value="NO">NO</option>
              <option value="YES">YES</option>
            </select>
            <p
              v-if="validationErrors.addCookie"
              class="mt-1 text-sm text-red-600"
            >
              {{ validationErrors.addCookie }}
            </p>
            <p class="mt-1 text-xs text-gray-500">
              Enable cookie-based session management for this scenario
            </p>
          </div>

          <!-- Show these fields in Streaming Configuration for non-VMAP/VAST -->
          <div>
            <label
              for="belongsToCustomer"
              class="block text-sm font-medium text-gray-700"
            >
              Belongs to Customer
            </label>
            <input
              id="belongsToCustomer"
              v-model="form.belongsToCustomer"
              type="text"
              class="mt-1 input"
              :class="{ 'border-red-500': validationErrors.belongsToCustomer }"
              placeholder="e.g., Customer ABC"
            />
            <p
              v-if="validationErrors.belongsToCustomer"
              class="mt-1 text-sm text-red-600"
            >
              {{ validationErrors.belongsToCustomer }}
            </p>
            <p v-else class="mt-1 text-xs text-gray-500">
              Optional: Specify which customer this scenario belongs to
            </p>
          </div>

          <div>
            <label
              for="specialNotes"
              class="block text-sm font-medium text-gray-700"
            >
              Special Notes
            </label>
            <textarea
              id="specialNotes"
              v-model="form.specialNotes"
              rows="2"
              class="mt-1 input"
              :class="{ 'border-red-500': validationErrors.specialNotes }"
              placeholder="Any special considerations or notes for QA..."
            ></textarea>
            <p
              v-if="validationErrors.specialNotes"
              class="mt-1 text-sm text-red-600"
            >
              {{ validationErrors.specialNotes }}
            </p>
          </div>
        </div>
      </div>

      <!-- Error Display -->
      <div v-if="error" class="bg-red-50 border border-red-200 rounded-md p-4">
        <div class="flex">
          <ExclamationTriangleIcon class="h-5 w-5 text-red-400" />
          <div class="ml-3">
            <h3 class="text-sm font-medium text-red-800">Error</h3>
            <p class="mt-1 text-sm text-red-700">{{ error }}</p>
          </div>
        </div>
      </div>

      <!-- Actions -->
      <div class="flex justify-end space-x-3">
        <router-link
          to="/"
          class="btn btn-secondary"
          :class="{ 'pointer-events-none opacity-50': loading }"
        >
          Cancel
        </router-link>
        <button
          type="submit"
          :disabled="loading"
          class="btn btn-primary relative"
        >
          <span
            v-if="loading"
            class="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"
          ></span>
          {{ loading ? "Creating Scenario..." : "Create Scenario" }}
        </button>
      </div>
    </form>

    <!-- Category Management Modal -->
    <div
      v-if="showCategoryModal"
      class="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50"
      @click.self="showCategoryModal = false"
    >
      <div class="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div class="p-6">
          <h3 class="text-lg font-medium text-gray-900 mb-4">
            Manage Categories for {{ form.type }}
          </h3>

          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">
                Add New Category for {{ form.type }}
              </label>
              <div class="flex space-x-2">
                <input
                  v-model="newCategory"
                  type="text"
                  class="input flex-1"
                  placeholder="Enter category name"
                  @keyup.enter="addCategory"
                />
                <button
                  type="button"
                  @click="addCategory"
                  class="btn btn-primary"
                >
                  Add
                </button>
              </div>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">
                Existing Categories for {{ form.type }}
              </label>
              <div class="space-y-2 max-h-60 overflow-y-auto">
                <div
                  v-for="(cat, index) in categories"
                  :key="cat._id"
                  class="flex items-center justify-between p-2 bg-gray-50 rounded"
                >
                  <span class="text-sm text-gray-900">{{ cat.name }}</span>
                  <button
                    type="button"
                    @click="removeCategory(index)"
                    class="text-red-600 hover:text-red-800"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      class="h-5 w-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
                <div
                  v-if="categories.length === 0"
                  class="text-sm text-gray-500 text-center py-4"
                >
                  No categories yet
                </div>
              </div>
            </div>
          </div>

          <div class="mt-6 flex justify-end">
            <button
              type="button"
              @click="showCategoryModal = false"
              class="btn btn-secondary"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Delete Category Confirmation Modal -->
    <div
      v-if="showDeleteModal"
      class="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50"
      @click.self="cancelDeleteCategory"
    >
      <div class="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div class="p-6">
          <h3 class="text-lg font-medium text-gray-900 mb-4">
            Delete Category
          </h3>

          <p class="text-sm text-gray-600 mb-6">
            Are you sure you want to delete the category
            <span class="font-semibold"
              >"{{ categoryToDelete?.category?.name }}"</span
            >? This action cannot be undone.
          </p>

          <div class="flex justify-end space-x-3">
            <button
              type="button"
              @click="cancelDeleteCategory"
              class="btn btn-secondary"
              :disabled="categoryLoading"
            >
              Cancel
            </button>
            <button
              type="button"
              @click="confirmDeleteCategory"
              class="btn btn-danger"
              :disabled="categoryLoading"
            >
              <span v-if="categoryLoading" class="flex items-center">
                <svg
                  class="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
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
                Deleting...
              </span>
              <span v-else>Delete</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Error Modal -->
    <div
      v-if="showErrorModal"
      class="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50"
      @click.self="closeErrorModal"
    >
      <div class="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div class="p-6">
          <div class="flex items-center mb-4">
            <div class="flex-shrink-0">
              <svg
                class="h-6 w-6 text-red-600"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
            </div>
            <div class="ml-3">
              <h3 class="text-lg font-medium text-gray-900">
                Cannot Delete Category
              </h3>
            </div>
          </div>

          <p class="text-sm text-gray-600 mb-6">
            {{ errorMessage }}
          </p>

          <div class="flex justify-end">
            <button
              type="button"
              @click="closeErrorModal"
              class="btn btn-primary"
            >
              OK
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { ExclamationTriangleIcon } from "@heroicons/vue/24/outline";
import { useScenariosStore } from "../stores/scenarios";
import api from "../config/api";

const router = useRouter();
const store = useScenariosStore();

const { loading, error } = store;

const form = reactive({
  name: "",
  description: "",
  sourceManifestUrl: "",
  type: "", // No default - user must select
  playbackType: "Live", // Default to Live
  belongsToCustomer: "",
  specialNotes: "",
  category: "",
  approveVersion: "",
  debug: "",
  selectedAudioVariant: "", // New field for audio variant selection
  requestHeaders: [], // New field for custom request headers
  addCookie: "NO", // New field for cookie management
});

const categories = ref([]);
const newCategory = ref("");
const showCategoryModal = ref(false);
const categoryLoading = ref(false);
const showDeleteModal = ref(false);
const categoryToDelete = ref(null);
const showErrorModal = ref(false);
const errorMessage = ref("");
const validationErrors = ref({});
const audioVariants = ref([]); // Store detected audio variants
const audioDetectionLoading = ref(false); // Loading state for audio detection
let audioDetectionTimeout = null; // Debounce timeout for audio detection

// Header management functions
function addHeader() {
  form.requestHeaders.push({ name: "", value: "" });
}

function removeHeader(index) {
  form.requestHeaders.splice(index, 1);
}

// Form validation function
function validateForm() {
  const errors = {};

  // Required field validation
  if (!form.name.trim()) {
    errors.name = "Scenario name is required";
  }

  if (!form.type) {
    errors.type = "Type is required";
  }

  // Source Manifest URL is only required for non-VMAP/VAST/MP4/GIF types
  if (form.type !== "VMAP" && form.type !== "VAST" && form.type !== "MP4" && form.type !== "GIF") {
    if (!form.sourceManifestUrl.trim()) {
      errors.sourceManifestUrl = "Source manifest URL is required";
    } else {
      // URL format validation based on type
      try {
        const url = new URL(form.sourceManifestUrl);
        const pathname = url.pathname.toLowerCase();

        // Validate URL based on selected type
        if (form.type === "HLS" && !pathname.endsWith(".m3u8")) {
          errors.sourceManifestUrl = "URL must be a valid HLS manifest (.m3u8)";
        } else if (form.type === "DASH" && !pathname.endsWith(".mpd")) {
          errors.sourceManifestUrl = "URL must be a valid DASH manifest (.mpd)";
        }
        // For other types (VMAP, VAST, MP4, GIF), allow any valid URL
      } catch {
        errors.sourceManifestUrl = "Please enter a valid URL";
      }
    }
  }

  // Audio variant validation - required if audio variants are detected and not MP4/VMAP/VAST/GIF
  if (audioVariants.value.length > 0 && !form.selectedAudioVariant && 
      form.type !== "MP4" && form.type !== "VMAP" && form.type !== "VAST" && form.type !== "GIF") {
    errors.selectedAudioVariant = "Please select an audio variant";
  }

  // Optional field validation
  if (form.name.trim() && form.name.length > 100) {
    errors.name = "Scenario name must be less than 100 characters";
  }

  if (form.description && form.description.length > 500) {
    errors.description = "Description must be less than 500 characters";
  }

  if (form.belongsToCustomer && form.belongsToCustomer.length > 100) {
    errors.belongsToCustomer = "Customer name must be less than 100 characters";
  }

  if (form.specialNotes && form.specialNotes.length > 1000) {
    errors.specialNotes = "Special notes must be less than 1000 characters";
  }

  // Request headers validation
  form.requestHeaders.forEach((header, index) => {
    if (header.name && !header.value) {
      errors[`header_value_${index}`] =
        "Header value is required when header name is provided";
    }
    if (header.value && !header.name) {
      errors[`header_name_${index}`] =
        "Header name is required when header value is provided";
    }
    if (header.name && header.name.length > 100) {
      errors[`header_name_${index}`] =
        "Header name must be less than 100 characters";
    }
    if (header.value && header.value.length > 500) {
      errors[`header_value_${index}`] =
        "Header value must be less than 500 characters";
    }
  });

  validationErrors.value = errors;
  return Object.keys(errors).length === 0;
}

// Detect type from URL - only for HLS/DASH audio detection
async function detectTypeFromUrl() {
  if (!form.sourceManifestUrl.trim()) {
    // Clear audio variants if URL is empty
    audioVariants.value = [];
    form.selectedAudioVariant = "";
    return;
  }

  // Skip audio detection for MP4, VMAP, VAST, GIF
  if (form.type === "MP4" || form.type === "VMAP" || form.type === "VAST" || form.type === "GIF") {
    audioVariants.value = [];
    form.selectedAudioVariant = "";
    return;
  }

  try {
    const url = new URL(form.sourceManifestUrl);
    const pathname = url.pathname.toLowerCase();

    // Only detect audio for HLS if type is HLS
    if (form.type === "HLS" && pathname.endsWith(".m3u8")) {
      // Debounce audio detection to avoid too many API calls while typing
      if (audioDetectionTimeout) {
        clearTimeout(audioDetectionTimeout);
      }

      audioDetectionTimeout = setTimeout(async () => {
        await detectAudioVariants(form.sourceManifestUrl);
      }, 1000); // Wait 1 second after user stops typing
    } else {
      // Clear audio variants for non-HLS types
      audioVariants.value = [];
      form.selectedAudioVariant = "";
    }

    // Clear any previous validation errors for sourceManifestUrl when user types
    if (validationErrors.value.sourceManifestUrl) {
      const errors = { ...validationErrors.value };
      delete errors.sourceManifestUrl;
      validationErrors.value = errors;
    }
  } catch {
    // Invalid URL, validation will catch this
    audioVariants.value = [];
    form.selectedAudioVariant = "";
  }
}

// Handle manifest URL paste event
async function handleManifestUrlPaste(event) {
  // Clear any pending debounced detection
  if (audioDetectionTimeout) {
    clearTimeout(audioDetectionTimeout);
  }

  // Wait for the input to be updated
  await new Promise((resolve) => setTimeout(resolve, 100));

  const url = form.sourceManifestUrl.trim();
  if (url && url.endsWith(".m3u8")) {
    await detectAudioVariants(url);
  }
}

// Detect audio variants from manifest URL
async function detectAudioVariants(manifestUrl) {
  if (!manifestUrl || !manifestUrl.endsWith(".m3u8")) {
    audioVariants.value = [];
    form.selectedAudioVariant = "";
    return;
  }

  try {
    audioDetectionLoading.value = true;

    // Prepare custom headers for the request
    const customHeaders = {};
    form.requestHeaders.forEach((header) => {
      if (header.name && header.value) {
        customHeaders[header.name] = header.value;
      }
    });

    const response = await api.post("/api/scenarios/detect-audio", {
      manifestUrl: manifestUrl,
      requestHeaders: customHeaders,
    });

    if (response.data.hasAudio) {
      audioVariants.value = response.data.audioVariants;
      console.log("Detected audio variants:", audioVariants.value);
    } else {
      audioVariants.value = [];
      form.selectedAudioVariant = "";
    }
  } catch (error) {
    console.error("Error detecting audio variants:", error);
    audioVariants.value = [];
    form.selectedAudioVariant = "";
    // Don't show error to user as this is optional functionality
  } finally {
    audioDetectionLoading.value = false;
  }
}

// Load categories from database when type is selected
onMounted(async () => {
  // Don't fetch categories on mount since no type is selected yet
  // Categories will be fetched when user selects a type
});

// Handle type change - fetch categories for selected type
async function onTypeChange() {
  // Clear category when type changes
  form.category = "";
  // Fetch categories for the new type
  await fetchCategories();
}

async function fetchCategories() {
  if (!form.type) {
    categories.value = [];
    return;
  }

  try {
    categoryLoading.value = true;
    const response = await api.get(`/api/categories?type=${form.type}`);
    categories.value = response.data;
  } catch (err) {
    console.error("Error fetching categories:", err);
  } finally {
    categoryLoading.value = false;
  }
}

async function addCategory() {
  const trimmed = newCategory.value.trim();
  if (!trimmed || !form.type) return;

  try {
    categoryLoading.value = true;
    const response = await api.post("/api/categories", {
      name: trimmed,
      type: form.type,
    });
    categories.value.push(response.data);
    categories.value.sort((a, b) => a.name.localeCompare(b.name));
    newCategory.value = "";
  } catch (err) {
    console.error("Error adding category:", err);
    if (err.response?.status === 409) {
      errorMessage.value = `Category already exists for ${form.type}`;
      showErrorModal.value = true;
    } else {
      errorMessage.value = "Failed to add category. Please try again.";
      showErrorModal.value = true;
    }
  } finally {
    categoryLoading.value = false;
  }
}

async function removeCategory(index) {
  categoryToDelete.value = { index, category: categories.value[index] };
  showDeleteModal.value = true;
}

async function confirmDeleteCategory() {
  if (!categoryToDelete.value) return;

  const { index, category } = categoryToDelete.value;

  try {
    categoryLoading.value = true;
    await api.delete(`/api/categories/${category._id}`);
    categories.value.splice(index, 1);
    showDeleteModal.value = false;
    categoryToDelete.value = null;
  } catch (err) {
    console.error("Error deleting category:", err);

    showDeleteModal.value = false;
    categoryToDelete.value = null;

    if (err.response?.status === 409) {
      // Category is in use - show error modal
      const errorData = err.response.data;
      errorMessage.value = `Cannot delete category "${category.name}". It is used by ${errorData.usageCount} scenario(s).`;
      showErrorModal.value = true;
    } else {
      errorMessage.value = "Failed to delete category. Please try again.";
      showErrorModal.value = true;
    }
  } finally {
    categoryLoading.value = false;
  }
}

function cancelDeleteCategory() {
  showDeleteModal.value = false;
  categoryToDelete.value = null;
}

function closeErrorModal() {
  showErrorModal.value = false;
  errorMessage.value = "";
}

async function handleSubmit() {
  if (loading.value) return; // Prevent double submission

  // Validate form
  if (!validateForm()) {
    return; // Stop submission if validation fails
  }

  console.log("Form submitted with data:", form);
  console.log("belongsToCustomer value:", form.belongsToCustomer);

  try {
    store.clearError();
    console.log("Calling store.createScenario...");
    const scenario = await store.createScenario(form);
    console.log("Scenario created:", scenario);
    console.log("Scenario belongsToCustomer:", scenario.belongsToCustomer);
    console.log("Scenario ID:", scenario?.id);
    console.log("Scenario type:", typeof scenario?.id);

    if (scenario && scenario.id) {
      console.log("Redirecting to scenario with ID:", scenario.id);
      const redirectPath = `/scenario/${scenario.id}`;
      console.log("Redirect path:", redirectPath);
      router.push(redirectPath);
    } else {
      console.error("Scenario ID is missing or invalid:", scenario);
      console.error(
        "Available scenario properties:",
        Object.keys(scenario || {}),
      );
      // Fallback to home page if no ID
      router.push("/");
    }
  } catch (err) {
    console.error("Error creating scenario:", err);
    // Error is handled by the store
  }
}
</script>
