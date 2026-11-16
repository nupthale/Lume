import { MentionTypeEnum } from '@/components/ChatEditor/interface';
import { NodeSpec, DOMOutputSpec } from 'prosemirror-model';

export const mentionIndexSchema: Record<string, NodeSpec> = {
    mentionIndex: {
      inline: true,
      group: "inline",
      atom: true,
      attrs: {
        name: { default: '' },
        type: { default: MentionTypeEnum.INDEX },
      },
      parseDOM: [{ 
        tag: "span.doc-mentionIndex", 
        getAttrs(dom) {
          if (!(dom instanceof HTMLElement)) return {};

          return {
            name: dom.getAttribute('name'),
            type: dom.getAttribute('type'),
          };
        }
      }],
      toDOM(node): DOMOutputSpec {
        // 第三个参数是文本内容，这会被 ProseMirror 用于 textContent
        return ['span', {
          class: "doc-mentionIndex",
          name: node.attrs.name,
          type: node.attrs.type,
        }, `${node.attrs.name}`];
      },
    },
  };