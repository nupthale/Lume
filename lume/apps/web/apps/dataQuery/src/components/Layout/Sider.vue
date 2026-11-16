<script setup lang="ts">
  import { storeToRefs } from 'pinia';
  import { MessageSquareMore } from 'lucide-vue-next';
  import { useRouter, useRoute } from 'vue-router'; // 导入 useRouter
  import { Skeleton } from 'ant-design-vue';

  import { RecycleScroller } from 'vue3-virtual-scroller';
  import 'vue3-virtual-scroller/dist/vue3-virtual-scroller.css'

  import Icon from '@/components/Icon/index.vue';

  import { useAppStore } from '@/store/modules/app';
  import { usePermissionStore } from '@/store/modules/permission.ts';
  import { useConversations } from '@/store/queries/agent/useConversations';
  import { useUpdateConversationList } from '@/store/subscriptions/agent/observers/useUpdateConversationList';
  import { useAgentStore } from '@/store/ui-states/agent/index';

  import Logo from './Logo.vue';

  import { isYiban } from '@/utils/yiban';
  import Profile from './Profile.vue';
  import Conversation from './Conversation.vue';

  const router = useRouter(); // 使用 useRouter
  const route = useRoute();

  const appStore = useAppStore();
  const { sidebarCollapse } = storeToRefs(appStore);

  const permissionStore = usePermissionStore();
  const { backMenuList } = storeToRefs(permissionStore);

  const { conversations, isLoading, refetch } = useConversations();

  const agentStore = useAgentStore();

  useUpdateConversationList({
    refetch,
  });

  const handleHomeClick = () => {
    agentStore.setCrtChat(null);

    router.push(`/`);
  }

  const handleAnalyzeClick = () => {
    agentStore.setCrtChat(null);

    router.push(`/analyze`);
  }

  const handleChatClick = (conversation) => {
    agentStore.setCrtChat({
      id: conversation.AppConversationID,
      name: conversation.ConversationName || '',
    });

    router.push(`/chat/${conversation.AgentType}/${conversation.AppConversationID}`);
  }

  const handleReportClick = () => {
    agentStore.setCrtChat(null);

    router.push(`/reports`);
  }

  const hasAuth = (key: string) => {
    return backMenuList.value?.some((item) => item.path === key);
  }
</script>

<template>
  <div :class="['sider', 'select-none', sidebarCollapse ? 'hide' : 'show']">
    <div class="flex flex-col flex-1 overflow-y-auto">
      <Logo />

      <div class="flex flex-col gap-1.5 pt-4 overflow-hidden">
        <div :class="['menu', 'mx-4', '!px-2', route.name === 'Home' ? 'menu--active' : '']" @click="handleHomeClick" v-if="hasAuth('/index')">
          <div class="flex items-center whitespace-nowrap overflow-hidden">
              <!-- <div class="homeIcon mr-2 flex-shrink-0"></div> -->
              <Icon icon="whiteboard_outlined" size="22px" class="mr-2" />
              开始问数
          </div>
        </div>

        <!-- <div :class="['menu', 'mx-4', '!px-2', route.name === 'Analyze' ? 'menu--active' : '']" @click="handleAnalyzeClick" v-if="hasAuth('/analyze')">
          <div class="flex items-center whitespace-nowrap overflow-hidden">
              <Icon icon="interview-space_filled" size="22px" class="mr-2" />
              经营决策
          </div>
        </div> -->

        <div :class="['menu', 'mx-4', '!px-2', route.name === 'Reports' ? 'menu--active' : '']" @click="handleReportClick" v-if="hasAuth('/reports')">
          <div class="flex items-center whitespace-nowrap overflow-hidden">
              <Icon icon="minutes-logo_filled" size="22px" class="mr-2" />
              撰写报告
              <span class="superTag inline-flex items-center rounded-full text-[11px] px-1.5 leading-[18px] super-aide-LztmSk font-medium text-[#1F2329] ml-2">
                <svg width="11" class="mr-0.5" height="10" viewBox="0 0 11 10" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5.72209 0.21582C5.86826 0.21582 5.98285 0.330016 5.99365 0.476693C6.02044 0.841677 6.08689 1.19452 6.18908 1.53034L6.33483 1.94034C6.76756 3.00001 7.56964 3.8565 8.59134 4.35036L8.98774 4.51981L9.11757 4.56573C9.42298 4.66903 9.74366 4.74186 10.0764 4.78068C10.1865 4.79353 10.2677 4.88688 10.2618 4.9997L10.2556 5.04115C10.2326 5.13466 10.1509 5.20748 10.0534 5.21872L10.0014 5.22522C9.6349 5.2714 9.27863 5.35749 8.93744 5.47959L8.52328 5.64904C7.44981 6.1429 6.55796 6.99939 6.01417 8.05906L5.82544 8.46906C5.68804 8.80489 5.58462 9.15773 5.51957 9.52271L5.50539 9.57594C5.46167 9.69613 5.34861 9.78358 5.22066 9.78358L5.16763 9.7783C5.06466 9.75788 4.98439 9.67901 4.9577 9.57594L4.9491 9.52271C4.92231 9.15773 4.85586 8.80489 4.75366 8.46906L4.60792 8.05906C4.17519 6.99939 3.37311 6.1429 2.35141 5.64904L1.95501 5.47959C1.65409 5.3677 1.33737 5.28588 1.00823 5.23741L0.86639 5.21872C0.756256 5.20587 0.675015 5.11253 0.680928 4.9997C0.686841 4.88688 0.777866 4.79353 0.889346 4.78068C1.22611 4.74186 1.55443 4.66903 1.87066 4.56573L2.00531 4.51981L2.41947 4.35036C3.49294 3.8565 4.38479 3.00001 4.92858 1.94034L5.11731 1.53034C5.2547 1.19452 5.35813 0.841677 5.42318 0.476693C5.44935 0.330017 5.57591 0.215821 5.72209 0.21582Z" fill="#2B2F36"></path></svg>
                超级助手
              </span>
          </div>
        </div>

        <div class="menu-group flex flex-col flex-1 pt-2 pb-4 pl-4 pr-1 overflow-hidden">
            <div class="menu-groupTitle flex items-center gap-1.5 mb-2 flex-nowrap whitespace-nowrap flex-shrink-0">
              <MessageSquareMore :size="14" class="flex-shrink-0" />
              最近会话
            </div>

            <div v-if="isLoading">
              <Skeleton class="skeletonItem" :paragraph="false" />
              <Skeleton class="skeletonItem" :paragraph="false" />
              <Skeleton class="skeletonItem" :paragraph="false" />
              <Skeleton class="skeletonItem" :paragraph="false" />
              <Skeleton class="skeletonItem" :paragraph="false" />
            </div>

            <div class="pl-2" v-else-if="!conversations.length">
              暂无
            </div>

            <RecycleScroller
              v-else
              class="scroller flex-1 h-full"
              :items="conversations || []"
              :item-size="40"
              key-field="AppConversationID"
              v-slot='{ item: conversation }'
            >
              <Conversation
                :conversation="conversation"
                @click="() => handleChatClick(conversation)"
                @update="() => refetch()"
              />
            </RecycleScroller>
        </div>
      </div>
    </div>

    <div :class="['profile', sidebarCollapse ? 'hide' : 'show']" v-if="!isYiban">
      <Profile />
      <div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
.sider {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  width: 280px;
  min-width: 280px;
  max-width: 280px;
  height: 100%;

  background: var(--home-sider-bg);
  transition: all .3s ease;
}

.sider.hide {
  width: 0;
  min-width: 0;
  max-width: 0;
}

.menu {
  cursor: pointer!important;
  border-radius: 8px;
  height: 32px;
  line-height: 32px;
  padding: 0 16px;
}

.menu:hover {
  background: var(--fill-color);
}

.menu--active {
  font-weight: 500;
  background: var(--B100);
}

.profile {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 90%;
  height: 62px;
  line-height: 32px;
  border-radius: 8px;
  margin: 0 0 6px 5%;
}

.scroller {
  height: 100%;

  &::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
    border-radius: 3px;
  }

  &::-webkit-scrollbar-thumb {
    background: #e0e0e0;
    border-radius: 4px;
  }

  &::-webkit-scrollbar-thumb:hover {
    background: #bdbdbd;
  }
}
</style>

<style scoped>
.profile :deep(.ant-btn-text) {
  display: flex;
  flex: 1;
  overflow: hidden;
  padding: 6px;
  margin: 4px;
}

.homeIcon {
  width: 24px;
  height: 24px;
  background: url('@/assets/homeIcon.svg');
}

.menu-groupTitle {
  font-weight: 400;
  font-size: 12px;
  color: var(--light-text-color);
  padding-left: 8px;
}

.chat {
  height: 38px;
  line-height: 38px;
}

.chatIcon {
  color: var(--light-text-color);
}

.superTag {
  background: linear-gradient(85.83deg,#f6f0ff 4.47%,#ddf2f4 68.99%,#e8f4dd 101.02%);
  padding: 0 6px;
}

.skeletonItem {
  margin-bottom: 8px;
}

.skeletonItem :deep(h3) {
  height: 26px!important;
}
</style>