<script setup lang="ts">
import { computed } from 'vue';
import { isArray } from 'lodash-es';
import { storeToRefs } from 'pinia';
import { RouterView } from 'vue-router';
import { ConfigProvider, StyleProvider, theme } from 'ant-design-vue';
import locale from 'ant-design-vue/es/locale/zh_CN';
import { VueQueryDevtools } from '@tanstack/vue-query-devtools'
 
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';

import { useThemeStore } from '@/store/ui-states/theme';

dayjs.locale("zh-cn");

const themeStore = useThemeStore();
const { isDark } = storeToRefs(themeStore);

  // 获取 ant-design-vue 的主题配置
const themeConfig = computed(() => ({
    algorithm: isDark.value ? theme.darkAlgorithm : theme.defaultAlgorithm
}));

const transformCellText = ({ text }) => {
  
  if (isArray(text)) {
    return text?.[0] ?? '-';
  }

  return text ?? '-';
};
</script>

<template>
  <StyleProvider hashPriority="high">
     <ConfigProvider :theme="themeConfig" :locale="locale" :transformCellText="transformCellText">
      <RouterView />

    </ConfigProvider>
  </StyleProvider>
  <VueQueryDevtools />
</template>

<style scoped>
</style>
