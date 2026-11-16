/**
 * daemon stream 事件 -> 原版 SSE 事件格式转换器。
 *
 * 原版 UI（useChat 的 message$ 管道）消费以下事件名：
 *   message_start / message / tool_message / message_cost / message_end
 * 本转换器把 lume daemon 的事件流映射为同名事件，
 * 使原版渲染逻辑在 Electron + 本地 daemon 下保持不变。
 */
import type { DaemonEvent } from '@/types/lume';

export type LegacySseData =
    | { event: 'message_start'; id: string }
    | { event: 'message'; answer: string }
    | { event: 'tool_message'; id?: string; message_title?: string; answer?: string }
    | { event: 'message_cost'; output_tokens: number; latency: number }
    | { event: 'message_end'; id: string };

const stringifyPayload = (payload: unknown): string => {
    if (typeof payload === 'string') return payload;

    try {
        return JSON.stringify(payload, null, 2) || '';
    } catch {
        return String(payload);
    }
};

export class DaemonEventMapper {
    /** 当前 assistant 消息 id（message_end 时用于 updateSuggestQuestions） */
    private currentMessageId = '';
    /** 本轮是否已有流式正文（防止 turn_completed.final_text 与 delta 重复） */
    private hasDeltaContent = false;

    map(event: DaemonEvent): LegacySseData[] {
        switch (event.type) {
            case 'assistant_message_started':
                this.currentMessageId = event.message_id;
                this.hasDeltaContent = false;
                return [{ event: 'message_start', id: event.message_id }];
            case 'assistant_delta':
                this.hasDeltaContent = true;
                return [{ event: 'message', answer: event.delta }];
            case 'tool_call_requested':
                return [
                    {
                        event: 'tool_message',
                        id: event.call_id,
                        message_title: event.tool,
                        answer: stringifyPayload(event.args),
                    },
                ];
            case 'tool_completed':
                return [
                    {
                        event: 'tool_message',
                        id: event.call_id,
                        answer: stringifyPayload(event.result),
                    },
                ];
            case 'tool_failed':
                return [
                    {
                        event: 'tool_message',
                        id: event.call_id,
                        answer: stringifyPayload(event.result ?? '工具执行失败'),
                    },
                ];
            case 'turn_completed': {
                const mapped: LegacySseData[] = [];
                // 仅在本轮没有任何流式正文时用 final_text 兜底，避免与 delta 重复
                if (!this.hasDeltaContent && event.final_text) {
                    mapped.push({ event: 'message', answer: event.final_text });
                }
                mapped.push({ event: 'message_end', id: this.currentMessageId });
                return mapped;
            }
            case 'turn_failed':
                return [
                    { event: 'message', answer: `请求失败（${event.reason}）：${event.error.message}` },
                    { event: 'message_end', id: this.currentMessageId },
                ];
            // thought / ready / turn_started / tool_started / assistant_message_completed /
            // permission_request：原版 UI 无对应消费逻辑，permission_request 由权限弹窗组件处理
            default:
                return [];
        }
    }
}
