<template>
       <div v-show="activeTab === 'edit'" class="space-y-6">
      <div class="card p-6">
        <h2 class="text-lg font-medium text-gray-900 mb-4">Edit Manifests</h2>

        <!-- Profile Selection (Only for HLS, not for DASH/VMAP/VAST) -->
        <div
          v-if="
            scenario.type !== 'DASH' &&
            scenario.type !== 'VMAP' &&
            scenario.type !== 'VAST'
          "
          class="grid grid-cols-2 gap-4 mb-6"
        >
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1"
              >Video Profile</label
            >
            <select v-model="selectedEditProfile" class="input w-full">
              <option
                v-for="profileNum in availableProfiles"
                :key="profileNum"
                :value="profileNum"
              >
                Profile {{ profileNum }}
              </option>
            </select>
          </div>
          <div v-if="availableAudioVariants.length > 0">
            <label class="block text-sm font-medium text-gray-700 mb-1"
              >Audio Profile</label
            >
            <select v-model="selectedEditAudio" class="input w-full">
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
          </div>
          <!-- Reset All Button Added Here -->
          <div class="flex items-end">
            <button
              @click="resetAllConfigs"
              class="btn btn-danger text-sm py-2"
            >
              Reset All
            </button>
          </div>
        </div>

        <!-- Reset All Button for DASH -->
        <div v-if="scenario.type === 'DASH'" class="mb-6 flex justify-end">
          <button @click="resetAllConfigs" class="btn btn-danger text-sm py-2">
            Reset All
          </button>
        </div>

        <!-- Legend (Shared style for HLS only) -->
        <div
          v-if="
            scenario.type !== 'DASH' &&
            scenario.type !== 'VMAP' &&
            scenario.type !== 'VAST'
          "
          class="flex items-center space-x-4 mb-4 text-[10px] px-1 font-medium"
        >
          <div class="flex items-center">
            <span
              class="w-3 h-3 bg-yellow-100 border border-yellow-200 rounded mr-1.5"
            ></span>
            <span class="text-gray-600">Edited for Current Profile</span>
          </div>
          <div class="flex items-center">
            <span
              class="w-3 h-3 bg-purple-100 border border-purple-200 rounded mr-1.5"
            ></span>
            <span class="text-gray-600">Edited for All Profiles</span>
          </div>
        </div>

        <!-- VMAP/VAST Edit Table -->
        <div
          v-if="scenario.type === 'VMAP' || scenario.type === 'VAST'"
          class="overflow-x-auto overflow-y-auto max-h-[500px] border rounded"
        >
          <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th
                  class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                >
                  URL No
                </th>
                <th
                  class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                >
                  URL
                </th>
                <th
                  class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                >
                  Filename
                </th>
                <th
                  class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                >
                  Action
                </th>
              </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
              <tr
                v-for="(fileData, key, index) in vmapVastEditFiles"
                :key="key"
                :class="{ 'bg-yellow-50': fileData.isContentEdited }"
              >
                <td class="px-4 py-2 text-sm text-gray-900">
                  {{ index + 1 }}
                </td>
                <td
                  class="px-4 py-2 text-sm text-gray-500 break-all text-[10px]"
                >
                  {{ fileData.originalUrl || "-" }}
                </td>
                <td
                  class="px-4 py-2 text-sm break-all font-mono text-[10px]"
                  :class="{
                    'text-blue-600 hover:underline cursor-pointer':
                      fileData.filename,
                    'text-yellow-700': fileData.isContentEdited,
                  }"
                  @click="fileData.filename && openVmapVastEditor(fileData)"
                >
                  {{ fileData.filename || "-" }}
                </td>
                <td class="px-4 py-2 text-sm text-gray-500">
                  <div class="flex items-center space-x-2">
                    <button
                      v-if="fileData.filename"
                      @click.stop="previewVmapVastFile(fileData)"
                      class="text-gray-400 hover:text-blue-600 p-1 rounded hover:bg-blue-50 transition-colors"
                      title="Preview Original"
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
                          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                        />
                      </svg>
                    </button>
                    <button
                      v-if="fileData.filename"
                      @click.stop="resetVmapVastFile(fileData)"
                      class="text-gray-400 hover:text-red-600 p-1 rounded hover:bg-red-50 transition-colors"
                      title="Reset file"
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
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- HLS/DASH Manifest Edit Table -->
        <div
          v-if="scenario.type !== 'VMAP' && scenario.type !== 'VAST'"
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
                  {{ scenario.type === "DASH" ? "Manifest" : "Video Manifest" }}
                </th>
                <th
                  class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                >
                  Action
                </th>
                <template v-if="selectedEditAudio && scenario.type !== 'DASH'">
                  <th
                    class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase border-l border-gray-200"
                  >
                    #
                  </th>
                  <th
                    class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                  >
                    Audio Manifest
                  </th>
                  <th
                    class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                  >
                    Action
                  </th>
                </template>
              </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
              <tr v-for="m in editFilteredManifests" :key="m.manifestNumber">
                <td
                  class="px-4 py-2 text-sm text-gray-900"
                  :class="{
                    'bg-purple-50':
                      m.video?.isContentEditedForAll ||
                      m.audio?.isContentEditedForAll,
                    'bg-yellow-50':
                      (!m.video?.isContentEditedForAll &&
                        m.video?.isContentEdited) ||
                      (!m.audio?.isContentEditedForAll &&
                        m.audio?.isContentEdited),
                  }"
                >
                  {{ m.manifestNumber }}
                </td>
                <td
                  class="px-4 py-2 text-sm break-all font-mono text-[10px]"
                  :class="{
                    'bg-purple-50 text-purple-700':
                      m.video?.isContentEditedForAll,
                    'bg-yellow-50 text-yellow-700':
                      !m.video?.isContentEditedForAll &&
                      m.video?.isContentEdited,
                    'text-blue-600 hover:underline cursor-pointer': m.video,
                  }"
                  @click="m.video && openEditor(m, 'video')"
                >
                  {{ m.video ? m.video.rewrittenFilename : "-" }}
                </td>
                <td
                  class="px-4 py-2 text-sm text-gray-500"
                  :class="{
                    'bg-purple-50': m.video?.isContentEditedForAll,
                    'bg-yellow-50':
                      !m.video?.isContentEditedForAll &&
                      m.video?.isContentEdited,
                  }"
                >
                  <div class="flex items-center space-x-2">
                    <button
                      v-if="m.video"
                      @click.stop="previewManifest(m, 'video')"
                      class="text-gray-400 hover:text-blue-600 p-1 rounded hover:bg-blue-50 transition-colors"
                      title="Preview Original"
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
                          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                        />
                      </svg>
                    </button>
                    <!-- Reset Button - Simple for DASH, Modal for VOD, Dropdown for HLS Live -->
                    <div v-if="m.video && scenario.type === 'DASH'">
                      <button
                        @click.stop="
                          resetManifestContentForRow(m, 'current', 'video')
                        "
                        class="text-gray-400 hover:text-red-600 p-1 rounded hover:bg-red-50 transition-colors"
                        title="Reset manifest"
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
                    <!-- Reset Video Modal for VOD -->
                    <div v-else-if="m.video && scenario.playbackType === 'VOD'">
                      <button
                        @click="openEditActionScopeModal('reset', 'video', m)"
                        class="text-gray-400 hover:text-red-600 p-1 rounded hover:bg-red-50 transition-colors"
                        title="Reset manifest"
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
                    <!-- Reset Video Dropdown for HLS Live -->
                    <div
                      v-else-if="m.video"
                      class="relative dropdown-container"
                    >
                      <button
                        @click.stop="
                          toggleDropdown('edit-reset-v-' + m.manifestNumber)
                        "
                        class="text-gray-400 hover:text-red-600 p-1 rounded hover:bg-red-50 transition-colors"
                        title="Reset manifest"
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

                      <div
                        v-if="
                          activeDropdown === 'edit-reset-v-' + m.manifestNumber
                        "
                        class="absolute left-0 mt-2 w-48 bg-white border border-gray-200 rounded-md shadow-lg z-50 text-left overflow-hidden animate-in fade-in slide-in-from-top-1 duration-100"
                      >
                        <button
                          @click="
                            resetManifestContentForRow(m, 'current', 'video')
                          "
                          class="block w-full text-left px-4 py-2 text-xs text-gray-700 hover:bg-gray-100 border-b border-gray-100"
                        >
                          Reset for Current Profile
                        </button>
                        <button
                          @click="resetManifestContentForRow(m, 'all', 'video')"
                          class="block w-full text-left px-4 py-2 text-xs text-red-600 hover:bg-red-50"
                        >
                          Reset for All Profiles
                        </button>
                      </div>
                    </div>
                  </div>
                </td>
                <template v-if="selectedEditAudio && scenario.type !== 'DASH'">
                  <td
                    class="px-4 py-2 text-sm text-gray-900 border-l border-gray-200"
                    :class="{
                      'bg-purple-50':
                        m.video?.isContentEditedForAll ||
                        m.audio?.isContentEditedForAll,
                      'bg-yellow-50':
                        (!m.video?.isContentEditedForAll &&
                          m.video?.isContentEdited) ||
                        (!m.audio?.isContentEditedForAll &&
                          m.audio?.isContentEdited),
                    }"
                  >
                    {{ m.manifestNumber }}
                  </td>
                  <td
                    class="px-4 py-2 text-sm break-all font-mono text-[10px]"
                    :class="{
                      'bg-purple-50 text-purple-700':
                        m.audio?.isContentEditedForAll,
                      'bg-yellow-50 text-yellow-700':
                        !m.audio?.isContentEditedForAll &&
                        m.audio?.isContentEdited,
                      'text-blue-600 hover:underline cursor-pointer': m.audio,
                    }"
                    @click="m.audio && openEditor(m, 'audio')"
                  >
                    {{ m.audio ? m.audio.rewrittenFilename : "-" }}
                  </td>
                  <td
                    class="px-4 py-2 text-sm text-gray-500"
                    :class="{
                      'bg-purple-50': m.audio?.isContentEditedForAll,
                      'bg-yellow-50':
                        !m.audio?.isContentEditedForAll &&
                        m.audio?.isContentEdited,
                    }"
                  >
                    <div class="flex items-center space-x-2">
                      <button
                        v-if="m.audio"
                        @click.stop="previewManifest(m, 'audio')"
                        class="text-gray-400 hover:text-blue-600 p-1 rounded hover:bg-blue-50 transition-colors"
                        title="Preview Original"
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
                            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                          />
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                          />
                        </svg>
                      </button>
                      <!-- Reset Audio Button - Modal for VOD, Dropdown for Live -->
                      <div v-if="m.audio && scenario.playbackType === 'VOD'">
                        <button
                          @click="openEditActionScopeModal('reset', 'audio', m)"
                          class="text-gray-400 hover:text-red-600 p-1 rounded hover:bg-red-50 transition-colors"
                          title="Reset manifest"
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
                      <!-- Reset Audio Dropdown for Live -->
                      <div v-else-if="m.audio" class="relative dropdown-container">
                        <button
                          @click.stop="
                            toggleDropdown('edit-reset-a-' + m.manifestNumber)
                          "
                          class="text-gray-400 hover:text-red-600 p-1 rounded hover:bg-red-50 transition-colors"
                          title="Reset manifest"
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

                        <div
                          v-if="
                            activeDropdown ===
                            'edit-reset-a-' + m.manifestNumber
                          "
                          class="absolute left-0 mt-2 w-48 bg-white border border-gray-200 rounded-md shadow-lg z-50 text-left overflow-hidden animate-in fade-in slide-in-from-top-1 duration-100"
                        >
                          <button
                            @click="
                              resetManifestContentForRow(m, 'current', 'audio')
                            "
                            class="block w-full text-left px-4 py-2 text-xs text-gray-700 hover:bg-gray-100 border-b border-gray-100"
                          >
                            Reset for Current Profile
                          </button>
                          <button
                            @click="
                              resetManifestContentForRow(m, 'all', 'audio')
                            "
                            class="block w-full text-left px-4 py-2 text-xs text-red-600 hover:bg-red-50"
                          >
                            Reset for All Profiles
                          </button>
                        </div>
                      </div>
                    </div>
                  </td>
                </template>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Editor Modal -->
      <div
        v-if="showEditor"
        class="fixed inset-0 z-50 overflow-hidden flex items-center justify-center p-4"
      >
        <div
          class="absolute inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
          @click="closeEditor"
        ></div>
        <div
          class="relative bg-white rounded-lg shadow-xl w-full max-w-7xl h-[90vh] flex flex-col"
        >
          <!-- Editor Header -->
          <div
            class="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gray-50"
          >
            <div class="flex flex-col">
              <h3 class="text-base font-semibold text-gray-900">
                Editing: {{ currentEditingFile.name }}
              </h3>
              <p class="text-xs text-gray-500">
                Profile: {{ currentEditingFile.profile }} | Original:
                {{ currentEditingFile.manifestKey }}
              </p>
            </div>
            <div class="flex items-center space-x-3">
              <!-- View Original Toggle -->
              <button
                @click="toggleOriginalPreview"
                class="btn btn-secondary text-xs flex items-center px-3"
                :class="{
                  'bg-blue-50 text-blue-700 border-blue-200': showOriginal,
                }"
              >
                <svg
                  class="h-4 w-4 mr-1.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                  />
                </svg>
                View Original
              </button>

              <!-- Reset Button/Dropdown -->
              <div
                v-if="
                  scenario.type === 'DASH' ||
                  scenario.type === 'VMAP' ||
                  scenario.type === 'VAST'
                "
                class="relative"
              >
                <button
                  @click="resetCurrentManifest('current')"
                  class="btn btn-secondary text-xs flex items-center"
                >
                  Reset
                </button>
              </div>
              <div v-else class="relative dropdown-container">
                <button
                  @click.stop="toggleDropdown('edit-reset')"
                  class="btn btn-secondary text-xs flex items-center"
                >
                  Reset
                  <svg
                    class="ml-1.5 h-3 w-3"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </button>
                <div
                  v-if="activeDropdown === 'edit-reset'"
                  class="absolute right-0 mt-2 w-48 bg-white border border-gray-200 rounded-md shadow-lg z-50 overflow-hidden"
                >
                  <button
                    @click="resetCurrentManifest('current')"
                    class="block w-full text-left px-4 py-2 text-xs text-gray-700 hover:bg-gray-100 border-b"
                  >
                    Reset for Current Profile
                  </button>
                  <button
                    @click="resetCurrentManifest('all')"
                    class="block w-full text-left px-4 py-2 text-xs text-gray-700 hover:bg-gray-100"
                  >
                    Reset for All Profiles
                  </button>
                </div>
              </div>

              <!-- Save Button/Dropdown -->
              <div
                v-if="
                  scenario.type === 'DASH' ||
                  scenario.type === 'VMAP' ||
                  scenario.type === 'VAST'
                "
                class="relative"
              >
                <button
                  @click="saveCurrentManifest(false)"
                  class="btn btn-primary text-xs flex items-center"
                >
                  Save
                </button>
              </div>
              <div v-else class="relative dropdown-container">
                <button
                  @click.stop="toggleDropdown('edit-save')"
                  class="btn btn-primary text-xs flex items-center"
                >
                  Save
                  <svg
                    class="ml-1.5 h-3 w-3"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </button>
                <div
                  v-if="activeDropdown === 'edit-save'"
                  class="absolute right-0 mt-2 w-48 bg-white border border-gray-200 rounded-md shadow-lg z-50 overflow-hidden"
                >
                  <button
                    @click="saveCurrentManifest(false)"
                    class="block w-full text-left px-4 py-2 text-xs text-gray-700 hover:bg-gray-100 border-b font-medium"
                  >
                    Save for Current Profile
                  </button>
                  <button
                    @click="saveCurrentManifest(true)"
                    class="block w-full text-left px-4 py-2 text-xs text-blue-600 hover:bg-blue-50 font-medium"
                  >
                    Save for All Profiles
                  </button>
                </div>
              </div>

              <button
                @click="closeEditor"
                class="text-gray-400 hover:text-gray-500 p-1"
              >
                <svg
                  class="h-6 w-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
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
          </div>

          <!-- Editor Body -->
          <div class="flex-1 flex overflow-hidden">
            <!-- Main Editor -->
            <div class="flex-1 relative border-r">
              <div ref="monacoContainer" class="absolute inset-0"></div>
            </div>
            <!-- Original Preview -->
            <div
              v-show="showOriginal"
              class="flex-1 relative bg-gray-900 transition-all duration-300"
            >
              <div
                class="absolute top-0 left-0 right-0 py-1 px-3 bg-gray-800 text-gray-400 text-[10px] font-mono border-b border-gray-700 z-10 flex justify-between items-center"
              >
                <span>ORIGINAL MANIFEST (READ-ONLY)</span>
                <button @click="showOriginal = false" class="hover:text-white">
                  Close
                </button>
              </div>
              <div
                ref="monacoOriginalContainer"
                class="absolute inset-0 pt-6"
              ></div>
              <div
                v-if="loadingOriginal"
                class="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-50"
              >
                <svg
                  class="animate-spin h-8 w-8 text-blue-500"
                  viewBox="0 0 24 24"
                >
                  <circle
                    class="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    stroke-width="4"
                    fill="none"
                  ></circle>
                  <path
                    class="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
</template>
<script setup>
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useRoute } from "vue-router";
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
  manifestMapData: {
    type: Object,
    default: null,
  },
  availableProfiles: {
    type: Array,
    default: () => [],
  },
  availableAudioVariants: {
    type: Array,
    default: () => [],
  },
});

const emit = defineEmits([
  "update:manifestMapData",
  "update:showResetAllModal",
  "update:showResetVmapVastModal",
  "update:fileToReset",
  "update:showEditActionScopeModal",
  "update:editActionScopeModalConfig",
  "loadManifestMap",
]);

const route = useRoute();
const { success, error: showError } = useNotifications();

// Editor section refs
const selectedEditProfile = ref(0);
const selectedEditAudio = ref("");
const showEditor = ref(false);
const showOriginal = ref(false);
const loadingOriginal = ref(false);
const currentEditingFile = ref(null);
const monacoContainer = ref(null);
const monacoOriginalContainer = ref(null);
let editor = null;
let originalEditor = null;
const monaco = ref(null);
const activeDropdown = ref(null);

// Computed property for filtered manifests in edit tab
const editFilteredManifests = computed(() => {
  if (!props.manifestMapData) return [];
  const videoManifests =
    props.manifestMapData.profile?.[selectedEditProfile.value] || {};
  const audioManifests = selectedEditAudio.value
    ? props.manifestMapData.audio?.[selectedEditAudio.value] || {}
    : {};
  const grouped = {};

  Object.entries(videoManifests).forEach(([key, m]) => {
    if (!grouped[m.manifestNumber])
      grouped[m.manifestNumber] = { manifestNumber: m.manifestNumber };
    grouped[m.manifestNumber].video = { key, ...m };
  });

  if (selectedEditAudio.value) {
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

// VMAP/VAST/MP4/GIF Edit files computed property (includes edit status)
const vmapVastEditFiles = computed(() => {
  if (!props.manifestMapData) return {};
  if (
    props.scenario?.type !== "VMAP" &&
    props.scenario?.type !== "VAST" &&
    props.scenario?.type !== "MP4" &&
    props.scenario?.type !== "GIF"
  )
    return {};

  // manifestMapData for VMAP/VAST/MP4/GIF contains urlMapping.json structure with edit status
  const files = {};
  Object.entries(props.manifestMapData).forEach(([key, fileData]) => {
    if (fileData.filename && !fileData.error) {
      files[key] = {
        ...fileData,
        isContentEdited: fileData.isContentEdited || false,
      };
    }
  });
  return files;
});

async function loadMonaco() {
  if (monaco.value) return;
  try {
    monaco.value = await import("monaco-editor");
  } catch (err) {
    console.error("Monaco Editor failed to load:", err);
    showError("Monaco Editor failed to load. Please ensure it is installed.");
  }
}

async function openEditor(m, type) {
  const item = m[type];
  const isDash = props.scenario.type === "DASH";

  let profile, filePath;

  if (isDash) {
    profile = 0;
    filePath = `manifests/${item.rewrittenFilename}`;
  } else {
    profile =
      type === "video" ? selectedEditProfile.value : selectedEditAudio.value;
    filePath =
      type === "video"
        ? `profiles/${profile}/${item.rewrittenFilename}`
        : `audio/${profile}/${item.rewrittenFilename}`;
  }

  currentEditingFile.value = {
    name: item.rewrittenFilename,
    manifestKey: item.key,
    profile,
    type,
    filePath,
    manifestNumber: m.manifestNumber,
    sectionKey: isDash
      ? "profile.0"
      : type === "video"
        ? `profile.${profile}`
        : `audio.${profile}`,
    isDash,
  };

  showEditor.value = true;
  await loadMonaco();

  try {
    const endpoint = isDash
      ? `/api/scenarios/${props.scenario.id}/dash-manifest-content`
      : `/api/scenarios/${props.scenario.id}/manifest-content`;

    const { data } = await api.get(endpoint, {
      params: { filePath },
    });

    if (editor) {
      editor.setValue(data.content);
    } else {
      setTimeout(() => {
        if (monacoContainer.value) {
          editor = monaco.value.editor.create(monacoContainer.value, {
            value: data.content,
            language: isDash ? "xml" : "m3u8",
            theme: "vs-dark",
            automaticLayout: true,
          });
        }
      }, 100);
    }
  } catch (err) {
    showError("Failed to load manifest content");
  }
}

function closeEditor() {
  showEditor.value = false;
  showOriginal.value = false;
  if (editor) {
    editor.dispose();
    editor = null;
  }
  if (originalEditor) {
    originalEditor.dispose();
    originalEditor = null;
  }
}

async function toggleOriginalPreview() {
  showOriginal.value = !showOriginal.value;
  if (showOriginal.value) {
    loadingOriginal.value = true;
    try {
      const isDash = currentEditingFile.value.isDash;
      let origPath;

      if (isDash) {
        origPath = `manifests/${currentEditingFile.value.manifestKey}`;
      } else {
        const isVideo = currentEditingFile.value.type === "video";
        origPath = isVideo
          ? `profiles/${currentEditingFile.value.profile}/${currentEditingFile.value.manifestKey}`
          : `audio/${currentEditingFile.value.profile}/${currentEditingFile.value.manifestKey}`;
      }

      const endpoint = isDash
        ? `/api/scenarios/${props.scenario.id}/dash-manifest-content`
        : `/api/scenarios/${props.scenario.id}/manifest-content`;

      const { data } = await api.get(endpoint, {
        params: { filePath: origPath, isOriginal: true },
      });

      if (originalEditor) {
        originalEditor.setValue(data.content);
      } else {
        setTimeout(() => {
          if (monacoOriginalContainer.value) {
            originalEditor = monaco.value.editor.create(
              monacoOriginalContainer.value,
              {
                value: data.content,
                language: isDash ? "xml" : "m3u8",
                theme: "vs-dark",
                readOnly: true,
                automaticLayout: true,
              },
            );
          }
        }, 100);
      }
    } catch (err) {
      showError("Failed to load original manifest");
      showOriginal.value = false;
    } finally {
      loadingOriginal.value = false;
    }
  }
}

async function saveCurrentManifest(saveForAll) {
  const content = editor.getValue();
  const isDash = currentEditingFile.value.isDash;
  const isVmapVast =
    currentEditingFile.value.type === "VMAP" ||
    currentEditingFile.value.type === "VAST";

  try {
    let endpoint, payload;

    if (isVmapVast) {
      endpoint = `/api/scenarios/${props.scenario.id}/vmap-vast-content`;
      payload = {
        filename: currentEditingFile.value.filename,
        content,
      };
    } else if (isDash) {
      endpoint = `/api/scenarios/${props.scenario.id}/dash-manifest-content`;
      payload = {
        filePath: currentEditingFile.value.filePath,
        content,
        manifestKey: currentEditingFile.value.manifestKey,
      };
    } else {
      endpoint = `/api/scenarios/${props.scenario.id}/manifest-content`;
      payload = {
        filePath: currentEditingFile.value.filePath,
        content,
        saveForAll,
        manifestKey: currentEditingFile.value.manifestKey,
        sectionKey: currentEditingFile.value.sectionKey,
        profileNumber: currentEditingFile.value.profile,
      };
    }

    const { data } = await api.post(endpoint, payload);

    success(data.message);
    activeDropdown.value = null;

    // Reload manifest map
    emit("loadManifestMap");
  } catch (err) {
    showError("Failed to save file");
  }
}

async function resetCurrentManifest(scope) {
  const isDash = currentEditingFile.value.isDash;
  const isVmapVast =
    currentEditingFile.value.type === "VMAP" ||
    currentEditingFile.value.type === "VAST";

  try {
    let endpoint, payload;

    if (isVmapVast) {
      endpoint = `/api/scenarios/${props.scenario.id}/vmap-vast-reset`;
      payload = {
        filename: currentEditingFile.value.filename,
      };
    } else if (isDash) {
      endpoint = `/api/scenarios/${props.scenario.id}/dash-manifest-reset`;
      payload = {
        filePath: currentEditingFile.value.filePath,
        manifestKey: currentEditingFile.value.manifestKey,
      };
    } else {
      endpoint = `/api/scenarios/${props.scenario.id}/manifest-reset`;
      payload = {
        filePath: currentEditingFile.value.filePath,
        manifestKey: currentEditingFile.value.manifestKey,
        sectionKey: currentEditingFile.value.sectionKey,
        resetForAll: scope === "all",
      };
    }

    const { data } = await api.post(endpoint, payload);

    success(data.message);
    activeDropdown.value = null;

    // Reload manifest map
    emit("loadManifestMap");

    // Reload the content into the editor
    if (isVmapVast) {
      const { data: contentData } = await api.get(
        `/api/scenarios/${props.scenario.id}/vmap-vast-content`,
        { params: { filename: currentEditingFile.value.filename } },
      );
      editor.setValue(contentData.content);
    } else {
      const contentEndpoint = isDash
        ? `/api/scenarios/${props.scenario.id}/dash-manifest-content`
        : `/api/scenarios/${props.scenario.id}/manifest-content`;

      const { data: contentData } = await api.get(contentEndpoint, {
        params: { filePath: currentEditingFile.value.filePath },
      });
      editor.setValue(contentData.content);
    }
  } catch (err) {
    showError("Failed to reset file");
  }
}

async function previewManifest(m, type) {
  await openEditor(m, type);
  if (!showOriginal.value) {
    await toggleOriginalPreview();
  }
}

async function resetManifestContentForRow(m, scope, type) {
  const item = m[type];
  if (!item) return;

  const profile =
    type === "video" ? selectedEditProfile.value : selectedEditAudio.value;
  const filePath =
    type === "video"
      ? `profiles/${profile}/${item.rewrittenFilename}`
      : `audio/${profile}/${item.rewrittenFilename}`;
  const sectionKey =
    type === "video" ? `profile.${profile}` : `audio.${profile}`;

  try {
    const { data } = await api.post(
      `/api/scenarios/${props.scenario.id}/manifest-reset`,
      {
        filePath,
        manifestKey: item.key,
        sectionKey,
        resetForAll: scope === "all",
      },
    );

    success(data.message);
    activeDropdown.value = null;
    emit("loadManifestMap");
  } catch (err) {
    showError("Failed to reset manifest");
  }
}

// Open VMAP/VAST file in editor
async function openVmapVastEditor(fileData) {
  try {
    await loadMonaco();
    if (!monaco.value) return;

    const response = await api.get(
      `/api/scenarios/${props.scenario.id}/vmap-vast-content`,
      {
        params: { filename: fileData.filename },
      },
    );

    currentEditingFile.value = {
      name: fileData.filename,
      filename: fileData.filename,
      content: response.data.content,
      originalContent: response.data.originalContent,
      type: props.scenario.type,
    };

    showEditor.value = true;

    await new Promise((resolve) => setTimeout(resolve, 100));

    if (monacoContainer.value) {
      editor = monaco.value.editor.create(monacoContainer.value, {
        value: currentEditingFile.value.content,
        language: "xml",
        theme: "vs-dark",
        automaticLayout: true,
        minimap: { enabled: true },
        scrollBeyondLastLine: false,
        wordWrap: "on",
      });
    }
  } catch (error) {
    console.error("Error opening VMAP/VAST editor:", error);
    showError("Failed to load file content");
  }
}

// Preview VMAP/VAST original file
async function previewVmapVastFile(fileData) {
  if (
    !currentEditingFile.value ||
    currentEditingFile.value.filename !== fileData.filename
  ) {
    await openVmapVastEditor(fileData);
  }
  await toggleOriginalPreview();
}

// Reset VMAP/VAST file to original
async function resetVmapVastFile(fileData) {
  emit("update:fileToReset", fileData);
  emit("update:showResetVmapVastModal", true);
}

async function resetAllConfigs() {
  emit("update:showResetAllModal", true);
}

function toggleDropdown(id) {
  if (activeDropdown.value === id) {
    activeDropdown.value = null;
  } else {
    activeDropdown.value = id;
  }
}

// Open edit action scope modal for reset operations
function openEditActionScopeModal(actionType, mediaType, manifest) {
  emit("update:editActionScopeModalConfig", {
    actionType,
    mediaType,
    manifest,
  });
  emit("update:showEditActionScopeModal", true);
}

// Close dropdowns on outside click
function handleGlobalClick(e) {
  if (!e.target.closest(".dropdown-container")) {
    activeDropdown.value = null;
  }
}

onMounted(() => {
  window.addEventListener("click", handleGlobalClick);
});

onUnmounted(() => {
  window.removeEventListener("click", handleGlobalClick);
  if (editor) {
    editor.dispose();
    editor = null;
  }
  if (originalEditor) {
    originalEditor.dispose();
    originalEditor = null;
  }
});
</script>