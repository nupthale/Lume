<script setup lang="ts">
import { PageEnum } from '@/enums/pageEnum';
import Empty from '@/components/Empty/index.vue';
import { Button } from 'ant-design-vue';
import { router } from '@/router/index';

const img404 = new URL('@/assets/404.image', import.meta.url).href;

const handleGoIndex = () => {
  router.push(PageEnum.BASE_HOME);
}
</script>

<template>
  <div class="empty-page">
    <Empty
        :illustration="img404"
        message="抱歉，您要查找的页面不存在"
    >
      <template #buttons>
        <Button type="primary" @click="handleGoIndex">返回首页</Button>
      </template>
    </Empty>
  </div>
</template>

<style scoped>
.empty-page {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}
</style>