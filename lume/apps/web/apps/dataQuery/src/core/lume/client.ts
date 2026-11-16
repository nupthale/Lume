/**
 * window.lume 唯一访问点。
 * 非 Electron 环境下 window.lume 不存在，抛出明确错误（不做远程 fallback）。
 */
import type { DaemonEvent, LumeBridge } from '@/types/lume';

const getLume = (): LumeBridge => {
    if (typeof window === 'undefined' || !window.lume) {
        throw new Error('请在 lume Electron 客户端中运行');
    }

    return window.lume;
};

export const hasLumeBridge = (): boolean => typeof window !== 'undefined' && !!window.lume;

export const createConversation = () => getLume().createConversation();
export const listConversations = () => getLume().listConversations();
export const getMessages = (conversationId: string) => getLume().getMessages(conversationId);
export const deleteConversation = (conversationId: string) => getLume().deleteConversation(conversationId);
export const sendMessage = (conversationId: string, content: string) => getLume().sendMessage(conversationId, content);
export const interrupt = (conversationId: string) => getLume().interrupt(conversationId);
export const feedback = (conversationId: string, messageSeq: number, likeType: number) => getLume().feedback(conversationId, messageSeq, likeType);
export const permissionResponse = (requestId: string, approved: boolean) => getLume().permissionResponse(requestId, approved);
export const onEvent = (callback: (conversationId: string, event: DaemonEvent) => void) => getLume().onEvent(callback);
