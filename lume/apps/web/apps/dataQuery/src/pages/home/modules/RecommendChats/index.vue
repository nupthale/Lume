<script lang="tsx">
import { defineComponent } from 'vue';
import { Node } from 'prosemirror-model';

import { schema } from '@/components/ChatEditor/plugins/schema';
import { AgentTypeEnum } from '@/types/agent';

export default defineComponent({
    emits: ['select'],
    setup(_props, { emit }) {
        const list: { brief: string, node: Node, type: AgentTypeEnum }[] = [
            { 
                brief: '🏦 营业部佣金收入', 
                node: schema.nodes.paragraph.create({}, [
                    schema.text('查询'),
                    schema.nodes['slot'].create({
                        placeholder: '分支机构',
                    }, [
                        schema.text('\u200B'),
                    ]),
                    schema.text('\u200B'),
                    schema.text('的佣金收入'),
                ]),
                type: AgentTypeEnum.DATA_QUERY,
            },
            { 
                brief: '📈 分析营业部的两融余额变化', 
                node: schema.nodes.paragraph.create({}, [
                    schema.text('分析'),
                    schema.nodes['slot'].create({
                        placeholder: '分支机构',
                    }, [
                        schema.text('\u200B'),
                    ]),
                    schema.text('\u200B'),
                    schema.text('的两融余额变化'),  
                ]),
                type: AgentTypeEnum.DATA_QUERY,
            },
            { 
                brief: '🚴 今年以来营业部的经营状况', 
                node: schema.nodes.paragraph.create({}, [
                    schema.text('今年以来'),
                    schema.nodes['slot'].create({
                        placeholder: '分支机构',
                    }, [
                        schema.text('\u200B'),
                    ]),
                    schema.text('\u200B'),
                    schema.text('的经营状况如何'),
                   
                ]),
                type: AgentTypeEnum.OPERATION,
            },
            { 
                brief: '🤶 两融规模、产品保有量、机构业务收入', 
                node: schema.nodes.paragraph.create({}, [
                    schema.text('查询下最近的两融规模、产品保有量、机构业务收入情况'),
                ]),
                type: AgentTypeEnum.OPERATION,
            },
            { 
                brief: '🥳 营业部开户日报', 
                node: schema.nodes.paragraph.create({}, [
                    schema.text('查询'),
                    schema.nodes['slot'].create({
                        placeholder: '分支机构',
                    }, [
                        schema.text('\u200B'),
                    ]),
                    schema.text('\u200B'),
                    schema.text('的开户日报')
                ]),
                type: AgentTypeEnum.ORDI_REPORT,
            },
            { 
                brief: '🐝 营业部交易日报', 
                node: schema.nodes.paragraph.create({}, [
                    schema.text('查询'),
                    schema.nodes['slot'].create({
                        placeholder: '分支机构',
                    }, [
                        schema.text('\u200B'),
                    ]),
                    schema.text('\u200B'),
                    schema.text('的交易日报')
                ]),
                type: AgentTypeEnum.ORDI_REPORT,
            },
            { 
                brief: '🌈 营业部佣金日报', 
                node: schema.nodes.paragraph.create({}, [
                    schema.text('查询'),
                    schema.nodes['slot'].create({
                        placeholder: '分支机构',
                    }, [
                        schema.text('\u200B'),
                    ]),
                    schema.text('\u200B'),
                    schema.text('的佣金日报')
                ]),
                type: AgentTypeEnum.ORDI_REPORT,
            },
        ];

        const handleClick = (item) => {
            emit('select', item);
        }

        return () => (
            <div class="w-full flex gap-2 flex-wrap">
                {
                    list.map((item, index) => (
                        <div class="item" key={index} onClick={() => handleClick(item)}>
                            {item.brief}
                        </div>
                    ))
                }
            </div>
        );
    }
})
</script>

<style scoped>
.item {
    font-size: 13px;
    color: var(--light-text-color);
    padding: 8px 12px;
    border-radius: 999999px;
    border: 1px solid var(--table-border-color);
    cursor: pointer;

    background: var(--blur-bg-filter);
    backdrop-filter: var(--fullscreen-modal-header-filter);
}

.item:hover {
    background: var(--menu-item-hover);
}
</style>