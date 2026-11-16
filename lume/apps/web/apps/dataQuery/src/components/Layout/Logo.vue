<script setup lang="ts">
    import { RouterLink } from 'vue-router';
    import { TextButton } from '@zsfe/zsui';
    import { Tooltip } from 'ant-design-vue';
    import { storeToRefs } from 'pinia';

    import { useAppStore } from '@/store/modules/app';
    import Icon from '@/components/Icon/index.vue';

    import { PageEnum } from '@/enums/pageEnum';

    const appStore = useAppStore();
    const { sidebarCollapse } = storeToRefs(appStore);
</script>

<template>
    <div class="flex flex-col">
      <div :class="['wrapper']">
        <RouterLink :to="PageEnum.BASE_HOME" class="logo">
        </RouterLink>

        <Tooltip title="收起侧边栏" v-if="!sidebarCollapse">
          <TextButton class="foldIcon" @click="appStore.setSidebarCollapse(true)">
            <Icon icon="side-expand_outlined" size="20px" />
          </TextButton>
        </Tooltip>
      </div>

      <div class="fixed top-[15px] left-4 z-20 flex items-center" style="height: 30px;" v-if="sidebarCollapse">
        <Tooltip title="展开侧边栏" placement="right">
          <TextButton @click="appStore.setSidebarCollapse(false)">
            <Icon icon="side-fold_outlined" size="20px" />
          </TextButton>
        </Tooltip>
      </div>
    </div>
</template>

<style scoped lang="less">
  .wrapper {
    position: relative;
    display: flex;
    align-items: center;
    font-size: 14px;
    width: 240px;
    padding: 14px 0 0 18px;
  }

  .wrapper.small {
    width: 50px!important;
    padding-left: 16px!important;
  }

  .wrapper.smallScreen {
    width: 180px;
    padding: 14px 0 0 21px;
  }

  .wrapper.smallScreen .foldIcon {
    left: 228px;
  }

  .foldIcon {
    position: absolute;
    left: 236px;
    top: 21px;
    cursor: pointer;
  }

  .logo {
    display: block;
    width: 240px;
    height: 37px;

    background: url('@/assets/logo.png');
    background-size: auto 69px;
    background-repeat: no-repeat;
    background-position: 0 5px;
  }

  :root[data-theme="dark"] .logo {
    background-position: 0 -36px;
  }
</style>