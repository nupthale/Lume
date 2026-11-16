<script setup lang="ts">
import { onMounted } from 'vue';
import { RouterView } from 'vue-router';
import { useUserStore } from '@/store/modules/user';

import Sider from './Sider.vue';

const userStore = useUserStore();

onMounted(() => {
  userStore.afterLoginAction();
});
</script>

<template>
  <div class="main">
    <Sider />

    <div class="content">
      <slot />
      <RouterView />
    </div>
  </div>
</template>

<style scoped>
.main {
  display: flex;
  height: 100%;
  box-sizing: border-box;

  overflow: hidden;
}

.content {
  display: flex;
  flex-direction: column;
  position: relative;

  margin: 0 auto;
  flex: 1;
  overflow: hidden;
}
</style>