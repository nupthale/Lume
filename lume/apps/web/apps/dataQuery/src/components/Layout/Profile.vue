<script setup lang="ts">
import { computed } from 'vue';
import {Dropdown, Tooltip } from "ant-design-vue";
import { storeToRefs } from 'pinia';
import { UserAvatar, TextButton } from '@zsfe/zsui';
import { useDark, useToggle } from '@vueuse/core';
import { ArrowLeftRight } from 'lucide-vue-next';

import { useUserStore } from '@/store/modules/user';

import { isYiban } from '@/utils/yiban';

const isDark = useDark({
  attribute: 'data-theme',
});
const toggleDark = useToggle(isDark);

const userStore = useUserStore();
const { userInfo } = storeToRefs(userStore);

const username = computed(() => userInfo?.value?.realname || '');
const email = computed(() => userInfo?.value?.email || '');

const handleLogout = () => userStore.logout();
</script>

<template>
  <Dropdown>
    <TextButton class="userwrap">
      <div class="flex items-center w-full">
        <UserAvatar :username="username" :showText="false" />
        <div class="text-left ml-2 flex-1 truncate">
          {{ username || '-' }}
          <div class="-mt-0.5 lightText truncate">
            {{ email || '-' }}
          </div>
        </div>
      </div>
      
      
    </TextButton>
    <template #overlay>
      <div class="profile">
        <div class="profile-user">{{username}}</div>

        <ul class="profile-menus" :class="[isYiban ? 'profile-menus--yiban' : '']">
          <li class="profile-menu">
            <span>外观</span>
            <span class="profile-text">
              <Tooltip :title="isDark ? '浅色' : '深色'">
                <TextButton @click="() => toggleDark()">
                  <div class="flex items-center gap-1">
                    <ArrowLeftRight :size="14" />
                    <span v-if="isDark">浅色</span>
                    <span v-else>深色</span>
                  </div>
                </TextButton>
              </Tooltip>
            </span>
          </li>
          <li class="profile-menu">
            <span>语言</span>
            <span class="profile-text">简体中文</span>
          </li>
          <li class="profile-menu">
            <span>时区</span>
            <span class="profile-text">GMT+08:00</span>
          </li>
        </ul>

        <div class="profile-logout-container" v-if="!isYiban">
          <div class="profile-logout" @click="handleLogout">
            退出登录
          </div>
        </div>
      </div>

    </template>
  </Dropdown>
</template>

<style scoped>
.user :deep(.zsui-user__avatar) {
  background: radial-gradient(circle at 18.7% 37.8%, rgba(255, 139, 7, 0.6) 0%, rgb(255, 139, 7) 90%) rgba(255, 255, 255, 0.9) !important;
}

.user :deep(.ant-avatar-string) {
  line-height: 21px!important;
}

.userwrap :deep(.zsui-user) {
  display: flex;
}
</style>

<style scoped lang="less">
.profile {
  min-width: 200px;
  padding: 2px 0;
  background: var(--body-bg);
  border-radius: 6px;
  border: 1px solid var(--float-border-color);
}

.profile-user {
  padding: 10px 12px;
  font-weight: 500;
  line-height: 22px;
  border-bottom: 1px solid var(--float-border-color);
}

.profile-menus {
  margin: 0;
  padding: 2px 0;
  border-bottom: 1px solid var(--float-border-color);
}

.profile-menus--yiban {
  border-bottom: none!important;
}

.profile-menu, .profile-logout {
  display: flex;
  align-items: center;
  justify-content: space-between;

  width: calc(100% - 6px);
  height: 34px;
  padding: 4px 8px;
  margin: 1px 3px;
  box-sizing: border-box;
  list-style: none;
  border-radius: 4px;

  &:hover {
    background: #1f232914;
  }
}

.profile-logout-container {
  padding-top: 2px;
  cursor: pointer;
}

.profile-text {
  font-size: 12px;
  margin-left: 10px;
  color: rgb(100, 106, 115);
}
</style>