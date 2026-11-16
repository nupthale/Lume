import { Subject } from 'rxjs';

import { AgentTypeEnum } from '@/types/agent';

// 创建新会话
export const createConversation$ = new Subject<{ query: string, agentType: AgentTypeEnum }>();

// 更新会话列表
export const updateConversationList$ = new Subject();

// submit会话消息
export const sendUserMessage$ = new Subject<{
    message: string;
}>();