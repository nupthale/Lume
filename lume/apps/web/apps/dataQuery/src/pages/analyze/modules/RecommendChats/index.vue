<script lang="tsx">
import { defineComponent } from 'vue';
import { Node } from 'prosemirror-model';

import { schema } from '@/components/ChatEditor/plugins/schema';

export default defineComponent({
    emits: ['select'],
    setup(_props, { emit }) {
        const list: { brief: string, node: Node }[] = [
            { 
                brief: '🥳 今年以来营业部的经营状况', 
                node: schema.nodes.paragraph.create({}, [
                    schema.text('今年以来'),
                    schema.nodes['slot'].create({
                        placeholder: '分支机构',
                    }, [
                        schema.text('\u200B'),
                    ]),
                    schema.text('\u200B'),
                    schema.text('的经营状况如何')
                ]) 
            },
            { 
                brief: '🥳 查询两融规模、产品保有量、机构业务收入', 
                node: schema.nodes.paragraph.create({}, [
                    schema.text('查询下最近的两融规模、产品保有量、机构业务收入情况'),
                ]) 
            },
        ];

        const handleClick = (node: Node) => {
            emit('select', node);
        }

        return () => (
            <div class="w-full flex gap-2 flex-wrap max-h-[84px]">
                {
                    list.map((item, index) => (
                        <div class="item" key={index} onClick={() => handleClick(item.node)}>
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