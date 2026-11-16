
import { defineStore } from 'pinia';

import { MessageType } from '@/components/Messages/interface';

interface State {
    chats: Record<string, {
        answerLoading: boolean;
        messages: MessageType[];
    }>;
}

export const useChatsStore = defineStore({
    id: 'chats-store',
    state: (): State => ({
       chats: {},
    }),
    getters: {},
    actions: {
        setAnswerLoading(conversationId, loading) {
            this.chats[conversationId] = this.chats[conversationId] || {};
            this.chats[conversationId].answerLoading = loading || false;
            
            // 重新赋值以触发响应式更新
            this.chats = { ...this.chats };
        },
        setMessages(conversationId, messages) {
            this.chats[conversationId] = this.chats[conversationId] || {};
            this.chats[conversationId].messages = [...(messages)];
            
            // 重新赋值以触发响应式更新
            this.chats = { ...this.chats };
        },
        addMessage(conversationId, message) {
            this.chats[conversationId] = this.chats[conversationId] || {};
            this.chats[conversationId].messages = this.chats[conversationId].messages || [];
            this.chats[conversationId].messages.push(message);
            
            // 重新赋值以触发响应式更新
            this.chats = { ...this.chats };
        },
        updateLastMessage(conversationId, message) {
            this.chats[conversationId] = this.chats[conversationId] || {};
            this.chats[conversationId].messages = this.chats[conversationId].messages || [];

            const messages = this.chats[conversationId].messages || [];
            const lastMessage = messages[messages.length - 1];
            
            this.chats[conversationId].messages = [
                ...(messages.slice(0, -1)),
                {
                    ...lastMessage,
                    ...message,
                }
            ];

            // 重新赋值以触发响应式更新
            this.chats = { ...this.chats };
        },

        updateMessage(conversationId, messageId, newMessage) {
            this.chats[conversationId] = this.chats[conversationId] || {};
            this.chats[conversationId].messages = this.chats[conversationId].messages || [];

            const messages = this.chats[conversationId].messages || [];
            this.chats[conversationId].messages = messages?.map(message => {
                if (message.id === messageId) {
                    return {
                        ...message,
                        ...newMessage,
                    };
                }
                return message;
            });
            
            // 重新赋值以触发响应式更新
            this.chats = { ...this.chats };
        },
    },
});