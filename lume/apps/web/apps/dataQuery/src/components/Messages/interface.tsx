export enum MessageRoleEnum {
    USER = 'user',
    AI = 'ai',
}

export type MessageType = {
    id: string;
    content: string;
    role: MessageRoleEnum;
    cost?: {
        tokens?: number,
        time?: number,
    };
    like?: number;
    suggestQuestions?: string[];
    tracing?: Record<string, any>[];
}

export enum MessageLikeEnum {
    LIKE = 1,
    NONE = 0,
    DISLIKE = -1,
}