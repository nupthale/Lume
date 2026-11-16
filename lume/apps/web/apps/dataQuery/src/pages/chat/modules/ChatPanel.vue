<script lang="tsx">
import { defineComponent, toRef, PropType } from 'vue';
import { storeToRefs } from 'pinia';

import { useChat } from '@/hooks/useChat';
import { useAgentStore } from '@/store/ui-states/agent';
import Loading from '@/components/Loading/index.vue';
import Empty from '@/components/Empty/index.vue';
import imgSearchFailed from '@/assets/images/searchFailed.png';

import Messages from '@/components/Messages/index.vue';
import IdxChatEditor from '@/components/IdxChatEditor/index.vue';
import LumePermissionDialog from '@/components/LumePermissionDialog/index.vue';
import { AgentTypeEnum } from '@/types/agent';

export default defineComponent({
    props: {
        conversationId: String,
        agentType: {
            type: String as PropType<AgentTypeEnum>,
            default: AgentTypeEnum.DATA_QUERY,
        }
    },
    setup(props) {
        const conversationId = toRef(props, 'conversationId');

        const agentStore = useAgentStore();
        const { initQuestion } = storeToRefs(agentStore);

        const {
            messages, 
            chatLoading,
            chatError,
            answerLoading, 
            editorRef, 
            handleSubmitChat, 
            handleStopChat,
            handleRegenerate,
            handleFeedback,
        } = useChat(
            initQuestion,
            () => {
                // 清空初始问题
                agentStore.setInitQuestion('');
            },
            conversationId,
            props.agentType!,
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

                    <div class="flex-1 overflow-hidden">
                        <Messages 
                            showFooter={true}
                            messages={messages.value} 
                            answerLoading={answerLoading.value}
                            onRegenerate={handleRegenerate}
                            onFeedback={handleFeedback}
                            onSubmitChat={(query) => handleSubmitChat(query)}
                        />
                    </div>

                    <div class="w-full flex flex-col justify-center items-center px-8 pb-2 mb-5 mt-10">
                        <IdxChatEditor 
                            class="w-full max-w-[740px]" 
                            ref={editorRef}
                            agentType={props.agentType}
                            answerLoading={answerLoading.value}
                            onSubmit={() => handleSubmitChat()}
                            onStop={() => handleStopChat()}
                        />
                    </div>
                </>
            );
        }

        return () => renderMain();
    }
});
</script>

<style scoped>
</style>