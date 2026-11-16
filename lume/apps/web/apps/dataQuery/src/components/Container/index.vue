<script setup lang="ts">
</script>

<template>
  <div class="container">
    <slot />
  </div>
</template>

<style scoped>
.container {
  width: 100%;
  max-width: none!important;
  box-shadow: rgba(31, 35, 41, 0.02) 0px 2px 20px 0px;
  border-radius: 8px;
  background-color: #fff;
}
</style>