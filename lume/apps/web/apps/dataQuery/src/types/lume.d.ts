/**
 * lume daemon stream 协议类型（packages/protocol/src/outbound.ts 的渲染端镜像）。
 * 供 Electron preload 暴露的 window.lume 使用，非 Electron 环境下 window.lume 不存在。
 */

export type LumeMessage = {
    seq: number;
    role: 'user' | 'assistant' | 'tool';
    content: string;
    like: number;
};

export type LumeConversation = {
    id: string;
    title: string;
    created_at: string;
    updated_at: string;
    message_count: number;
};

export type DaemonEvent =
    | { type: 'ready'; session_id: string; protocol_version: number; model: string }
    | { type: 'turn_started'; turn_id: string }
    | { type: 'assistant_message_started'; turn_id: string; message_id: string }
    | { type: 'assistant_delta'; turn_id: string; delta: string }
    | { type: 'assistant_message_completed'; turn_id: string; message_id: string; finish_reason?: string }
    | { type: 'thought_delta'; turn_id: string; delta: string }
    | { type: 'thought'; turn_id: string; text: string }
    | { type: 'tool_call_requested'; turn_id: string; call_id: string; tool: string; args: unknown }
    | { type: 'tool_started'; turn_id: string; call_id: string }
    | { type: 'tool_completed'; turn_id: string; call_id: string; result: unknown }
    | { type: 'tool_failed'; turn_id: string; call_id: string; result: unknown }
    | { type: 'permission_request'; turn_id: string; id: string; call_id: string; tool: string; args: unknown; reason: string }
    | { type: 'turn_completed'; turn_id: string; final_text?: string }
    | { type: 'turn_failed'; turn_id: string; reason: string; error: { code: string; message: string } };

export interface LumeBridge {
    createConversation(): Promise<{ conversationId: string }>;
    listConversations(): Promise<LumeConversation[]>;
    getMessages(conversationId: string): Promise<{ id: string; title: string; messages: LumeMessage[] }>;
    deleteConversation(conversationId: string): Promise<void>;
    sendMessage(conversationId: string, content: string): Promise<void>;
    interrupt(conversationId: string): Promise<void>;
    feedback(conversationId: string, messageSeq: number, likeType: number): Promise<void>;
    permissionResponse(requestId: string, approved: boolean): Promise<void>;
    onEvent(callback: (conversationId: string, event: DaemonEvent) => void): () => void;
}

declare global {
    interface Window {
        lume?: LumeBridge;
    }
}

export {};
