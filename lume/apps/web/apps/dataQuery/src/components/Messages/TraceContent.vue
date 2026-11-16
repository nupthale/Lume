<script lang="tsx">
import { defineComponent, watchEffect, ref } from 'vue';
import { unified } from 'unified'
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import remarkParse from 'remark-parse';

export default defineComponent({
    props: {
        content: String,
    },
    setup(props) {
        const processorRef = ref();
        const parsedContentRef = ref('');

        watchEffect(async () => {
            if (!processorRef.value) {
                processorRef.value = await unified()
                    .use(remarkParse)
                    .use(remarkBreaks)
                    .use(remarkGfm);
            }

            processContent();
        });

        const processContent = async () => {
            if (!props.content) return '';

            const processor = processorRef.value;

            const ast = processor.parse(props.content);
            
            parsedContentRef.value = renderChildren(ast.children);
        }

        const componentMap = {
            root: node => `<div>${renderChildren(node.children)}</div>`,
            paragraph: node => `<p>${renderChildren(node.children)}</p>`,
            text: (node) => node.value,
            inlineCode: node => {
                return `<span class="inlineCode">${node.value}</span>`;
            },
            list: (node) => {
                const listTag = node.ordered ? 'ol' : 'ul';
                return `<${listTag} class="flex flex-col gap-2">${renderChildren(node.children)}</${listTag}>`;
            },
            listItem: (node) => {
                return `<li>${renderChildren(node.children)}</li>`;
            },
        };

        const renderChildren = (children) => {
            return children.map(child => {
                const component = componentMap[child.type];
                if (!component) return null;
                return component(child);
            }).filter(Boolean).join('');
        };

        return () => (
            <div class="traceContent" innerHTML={parsedContentRef.value}></div>
        );
    }
})
</script>

<style scoped>
.traceContent :deep(.inlineCode) {
    padding: 2px 6px;
    border-radius: 4px;
    background: var(--N50);
    border: 1px solid var(--table-border-color);
    margin: 0 3px;
}
</style>