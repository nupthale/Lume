import { h, ref, Ref } from 'vue';

import { unified } from 'unified'
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import remarkParse from 'remark-parse'

import Code from './extensions/Code/index.vue';
import TableContainer from './extensions/TableContainer/index.vue';
import { useLoadingDot } from './useLoadingDot';

export const useContentToVue = (showLoadingDot?: Ref<boolean>, isLast?: Ref<boolean>) => {
    const componentNode = ref();

    const { addLoadingDot } = useLoadingDot();

    const componentMap = {
        root: node => h('div', renderChildren(node.children)),
        blockquote: node => h('blockquote', renderChildren(node.children)),
        code: node => h(Code, { code: node.value, lang: node.lang, isLast: isLast?.value }),
        emphasis: node => h('em', renderChildren(node.children)),
        heading: (node) => h('h' + node.depth, renderChildren(node.children)),
        html: (node) => {
            return h({
                setup() {
                    return () => h('span', {
                        innerHTML: node.value
                    });
                }
            });
        },
        image: (node) => h('img', { src: node.url }),
        link: (node) => h('a', { href: node.url, target: '_blank' }, renderChildren(node.children)),
        break: () => h('br'),
        inlineCode: node => h('code', node.value),
        delete: node => h('span', { class: 'delete' }, renderChildren(node.children)),
        strong: node => h('strong', renderChildren(node.children)),
        paragraph: (node) => h('p', renderChildren(node.children)),
        text: (node) => {
            if (node._addLoading) {
                return [
                    node.value,
                    h('span', { class: 'messageLoadingDot' })
                ];
            }
            return node.value;
        },
        list: (node) => h(node.ordered ? 'ol' : 'ul', renderChildren(node.children)),
        listItem: (node) => h('li', renderChildren(node.children)),
        thematicBreak: () => h('hr'),
        table: (node) => {
            return h(
                TableContainer,
                h('table', node.children?.map((row, rowIndex) => 
                    h('tr', row.children?.map((cell, cellIndex) => 
                        h(rowIndex === 0 ? 'th' : 'td', {
                            style: {
                                textAlign: node.align[cellIndex],
                            }
                        },  renderChildren(cell.children))
                    )
                ))),
            );
        },
    };

    const renderChildren = (children) => {
        return children.map(child => {
          const component = componentMap[child.type];
          if (!component) return null; // 忽略未定义的节点类型
          return component(child);
        });
    };

    const parseAndUpdate = async (content?: string) => {
        if (!content?.length) {
            componentNode.value = h('div');
            return;
        }

        const processor = await unified()
            .use(remarkParse)
            .use(remarkBreaks)
            .use(remarkGfm);

        try {
            const ast = processor.parse(content || '');
        
            // 如果需要显示loading，找到最后一个文本节点并标记
            if (showLoadingDot?.value) {
                addLoadingDot(ast);
            }
            
            componentNode.value = h('div', { class: 'messageContent' }, renderChildren(ast.children));
        } catch(e) {
            console.error('错误的markdown类型');
        }
    }

    return {
        componentNode,
        parseAndUpdate,
    };
}