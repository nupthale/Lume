import { nanoid } from 'nanoid';
import { NodeSpec, DOMOutputSpec, Schema } from 'prosemirror-model';

export const coderSchema: Record<string, NodeSpec> = {
    coder: {
      group: 'block',
      content: 'text*',
      attrs: {
        id: { default: '' },
        language: { default: 'javascript' },
        viewType: { default: '' },
      },
      parseDOM: [{ 
        tag: "div.doc-coder", 
        getAttrs(dom: any) {
          return {
            id: dom.getAttribute('data-id'),
            language: dom.getAttribute('data-language'),
            viewType: dom.getAttribute('data-viewType'),
          }
        },
      }],
      toDOM(node): DOMOutputSpec {
        return ["div", {
          class: "doc-coder",
          'data-id': node.attrs.id,
          'data-language': node.attrs.language,
          'data-viewType': node.attrs.viewType,
        }, 0]
      },
      create(schema: Schema, attrs, content = []) {
        const id = nanoid();

        setTimeout(() => {
          const dom = document.querySelector(`div.doc-coder[data-id="${id}"] div[contenteditable='plaintext-only']`) as HTMLElement;
          if (dom) {
            dom.focus();
          }
        }, 0);

        return schema.nodes['coder'].create({
          ...attrs,
          id,
        }, content);
      }
    },
  };