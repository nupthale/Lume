/* eslint-disable */
// @ts-nocheck

/**
 * agent 会话接口层：原远程「智能经营分析系统」REST + SSE 已替换为
 * Electron IPC（window.lume -> 本地 lume daemon）。
 * 所有导出名称、参数、返回结构与原版保持一致，界面组件无感知。
 * @see src/core/lume/client.ts（window.lume 唯一访问点）
 * @see lume/packages/protocol（daemon stream 协议）
 *
 * 注意：getAiExtDataContent（vis-id 图表配置）属于数据查询服务而非 agent 会话，保留原实现。
 */
import axios from 'axios';

import { getToken } from '@/utils/auth';
import {
  createConversation,
  deleteConversation,
  feedback,
  getMessages,
  listConversations,
} from '@/core/lume/client';
import type { LumeMessage } from '@/types/lume';
import { AgentTypeEnum } from '@/types/agent';

const axiosInstance = axios.create({
  baseURL: '/',
  withCredentials: true,
});

export const headers = {
  'X-Access-Token': getToken(),
  'Content-type': 'application/json',
}

const response = <T>(data: T) => ({ status: 200, data });

const getConversationId = (params: any): string => {
  const conversationId = params?.AppConversationID || params?.conversationId;

  if (!conversationId) {
    throw new Error('缺少会话 ID');
  }

  return conversationId;
};

// daemon 消息序列 -> 原版 Messages/AnswerInfo 结构（user/assistant 配对，工具后多条 assistant 合并）
const mapDaemonMessages = (daemonMessages: LumeMessage[]) => {
  const sorted = [...daemonMessages].sort((a, b) => a.seq - b.seq);
  const pairs: any[] = [];
  let pendingUser: LumeMessage | null = null;

  const appendPendingUser = () => {
    if (!pendingUser) return;

    pairs.push({
      QueryID: String(pendingUser.seq),
      Query: pendingUser.content,
      AnswerInfo: null,
    });
  };

  for (const message of sorted) {
    if (message.role === 'user') {
      appendPendingUser();
      pendingUser = message;
      continue;
    }

    if (message.role !== 'assistant') {
      continue;
    }

    if (pendingUser) {
      pairs.push({
        QueryID: String(pendingUser.seq),
        Query: pendingUser.content,
        AnswerInfo: {
          MessageID: String(message.seq),
          Answer: message.content,
          TotalTokens: 0,
          Latency: 0,
          Like: message.like,
          SuggestedQuestions: [],
          TracingJsonStr: '[]',
        },
      });
      pendingUser = null;
    } else {
      // 同一轮中工具调用后的后续 assistant 消息，合并为该轮的最终回答
      const answerInfo = pairs[pairs.length - 1]?.AnswerInfo;

      if (answerInfo) {
        answerInfo.MessageID = String(message.seq);
        answerInfo.Answer = message.content;
        answerInfo.Like = message.like;
      }
    }
  }

  return {
    messages: pairs.reverse(),
    processingMessage: pendingUser ? { Query: pendingUser.content } : null,
  };
};

// 创建会话
export const postCreateConversation = async (_params: any, _options: any = {}) => {
  const { conversationId } = await createConversation();

  return response({
    Conversation: {
      AppConversationID: conversationId,
    },
  });
}

// 创建预览会话
export const postCreatePreviewConversation = async (_params: any, _options: any = {}) => {
  const { conversationId } = await createConversation();

  return response({
    Conversation: {
      AppConversationID: conversationId,
    },
  });
}

// 更新会话（daemon 会话标题由首条消息自动生成，此处保持接口兼容）
export const postUpdateConversation = async (_params: any) => {
  return response({});
}

// 删除会话
export const postDeleteConversation = async (params: any) => {
  await deleteConversation(getConversationId(params));

  return response({});
}

// 获取会话message
export const postGetConversationMessages = async (params: any) => {
  const result = await getMessages(getConversationId(params));
  const { messages, processingMessage } = mapDaemonMessages(result.messages || []);

  return response({
    Messages: messages,
    ...(processingMessage ? { ProcessingMessage: processingMessage } : {}),
  });
}

// daemon 暂无推荐问题功能，保持接口兼容返回空
export const postGetSuggestedQuestions = async (_params: any) => {
  return response({
    SuggestedQuestions: [],
  });
}

// feedback， 点赞或者踩（MessageID 为历史消息时为 assistant seq 字符串）
export const postMessageFeedback = async (params: any) => {
  const conversationId = params?.AppConversationID || params?.conversationId;
  const messageSeq = Number(params?.MessageID);

  if (conversationId && Number.isFinite(messageSeq)) {
    await feedback(conversationId, messageSeq, Number(params?.LikeType || 0));
  }

  return response({});
}

export const getConversationList = async () => {
  const conversations = await listConversations();

  return response({
    ConversationList: conversations.map((conversation) => ({
      AppConversationID: conversation.id,
      ConversationName: conversation.title,
      CreatedAt: conversation.created_at,
      UpdatedAt: conversation.updated_at,
      MessageCount: conversation.message_count,
      // 原远程接口按会话返回 AgentType，Sider 依据它跳转 /chat/:agentType/:id；
      // daemon 为主智能体（问数），统一映射为 WS_QUERY，避免路由出现 undefined
      AgentType: AgentTypeEnum.WS_QUERY,
    })),
  });
};

// 精简会话标题（原服务端 workflow 已下线，改为本地截断，返回结构与原版一致）
export const postSyncRunAppWorkflow = async (params: any) => {
  let query = '';

  try {
    query = JSON.parse(params?.inputData || '{}').query || '';
  } catch {
    query = '';
  }

  const shortName = String(query || '').slice(0, 30);

  return response({
    output: JSON.stringify({ output: shortName }),
  });
}

// vis-id获取配置（数据查询服务，与 agent 会话无关，保留原实现）
export const getAiExtDataContent = (params: any) => {
  return axiosInstance.request<{ result: Record<string, any>}>({
    url: '/data-query-api/data/dataQuery/getAiExtDataContent',
    method: 'POST',
    data: params,
    headers: {
      ...headers,
      'API-TOKEN': 'B8F2A1C5D7E3F9A6B4C2D8E1A5F7B3C9D6E2A4F8B1C5D3E7F9A2B6C4D8E1A5F3B7C9',
    },
  });
}
