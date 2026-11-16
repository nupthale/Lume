<script lang="tsx">
import { defineComponent, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { EllipsisText } from '@zsfe/zsui';
import { storeToRefs } from 'pinia';

import { useAppStore } from '@/store/modules/app';
import { useAgentStore } from '@/store/ui-states/agent';

import ChatPanel from './modules/ChatPanel.vue';
import { AgentTypeEnum } from '@/types/agent.ts';

export default defineComponent({
    setup() {
        const route = useRoute();

        const appStore = useAppStore();
        const { sidebarCollapse } = storeToRefs(appStore);

        const conversationId = ref(route.params.id as string);
        const agentType = ref(route.params.agentType as AgentTypeEnum);

        const agentStore = useAgentStore();
        const { crtChat } = storeToRefs(agentStore);

        // Watch route changes and update conversationId
        watch(
            () => [route.params.id, route.params.agentType] as [string, AgentTypeEnum],
            ([newId, newType]) => {
                conversationId.value = newId;
                agentType.value = newType;
            }
        );

        return () => (
            <div class="wrap h-full overflow-hidden flex flex-col">
                <div class="wrapInner rounded-xl flex flex-col h-full">
                    <div class="px-6 py-3 flex items-stretch justify-between absolute left-0 right-0 top-0 z-10 rounded-t-xl">
                        <div class={[sidebarCollapse.value ? 'pl-8' : 'pl-0', 'max-w-xs overflow-hidden']}>
                            <EllipsisText title={crtChat.value?.name?.trim() || '新会话'} >
                                <div>{crtChat.value?.name?.trim() || '新会话'}</div>
                            </EllipsisText>
                            <div class="lightText">相关数据仅用于内部统计参考，不能用于监管报送</div>
                        </div>
                    </div>
                    <div class="h-full pt-[58px] flex flex-col overflow-hidden">
                        <ChatPanel 
                            key={conversationId.value} 
                            conversationId={conversationId.value}
                            agentType={agentType.value}
                        />
                    </div>
                </div>
                
            </div>
        );
    }
});
</script>

<style scoped>
.wrap {
    padding: 8px 8px 8px 0;

    /* background: linear-gradient(90deg, var(--home-sider-bg), #eaf0f5); */
    background: var(--home-sider-bg);
    /* backdrop-filter: var(--fullscreen-modal-header-filter); */
}

.wrapInner {
    height: 100%;
    position: relative;
    background-image: url(@/assets/homebg2.png);
    /* background: var(--body-bg);
    backdrop-filter: var(--fullscreen-modal-header-filter); */
}

:root[data-theme="dark"] .wrapInner {
    background: var(--chat-messages-bg);
}
</style>