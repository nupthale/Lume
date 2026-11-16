import { NodeSpec, DOMOutputSpec } from 'prosemirror-model';

export const slotSchema: Record<string, NodeSpec> = {
    slot: {
      inline: true,
      group: "inline",
      content: 'inline*',
      attrs: {
        placeholder: { default: '请输入' },
      },
      parseDOM: [{ 
        tag: "span.doc-slot", 
        getAttrs(dom) {
          if (!(dom instanceof HTMLElement)) return {};

          return {
            placeholder: dom.getAttribute('data-placeholder'),
          };
        }
      }],
      toDOM(node): DOMOutputSpec {
        // 第三个参数是文本内容，这会被 ProseMirror 用于 textContent
        return ['span', {
          class: "doc-slot",
          'data-placeholder': node.attrs.placeholder,
        }, 0];
      },
    },
  };