import { NodeSpec, DOMOutputSpec } from 'prosemirror-model';

export const mentionBranchSchema: Record<string, NodeSpec> = {
    mentionBranch: {
      inline: true,
      group: "inline",
      atom: true,
      attrs: {
        name: { default: '' },
      },
      parseDOM: [{ 
        tag: "span.doc-mentionBranch", 
        getAttrs(dom) {
          if (!(dom instanceof HTMLElement)) return {};

          return {
            name: dom.getAttribute('name'),
          };
        }
      }],
      toDOM(node): DOMOutputSpec {
        // 第三个参数是文本内容，这会被 ProseMirror 用于 textContent
        return ['span', {
          class: "doc-mentionBranch",
          name: node.attrs.name,
        }, `@${node.attrs.name}`];
      },
    },
  };