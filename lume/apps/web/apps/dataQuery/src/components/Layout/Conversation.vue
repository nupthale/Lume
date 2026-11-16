<script setup lang="ts">
import { PropType } from 'vue';
import { Menu, Dropdown, Modal } from 'ant-design-vue';
import { TextButton } from '@zsfe/zsui';
import { MessageCircleMore, Ellipsis, Trash2 } from 'lucide-vue-next';
import { useRoute, useRouter } from 'vue-router';

import { postDeleteConversation } from '@/api/agent/index.ts';
import { useConversationActions } from './useConversationActions';

const MenuItem = Menu.Item;

const props = defineProps({
    conversation: Object as PropType<{
        AppConversationID: string;
        ConversationName: string;
        AgentType: string;
    }>
});

const emit = defineEmits(['update']);

const router = useRouter();
const route = useRoute();

const {
    hoverId,
    actionDropdownVisible,
    handleConversationMouseEnter,
    handleConversationMouseLeave,
    handleConversationMenuMouseEnter,
    handleConversationMenuMouseLeave,

    handleConversationActionMouseClick,
} = useConversationActions();

const handleDeleteConversation = async (conversationId, agentType) => {
    Modal.confirm({
        okButtonProps: {
            danger: true,
        },
        okText: '删除',
        title: '确定删除对话？',
        content: '删除后，聊天记录将不可恢复。',
        centered: true,
        onOk: async () => {
            try {
                actionDropdownVisible.value = false;
                hoverId.value = '';

                await postDeleteConversation({
                    AppConversationID: conversationId,
                    AgentType: agentType,
                });

                router.replace(`/`);

                emit('update');
            } catch(e) {
                console.error(e);
            }
        }
    });
}
</script>

<template>
<div 
    :class="['menu', '!px-2', 'chat', 'truncate', 'flex', 'items-center', 'gap-1.5', 'group', route.params?.id === conversation?.AppConversationID ? 'menu--active' : '']" 
    @mouseenter="() => handleConversationMouseEnter(conversation?.AppConversationID)"
    @mouseleave="handleConversationMouseLeave"
    >
    <MessageCircleMore :size="14" class="chatIcon flex-shrink-0" />
    <div class="flex-1 truncate">{{ conversation?.ConversationName || '-'}}</div>

    <Dropdown placement='bottomLeft' :open="actionDropdownVisible">
        <template #overlay>
            <div class="acitonsMenuContainer">
                <Menu 
                    @mouseenter="handleConversationMenuMouseEnter" 
                    @mouseleave="handleConversationMenuMouseLeave"
                    @click="() => handleDeleteConversation(conversation?.AppConversationID, conversation?.AgentType)"
                >
                    <MenuItem key={type}>
                        <div class="flex items-center gap-2" style="color: var(--R500)">
                        <Trash2 :size="16" />
                        删除
                        </div>
                    </MenuItem>
                </Menu>
            </div>
        </template>
        <TextButton
            class="flex-shrink-0" 
            v-show="hoverId === conversation?.AppConversationID"
            @click.stop="handleConversationActionMouseClick"
        >
            <Ellipsis :size="16" />
        </TextButton>
    </Dropdown>
</div>
</template>

<style scoped>
.acitonsMenuContainer {
  width: 140px;
  border: 1px solid var(--float-border-color);
  box-shadow: var(--overlay-shadow);
  border-radius: 6px;
}
</style>