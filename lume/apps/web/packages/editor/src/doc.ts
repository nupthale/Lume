import { nanoid } from 'nanoid';

import { schema } from './Editor/plugins/schema';
import { MentionTypeEnum } from './Editor/interface';
import { ListTypeEnum } from './Editor/plugins/nodes/list/interface';

const LIST_TYPE = ListTypeEnum.ORDERED;

export const defaultDoc = {
    "type": "doc",
    "content": [
        {
            "type": "title",
            "attrs": {
                "id": nanoid(8),
                "placeholder": "请输入标题"
            },
        },
        {
            "type": "body",
            "content": [
                {
                    "type": "textBlock",
                    "attrs": {
                        "id": nanoid(8)
                    },
                    "content": [
                        {
                            "type": "textBlock_head",
                            "attrs": {
                                "id": nanoid(8)
                            }
                        }
                    ]
                }
            ]
        }
    ]
};

export const docComments = {
    'refId1': ['commentId1', 'commentId2'],
    'refId2': ['commentId3', 'commentId4'],
};

export const commentInfoMap = {
    'commentId1': {
        id: 'commentId1',
        refDoc: '任务处理',
        comments: [
            { id: '1', user: '王凯', content: '思维 理念 成长 搜集 完美', createTime: '2022-01-01' },
            { id: '2', user: '小米', content: '感谢！分享我的结果～是「学习专注追求竞争回顾」，且战略思维最高，影响力其次。', createTime: '2022-01-02' },
            { id: '3', user: 'Adam', content: '感觉重合度很高hhh 😂', createTime: '2022-01-02' },
        ],
    },
    'commentId2': {
        id: 'commentId2',
        refDoc: '任务处理',
        comments: [
            { id: '1', user: '张瑞', content: '很好的案例~', createTime: '2022-01-01' },
            { id: '2', user: '李先森', content: '期待你的成果，🥳', createTime: '2022-01-02' },
            { id: '3', user: 'Adam', content: '建立个人知识库Wiki， 沉淀个人思考', createTime: '2022-01-02' },
        ],
    },
    'commentId3': {
        id: 'commentId3',
        refDoc: '触发任务详情的展示。',
        comments: [
            { id: '1', user: '陈明宇', content: '这个功能设计得很合理，提高了操作效率', createTime: '2022-01-01' },
            { id: '2', user: '林思远', content: '建议可以增加批量处理的功能，对于大量任务会更方便', createTime: '2022-01-02' },
            { id: '3', user: '张雨晴', content: '界面交互很流畅，使用体验不错 👍', createTime: '2022-01-02' },
        ],
    },
    'commentId4': {
        id: 'commentId4',
        refDoc: '触发任务详情的展示。',
        comments: [
            { id: '1', user: '赵子涵', content: '产品体验越来越好了，期待后续更新 🎉', createTime: '2022-01-01' },
            { id: '2', user: '吴思琪', content: '操作流程简单直观，新手也能快速上手', createTime: '2022-01-02' },
            { id: '3', user: '刘天成', content: '希望能增加一些快捷键支持，提升效率 ⌨️', createTime: '2022-01-02' },
        ],
    },
};

export const mockUsers = [
    { id: '1', name: '王凯' },
    { id: '2', name: '张雨晴' },
    { id: '3', name: '李思琪' },
    { id: '4', name: '刘天成' },
    { id: '5', name: '陈明宇' },
];