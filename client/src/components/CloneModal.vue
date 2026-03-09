<template>
  <div
    class="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50"
  >
    <div
      class="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white"
    >
      <div class="mt-3">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-medium text-gray-900">Clone Scenario</h3>
          <button
            @click="$emit('close')"
            class="text-gray-400 hover:text-gray-600"
          >
            <XMarkIcon class="h-6 w-6" />
          </button>
        </div>

        <form @submit.prevent="handleSubmit" class="space-y-4">
          <div>
            <label
              for="cloneName"
              class="block text-sm font-medium text-gray-700"
            >
              New Scenario Name *
            </label>
            <input
              id="cloneName"
              v-model="form.name"
              type="text"
              required
              class="mt-1 input"
              :placeholder="`${scenario.name} (Copy)`"
            />
          </div>

          <div>
            <label
              for="cloneDescription"
              class="block text-sm font-medium text-gray-700"
            >
              Description
            </label>
            <textarea
              id="cloneDescription"
              v-model="form.description"
              rows="3"
              class="mt-1 input"
              :placeholder="scenario.description"
            ></textarea>
          </div>

          <div class="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              @click="$emit('close')"
              class="btn btn-secondary"
            >
              Cancel
            </button>
            <button type="submit" :disabled="loading" class="btn btn-primary">
              <span
                v-if="loading"
                class="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"
              ></span>
              {{ loading ? "Cloning..." : "Clone Scenario" }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive } from "vue";
import { XMarkIcon } from "@heroicons/vue/24/outline";
import { useScenariosStore } from "../stores/scenarios";

const props = defineProps(["scenario"]);
const emit = defineEmits(["close", "clone"]);

const store = useScenariosStore();
const { loading } = store;

const form = reactive({
  name: `${props.scenario.name} (Copy)`,
  description: props.scenario.description || "",
});

function handleSubmit() {
  emit("clone", form);
}
</script>
