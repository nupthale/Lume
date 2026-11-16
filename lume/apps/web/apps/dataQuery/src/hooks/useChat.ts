import { ref, Ref, onUnmounted, computed, onMounted } from 'vue';
import { nanoid } from 'nanoid';
import { useSubscription } from '@vueuse/rxjs';
import { tap, concatMap, delay } from 'rxjs/operators';
import { Subject, of } from 'rxjs';
import { storeToRefs } from 'pinia';

import { useChatsStore } from '@/store/ui-states/agent/chat';
import { MessageType, MessageRoleEnum, MessageLikeEnum } from '@/components/Messages/interface';
import { reachEnd$ } from '@/components/Messages/event';

import {
    postGetConversationMessages,
    postMessageFeedback,
    postGetSuggestedQuestions,
} from '@/api/agent/index';
import { AgentTypeEnum } from '@/types/agent';
import { interrupt, onEvent, sendMessage, hasLumeBridge } from '@/core/lume/client';
import { DaemonEventMapper } from '@/core/lume/protocol';

import { sendUserMessage$ } from '@/store/subscriptions/agent/observables/index';


const message$ = new Subject<{
    event: any;
    tracing: any;
    answer: string[];
}>();

export const useChat = (
    initQuestion: Ref<string | undefined>,
    onClearInitQuestion: () => void,
    conversationId: Ref<string | undefined>,
    agentType: AgentTypeEnum,
    _isPreview: boolean = false,
) => {
    const editorRef = ref();
    const chatLoading = ref(false);
    const chatError = ref(null);

    const chatsStore = useChatsStore();
    const { chats } = storeToRefs(chatsStore);

    // daemon 事件流状态（替代原 SSE 局部闭包，单活动会话语义与原版一致）
    let answer: string[] = [];
    const tracing: any[] = [];
    const daemonMapper = new DaemonEventMapper();
    // 用户主动停止后，daemon 的收尾失败事件不再作为错误展示（对齐原版 abort 行为）
    let suppressTurnFailure = false;

    const messages = computed(() => {
        return chats.value[conversationId.value!]?.messages || [];
    });

    const answerLoading = computed(() => {
        return chats.value[conversationId.value!]?.answerLoading || false;
    });

    // 订阅 Electron daemon 事件流：daemon 事件 -> 原版事件格式 -> message$ 管道
    // 非 Electron 环境无 bridge，订阅降级为 no-op（发送时才报错，页面保持可打开）
    const stopListening = hasLumeBridge()
        ? onEvent((eventConversationId, event) => {
            if (!conversationId.value || eventConversationId !== conversationId.value) return;

            if (event.type === 'turn_completed' || event.type === 'turn_failed') {
                suppressTurnFailure = false;
            }

            // 用户主动中断的收尾失败：不展示错误，仅结束 loading
            if (event.type === 'turn_failed' && suppressTurnFailure) {
                message$.next({
                    event: { data: JSON.stringify({ event: 'message_end', id: '' }) },
                    tracing,
                    answer,
                });
                return;
            }

            const mappedEvents = daemonMapper.map(event);

            for (const data of mappedEvents) {
                message$.next({
                    event: { data: JSON.stringify(data) },
                    tracing,
                    answer,
                });
            }
        })
        : () => {};

    onUnmounted(() => {
        stopListening();
        handleStopChat();
    });

    useSubscription(
        sendUserMessage$.pipe(
            tap(({ message }) => {
                handleSubmitChat(message);
            })
        ).subscribe()
    );

    useSubscription(
        message$.pipe(
            concatMap((v) => of(v).pipe(
                // 200的话， 那个chart的config太慢了
                delay(0),
                tap(({ event, tracing, answer }) => {
                    console.log('Received event:', event);
    
                    try {
                        // Handle the case where data has "data: " prefix
                        let rawData = event.data;
                        
                        // Remove "data: " prefix if it exists
                        if (rawData.startsWith('data: ')) {
                            rawData = rawData.substring(6); // Remove "data: " (6 characters)
                        }
                        
                        const data = JSON.parse(rawData);
                        console.log('Parsed data:', data.event, data);
                
                        // Update messages with the current answer
                        const newMessages = [...(chats.value?.[conversationId.value!]?.messages || [])];
                        // Update the last AI message or add a new one
                        const lastMessage = newMessages[newMessages.length - 1];
    
                        switch(data.event) {
                            case 'tool_message':
                                tracing.push(data);
                                if (lastMessage && lastMessage.role === MessageRoleEnum.AI) {
                                    chatsStore.updateLastMessage(
                                        conversationId.value,
                                        {
                                            ...lastMessage,
                                            tracing,
                                        }
                                    )
                                }
    
                                break;
                            case 'message_start':
                            case 'message':
                                if (data.answer) {
                                    answer.push(data.answer);
                                }
                                
                                if (lastMessage && lastMessage.role === MessageRoleEnum.AI) {
                                    chatsStore.updateLastMessage(
                                        conversationId.value,
                                        {
                                            ...lastMessage,
                                            content: answer.join(''),
                                            tracing,
                                        }
                                    )
                                }
                                break;
                            case 'message_cost':
    
                                chatsStore.updateLastMessage(
                                    conversationId.value,
                                    {
                                        cost: {
                                            tokens: data.output_tokens,
                                            time: data.latency,
                                        },
                                    }
                                )
    
                                break;    
                            case 'message_end':
                                chatsStore.setAnswerLoading(conversationId.value, false);
    
                                updateSuggestQuestions(data.id);
                                break;
                            default: 
                                break;
                        }
                    } catch(e) {
                        console.error('Error parsing event data:', e);
                        console.error('Raw event data:', event.data);
                    }
                })
            )),
        ).subscribe()
    )
        
    const handleSubmitChat = async (initQuery?: string) => {
        try {
            let query = initQuery;
            if (!initQuery) {
                const doc = editorRef.value.getDoc();
                query = doc?.text || '';

                editorRef.value.clear();
            }

            if (!query) {
                return;
            }

            answer = [];
            tracing.length = 0;
            suppressTurnFailure = false;

            chatsStore.addMessage(conversationId.value, {
                id: nanoid(8),
                content: query,
                role: MessageRoleEnum.USER,
            });
            chatsStore.setAnswerLoading(conversationId.value, true);

            chatsStore.addMessage(
                conversationId.value,
                {
                    id: nanoid(8),
                    role: MessageRoleEnum.AI,
                    tracing,
                }
            );

            reachEnd$.next();

            // 经 Electron IPC 发送给本地 daemon，流式回答由 onEvent 事件流驱动 message$ 管道
            await sendMessage(conversationId.value!, query);
        } catch(e) {
            console.error(e);
            chatsStore.setAnswerLoading(conversationId.value, false);
        }
    }

    const handleStopChat = () => {
         if (hasLumeBridge()) {
             suppressTurnFailure = true;
             interrupt(conversationId.value!).catch((e) => {
                 suppressTurnFailure = false;
                 console.error(e);
             });
         }
         chatsStore.setAnswerLoading(conversationId.value, false);
    }

    const getMessages = async () => {
        try {
            chatLoading.value = true;

            const result = await postGetConversationMessages({
                AppConversationID: conversationId.value,
                Limit: 100,
                AgentType: agentType,
            });

            const resultMessages = result.data.Messages?.reverse() || [];
            let list: MessageType[] = [];

            const processingMessage = result.data.ProcessingMessage;

            for (let i = 0; i < resultMessages.length; i++) {
                const item = resultMessages[i];
                list.push({
                    id: item.QueryID,
                    content: item.Query,
                    role: MessageRoleEnum.USER,
                });

                if (item.AnswerInfo) {
                    let tracing = item.AnswerInfo.TracingJsonStr ? JSON.parse(item.AnswerInfo.TracingJsonStr) : [];

                    list.push({
                        id: item.AnswerInfo.MessageID,
                        content: item.AnswerInfo.Answer,
                        role: MessageRoleEnum.AI,
                        cost: {
                            tokens: item.AnswerInfo.TotalTokens,
                            time: item.AnswerInfo.Latency,
                        },
                        like: item.AnswerInfo.Like,
                        suggestQuestions: item.AnswerInfo.SuggestedQuestions || [],
                        tracing,
                    })
                }
            }

            chatsStore.setMessages(conversationId.value, list);

            // 如果有正在处理的， 则提交以下
            if (processingMessage) {
                handleSubmitChat(processingMessage.Query);
            }
        } catch(e) {
            chatError.value = e;
            console.error(e);
        } finally {
            chatLoading.value = false;
        }
    }

    const updateSuggestQuestions = async (messageId: string) => {
        try {
            const result = await postGetSuggestedQuestions({
                MessageID: messageId,
                AgentType: agentType,
            });

            if (result.status !== 200) {
                return;
            }

            const questions = result.data.SuggestedQuestions || [];

            chatsStore.updateMessage(conversationId.value, messageId, {
                suggestQuestions: questions,
            });
        } catch(e) {
            console.error(e);
        }
    }

    onMounted(async () => {
        if (initQuestion.value) {
            const query = initQuestion.value;

            onClearInitQuestion?.();

            await handleSubmitChat(query);
        } else {
            getMessages();
        }
    });

    const handleRegenerate = async (_messageId: string) => {
        try {
            // daemon 无按消息重生成接口：复用最后一条 user 消息重新发送
            const lastUserMessage = [...(messages.value || [])].reverse().find((message) => message.role === MessageRoleEnum.USER);
            if (!lastUserMessage) {
                return;
            }

            answer = [];
            tracing.length = 0;
            suppressTurnFailure = false;

            chatsStore.setAnswerLoading(conversationId.value, true);
            chatsStore.updateLastMessage(
                conversationId.value,
                {
                    tracing: [],
                    suggestQuestions: [],
                    content: '',
                }
            );

            reachEnd$.next();

            await sendMessage(conversationId.value!, lastUserMessage.content);
        } catch(e) {
            console.error(e);
            chatsStore.setAnswerLoading(conversationId.value, false);
        }
    };

    const handleFeedback = async (messageId: string, likeEnum: MessageLikeEnum) => {
        try {
            await postMessageFeedback({
                AppConversationID: conversationId.value,
                MessageID: messageId,
                LikeType: likeEnum,
                AgentType: agentType,
            });
        } catch(e) {
            console.error(e);
        }
    };

    return {
        messages,
        editorRef,

        chatLoading,
        chatError,

        answerLoading,
        handleSubmitChat,
        handleStopChat,

        handleRegenerate,
        handleFeedback,
    };
}