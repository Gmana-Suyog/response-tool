<template>
        <div v-show="activeTab === 'playback'" class="space-y-6">
      <!-- Loading State for HLS/DASH (while rewrite/ZIP processes are running) -->
      <div
        v-if="(scenario.type === 'HLS' || scenario.type === 'DASH') && isProcessingPlayback"
        class="max-w-5xl mx-auto"
      >
        <div class="card p-12">
          <div class="flex flex-col items-center justify-center space-y-6">
            <!-- Animated Loader -->
            <div class="relative">
              <div class="w-20 h-20 border-4 border-blue-200 rounded-full"></div>
              <div class="w-20 h-20 border-4 border-blue-600 rounded-full animate-spin border-t-transparent absolute top-0 left-0"></div>
            </div>
            
            <!-- Loading Text -->
            <div class="text-center space-y-2">
              <h3 class="text-lg font-medium text-gray-900">
                Preparing Playback
              </h3>
              <p class="text-sm text-gray-600 max-w-md">
                {{ playbackLoadingMessage }}
              </p>
            </div>
            
            <!-- Progress Indicator (if available) -->
            <div v-if="downloadStats && downloadStats.progress" class="w-full max-w-md">
              <div class="flex justify-between text-sm text-gray-600 mb-2">
                <span>Processing...</span>
                <span>{{ Math.round(downloadStats.progress) }}%</span>
              </div>
              <div class="w-full bg-gray-200 rounded-full h-2">
                <div 
                  class="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  :style="{ width: downloadStats.progress + '%' }"
                ></div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Centered content container for HLS/DASH Player (not for VMAP/VAST/MP4/GIF) -->
      <div
        v-if="scenario.type !== 'VMAP' && scenario.type !== 'VAST' && scenario.type !== 'MP4' && scenario.type !== 'GIF' && !isProcessingPlayback"
        class="max-w-5xl mx-auto space-y-6"
      >
        <!-- No Content Warning -->
        <div
          v-if="!hasAnyDownloadedContent"
          class="bg-yellow-50 border border-yellow-200 rounded-md p-4"
        >
          <div class="flex">
            <svg
              class="h-5 w-5 text-yellow-400"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <div class="ml-3">
              <h3 class="text-sm font-medium text-yellow-800">
                No Downloaded Content
              </h3>
              <p class="mt-1 text-sm text-yellow-700">
                No segments have been downloaded yet. Please go to the Download
                tab and start downloading content before attempting playback.
              </p>
            </div>
          </div>
        </div>

        <!-- HLS Player -->
        <div v-if="scenario.type !== 'DASH'" class="card p-6">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-lg font-medium text-gray-900">HLS Player</h2>
            
            <!-- Cookie Validation Toggle (only for HLS Live with cookies enabled) -->
            <div v-if="scenario.type === 'HLS' && scenario.playbackType === 'Live' && scenario.addCookie === 'YES'" class="flex items-center space-x-3">
              <label class="flex items-center cursor-pointer">
                <span class="text-sm font-medium text-gray-700 mr-3">Cookie Validation</span>
                <div class="relative">
                  <input
                    type="checkbox"
                    v-model="cookieValidationEnabled"
                    @change="toggleCookieValidation"
                    class="sr-only"
                  />
                  <div
                    :class="[
                      'block w-10 h-6 rounded-full transition-colors',
                      cookieValidationEnabled ? 'bg-blue-600' : 'bg-gray-300'
                    ]"
                  ></div>
                  <div
                    :class="[
                      'absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform',
                      cookieValidationEnabled ? 'transform translate-x-4' : ''
                    ]"
                  ></div>
                </div>
              </label>
              <div class="text-xs text-gray-500 max-w-xs">
                {{ cookieValidationEnabled 
                  ? 'External players must send valid cookies' 
                  : 'External players can play without cookie validation' 
                }}
              </div>
            </div>
          </div>

          <div class="space-y-4">
            <video
              ref="videoElement"
              controls
              class="w-full h-96 bg-black rounded"
            >
              Your browser does not support the video tag.
            </video>

            <div class="space-y-3">
              <!-- URL Input for External HLS Playback -->
              <div class="space-y-2">
                <label class="block text-sm font-medium text-gray-700">
                  Play from URL
                </label>
                <div class="flex space-x-3">
                  <input
                    v-model="externalHlsUrl"
                    type="text"
                    placeholder="Enter HLS manifest URL (e.g., https://example.com/playlist.m3u8)"
                    class="input flex-1"
                    @keyup.enter="loadExternalHlsUrl"
                  />
                  <button
                    @click="loadExternalHlsUrl"
                    :disabled="!externalHlsUrl || !externalHlsUrl.trim()"
                    :class="[
                      externalHlsUrl && externalHlsUrl.trim()
                        ? 'btn btn-primary'
                        : 'btn btn-secondary opacity-50 cursor-not-allowed',
                    ]"
                  >
                    Play URL
                  </button>
                </div>
              </div>

              <!-- Divider -->
              <div class="relative">
                <div class="absolute inset-0 flex items-center">
                  <div class="w-full border-t border-gray-300"></div>
                </div>
                <div class="relative flex justify-center text-sm">
                  <span class="px-2 bg-white text-gray-500">OR</span>
                </div>
              </div>

              <!-- Master Manifest Playback -->
              <div class="flex space-x-3">
                <button
                  @click="loadLocalMasterManifest"
                  :disabled="!hasLocalMasterManifest"
                  :class="[
                    hasLocalMasterManifest
                      ? 'btn btn-primary flex-1'
                      : 'btn btn-secondary flex-1 opacity-50 cursor-not-allowed',
                  ]"
                >
                  Load Local Master Manifest
                </button>
              </div>

              <!-- Profile Selection and Playback -->
              <div class="flex space-x-3">
                <select v-model="selectedPlaybackProfile" class="input flex-1">
                  <option
                    v-for="n in scenario.profileCount || 5"
                    :key="n - 1"
                    :value="n - 1"
                  >
                    Profile {{ n - 1 }} ({{ getProfileInfo(n - 1) }})
                  </option>
                </select>
                <button
                  @click="loadLocalProfileManifest"
                  :disabled="!hasLocalProfileManifest(selectedPlaybackProfile)"
                  :class="[
                    hasLocalProfileManifest(selectedPlaybackProfile)
                      ? 'btn btn-primary'
                      : 'btn btn-secondary opacity-50 cursor-not-allowed',
                  ]"
                >
                  Load Profile
                </button>
              </div>

              <!-- Stop Playback Button (VOD HLS only) -->
              <div v-if="scenario.playbackType === 'VOD'" class="flex space-x-3">
                <button
                  @click="stopVodPlayback"
                  :disabled="stopPlaybackLoading"
                  class="btn btn-danger flex-1 relative"
                >
                  <span
                    v-if="stopPlaybackLoading"
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
                  <span v-else>Stop Playback</span>
                </button>
              </div>

              <!-- Playback Status -->
              <div
                class="text-sm text-gray-600 bg-gray-50 p-3 rounded min-h-[52px] flex items-center"
              >
                <div v-if="playbackStatus" class="flex items-center space-x-2">
                  <svg
                    v-if="playbackStatus.type === 'success'"
                    class="h-4 w-4 text-green-500 flex-shrink-0"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fill-rule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clip-rule="evenodd"
                    />
                  </svg>
                  <svg
                    v-else-if="playbackStatus.type === 'error'"
                    class="h-4 w-4 text-red-500 flex-shrink-0"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fill-rule="evenodd"
                      d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                      clip-rule="evenodd"
                    />
                  </svg>
                  <svg
                    v-else
                    class="h-4 w-4 text-blue-500 flex-shrink-0"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fill-rule="evenodd"
                      d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                      clip-rule="evenodd"
                    />
                  </svg>
                  <span>{{ playbackStatus.message }}</span>
                </div>
                <div v-else class="text-gray-400 text-xs">
                  Ready for playback
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- DASH Player -->
        <div v-if="scenario.type === 'DASH'" class="card p-6">
          <h2 class="text-lg font-medium text-gray-900 mb-4">DASH Player</h2>

          <div class="space-y-4">
            <video
              ref="videoElement"
              controls
              class="w-full h-96 bg-black rounded"
            >
              Your browser does not support the video tag.
            </video>

            <div class="space-y-3">
              <!-- Load DASH Manifest -->
              <div class="flex space-x-3">
                <button
                  @click="loadDashManifest"
                  :disabled="!hasDashManifests"
                  :class="[
                    hasDashManifests
                      ? 'btn btn-primary flex-1'
                      : 'btn btn-secondary flex-1 opacity-50 cursor-not-allowed',
                  ]"
                >
                  Load DASH Manifest
                </button>
              </div>

              <!-- Playback Status -->
              <div
                class="text-sm text-gray-600 bg-gray-50 p-3 rounded min-h-[52px] flex items-center"
              >
                <div v-if="playbackStatus" class="flex items-center space-x-2">
                  <svg
                    v-if="playbackStatus.type === 'success'"
                    class="h-4 w-4 text-green-500 flex-shrink-0"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fill-rule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clip-rule="evenodd"
                    />
                  </svg>
                  <svg
                    v-else-if="playbackStatus.type === 'error'"
                    class="h-4 w-4 text-red-500 flex-shrink-0"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fill-rule="evenodd"
                      d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                      clip-rule="evenodd"
                    />
                  </svg>
                  <svg
                    v-else
                    class="h-4 w-4 text-blue-500 flex-shrink-0"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fill-rule="evenodd"
                      d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                      clip-rule="evenodd"
                    />
                  </svg>
                  <span>{{ playbackStatus.message }}</span>
                </div>
                <div v-else class="text-gray-400 text-xs">
                  Ready for playback
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <!-- End of centered container -->

      <!-- Configuration Section (Full Width) -->
      <div
        v-if="
          hasAnyDownloadedContent ||
          scenario.type === 'VMAP' ||
          scenario.type === 'VAST' ||
          scenario.type === 'MP4' ||
          scenario.type === 'GIF'
        "
        class="card p-6"
      >
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-medium text-gray-900">Configuration</h2>
          <div class="flex space-x-2">
            <!-- Apply to All Button (shown for HLS without audio, DASH, VMAP, VAST, MP4, GIF) -->
            <button
              v-if="
                (scenario.type !== 'DASH' && scenario.type !== 'VMAP' && scenario.type !== 'VAST' && scenario.type !== 'MP4' && scenario.type !== 'GIF' && !selectedConfigAudio) ||
                scenario.type === 'DASH' ||
                scenario.type === 'VMAP' ||
                scenario.type === 'VAST' ||
                scenario.type === 'MP4' ||
                scenario.type === 'GIF'
              "
              @click="openApplyToAllModal('video')"
              class="btn btn-primary"
            >
              {{ 
                scenario.type === 'HLS' && !selectedConfigAudio 
                  ? `Apply to Profile ${selectedConfigProfile}` 
                  : scenario.type === 'DASH'
                  ? 'Apply to All'
                  : scenario.type === 'VMAP' || scenario.type === 'VAST' || scenario.type === 'MP4' || scenario.type === 'GIF'
                  ? 'Apply to All'
                  : 'Apply to All'
              }}
            </button>
            <!-- Reset All Button -->
            <button
              v-if="!selectedConfigAudio || scenario.type === 'DASH' || scenario.type === 'VMAP' || scenario.type === 'VAST' || scenario.type === 'MP4' || scenario.type === 'GIF'"
              @click="resetAllConfigs"
              class="btn btn-danger"
            >
              Reset All
            </button>
          </div>
        </div>

        <!-- Profile Selection (HLS only, not for DASH/VMAP/VAST/MP4/GIF) -->
        <div
          v-if="
            scenario.type !== 'DASH' &&
            scenario.type !== 'VMAP' &&
            scenario.type !== 'VAST' &&
            scenario.type !== 'MP4' &&
            scenario.type !== 'GIF'
          "
          class="mb-6"
        >
          <div class="grid grid-cols-2 gap-4">
            <!-- Video Profile Column -->
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1"
                >Video Profile</label
              >
              <select v-model="selectedConfigProfile" class="input w-full mb-2">
                <option
                  v-for="profileNum in availableProfiles"
                  :key="profileNum"
                  :value="profileNum"
                >
                  Profile {{ profileNum }}
                </option>
              </select>
              <!-- Video Action Buttons (shown when audio is selected) -->
              <div v-if="selectedConfigAudio" class="flex space-x-2">
                <button
                  @click="openApplyToAllModal('video')"
                  class="btn btn-primary btn-sm flex-1"
                >
                  Apply to Profile {{ selectedConfigProfile }}
                </button>
                <button
                  @click="resetAllConfigsForType('video')"
                  class="btn btn-danger btn-sm flex-1"
                >
                  Reset All Video
                </button>
              </div>
            </div>
            
            <!-- Audio Profile Column -->
            <div v-if="availableAudioVariants.length > 0">
              <label class="block text-sm font-medium text-gray-700 mb-1"
                >Audio Profile</label
              >
              <select v-model="selectedConfigAudio" class="input w-full mb-2">
                <option value="">None</option>
                <option
                  v-for="variant in availableAudioVariants"
                  :key="variant.name"
                  :value="variant.name"
                >
                  {{ variant.name }}
                  {{ variant.language ? `(${variant.language})` : "" }}
                </option>
              </select>
              <!-- Audio Action Buttons (shown when audio is selected) -->
              <div v-if="selectedConfigAudio" class="flex space-x-2">
                <button
                  @click="openApplyToAllModal('audio')"
                  class="btn btn-primary btn-sm flex-1"
                >
                  Apply to {{ selectedConfigAudio }}
                </button>
                <button
                  @click="resetAllConfigsForType('audio')"
                  class="btn btn-danger btn-sm flex-1"
                >
                  Reset All Audio
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Legend (not for VMAP/VAST/MP4/GIF) -->
        <div
          v-if="scenario.type !== 'VMAP' && scenario.type !== 'VAST' && scenario.type !== 'MP4' && scenario.type !== 'GIF'"
          class="flex items-center space-x-4 mb-2 text-[10px] mt-4 px-1"
        >
          <div class="flex items-center">
            <span
              class="w-3 h-3 bg-yellow-100 border border-yellow-200 rounded mr-1.5"
            ></span>
            <span class="text-gray-600 font-medium"
              >Edited for Current Profile</span
            >
          </div>
          <div class="flex items-center">
            <span
              class="w-3 h-3 bg-purple-100 border border-purple-200 rounded mr-1.5"
            ></span>
            <span class="text-gray-600 font-medium"
              >Edited for All Profiles</span
            >
          </div>
        </div>

        <!-- VMAP/VAST/MP4/GIF Configuration Table -->
        <div
          v-if="scenario.type === 'VMAP' || scenario.type === 'VAST' || scenario.type === 'MP4' || scenario.type === 'GIF'"
          class="overflow-x-auto overflow-y-auto max-h-[500px] border rounded"
        >
          <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th
                  class="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                >
                  #
                </th>
                <th
                  class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                >
                  Filename
                </th>
                <th
                  class="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                >
                  Delay
                </th>
                <th
                  class="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                >
                  %
                </th>
                <th
                  class="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                >
                  Status
                </th>
                <th
                  class="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                >
                  %
                </th>
                <th
                  class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                >
                  Actions
                </th>
              </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
              <tr
                v-for="(fileData, key) in vmapVastFiles"
                :key="key"
                :class="{ 'bg-yellow-50': fileData.isEdited, 'bg-blue-50': fileData.isCopy }"
              >
                <td class="px-2 py-2 text-sm text-gray-900 font-medium">
                  {{ getConfigIndex(key) }}
                </td>
                <td
                  class="px-4 py-2 text-sm text-gray-900 break-all font-mono text-[10px]"
                >
                  {{ fileData.filename || key }}
                </td>
                <td class="px-2 py-2 text-sm text-gray-500">
                  <input
                    v-model.number="fileData.delay"
                    type="number"
                    step="0.1"
                    min="0"
                    class="input w-16 py-0.5 text-xs"
                  />
                </td>
                <td class="px-2 py-2 text-sm text-gray-500">
                  <input
                    v-model.number="fileData.delayPercentage"
                    type="number"
                    min="0"
                    max="100"
                    class="input w-14 py-0.5 text-xs"
                    placeholder="100"
                  />
                </td>
                <td class="px-2 py-2 text-sm text-gray-500">
                  <select
                    v-model="fileData.statusCode"
                    class="input w-20 py-0.5 text-xs"
                  >
                    <option
                      v-for="code in httpStatusCodes"
                      :key="code"
                      :value="code"
                    >
                      {{ code }}
                    </option>
                  </select>
                </td>
                <td class="px-2 py-2 text-sm text-gray-500">
                  <input
                    v-model.number="fileData.statusPercentage"
                    type="number"
                    min="0"
                    max="100"
                    class="input w-14 py-0.5 text-xs"
                    placeholder="100"
                  />
                </td>
                <td class="px-4 py-2 text-sm text-gray-500">
                  <div class="flex space-x-2">
                    <button
                      @click="saveVmapVastConfig(key, fileData)"
                      class="text-blue-600 hover:text-blue-800 p-1 rounded hover:bg-blue-50 transition-colors"
                      title="Save settings"
                    >
                      <svg
                        class="h-4 w-4"
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
                    </button>
                    <button
                      @click="resetVmapVastConfig(key)"
                      class="text-gray-400 hover:text-gray-600 p-1 rounded hover:bg-gray-50 transition-colors"
                      title="Reset settings"
                    >
                      <svg
                        class="h-4 w-4"
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
                    </button>
                    <button
                      @click="copyConfigEntry(key)"
                      class="text-green-600 hover:text-green-800 p-1 rounded hover:bg-green-50 transition-colors"
                      title="Copy configuration"
                    >
                      <svg
                        class="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                        />
                      </svg>
                    </button>
                    <button
                      v-if="key.includes('_copy_')"
                      @click="removeConfigEntry(key)"
                      class="text-red-600 hover:text-red-800 p-1 rounded hover:bg-red-50 transition-colors"
                      title="Remove copy"
                    >
                      <svg
                        class="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- HLS/DASH Manifest Table -->
        <div
          v-if="scenario.type !== 'VMAP' && scenario.type !== 'VAST' && scenario.type !== 'MP4' && scenario.type !== 'GIF'"
          class="overflow-x-auto overflow-y-auto max-h-[500px] border rounded"
        >
          <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th
                  class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                >
                  #
                </th>
                <th
                  class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                >
                  Video Manifest
                </th>
                <th
                  class="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                >
                  Delay (V)
                </th>
                <th
                  class="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                >
                  %
                </th>
                <th
                  class="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                >
                  Status (V)
                </th>
                <th
                  class="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                >
                  %
                </th>
                <th
                  class="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                >
                  Repeat (V)
                </th>
                <th
                  class="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                >
                  %
                </th>
                <th
                  class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                >
                  Actions (V)
                </th>
                <template v-if="selectedConfigAudio">
                  <th
                    class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase border-l border-gray-200"
                  >
                    Audio Manifest
                  </th>
                  <th
                    class="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                  >
                    Delay (A)
                  </th>
                  <th
                    class="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                  >
                    %
                  </th>
                  <th
                    class="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                  >
                    Status (A)
                  </th>
                  <th
                    class="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                  >
                    %
                  </th>
                  <th
                    class="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                  >
                    Repeat (A)
                  </th>
                  <th
                    class="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                  >
                    %
                  </th>
                  <th
                    class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                  >
                    Actions (A)
                  </th>
                </template>
              </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
              <tr v-for="m in filteredManifests" :key="m.manifestNumber">
                <td
                  class="px-4 py-2 text-sm text-gray-900"
                  :class="{
                    'bg-purple-50':
                      m.video?.isEditedForAll || m.audio?.isEditedForAll,
                    'bg-yellow-50':
                      (!m.video?.isEditedForAll && m.video?.isEdited) ||
                      (!m.audio?.isEditedForAll && m.audio?.isEdited),
                  }"
                >
                  {{ m.manifestNumber }}
                </td>
                <td
                  class="px-4 py-2 text-sm text-gray-500 break-all font-mono text-[10px]"
                  :class="{
                    'bg-purple-50': m.video?.isEditedForAll,
                    'bg-yellow-50':
                      !m.video?.isEditedForAll && m.video?.isEdited,
                  }"
                >
                  {{ m.video ? m.video.rewrittenFilename : "-" }}
                </td>
                <td
                  class="px-2 py-2 text-sm text-gray-500"
                  :class="{
                    'bg-purple-50': m.video?.isEditedForAll,
                    'bg-yellow-50':
                      !m.video?.isEditedForAll && m.video?.isEdited,
                  }"
                >
                  <input
                    v-if="m.video"
                    v-model.number="m.video.delay"
                    type="number"
                    step="0.1"
                    min="0"
                    class="input w-16 py-0.5 text-xs"
                  />
                </td>
                <td
                  class="px-2 py-2 text-sm text-gray-500"
                  :class="{
                    'bg-purple-50': m.video?.isEditedForAll,
                    'bg-yellow-50':
                      !m.video?.isEditedForAll && m.video?.isEdited,
                  }"
                >
                  <input
                    v-if="m.video"
                    v-model.number="m.video.delayPercentage"
                    type="number"
                    min="0"
                    max="100"
                    class="input w-14 py-0.5 text-xs"
                    placeholder="100"
                  />
                </td>
                <td
                  class="px-2 py-2 text-sm text-gray-500"
                  :class="{
                    'bg-purple-50': m.video?.isEditedForAll,
                    'bg-yellow-50':
                      !m.video?.isEditedForAll && m.video?.isEdited,
                  }"
                >
                  <select
                    v-if="m.video"
                    v-model="m.video.status"
                    class="input w-20 py-0.5 text-xs"
                  >
                    <option
                      v-for="code in httpStatusCodes"
                      :key="code"
                      :value="code"
                    >
                      {{ code }}
                    </option>
                  </select>
                </td>
                <td
                  class="px-2 py-2 text-sm text-gray-500"
                  :class="{
                    'bg-purple-50': m.video?.isEditedForAll,
                    'bg-yellow-50':
                      !m.video?.isEditedForAll && m.video?.isEdited,
                  }"
                >
                  <input
                    v-if="m.video"
                    v-model.number="m.video.statusPercentage"
                    type="number"
                    min="0"
                    max="100"
                    class="input w-14 py-0.5 text-xs"
                    placeholder="100"
                  />
                </td>
                <td
                  class="px-2 py-2 text-sm text-gray-500"
                  :class="{
                    'bg-purple-50': m.video?.isEditedForAll,
                    'bg-yellow-50':
                      !m.video?.isEditedForAll && m.video?.isEdited,
                  }"
                >
                  <input
                    v-if="m.video"
                    v-model.number="m.video.repeat"
                    type="number"
                    min="0"
                    class="input w-16 py-0.5 text-xs"
                  />
                </td>
                <td
                  class="px-2 py-2 text-sm text-gray-500"
                  :class="{
                    'bg-purple-50': m.video?.isEditedForAll,
                    'bg-yellow-50':
                      !m.video?.isEditedForAll && m.video?.isEdited,
                  }"
                >
                  <input
                    v-if="m.video"
                    v-model.number="m.video.repeatPercentage"
                    type="number"
                    min="0"
                    max="100"
                    class="input w-14 py-0.5 text-xs"
                    placeholder="100"
                  />
                </td>
                <td
                  class="px-4 py-2 text-sm text-gray-500 overflow-visible"
                  :class="{
                    'bg-purple-50': m.video?.isEditedForAll,
                    'bg-yellow-50':
                      !m.video?.isEditedForAll && m.video?.isEdited,
                  }"
                >
                  <div v-if="m.video" class="flex space-x-2">
                    <!-- Save Button/Dropdown (DASH: direct button, HLS: dropdown) -->
                    <div v-if="scenario.type === 'DASH'" class="relative">
                      <button
                        @click="saveManifestConfigForRow(m, 'current', 'video')"
                        class="text-blue-600 hover:text-blue-800 p-1 rounded hover:bg-blue-50 transition-colors"
                        title="Save video settings"
                      >
                        <svg
                          class="h-4 w-4"
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
                      </button>
                    </div>
                    <div v-else class="relative">
                      <button
                        @click="openActionScopeModal('save', 'video', m)"
                        class="text-blue-600 hover:text-blue-800 p-1 rounded hover:bg-blue-50 transition-colors"
                        title="Save video settings"
                      >
                        <svg
                          class="h-4 w-4"
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
                      </button>
                    </div>

                    <!-- Reset Button/Dropdown (DASH: direct button, HLS: dropdown) -->
                    <div v-if="scenario.type === 'DASH'" class="relative">
                      <button
                        @click="
                          resetManifestConfigForRow(m, 'current', 'video')
                        "
                        class="text-gray-400 hover:text-gray-600 p-1 rounded hover:bg-gray-50 transition-colors"
                        title="Reset video settings"
                      >
                        <svg
                          class="h-4 w-4"
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
                      </button>
                    </div>
                    <div v-else class="relative">
                      <button
                        @click="openActionScopeModal('reset', 'video', m)"
                        class="text-gray-400 hover:text-gray-600 p-1 rounded hover:bg-gray-50 transition-colors"
                        title="Reset video settings"
                      >
                        <svg
                          class="h-4 w-4"
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
                      </button>
                    </div>
                  </div>
                </td>
                <template v-if="selectedConfigAudio">
                  <td
                    class="px-4 py-2 text-sm text-gray-500 break-all font-mono text-[10px] border-l border-gray-200"
                    :class="{
                      'bg-purple-50': m.audio?.isEditedForAll,
                      'bg-yellow-50':
                        !m.audio?.isEditedForAll && m.audio?.isEdited,
                    }"
                  >
                    {{ m.audio ? m.audio.rewrittenFilename : "-" }}
                  </td>
                  <td
                    class="px-2 py-2 text-sm text-gray-500"
                    :class="{
                      'bg-purple-50': m.audio?.isEditedForAll,
                      'bg-yellow-50':
                        !m.audio?.isEditedForAll && m.audio?.isEdited,
                    }"
                  >
                    <input
                      v-if="m.audio"
                      v-model.number="m.audio.delay"
                      type="number"
                      step="0.1"
                      min="0"
                      class="input w-16 py-0.5 text-xs"
                    />
                  </td>
                  <td
                    class="px-2 py-2 text-sm text-gray-500"
                    :class="{
                      'bg-purple-50': m.audio?.isEditedForAll,
                      'bg-yellow-50':
                        !m.audio?.isEditedForAll && m.audio?.isEdited,
                    }"
                  >
                    <input
                      v-if="m.audio"
                      v-model.number="m.audio.delayPercentage"
                      type="number"
                      min="0"
                      max="100"
                      class="input w-14 py-0.5 text-xs"
                      placeholder="100"
                    />
                  </td>
                  <td
                    class="px-2 py-2 text-sm text-gray-500"
                    :class="{
                      'bg-purple-50': m.audio?.isEditedForAll,
                      'bg-yellow-50':
                        !m.audio?.isEditedForAll && m.audio?.isEdited,
                    }"
                  >
                    <select
                      v-if="m.audio"
                      v-model="m.audio.status"
                      class="input w-20 py-0.5 text-xs"
                    >
                      <option
                        v-for="code in httpStatusCodes"
                        :key="code"
                        :value="code"
                      >
                        {{ code }}
                      </option>
                    </select>
                  </td>
                  <td
                    class="px-2 py-2 text-sm text-gray-500"
                    :class="{
                      'bg-purple-50': m.audio?.isEditedForAll,
                      'bg-yellow-50':
                        !m.audio?.isEditedForAll && m.audio?.isEdited,
                    }"
                  >
                    <input
                      v-if="m.audio"
                      v-model.number="m.audio.statusPercentage"
                      type="number"
                      min="0"
                      max="100"
                      class="input w-14 py-0.5 text-xs"
                      placeholder="100"
                    />
                  </td>
                  <td
                    class="px-2 py-2 text-sm text-gray-500"
                    :class="{
                      'bg-purple-50': m.audio?.isEditedForAll,
                      'bg-yellow-50':
                        !m.audio?.isEditedForAll && m.audio?.isEdited,
                    }"
                  >
                    <input
                      v-if="m.audio"
                      v-model.number="m.audio.repeat"
                      type="number"
                      min="0"
                      class="input w-16 py-0.5 text-xs"
                    />
                  </td>
                  <td
                    class="px-2 py-2 text-sm text-gray-500"
                    :class="{
                      'bg-purple-50': m.audio?.isEditedForAll,
                      'bg-yellow-50':
                        !m.audio?.isEditedForAll && m.audio?.isEdited,
                    }"
                  >
                    <input
                      v-if="m.audio"
                      v-model.number="m.audio.repeatPercentage"
                      type="number"
                      min="0"
                      max="100"
                      class="input w-14 py-0.5 text-xs"
                      placeholder="100"
                    />
                  </td>
                  <td
                    class="px-4 py-2 text-sm text-gray-500 overflow-visible"
                    :class="{
                      'bg-purple-50': m.audio?.isEditedForAll,
                      'bg-yellow-50':
                        !m.audio?.isEditedForAll && m.audio?.isEdited,
                    }"
                  >
                    <div class="flex space-x-2">
                      <!-- Save Audio Button/Dropdown (DASH: direct button, HLS: dropdown) -->
                      <div v-if="scenario.type === 'DASH'" class="relative">
                        <button
                          @click="
                            saveManifestConfigForRow(m, 'current', 'audio')
                          "
                          class="text-blue-600 hover:text-blue-800 p-1 rounded hover:bg-blue-50 transition-colors"
                          title="Save audio settings"
                        >
                          <svg
                            class="h-4 w-4"
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
                        </button>
                      </div>
                      <div v-else class="relative">
                        <button
                          @click="openActionScopeModal('save', 'audio', m)"
                          class="text-blue-600 hover:text-blue-800 p-1 rounded hover:bg-blue-50 transition-colors"
                          title="Save audio settings"
                        >
                          <svg
                            class="h-4 w-4"
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
                        </button>
                      </div>

                      <!-- Reset Audio Button/Dropdown (DASH: direct button, HLS: dropdown) -->
                      <div v-if="scenario.type === 'DASH'" class="relative">
                        <button
                          @click="
                            resetManifestConfigForRow(m, 'current', 'audio')
                          "
                          class="text-gray-400 hover:text-gray-600 p-1 rounded hover:bg-gray-50 transition-colors"
                          title="Reset audio settings"
                        >
                          <svg
                            class="h-4 w-4"
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
                        </button>
                      </div>
                      <div v-else class="relative">
                        <button
                          @click="openActionScopeModal('reset', 'audio', m)"
                          class="text-gray-400 hover:text-gray-600 p-1 rounded hover:bg-gray-50 transition-colors"
                          title="Reset audio settings"
                        >
                          <svg
                            class="h-4 w-4"
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
                        </button>
                      </div>
                    </div>
                  </td>
                </template>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Local Files Status -->
      <div
        v-if="
          scenario.type !== 'DASH' &&
          scenario.type !== 'VMAP' &&
          scenario.type !== 'VAST' &&
          scenario.type !== 'MP4' &&
          scenario.type !== 'GIF'
        "
        class="card p-6"
      >
        <h3 class="text-lg font-medium text-gray-900 mb-4">
          Local Files Status
        </h3>

        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-sm font-medium text-gray-700"
              >Master Manifest</span
            >
            <span
              :class="[
                hasLocalMasterManifest
                  ? 'text-green-600 bg-green-100'
                  : 'text-red-600 bg-red-100',
                'px-2 py-1 rounded text-xs font-medium',
              ]"
            >
              {{ hasLocalMasterManifest ? "Available" : "Not Available" }}
            </span>
          </div>

          <div class="space-y-2">
            <span class="text-sm font-medium text-gray-700"
              >Profile Manifests</span
            >
            <div class="grid grid-cols-2 gap-2">
              <div
                v-for="n in scenario.profileCount || 5"
                :key="n - 1"
                class="flex items-center justify-between p-2 bg-gray-50 rounded"
              >
                <span class="text-xs text-gray-600">Profile {{ n - 1 }}</span>
                <span
                  :class="[
                    hasLocalProfileManifest(n - 1)
                      ? 'text-green-600 bg-green-100'
                      : 'text-red-600 bg-red-100',
                    'px-2 py-0.5 rounded text-xs font-medium',
                  ]"
                >
                  {{ hasLocalProfileManifest(n - 1) ? "Ready" : "Missing" }}
                </span>
              </div>
            </div>
          </div>

          <div v-if="availableAudioVariants.length > 0" class="space-y-2">
            <span class="text-sm font-medium text-gray-700"
              >Audio Manifests</span
            >
            <div class="grid grid-cols-2 gap-2">
              <div
                v-for="variant in availableAudioVariants"
                :key="variant.name"
                class="flex items-center justify-between p-2 bg-gray-50 rounded"
              >
                <span class="text-xs text-gray-600">{{ variant.name }}</span>
                <span
                  :class="[
                    hasLocalAudioManifest(variant.name)
                      ? 'text-green-600 bg-green-100'
                      : 'text-red-600 bg-red-100',
                    'px-2 py-0.5 rounded text-xs font-medium',
                  ]"
                >
                  {{
                    hasLocalAudioManifest(variant.name) ? "Ready" : "Missing"
                  }}
                </span>
              </div>
            </div>
          </div>

          <div class="flex items-center justify-between">
            <span class="text-sm font-medium text-gray-700"
              >Downloaded Segments</span
            >
            <span class="text-sm text-gray-600">
              {{ Object.keys(segmentMap).length }} segments
            </span>
          </div>
        </div>
      </div>
    </div>
</template>
<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { useRoute } from "vue-router";
import Hls from "hls.js";
import dashjs from "dashjs";
import api from "../config/api";
import { useNotifications } from "../composables/useNotifications";
import { useScenariosStore } from "../stores/scenarios";

const props = defineProps({
  scenario: {
    type: Object,
    required: true,
  },
  activeTab: {
    type: String,
    required: true,
  },
  segmentMap: {
    type: Object,
    default: () => ({}),
  },
  downloadStats: {
    type: Object,
    default: null,
  },
});

const emit = defineEmits([
  "update:showActionScopeModal",
  "update:showApplyToAllModal",
]);

const route = useRoute();
const store = useScenariosStore();
const { success, error: showError } = useNotifications();

// Playback-related refs
const videoElement = ref(null);
const selectedPlaybackProfile = ref(0);
const externalHlsUrl = ref("");
const playbackStatus = ref(null);
const stopPlaybackLoading = ref(false);
const cookieValidationEnabled = ref(true);

// Configuration section refs
const selectedConfigProfile = ref(0);
const selectedConfigAudio = ref("");
const manifestMapData = ref(null);
const httpStatusCodes = [
  200, 400, 401, 403, 404, 408, 410, 416, 422, 429, 500, 502, 503, 504,
];

// Player instances
let hls = null;
let dashPlayer = null;

// Computed properties for local file availability
const hasLocalMasterManifest = computed(() => {
  return props.scenario && !props.scenario.isPlaceholder;
});

const hasLocalProfileManifest = computed(() => {
  return (profileIndex) => {
    return (
      props.scenario &&
      !props.scenario.isPlaceholder &&
      Object.keys(props.segmentMap).length > 0
    );
  };
});

const hasAnyDownloadedContent = computed(() => {
  if (props.scenario?.type === "DASH") {
    const hasManifests =
      manifestMapData.value &&
      manifestMapData.value.profile &&
      Object.keys(manifestMapData.value.profile).length > 0 &&
      Object.keys(manifestMapData.value.profile["0"] || {}).length > 0;
    return hasManifests;
  }
  return Object.keys(props.segmentMap).length > 0;
});

const isProcessingPlayback = computed(() => {
  if (props.scenario?.type !== "HLS" && props.scenario?.type !== "DASH") {
    return false;
  }

  if (
    props.scenario?.downloadStatus === "downloading" ||
    props.scenario?.downloadStatus === "stopping"
  ) {
    return true;
  }

  if (
    props.scenario?.downloadStatus === "completed" &&
    !hasAnyDownloadedContent.value
  ) {
    return true;
  }

  return false;
});

const playbackLoadingMessage = computed(() => {
  if (props.scenario?.downloadStatus === "downloading") {
    return "Downloading content and preparing manifests for playback...";
  }
  if (props.scenario?.downloadStatus === "stopping") {
    return "Finalizing download and creating ZIP archive...";
  }
  if (
    props.scenario?.downloadStatus === "completed" &&
    !hasAnyDownloadedContent.value
  ) {
    return "Processing downloaded content and rewriting manifests...";
  }
  return "Preparing content for playback...";
});

const hasDashManifests = computed(() => {
  const result =
    props.scenario &&
    props.scenario.type === "DASH" &&
    !props.scenario.isPlaceholder &&
    manifestMapData.value &&
    manifestMapData.value.profile &&
    Object.keys(manifestMapData.value.profile).length > 0 &&
    Object.keys(manifestMapData.value.profile["0"] || {}).length > 0;

  return result;
});

const hasLocalAudioManifest = computed(() => {
  return (variantName) => {
    return (
      props.scenario &&
      !props.scenario.isPlaceholder &&
      manifestMapData.value?.audio?.[variantName] &&
      Object.keys(manifestMapData.value.audio[variantName]).length > 0
    );
  };
});

const availableProfiles = computed(() => {
  if (!props.scenario || !props.scenario.profileCount) return [];
  return Array.from({ length: props.scenario.profileCount }, (_, i) => i);
});

const availableAudioVariants = computed(() => {
  if (!props.scenario || !props.scenario.audioVariants) return [];
  return props.scenario.audioVariants;
});

const filteredManifests = computed(() => {
  if (!manifestMapData.value) return [];
  const videoManifests =
    manifestMapData.value.profile?.[selectedConfigProfile.value] || {};
  const audioManifests = selectedConfigAudio.value
    ? manifestMapData.value.audio?.[selectedConfigAudio.value] || {}
    : {};
  const grouped = {};

  Object.entries(videoManifests).forEach(([key, m]) => {
    if (!grouped[m.manifestNumber])
      grouped[m.manifestNumber] = { manifestNumber: m.manifestNumber };
    grouped[m.manifestNumber].video = { key, ...m };
  });

  if (selectedConfigAudio.value) {
    Object.entries(audioManifests).forEach(([key, m]) => {
      if (!grouped[m.manifestNumber])
        grouped[m.manifestNumber] = { manifestNumber: m.manifestNumber };
      grouped[m.manifestNumber].audio = { key, ...m };
    });
  }
  return Object.values(grouped).sort(
    (a, b) => a.manifestNumber - b.manifestNumber,
  );
});

const vmapVastFiles = computed(() => {
  if (!manifestMapData.value) return {};
  if (props.scenario?.type === "MP4") {
    return manifestMapData.value.mp4 || {};
  } else if (props.scenario?.type === "GIF") {
    return manifestMapData.value.gif || {};
  }
  return manifestMapData.value.vmapVast || {};
});

// Playback functions
async function loadLocalMasterManifest() {
  const scenarioId = props.scenario.id;

  if (!hasLocalMasterManifest.value) {
    setPlaybackStatus(
      "error",
      "Local master manifest not available. Please download the scenario first.",
    );
    return;
  }

  try {
    if (props.scenario.playbackType !== "VOD") {
      await api.post(`/api/scenarios/${scenarioId}/live-stream/reset`, {
        resetAll: true,
      });
    }

    const backendUrl =
      import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";
    const manifestUrl = `${backendUrl}/api/scenarios/${scenarioId}/player/master/master-local.m3u8`;
    setPlaybackStatus("info", "Loading local master manifest...");
    loadHLS(manifestUrl);
  } catch (error) {
    console.error("Error in loadLocalMasterManifest:", error);
    const backendUrl =
      import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";
    const manifestUrl = `${backendUrl}/api/scenarios/${scenarioId}/player/master/master-local.m3u8`;
    setPlaybackStatus("info", "Loading local master manifest...");
    loadHLS(manifestUrl);
  }
}

async function loadLocalProfileManifest() {
  const scenarioId = props.scenario.id;

  if (!hasLocalProfileManifest.value(selectedPlaybackProfile.value)) {
    setPlaybackStatus(
      "error",
      `Local profile ${selectedPlaybackProfile.value} manifest not available. Please download this profile first.`,
    );
    return;
  }

  try {
    if (props.scenario.playbackType !== "VOD") {
      await api.post(`/api/scenarios/${scenarioId}/live-stream/reset`, {
        profileNumber: selectedPlaybackProfile.value,
      });
    }

    const backendUrl =
      import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";
    const manifestUrl = `${backendUrl}/api/scenarios/${scenarioId}/player/profiles/${selectedPlaybackProfile.value}/playlist.m3u8`;
    setPlaybackStatus(
      "info",
      `Loading local profile ${selectedPlaybackProfile.value} manifest...`,
    );
    loadHLS(manifestUrl);
  } catch (error) {
    console.error("Error in loadLocalProfileManifest:", error);
    const backendUrl =
      import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";
    const manifestUrl = `${backendUrl}/api/scenarios/${scenarioId}/player/profiles/${selectedPlaybackProfile.value}/playlist.m3u8`;
    setPlaybackStatus(
      "info",
      `Loading local profile ${selectedPlaybackProfile.value} manifest...`,
    );
    loadHLS(manifestUrl);
  }
}

function loadExternalHlsUrl() {
  const url = externalHlsUrl.value.trim();

  if (!url) {
    setPlaybackStatus("error", "Please enter a valid HLS URL");
    return;
  }

  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    setPlaybackStatus("error", "URL must start with http:// or https://");
    return;
  }

  setPlaybackStatus("info", `Loading HLS from external URL...`);
  loadHLS(url);
}

async function stopVodPlayback() {
  const scenarioId = props.scenario.id;
  stopPlaybackLoading.value = true;

  try {
    if (videoElement.value) {
      videoElement.value.pause();
      videoElement.value.currentTime = 0;
    }

    if (hls) {
      hls.destroy();
      hls = null;
    }

    setPlaybackStatus("success", "Playback stopped successfully.");
    success("VOD playback stopped");
  } catch (error) {
    console.error("Error stopping VOD playback:", error);
    setPlaybackStatus("error", "Failed to stop playback. Please try again.");
    showError("Failed to stop VOD playback");
  } finally {
    stopPlaybackLoading.value = false;
  }
}

function setPlaybackStatus(type, message) {
  playbackStatus.value = { type, message };

  if (type !== "error") {
    setTimeout(() => {
      if (playbackStatus.value && playbackStatus.value.message === message) {
        playbackStatus.value = null;
      }
    }, 5000);
  }
}

function getProfileInfo(profileIndex) {
  if (
    props.scenario &&
    props.scenario.profiles &&
    props.scenario.profiles[profileIndex]
  ) {
    const profile = props.scenario.profiles[profileIndex];
    return `${profile.resolution || "Unknown"} - ${(
      profile.bandwidth / 1000000
    ).toFixed(1)}Mbps`;
  }
  return "Unknown";
}

function loadHLS(url) {
  if (hls) {
    hls.destroy();
    hls = null;
  }

  if (videoElement.value) {
    videoElement.value.src = "";
    videoElement.value.load();
  }

  if (Hls.isSupported()) {
    hls = new Hls({
      debug: false,
      enableWorker: true,
      xhrSetup: function (xhr, url) {
        xhr.withCredentials = true;
      },
    });

    hls.loadSource(url);
    hls.attachMedia(videoElement.value);

    hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
      setPlaybackStatus(
        "success",
        `Manifest loaded successfully. ${data.levels.length} quality levels available.`,
      );
    });

    hls.on(Hls.Events.LEVEL_LOADED, (event, data) => {
      setPlaybackStatus(
        "success",
        `Quality level loaded with ${data.details.fragments.length} segments.`,
      );
    });

    hls.on(Hls.Events.ERROR, (event, data) => {
      let errorMessage = "Playback error occurred";

      if (data.fatal) {
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            errorMessage =
              "Network error: Cannot load local files. Make sure the scenario has been downloaded.";
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            errorMessage = "Media error: Problem with video/audio content.";
            hls.recoverMediaError();
            return;
          default:
            errorMessage = "Fatal playback error: Cannot continue playback.";
            if (hls) {
              hls.destroy();
              hls = null;
            }
            break;
        }
      } else {
        errorMessage = `Playback warning: ${data.details || "Unknown error"}`;
      }

      setPlaybackStatus("error", errorMessage);
    });

    hls.on(Hls.Events.FRAG_BUFFERED, () => {
      setPlaybackStatus("success", "Local content is playing successfully.");
    });

    if (videoElement.value) {
      videoElement.value.addEventListener("ended", () => {
        setPlaybackStatus(
          "success",
          "Playback completed. Click 'Load Local Master Manifest' to play again.",
        );
      });
    }
  } else if (videoElement.value.canPlayType("application/vnd.apple.mpegurl")) {
    videoElement.value.src = url;
    setPlaybackStatus("info", "Loading with native HLS support...");

    videoElement.value.addEventListener("loadeddata", () => {
      setPlaybackStatus(
        "success",
        "Local content loaded with native HLS support.",
      );
    });

    videoElement.value.addEventListener("error", (e) => {
      setPlaybackStatus(
        "error",
        "Error loading local content with native HLS support.",
      );
    });

    videoElement.value.addEventListener("ended", () => {
      setPlaybackStatus(
        "success",
        "Playback completed. Click 'Load Local Master Manifest' to play again.",
      );
    });
  } else {
    setPlaybackStatus(
      "error",
      "HLS playback is not supported in this browser.",
    );
  }
}

function loadDashManifest() {
  const scenarioId = props.scenario.id;

  if (!hasDashManifests.value) {
    setPlaybackStatus(
      "error",
      "DASH manifests not available. Please download the scenario first.",
    );
    return;
  }

  try {
    setPlaybackStatus("info", "Initializing DASH livestream...");

    api
      .post(`/api/scenarios/${scenarioId}/dash-live-stream/init`, {
        profileNumber: 0,
      })
      .then((response) => {
        const backendUrl =
          import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";
        const manifestUrl = `${backendUrl}/api/scenarios/${scenarioId}/dash-live-stream/manifest.mpd`;

        setPlaybackStatus("info", "Loading DASH livestream...");
        loadDASH(manifestUrl);
      })
      .catch((error) => {
        console.error("Error initializing DASH livestream:", error);
        setPlaybackStatus("error", "Failed to initialize DASH livestream");
      });
  } catch (error) {
    console.error("Error loading DASH manifest:", error);
    setPlaybackStatus("error", "Failed to load DASH manifest");
  }
}

function loadDASH(url) {
  if (dashPlayer) {
    dashPlayer.reset();
    dashPlayer = null;
  }

  if (hls) {
    hls.destroy();
    hls = null;
  }

  if (videoElement.value) {
    videoElement.value.src = "";
    videoElement.value.load();
  }

  try {
    dashPlayer = dashjs.MediaPlayer().create();

    dashPlayer.updateSettings({
      debug: {
        logLevel: dashjs.Debug.LOG_LEVEL_DEBUG,
      },
      streaming: {
        buffer: {
          fastSwitchEnabled: true,
        },
        liveDelay: 4,
      },
    });

    dashPlayer.initialize(videoElement.value, url, true);

    dashPlayer.on(dashjs.MediaPlayer.events.MANIFEST_LOADED, (e) => {
      setPlaybackStatus("info", "DASH manifest loaded, initializing stream...");
    });

    dashPlayer.on(dashjs.MediaPlayer.events.STREAM_INITIALIZED, () => {
      setPlaybackStatus(
        "success",
        "DASH stream initialized, starting playback...",
      );

      if (videoElement.value) {
        videoElement.value.play().catch((err) => {
          setPlaybackStatus(
            "error",
            "Failed to start playback. Click the play button to start.",
          );
        });
      }
    });

    dashPlayer.on(dashjs.MediaPlayer.events.PLAYBACK_STARTED, () => {
      setPlaybackStatus("success", "DASH content is playing successfully");
    });

    dashPlayer.on(dashjs.MediaPlayer.events.PLAYBACK_ENDED, () => {
      setPlaybackStatus(
        "success",
        "Playback completed. Click 'Load DASH Manifest' to play again.",
      );
    });

    dashPlayer.on(dashjs.MediaPlayer.events.ERROR, (e) => {
      let errorMessage = "DASH playback error occurred";

      if (e.error) {
        if (
          e.error.code ===
          dashjs.MediaPlayer.errors.DOWNLOAD_ERROR_ID_MANIFEST_CODE
        ) {
          errorMessage =
            "Cannot load DASH manifest. Make sure the scenario has been downloaded.";
        } else if (
          e.error.code ===
          dashjs.MediaPlayer.errors.DOWNLOAD_ERROR_ID_CONTENT_CODE
        ) {
          errorMessage =
            "Cannot load DASH segments. Make sure the scenario has been downloaded.";
        } else {
          errorMessage = `DASH error: ${e.error.message || "Unknown error"}`;
        }
      }

      setPlaybackStatus("error", errorMessage);
    });

    if (videoElement.value) {
      videoElement.value.addEventListener("ended", () => {
        setPlaybackStatus(
          "success",
          "Playback completed. Click 'Load DASH Manifest' to play again.",
        );
      });
    }
  } catch (error) {
    console.error("Error initializing DASH player:", error);
    setPlaybackStatus("error", "Failed to initialize DASH player");
  }
}

async function toggleCookieValidation() {
  const scenarioId = props.scenario.id;
  try {
    await api.post(`/api/scenarios/${scenarioId}/cookie-validation`, {
      enabled: cookieValidationEnabled.value,
    });

    success(
      cookieValidationEnabled.value
        ? "Cookie validation enabled - external players must send valid cookies"
        : "Cookie validation disabled - external players can play without validation",
    );
  } catch (err) {
    showError(
      `Failed to toggle cookie validation: ${err.response?.data?.error || err.message}`,
    );
    cookieValidationEnabled.value = !cookieValidationEnabled.value;
  }
}

// Configuration functions
async function loadManifestMap() {
  const scenarioId = props.scenario.id;
  try {
    const response = await api.get(`/api/scenarios/${scenarioId}/manifest-map`);
    manifestMapData.value = response.data;
  } catch (error) {
    console.error("Error loading manifest map:", error);
  }
}

function getConfigIndex(key) {
  const keys = Object.keys(vmapVastFiles.value);
  return keys.indexOf(key) + 1;
}

async function saveVmapVastConfig(key, fileData) {
  const scenarioId = props.scenario.id;
  try {
    let endpoint;
    if (props.scenario.type === "MP4") {
      endpoint = `/api/scenarios/${scenarioId}/mp4-config`;
    } else if (props.scenario.type === "GIF") {
      endpoint = `/api/scenarios/${scenarioId}/gif-config`;
    } else {
      endpoint = `/api/scenarios/${scenarioId}/vmap-vast-config`;
    }

    await api.post(endpoint, {
      filename: key,
      delay: fileData.delay || 0,
      delayPercentage: fileData.delayPercentage || 100,
      statusCode: fileData.statusCode || 200,
      statusPercentage: fileData.statusPercentage || 100,
    });

    success("Configuration saved successfully");
    await loadManifestMap();
  } catch (error) {
    showError("Failed to save configuration");
  }
}

async function resetVmapVastConfig(key) {
  const scenarioId = props.scenario.id;
  try {
    let endpoint;
    if (props.scenario.type === "MP4") {
      endpoint = `/api/scenarios/${scenarioId}/mp4-config/reset`;
    } else if (props.scenario.type === "GIF") {
      endpoint = `/api/scenarios/${scenarioId}/gif-config/reset`;
    } else {
      endpoint = `/api/scenarios/${scenarioId}/vmap-vast-config/reset`;
    }

    await api.post(endpoint, { filename: key });

    success("Configuration reset successfully");
    await loadManifestMap();
  } catch (error) {
    showError("Failed to reset configuration");
  }
}

async function copyConfigEntry(key) {
  const scenarioId = props.scenario.id;
  try {
    await api.post(`/api/scenarios/${scenarioId}/config-entry/copy`, {
      filename: key,
    });

    success("Configuration copied successfully");
    await loadManifestMap();
  } catch (error) {
    showError("Failed to copy configuration");
  }
}

async function removeConfigEntry(key) {
  const scenarioId = props.scenario.id;
  try {
    await api.post(`/api/scenarios/${scenarioId}/config-entry/remove`, {
      filename: key,
    });

    success("Configuration removed successfully");
    await loadManifestMap();
  } catch (error) {
    showError("Failed to remove configuration");
  }
}

async function saveManifestConfigForRow(m, scope, type) {
  const scenarioId = props.scenario.id;
  const item = m[type];
  if (!item) return;

  try {
    const config = {
      manifestKey: item.key,
      profileNumber: selectedConfigProfile.value,
      delay: item.delay || 0,
      delayPercentage: item.delayPercentage || 100,
      status: item.status || 200,
      statusPercentage: item.statusPercentage || 100,
      repeat: item.repeat || 0,
      repeatPercentage: item.repeatPercentage || 100,
      scope,
      type,
    };

    if (type === "audio") {
      config.audioVariant = selectedConfigAudio.value;
    }

    await store.updateManifestConfig(scenarioId, config);
    success("Configuration saved successfully");
    await loadManifestMap();
  } catch (error) {
    showError("Failed to save configuration");
  }
}

async function resetManifestConfigForRow(m, scope, type) {
  const scenarioId = props.scenario.id;
  const item = m[type];
  if (!item) return;

  try {
    const config = {
      manifestKey: item.key,
      profileNumber: selectedConfigProfile.value,
      scope,
      type,
    };

    if (type === "audio") {
      config.audioVariant = selectedConfigAudio.value;
    }

    await store.resetManifestConfig(scenarioId, config);
    success("Configuration reset successfully");
    await loadManifestMap();
  } catch (error) {
    showError("Failed to reset configuration");
  }
}

function openActionScopeModal(actionType, mediaType, manifest) {
  emit("update:showActionScopeModal", {
    show: true,
    actionType,
    mediaType,
    manifest,
  });
}

function openApplyToAllModal(mediaType) {
  emit("update:showApplyToAllModal", {
    show: true,
    mediaType,
    profileLabel:
      mediaType === "video"
        ? `Profile ${selectedConfigProfile.value}`
        : selectedConfigAudio.value,
  });
}

async function resetAllConfigs() {
  const scenarioId = props.scenario.id;
  try {
    if (
      props.scenario.type === "VMAP" ||
      props.scenario.type === "VAST" ||
      props.scenario.type === "MP4" ||
      props.scenario.type === "GIF"
    ) {
      let endpoint;
      if (props.scenario.type === "MP4") {
        endpoint = `/api/scenarios/${scenarioId}/mp4-config/reset-all`;
      } else if (props.scenario.type === "GIF") {
        endpoint = `/api/scenarios/${scenarioId}/gif-config/reset-all`;
      } else {
        endpoint = `/api/scenarios/${scenarioId}/vmap-vast-config/reset-all`;
      }

      await api.post(endpoint);
    } else {
      await store.resetAllManifestConfigs(scenarioId, "all");
    }

    success("All configurations reset successfully");
    await loadManifestMap();
  } catch (error) {
    showError("Failed to reset all configurations");
  }
}

async function resetAllConfigsForType(type) {
  const scenarioId = props.scenario.id;
  try {
    await store.resetAllManifestConfigs(scenarioId, type);
    success(`All ${type} configurations reset successfully`);
    await loadManifestMap();
  } catch (error) {
    showError(`Failed to reset all ${type} configurations`);
  }
}

// Watch for tab changes
watch(
  () => props.activeTab,
  async (newTab) => {
    if (newTab === "playback") {
      playbackStatus.value = null;
      await loadManifestMap();

      if (hls) {
        hls.destroy();
        hls = null;
      }

      if (videoElement.value) {
        videoElement.value.src = "";
        videoElement.value.load();
      }
    }
  },
);

// Lifecycle hooks
onMounted(async () => {
  console.log("ScenarioDetailPlaybackTab mounted");

  if (props.scenario.cookieValidationEnabled !== undefined) {
    cookieValidationEnabled.value = props.scenario.cookieValidationEnabled;
  }

  await loadManifestMap();
});

onUnmounted(() => {
  console.log("ScenarioDetailPlaybackTab unmounting, cleaning up...");
  if (hls) {
    hls.destroy();
    hls = null;
  }
  if (dashPlayer) {
    dashPlayer.reset();
    dashPlayer = null;
  }
  playbackStatus.value = null;
});
</script>