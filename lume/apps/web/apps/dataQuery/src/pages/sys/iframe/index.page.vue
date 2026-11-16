<template>
  <div>
    <Spin :spinning="loading" size="large">
      <iframe :src="frameSrc" ref="frameRef"></iframe>
    </Spin>
  </div>
</template>
<script lang="ts" setup>
  import { ref } from 'vue';
  import { Spin } from 'ant-design-vue';

  defineProps({
    frameSrc: String,
  });

  const loading = ref(true);
  // @ts-ignore
  const frameRef = ref<HTMLFrameElement>();
</script>
<style lang="less" scoped>
  @prefix-cls: ~'@{namespace}-iframe-page';

  .@{prefix-cls} {
    .ant-spin-nested-loading {
      position: relative;
      height: 100%;

      .ant-spin-container {
        width: 100%;
        height: 100%;
        padding: 10px;
      }
    }

    &__mask {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
    }

    &__main {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background-color: @component-background;
      border: 0;
      box-sizing: border-box;
    }
  }
</style>
