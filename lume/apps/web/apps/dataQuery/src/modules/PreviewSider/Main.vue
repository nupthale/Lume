<script lang="tsx">
import { defineComponent, toRef } from 'vue';
import { EllipsisText } from '@zsfe/zsui';

import { useChat } from '@/hooks/useChat';
import { AgentTypeEnum } from '@/types/agent';
import Loading from '@/components/Loading/index.vue';
import Empty from '@/components/Empty/index.vue';
import imgSearchFailed from '@/assets/images/searchFailed.png';

import Messages from '@/components/Messages/index.vue';
import LumePermissionDialog from '@/components/LumePermissionDialog/index.vue';

export default defineComponent({
    props: {
        initQuestion: String,
        conversationId: String,
    },
    setup(props) {
        const initQuestion = toRef(props, 'initQuestion');
        const conversationId = toRef(props, 'conversationId');

        const {
            messages, 
            chatLoading,
            chatError,
            answerLoading,  
            handleSubmitChat, 
            handleRegenerate,
            handleFeedback,
        } = useChat(
            initQuestion,
            () => {},
            conversationId,
            AgentTypeEnum.DATA_QUERY,
            true,
        );

        const renderMain = () => {
            if (chatError.value) {
                return (
                    <div class="h-full flex items-center justify-center">
                        <Empty illustration={imgSearchFailed} message="查询失败，请重试" />
                    </div>
                );
            }

            if (chatLoading.value) {
                return (
                    <div class="absolute top-0 left-0 right-0 bottom-0 flex items-center justify-center">
                        <Loading style={{ fontSize: '68px', position: 'relative' }} />
                    </div>
                );
            }

            return (
                <>
                    {/* lume daemon 权限审批（新增能力，自包含组件） */}
                    <LumePermissionDialog conversationId={conversationId.value} />

                    <Messages
                        showFooter={false}
                        messages={messages.value} 
                        answerLoading={answerLoading.value}
                        onRegenerate={handleRegenerate}
                        onFeedback={handleFeedback}
                        onSubmitChat={(query) => handleSubmitChat(query)}
                    />  
                </>
            );
        }

        return () => (
            <div class="wrap h-full overflow-hidden flex flex-col">
                <div class="wrapInner flex flex-col h-full">
                    <div class="px-6 py-3 flex items-stretch justify-between absolute left-0 right-0 top-0 z-1 rounded-t-xl">
                        <div class={['max-w-xs overflow-hidden']}>
                            <EllipsisText title={initQuestion.value || '新会话'} >
                                <div>{initQuestion.value}</div>
                            </EllipsisText>
                            <div class="lightText">相关数据仅用于内部统计参考，不能用于监管报送</div>
                        </div>
                    </div>
                    <div class="h-full pt-[58px] px-[21px] flex flex-col overflow-hidden">
                        {renderMain()}
                    </div>
                </div>
            </div>
            
        );
    }
});
</script>

<style scoped>
.wrap {
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