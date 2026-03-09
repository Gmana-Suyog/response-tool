<template>
      <div
      v-show="activeTab === 'download'"
      class="grid grid-cols-1 lg:grid-cols-3 gap-8"
    >
      <!-- Main Content -->
      <div class="lg:col-span-2 space-y-6">
        <!-- Placeholder Warning -->
        <div
          v-if="scenario.isPlaceholder"
          class="bg-yellow-50 border border-yellow-200 rounded-md p-4"
        >
          <div class="flex">
            <ExclamationTriangleIcon class="h-5 w-5 text-yellow-400" />
            <div class="ml-3">
              <h3 class="text-sm font-medium text-yellow-800">
                Manifest Fetch Failed
              </h3>
              <p class="mt-1 text-sm text-yellow-700">
                {{
                  scenario.manifestFetchError ||
                  "Could not fetch the original manifest. Using placeholder."
                }}
              </p>
              <p class="mt-1 text-sm text-yellow-700">
                You can still start downloads manually or try with a different
                URL.
              </p>
            </div>
          </div>
        </div>

        <!-- Download Control -->
        <div class="card p-6">
          <h2 class="text-lg font-medium text-gray-900 mb-4">
            Download Control
          </h2>

          <div class="space-y-4">
            <!-- For VMAP/VAST: Dynamic Source URLs -->
            <template
              v-if="scenario.type === 'VMAP' || scenario.type === 'VAST'"
            >
              <div
                v-for="(urlData, index) in sourceUrls"
                :key="index"
                class="space-y-3 p-4 border border-gray-200 rounded-md"
              >
                <div class="flex items-center justify-between mb-2">
                  <label class="block text-sm font-medium text-gray-700">
                    Source URL {{ index + 1 }}
                  </label>
                  <button
                    v-if="sourceUrls.length > 1"
                    @click="removeSourceUrl(index)"
                    type="button"
                    class="text-red-600 hover:text-red-800 p-1"
                    title="Remove URL"
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

                <div>
                  <input
                    v-model="urlData.url"
                    type="url"
                    placeholder="https://example.com/vmap.xml"
                    class="input w-full"
                  />
                </div>

                <!-- Request Headers for this URL -->
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">
                    Request Headers (Optional)
                  </label>
                  <div class="space-y-2">
                    <div
                      v-for="(header, hIndex) in urlData.requestHeaders"
                      :key="hIndex"
                      class="flex items-center space-x-2"
                    >
                      <input
                        v-model="header.name"
                        type="text"
                        placeholder="Header Name"
                        class="input flex-1"
                      />
                      <input
                        v-model="header.value"
                        type="text"
                        placeholder="Header Value"
                        class="input flex-1"
                      />
                      <button
                        type="button"
                        @click="removeHeaderFromUrl(index, hIndex)"
                        class="text-red-600 hover:text-red-800 p-2"
                        title="Remove header"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          class="h-4 w-4"
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
                      @click="addHeaderToUrl(index)"
                      class="flex items-center space-x-2 text-blue-600 hover:text-blue-800 text-sm"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        class="h-4 w-4"
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
                      <span>Add Header</span>
                    </button>
                  </div>
                </div>
              </div>

              <!-- Hidden: Multiple URL support for VMAP/VAST -->
              <!-- <button
                type="button"
                @click="addSourceUrl"
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
                <span class="text-sm">Add Source URL</span>
              </button> -->
            </template>

            <!-- For MP4: Dynamic Source URLs -->
            <template v-if="scenario.type === 'MP4'">
              <div
                v-for="(urlData, index) in sourceUrls"
                :key="index"
                class="space-y-3 p-4 border border-gray-200 rounded-md"
              >
                <div class="flex items-center justify-between mb-2">
                  <label class="block text-sm font-medium text-gray-700">
                    MP4 Source URL {{ index + 1 }}
                  </label>
                  <button
                    v-if="sourceUrls.length > 1"
                    @click="removeSourceUrl(index)"
                    type="button"
                    class="text-red-600 hover:text-red-800 p-1"
                    title="Remove URL"
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

                <div>
                  <input
                    v-model="urlData.url"
                    type="url"
                    placeholder="https://example.com/video.mp4"
                    class="input w-full"
                  />
                </div>

                <!-- Request Headers for this URL -->
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">
                    Request Headers (Optional)
                  </label>
                  <div class="space-y-2">
                    <div
                      v-for="(header, hIndex) in urlData.requestHeaders"
                      :key="hIndex"
                      class="flex items-center space-x-2"
                    >
                      <input
                        v-model="header.name"
                        type="text"
                        placeholder="Header Name"
                        class="input flex-1"
                      />
                      <input
                        v-model="header.value"
                        type="text"
                        placeholder="Header Value"
                        class="input flex-1"
                      />
                      <button
                        type="button"
                        @click="removeHeaderFromUrl(index, hIndex)"
                        class="text-red-600 hover:text-red-800 p-2"
                        title="Remove header"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          class="h-4 w-4"
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
                      @click="addHeaderToUrl(index)"
                      class="flex items-center space-x-2 text-blue-600 hover:text-blue-800 text-sm"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        class="h-4 w-4"
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
                      <span>Add Header</span>
                    </button>
                  </div>
                </div>
              </div>

              <!-- Hidden: Multiple URL support for MP4 -->
              <!-- <button
                type="button"
                @click="addSourceUrl"
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
                <span class="text-sm">Add MP4 Source URL</span>
              </button> -->
            </template>

            <!-- For GIF: Dynamic Source URLs -->
            <template v-if="scenario.type === 'GIF'">
              <div
                v-for="(urlData, index) in sourceUrls"
                :key="index"
                class="space-y-3 p-4 border border-gray-200 rounded-md"
              >
                <div class="flex items-center justify-between mb-2">
                  <label class="block text-sm font-medium text-gray-700">
                    GIF Source URL {{ index + 1 }}
                  </label>
                  <button
                    v-if="sourceUrls.length > 1"
                    @click="removeSourceUrl(index)"
                    type="button"
                    class="text-red-600 hover:text-red-800 p-1"
                    title="Remove URL"
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

                <div>
                  <input
                    v-model="urlData.url"
                    type="url"
                    placeholder="https://example.com/image.gif"
                    class="input w-full"
                  />
                </div>

                <!-- Request Headers for this URL -->
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">
                    Request Headers (Optional)
                  </label>
                  <div class="space-y-2">
                    <div
                      v-for="(header, hIndex) in urlData.requestHeaders"
                      :key="hIndex"
                      class="flex items-center space-x-2"
                    >
                      <input
                        v-model="header.name"
                        type="text"
                        placeholder="Header Name"
                        class="input flex-1"
                      />
                      <input
                        v-model="header.value"
                        type="text"
                        placeholder="Header Value"
                        class="input flex-1"
                      />
                      <button
                        type="button"
                        @click="removeHeaderFromUrl(index, hIndex)"
                        class="text-red-600 hover:text-red-800 p-2"
                        title="Remove header"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          class="h-4 w-4"
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
                      @click="addHeaderToUrl(index)"
                      class="flex items-center space-x-2 text-blue-600 hover:text-blue-800 text-sm"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        class="h-4 w-4"
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
                      <span>Add Header</span>
                    </button>
                  </div>
                </div>
              </div>

              <!-- Hidden: Multiple URL support for GIF -->
              <!-- <button
                type="button"
                @click="addSourceUrl"
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
                <span class="text-sm">Add GIF Source URL</span>
              </button> -->
            </template>

            <!-- For HLS/DASH: Original fields -->
            <template v-if="scenario.type !== 'VMAP' && scenario.type !== 'VAST' && scenario.type !== 'MP4' && scenario.type !== 'GIF'">
              <!-- Profile Number (HLS Live only) -->
              <div v-if="scenario.type !== 'DASH' && scenario.playbackType !== 'VOD'">
                <label
                  for="profileNumber"
                  class="block text-sm font-medium text-gray-700"
                >
                  Profile Number
                </label>
                <select
                  id="profileNumber"
                  v-model="selectedProfile"
                  class="mt-1 input"
                >
                  <option
                    v-for="n in scenario.profileCount || 5"
                    :key="n - 1"
                    :value="n - 1"
                  >
                    Profile {{ n - 1 }}
                  </option>
                </select>
              </div>

              <!-- No. of Segments to Download (HLS Live) -->
              <div v-if="scenario.type === 'HLS' && scenario.playbackType === 'Live'">
                <label
                  for="maxSegmentsToDownload"
                  class="block text-sm font-medium text-gray-700"
                >
                  No. of Segments to Download
                </label>
                <input
                  id="maxSegmentsToDownload"
                  v-model.number="maxSegmentsToDownload"
                  type="number"
                  min="1"
                  placeholder="Leave empty to download all"
                  class="mt-1 input"
                />
                <p class="mt-1 text-xs text-gray-500">
                  Download last N segments from first manifest, then only new segments from subsequent manifests (applies to both video and audio)
                </p>
              </div>

              <!-- Max Segments Per Fetch (DASH only) -->
              <div v-if="scenario.type === 'DASH' && scenario.playbackType !== 'VOD'">
                <label
                  for="maxSegments"
                  class="block text-sm font-medium text-gray-700"
                >
                  Max Segments Per Fetch
                </label>
                <input
                  id="maxSegments"
                  v-model.number="maxSegmentsPerFetch"
                  type="number"
                  min="1"
                  max="50"
                  class="mt-1 input"
                />
                <p class="mt-1 text-xs text-gray-500">
                  Limits how many new segments to download per manifest refresh
                  (1-50)
                </p>
              </div>

              <!-- No. of Segments to Download (VOD HLS only) -->
              <div v-if="scenario.type === 'HLS' && scenario.playbackType === 'VOD'">
                <label
                  for="maxSegmentsToDownload"
                  class="block text-sm font-medium text-gray-700"
                >
                  No. of Video Segments to Download
                </label>
                <input
                  id="maxSegmentsToDownload"
                  v-model.number="maxSegmentsToDownload"
                  type="number"
                  min="1"
                  placeholder="Leave empty to download all"
                  class="mt-1 input"
                />
                <p class="mt-1 text-xs text-gray-500">
                  Download first N video segments from the manifest (leave empty to download all segments)
                </p>
              </div>

              <!-- No. of Audio Segments to Download (VOD HLS only with separate audio) -->
              <div v-if="scenario.type === 'HLS' && scenario.playbackType === 'VOD' && hasAudioVariant">
                <label
                  for="maxAudioSegmentsToDownload"
                  class="block text-sm font-medium text-gray-700"
                >
                  No. of Audio Segments to Download
                </label>
                <input
                  id="maxAudioSegmentsToDownload"
                  v-model.number="maxAudioSegmentsToDownload"
                  type="number"
                  min="1"
                  placeholder="Leave empty to download all"
                  class="mt-1 input"
                />
                <p class="mt-1 text-xs text-gray-500">
                  Download first N audio segments from the manifest (leave empty to download all segments)
                </p>
              </div>
            </template>

            <button
              @click="startDownload"
              :disabled="
                scenario.downloadStatus === 'downloading' ||
                scenario.downloadStatus === 'stopping' ||
                downloadLoading
              "
              class="btn btn-primary w-full relative"
            >
              <span
                v-if="downloadLoading"
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
                Processing...
              </span>
              <span v-else>
                {{
                  scenario.downloadStatus === "downloading"
                    ? "Downloading..."
                    : scenario.downloadStatus === "stopping"
                      ? "Stopping..."
                      : "Start Download"
                }}
              </span>
            </button>
          </div>
        </div>

        <!-- Download Stats Info -->
        <div
          v-if="
            downloadStats &&
            downloadStats.lastLimitInfo &&
            (scenario.downloadStatus === 'downloading' ||
              scenario.downloadStatus === 'stopping')
          "
          class="card p-4"
        >
          <div
            v-if="downloadStats.lastLimitInfo.limitApplied"
            class="flex items-start space-x-3"
          >
            <svg
              class="h-5 w-5 text-yellow-500 mt-0.5"
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
            <div class="flex-1">
              <p class="text-sm font-medium text-yellow-800">
                Segment Limit Applied
              </p>
              <p class="mt-1 text-xs text-yellow-700">
                Playlist produced
                {{ downloadStats.lastLimitInfo.totalNewFound }} new segments,
                limit is {{ downloadStats.lastLimitInfo.maxSegmentsPerFetch }}.
                Ingested {{ downloadStats.lastLimitInfo.ingested }} segments.
              </p>
            </div>
          </div>
          <div
            v-else-if="downloadStats.lastLimitInfo.totalNewFound > 0"
            class="flex items-start space-x-3"
          >
            <svg
              class="h-5 w-5 text-blue-500 mt-0.5"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <div class="flex-1">
              <p class="text-sm font-medium text-blue-800">Download Active</p>
              <p class="mt-1 text-xs text-blue-700">
                Playlist produced
                {{ downloadStats.lastLimitInfo.totalNewFound }} new segments,
                limit is {{ downloadStats.lastLimitInfo.maxSegmentsPerFetch }}
                (no limiting needed).
              </p>
            </div>
          </div>

          <!-- Continuous Download Status -->
          <div
            v-if="downloadStats.targetDuration"
            class="mt-3 pt-3 border-t border-gray-200"
          >
            <div
              class="flex items-center justify-between text-xs text-gray-600"
            >
              <span>Target Duration: {{ downloadStats.targetDuration }}s</span>
              <span v-if="downloadStats.lastMediaSequence">
                Media Sequence: {{ downloadStats.lastMediaSequence }}
              </span>
            </div>
            <div v-if="downloadStats.consecutiveErrors > 0" class="mt-1">
              <span class="text-xs text-orange-600">
                Consecutive Errors: {{ downloadStats.consecutiveErrors }}
              </span>
            </div>
          </div>
        </div>

        <!-- Segment Mapping (HLS only, not for VMAP/VAST/MP4/GIF) -->
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
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-lg font-medium text-gray-900">Segment Mapping</h2>
            <button
              @click="refreshSegmentMap"
              class="btn btn-secondary text-sm"
            >
              Refresh
            </button>
          </div>

          <div
            v-if="segmentMap && Object.keys(segmentMap).length > 0"
            class="overflow-x-auto overflow-y-auto max-h-96"
          >
            <table class="min-w-full divide-y divide-gray-200">
              <thead class="bg-gray-50 sticky top-0">
                <tr>
                  <th
                    class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Original Segment
                  </th>
                  <th
                    class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Local Segment
                  </th>
                </tr>
              </thead>
              <tbody class="bg-white divide-y divide-gray-200">
                <tr
                  v-for="(localName, originalName) in segmentMap"
                  :key="originalName"
                >
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {{ originalName }}
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {{ localName }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div v-else class="text-center py-8 text-gray-500">
            No segments downloaded yet
          </div>
        </div>
      </div>

      <!-- Sidebar -->
      <div class="space-y-6">
        <!-- Scenario Info -->
        <div class="card p-6">
          <h3 class="text-lg font-medium text-gray-900 mb-4">Scenario Info</h3>

          <dl class="space-y-3">
            <div>
              <dt class="text-sm font-medium text-gray-500">Created</dt>
              <dd class="text-sm text-gray-900">
                {{ formatDate(scenario.createdAt) }}
              </dd>
            </div>

            <div
              v-if="
                scenario.sourceManifestUrl &&
                scenario.type !== 'VMAP' &&
                scenario.type !== 'VAST'
              "
            >
              <dt class="text-sm font-medium text-gray-500">Source Manifest</dt>
              <dd class="text-sm text-gray-900 break-all">
                <a
                  :href="scenario.sourceManifestUrl"
                  target="_blank"
                  class="text-blue-600 hover:text-blue-800"
                >
                  {{ scenario.sourceManifestUrl }}
                </a>
              </dd>
            </div>

            <div v-if="scenario.type">
              <dt class="text-sm font-medium text-gray-500">Type</dt>
              <dd class="text-sm text-gray-900">
                <span
                  class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-800"
                >
                  {{ scenario.type }}
                </span>
              </dd>
            </div>

            <div v-if="scenario.playbackType && scenario.type !== 'VMAP' && scenario.type !== 'VAST' && scenario.type !== 'MP4' && scenario.type !== 'GIF'">
              <dt class="text-sm font-medium text-gray-500">Playback Type</dt>
              <dd class="text-sm text-gray-900">
                <span
                  class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                  :class="
                    scenario.playbackType === 'Live'
                      ? 'bg-red-100 text-red-800'
                      : 'bg-green-100 text-green-800'
                  "
                >
                  {{ scenario.playbackType }}
                </span>
              </dd>
            </div>

            <div v-if="scenario.belongsToCustomer">
              <dt class="text-sm font-medium text-gray-500">
                Belongs to Customer
              </dt>
              <dd class="text-sm text-gray-900">
                <span
                  class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800"
                >
                  {{ scenario.belongsToCustomer }}
                </span>
              </dd>
            </div>

            <div v-if="scenario.type === 'HLS' && scenario.playbackType === 'Live' && scenario.addCookie">
              <dt class="text-sm font-medium text-gray-500">
                Cookie Enabled
              </dt>
              <dd class="text-sm text-gray-900">
                <span
                  class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                  :class="
                    scenario.addCookie === 'YES'
                      ? 'bg-green-100 text-green-800'
                      : 'bg-gray-100 text-gray-800'
                  "
                >
                  {{ scenario.addCookie }}
                </span>
              </dd>
            </div>

            <div v-if="scenario.segmentCount">
              <dt class="text-sm font-medium text-gray-500">Segments</dt>
              <dd class="text-sm text-gray-900">{{ scenario.segmentCount }}</dd>
            </div>

            <div v-if="scenario.profileCount">
              <dt class="text-sm font-medium text-gray-500">Profiles</dt>
              <dd class="text-sm text-gray-900">
                {{ scenario.profileCount }} profiles detected
              </dd>
            </div>

            <div v-if="scenario.maxSegmentsPerFetch && scenario.type !== 'VMAP' && scenario.type !== 'VAST' && scenario.type !== 'MP4' && scenario.type !== 'GIF'">
              <dt class="text-sm font-medium text-gray-500">
                Max Segments Per Fetch
              </dt>
              <dd class="text-sm text-gray-900">
                {{ scenario.maxSegmentsPerFetch }} segments
              </dd>
            </div>

            <div v-if="scenario.category">
              <dt class="text-sm font-medium text-gray-500">Category</dt>
              <dd class="text-sm text-gray-900">
                <span
                  class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800"
                >
                  {{ scenario.category }}
                </span>
              </dd>
            </div>

            <div v-if="scenario.approveVersion">
              <dt class="text-sm font-medium text-gray-500">Approve Version</dt>
              <dd class="text-sm text-gray-900">
                <span
                  class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800"
                >
                  v{{ scenario.approveVersion }}
                </span>
              </dd>
            </div>

            <div>
              <dt class="text-sm font-medium text-gray-500">
                {{
                  scenario.type === "VMAP" || scenario.type === "VAST"
                    ? `${scenario.type} URL`
                    : scenario.type === "MP4"
                    ? "MP4 URL"
                    : scenario.type === "GIF"
                    ? "GIF URL"
                    : "Master Manifest URL"
                }}
              </dt>
              <dd class="text-sm text-gray-900">
                <div class="flex items-center space-x-2">
                  <code
                    class="flex-1 bg-gray-100 px-2 py-1 rounded text-xs break-all"
                  >
                    {{ getMasterManifestUrl() }}
                  </code>
                  <button
                    @click="copyMasterManifestUrl"
                    class="flex-shrink-0 p-1 text-gray-400 hover:text-gray-600 focus:outline-none focus:text-gray-600"
                    title="Copy URL"
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
                </div>
                <p class="mt-1 text-xs text-gray-500">
                  {{
                    scenario.type === "VMAP" || scenario.type === "VAST"
                      ? `Use this URL to access the ${scenario.type} XML response`
                      : scenario.type === "MP4"
                      ? "Use this URL to access the MP4 video file"
                      : scenario.type === "GIF"
                      ? "Use this URL to access the GIF image file"
                      : "Use this URL in external HLS players to play the locally stored content"
                  }}
                </p>
              </dd>
            </div>

            <div v-if="scenario.debug">
              <dt class="text-sm font-medium text-gray-500">Debug</dt>
              <dd class="text-sm text-gray-900 whitespace-pre-wrap">
                {{ scenario.debug }}
              </dd>
            </div>

            <div v-if="scenario.specialNotes">
              <dt class="text-sm font-medium text-gray-500">Special Notes</dt>
              <dd class="text-sm text-gray-900">{{ scenario.specialNotes }}</dd>
            </div>

            <!-- Cookie Information -->
            <div v-if="scenario.addCookie === 'YES' && scenario.type === 'HLS' && scenario.playbackType === 'Live'">
              <dt class="text-sm font-medium text-gray-500">Cookie Information</dt>
              <dd class="text-sm text-gray-900">
                <div class="bg-blue-50 border border-blue-200 rounded-md p-3">
                  <div class="flex">
                    <svg class="h-5 w-5 text-blue-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd" />
                    </svg>
                    <div class="ml-3">
                      <p class="text-sm text-blue-700">
                        This scenario requires cookie-based authentication. The master manifest request will set a session cookie that must be included in all subsequent requests (playlists and segments).
                      </p>
                    </div>
                  </div>
                </div>
              </dd>
            </div>

            <!-- Downloaded URLs for VMAP/VAST/MP4/GIF -->
            <div
              v-if="
                (scenario.type === 'VMAP' || scenario.type === 'VAST' || scenario.type === 'MP4' || scenario.type === 'GIF') &&
                scenario.urlMapping &&
                Object.keys(scenario.urlMapping).length > 0
              "
            >
              <dt class="text-sm font-medium text-gray-500 mb-2">
                Downloaded Files
              </dt>
              <dd class="text-sm text-gray-900">
                <div class="space-y-2">
                  <div
                    v-for="(urlData, key) in getOriginalUrlMappings(scenario.urlMapping)"
                    :key="key"
                    class="bg-gray-50 p-2 rounded"
                  >
                    <div class="flex items-center justify-between">
                      <span class="text-xs font-medium text-gray-600">{{
                        key
                      }}</span>
                      <span
                        :class="
                          urlData.filename ? 'text-green-600' : 'text-red-600'
                        "
                        class="text-xs"
                      >
                        {{ urlData.filename ? "✓ Success" : "✗ Failed" }}
                      </span>
                    </div>
                    <div class="text-xs text-gray-500 break-all mt-1">
                      {{ urlData.originalUrl }}
                    </div>
                    <div v-if="urlData.filename" class="mt-1 space-y-1">
                      <div>
                        <a
                          :href="getDownloadedFileUrl(urlData.filename)"
                          target="_blank"
                          class="text-xs text-blue-600 hover:text-blue-800"
                        >
                          {{ urlData.filename }}
                        </a>
                      </div>
                      <div v-if="urlData.index" class="flex items-center space-x-2">
                        <code
                          class="flex-1 bg-gray-100 px-2 py-1 rounded text-xs break-all"
                        >
                          {{ getIndexedUrl(urlData.index) }}
                        </code>
                        <button
                          @click="copyIndexedUrl(urlData.index)"
                          class="flex-shrink-0 p-1 text-gray-400 hover:text-gray-600 focus:outline-none focus:text-gray-600"
                          title="Copy indexed URL"
                        >
                          <svg
                            class="h-3 w-3"
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
                      </div>
                      <p v-if="urlData.index" class="text-xs text-gray-500 italic">
                        Change the index value (?index=1, ?index=2, etc.) to access different configurations
                      </p>
                    </div>
                    <div v-if="urlData.error" class="text-xs text-red-600 mt-1">
                      Error: {{ urlData.error }}
                    </div>
                  </div>
                </div>
              </dd>
            </div>
          </dl>
        </div>

        <!-- Actions -->
        <div class="card p-6">
          <h3 class="text-lg font-medium text-gray-900 mb-4">Actions</h3>

          <div class="space-y-3">
            <button
              @click="showCloneModal = true"
              class="btn btn-secondary w-full"
            >
              Clone Scenario
            </button>
            <button
              @click="showDeleteModal = true"
              class="btn btn-danger w-full"
            >
              Delete Scenario
            </button>

            <a
              :href="`/api/scenarios/${scenario.id}/download-zip`"
              download
              class="btn btn-secondary w-full text-center block"
            >
              Download ZIP
            </a>
          </div>
        </div>
      </div>
    </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { useRoute } from "vue-router";
import { ExclamationTriangleIcon } from "@heroicons/vue/24/outline";
import { useScenariosStore } from "../stores/scenarios";
import api from "../config/api";
import { useNotifications } from "../composables/useNotifications";

const props = defineProps({
  scenario: {
    type: Object,
    required: true,
  },
  activeTab: {
    type: String,
    required: true,
  },
});

const emit = defineEmits(["update:showCloneModal", "update:showDeleteModal"]);

const route = useRoute();
const store = useScenariosStore();
const { success, error: showError } = useNotifications();

// Download-related refs
const selectedProfile = ref(0);
const maxSegmentsPerFetch = ref(6);
const maxSegmentsToDownload = ref(null);
const maxAudioSegmentsToDownload = ref(null);
const segmentMap = ref({});
const downloadStats = ref(null);
let statsInterval = null;

// VMAP/VAST/MP4/GIF source URLs
const sourceUrls = ref([
  {
    url: "",
    requestHeaders: [],
  },
]);

// Computed properties
const downloadLoading = computed(() => store.downloadLoading);

const hasAudioVariant = computed(() => {
  if (!props.scenario || !props.scenario.profiles) return false;
  return props.scenario.profiles.some(
    (profile) => profile.hasAudio === "separate",
  );
});

// Functions for managing source URLs
function addSourceUrl() {
  sourceUrls.value.push({
    url: "",
    requestHeaders: [],
  });
}

function removeSourceUrl(index) {
  if (sourceUrls.value.length > 1) {
    sourceUrls.value.splice(index, 1);
  }
}

function addHeaderToUrl(urlIndex) {
  sourceUrls.value[urlIndex].requestHeaders.push({ name: "", value: "" });
}

function removeHeaderFromUrl(urlIndex, headerIndex) {
  sourceUrls.value[urlIndex].requestHeaders.splice(headerIndex, 1);
}

// Download functions
async function startDownload() {
  const scenarioId = props.scenario.id;
  try {
    // Check if this is a VMAP/VAST/MP4/GIF scenario
    if (
      props.scenario.type === "VMAP" ||
      props.scenario.type === "VAST" ||
      props.scenario.type === "MP4" ||
      props.scenario.type === "GIF"
    ) {
      // Validate that at least one URL is provided
      const validUrls = sourceUrls.value.filter(
        (urlData) => urlData.url.trim() !== "",
      );
      if (validUrls.length === 0) {
        showError("Please provide at least one source URL");
        return;
      }

      // Prepare the source URLs with headers
      const preparedUrls = validUrls.map((urlData) => {
        const headersObject = {};
        urlData.requestHeaders.forEach((header) => {
          if (header.name && header.value) {
            headersObject[header.name] = header.value;
          }
        });
        return {
          url: urlData.url,
          requestHeaders: headersObject,
        };
      });

      // Call the other URL download endpoint
      const response = await api.post(
        `/api/scenarios/${scenarioId}/other-url-download`,
        {
          sourceUrls: preparedUrls,
        },
      );

      success(`Successfully downloaded ${response.data.totalUrls} URL(s)`);

      // Fetch URL mapping and update scenario
      try {
        const mappingResponse = await api.get(
          `/api/scenarios/${scenarioId}/other-url-mapping`,
        );
        if (props.scenario) {
          props.scenario.urlMapping = mappingResponse.data;
        }
      } catch (mappingError) {
        console.error("Error fetching URL mapping:", mappingError);
      }

      // Refresh scenario data
      await store.fetchScenario(scenarioId);
    } else {
      // Original HLS/DASH download logic
      const segmentsToDownload =
        props.scenario.type === "HLS" &&
        (props.scenario.playbackType === "VOD" ||
          props.scenario.playbackType === "Live")
          ? maxSegmentsToDownload.value
          : null;

      const audioSegmentsToDownload =
        props.scenario.type === "HLS" && props.scenario.playbackType === "VOD"
          ? maxAudioSegmentsToDownload.value
          : null;

      await store.startDownload(
        scenarioId,
        selectedProfile.value,
        maxSegmentsPerFetch.value,
        segmentsToDownload,
        audioSegmentsToDownload,
      );
      // Start polling for download stats
      await fetchDownloadStats();
      if (statsInterval) clearInterval(statsInterval);
      statsInterval = setInterval(fetchDownloadStats, 5000);
    }
  } catch (error) {
    console.error("Download error:", error);
    showError(error.response?.data?.error || "Failed to start download");
  }
}

async function refreshSegmentMap() {
  const scenarioId = props.scenario.id;

  // Only load segment map for HLS and DASH scenarios
  if (
    props.scenario?.type === "VMAP" ||
    props.scenario?.type === "VAST" ||
    props.scenario?.type === "MP4" ||
    props.scenario?.type === "GIF"
  ) {
    console.log(
      `[${props.scenario.type}] Skipping segment map load - not applicable for this scenario type`,
    );
    segmentMap.value = {};
    return;
  }

  try {
    segmentMap.value = await store.getSegmentMap(scenarioId);
  } catch (error) {
    // Error handled by store
  }
}

async function fetchDownloadStats() {
  const scenarioId = props.scenario.id;
  try {
    const response = await api.get(
      `/api/scenarios/${scenarioId}/download-stats`,
    );
    downloadStats.value = response.data;
  } catch (error) {
    // Silently handle 404 errors (no active download) - this is expected
    if (error.response?.status === 404) {
      downloadStats.value = null;

      // Stop polling if there's no active download
      if (statsInterval) {
        clearInterval(statsInterval);
        statsInterval = null;
      }
      return;
    }

    // Log other errors (but not 404s for download-stats)
    console.error("Error fetching download stats:", error);
    downloadStats.value = null;
  }
}

function formatDate(dateString) {
  return new Date(dateString).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getMasterManifestUrl() {
  const scenarioId = props.scenario.id;
  const backendUrl =
    import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";

  if (props.scenario?.type === "DASH") {
    return `${backendUrl}/api/scenarios/${scenarioId}/dash-live-stream/manifest.mpd`;
  }

  if (props.scenario?.type === "VMAP" || props.scenario?.type === "VAST") {
    return `${backendUrl}/api/scenarios/${scenarioId}/vmap-vast`;
  }

  if (props.scenario?.type === "MP4") {
    return `${backendUrl}/api/scenarios/${scenarioId}/mp4`;
  }

  if (props.scenario?.type === "GIF") {
    return `${backendUrl}/api/scenarios/${scenarioId}/gif`;
  }

  return `${backendUrl}/api/scenarios/${scenarioId}/player/master/master-local.m3u8`;
}

function getBackendUrl() {
  return import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";
}

function getDownloadedFileUrl(filename) {
  const scenarioId = props.scenario.id;
  const backendUrl = getBackendUrl();

  if (props.scenario?.type === "MP4") {
    return `${backendUrl}/api/scenarios/${scenarioId}/mp4/${filename}`;
  } else if (props.scenario?.type === "GIF") {
    return `${backendUrl}/api/scenarios/${scenarioId}/gif/${filename}`;
  } else {
    return `${backendUrl}/api/scenarios/${scenarioId}/vmap-vast/${filename}`;
  }
}

async function copyMasterManifestUrl() {
  try {
    const url = getMasterManifestUrl();
    await navigator.clipboard.writeText(url);
    success("Master manifest URL copied to clipboard!");
  } catch (error) {
    console.error("Failed to copy URL:", error);
    showError("Failed to copy URL to clipboard");
  }
}

function getOriginalUrlMappings(urlMapping) {
  if (!urlMapping) return {};

  // Filter to only show original entries (not copies)
  const originalEntries = {};
  Object.entries(urlMapping).forEach(([key, value]) => {
    // Only include entries that don't have "_copy_" in the key
    if (!key.includes("_copy_")) {
      originalEntries[key] = value;
    }
  });

  return originalEntries;
}

function getIndexedUrl(index) {
  const scenarioId = props.scenario.id;
  const backendUrl = getBackendUrl();

  if (props.scenario?.type === "MP4") {
    return `${backendUrl}/api/scenarios/${scenarioId}/mp4?index=${index}`;
  } else if (props.scenario?.type === "GIF") {
    return `${backendUrl}/api/scenarios/${scenarioId}/gif?index=${index}`;
  } else if (
    props.scenario?.type === "VMAP" ||
    props.scenario?.type === "VAST"
  ) {
    return `${backendUrl}/api/scenarios/${scenarioId}/vmap-vast?index=${index}`;
  }
  return "";
}

async function copyIndexedUrl(index) {
  try {
    const url = getIndexedUrl(index);
    await navigator.clipboard.writeText(url);
    success(`Indexed URL (index=${index}) copied to clipboard!`);
  } catch (error) {
    console.error("Failed to copy indexed URL:", error);
    showError("Failed to copy URL to clipboard");
  }
}

// Modal handlers
const showCloneModal = computed({
  get: () => false,
  set: (value) => emit("update:showCloneModal", value),
});

const showDeleteModal = computed({
  get: () => false,
  set: (value) => emit("update:showDeleteModal", value),
});

// Watch for tab changes
watch(
  () => props.activeTab,
  async (newTab) => {
    if (newTab === "download") {
      await refreshSegmentMap();
    }
  },
);

// Lifecycle hooks
onMounted(async () => {
  console.log("ScenarioDetailDownloadTab mounted");

  // Initialize sourceUrls for VMAP/VAST/MP4/GIF scenarios
  if (
    props.scenario.type === "VMAP" ||
    props.scenario.type === "VAST" ||
    props.scenario.type === "MP4" ||
    props.scenario.type === "GIF"
  ) {
    // If scenario has requestHeaders, initialize with one URL containing those headers
    if (
      props.scenario.requestHeaders &&
      Object.keys(props.scenario.requestHeaders).length > 0
    ) {
      const headers = [];
      Object.entries(props.scenario.requestHeaders).forEach(([name, value]) => {
        headers.push({ name, value });
      });
      sourceUrls.value = [
        {
          url: "",
          requestHeaders: headers,
        },
      ];
    }

    // Always try to fetch URL mapping for VMAP/VAST/MP4/GIF scenarios
    try {
      const mappingResponse = await api.get(
        `/api/scenarios/${props.scenario.id}/other-url-mapping`,
      );
      if (props.scenario) {
        props.scenario.urlMapping = mappingResponse.data;
      }
      console.log("URL mapping loaded:", mappingResponse.data);
    } catch (mappingError) {
      console.error("Error fetching URL mapping:", mappingError);
      // It's okay if mapping doesn't exist yet (scenario not downloaded)
    }
  }

  await refreshSegmentMap();

  // Start polling for download stats if downloading or stopping
  if (
    props.scenario.downloadStatus === "downloading" ||
    props.scenario.downloadStatus === "stopping"
  ) {
    await fetchDownloadStats();
    statsInterval = setInterval(fetchDownloadStats, 5000);
  }
});

onUnmounted(() => {
  console.log("ScenarioDetailDownloadTab unmounting, cleaning up...");
  if (statsInterval) {
    clearInterval(statsInterval);
    statsInterval = null;
  }
});
</script>