<script setup lang="ts">
  defineProps({
    title: String,
  });
</script>

<template>
  <div class="page-header">
    <div class="header-left">
      <div v-if="$slots.left">
        <slot name="left" />
      </div>
      <span class="text-2xl font-medium" v-else>{{ title }}</span>
    </div>
    <div class="header-right">
      <slot name="right"></slot>
    </div>
  </div>
</template>

<style scoped>
  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 28px;
    margin-bottom: 8px;
  }

  .header-right {
    margin-right: 25px;
  }
</style>
