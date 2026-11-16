import { useSubscription } from '@vueuse/rxjs'
import { message } from 'ant-design-vue';

import { of, tap, catchError, switchMap } from 'rxjs';
import { useRouter } from 'vue-router';

import { AgentTypeEnum } from '@/types/agent';
import { postCreateConversation, postUpdateConversation, postSyncRunAppWorkflow } from '@/api/agent/index';
import { useAgentStore } from '@/store/ui-states/agent/index';

import { createConversation$, updateConversationList$ } from '../observables/index';

// 如果message为空， 更新会话名
const updateChatName = async (conversationId: string, query: string, agentType: AgentTypeEnum) => {
    try {
        // 精简query后更新
        const result = await postSyncRunAppWorkflow({
            inputData: `{"query": "${query}"}`
        });
        const output = JSON.parse(result.data?.output);
        const shortName = output.output;

        await postUpdateConversation({
            AppConversationID: conversationId,
            ConversationName: shortName,
            AgentType: agentType,
        });

        updateConversationList$.next({});
    } catch(e) {
        console.error(e);
    }
}

export const useCreateConversation = () => {
    const agentStore = useAgentStore();
    const router = useRouter();

    useSubscription(
        createConversation$.pipe(
            switchMap(async ({ query, agentType }) => {
                try {
                    let result = await postCreateConversation({
                        ConversationName: query,
                        AgentType: agentType,
                    });

                    const conversation = result?.data?.Conversation;

                    // 更新名字
                    await postUpdateConversation({
                        AppConversationID: conversation.AppConversationID,
                        ConversationName: query,
                        AgentType: agentType,
                    });
        
                    return {
                        result,
                        query,
                        agentType,
                    };
                } catch(e) {
                    console.error(e);

                    return {};
                }
            }),
            tap(({ result, query, agentType }) => {
                if (!result) return;

                updateConversationList$.next({});
            
                const conversation = result?.data?.Conversation;
        
                agentStore.setCrtChat({
                    id: conversation.AppConversationID,
                    name: query || '',
                    agentType,
                });
        
                updateChatName(conversation.AppConversationID, query, agentType);

                agentStore.setInitQuestion(query);
        
                router.push(`/chat/${agentType}/${conversation.AppConversationID}`);
            }),
            catchError((e) => {
                message.error('加载失败，请重试');
                return of(e);
            }),
        ).subscribe()
    );
}