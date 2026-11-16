<script setup lang="ts">
  import { LottieAnimation } from 'lottie-web-vue';
  import loadingAnimationJson from '@/assets/loading3.json';

  defineProps({
    message: String,
  });
</script>

<template>
  <div class="loading-wrapper">
    <LottieAnimation :animation-data="loadingAnimationJson" :loop="true"></LottieAnimation>
    <div v-if="message" class="loading-message">{{ message }}</div>
  </div>
</template>

<style scoped>
  .loading-wrapper {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    margin: auto;

    width: 128px;
    height: 68px;
    z-index: 9;
  }

  .loading-message {
    max-width: 248px;
    margin-top: 16px;

    color: #646a73;
    font-size: 14px;
    font-weight: 400;
    line-height: 22px;
    text-align: center;
  }
</style>
