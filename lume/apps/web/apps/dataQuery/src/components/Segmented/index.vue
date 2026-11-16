<template>
    <div :class="['segmentedWrap', 'inline-flex', size === 'small' ? 'small' : '']">
      <div 
        v-for="(option, index) in options" 
        :key="option.value"
        @click="selectOption(option.value)"
        :class="[
          'segmentItem transition-all duration-200 ease-in-out cursor-pointer',
          'focus:outline-none',
          selectedValue === option.value
            ? 'active'
            : '',
        ]"
      >
        <slot name="label" :label="option.label" :index="index" v-if="$slots['label']" />
        <span v-else>{{ option.label }}</span>
      </div>
    </div>
  </template>
  
  <script lang="ts">
  import { PropType } from 'vue';

  export default {
    name: 'Segmented',
    props: {
      size: String,
      options: {
        type: Array as PropType<{ label: string, value: string }[]>,
        required: true
      },
      value: {
        type: [String, Number],
        default: null
      }
    },
    data() {
      return {
        selectedValue: this.value
      }
    },
    methods: {
      selectOption(value) {
        this.selectedValue = value
        this.$emit('change', value)
      }
    },
    watch: {
      value(newValue) {
        this.selectedValue = newValue
      }
    }
  }
  </script>

<style scoped>
.segmentedWrap {
    height: 32px;
    border-radius: 6px;
    border: 1px solid var(--N400);
    background: var(--body-bg);
    column-gap: 4px;
    padding: 3px;
}

.segmentedWrap.small {
  height: 26px;
  font-size: 12px;
}

.segmentItem {
    display: inline-flex;
    align-items: center;
    padding: 1px 8px;
    border-radius: 4px;
}

.segmentItem:hover {
    background: #1f232914;
}

.segmentItem.active {
    background: #3370ff14;
    color: #3370ff;
}

.segmentItem.active:hover {
    background: #3370ff33;
    color: #3370ff;
}
</style>