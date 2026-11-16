import { nanoid } from 'nanoid';
import { NodeSpec, DOMOutputSpec,Schema } from 'prosemirror-model';

export const querySchema: Record<string, NodeSpec> = {
    query: {
      content: "block*",
      group: 'block',
      selectable: true,
      attrs: {
        id: { default: '' },
      },
      parseDOM: [{ 
        tag: "div.doc-query", 
        priority: 51,  // 提高优先级
        getAttrs(dom: any) {
          return {
            id: dom.getAttribute('data-id'),
          }
        },
      }],
      toDOM(node): DOMOutputSpec {
        return ["div", {
          'data-id': node.attrs.id,
        }, 0]
      },
      create(schema: Schema, attrs) {
        const id = nanoid();
  
        return schema.nodes['query'].create({
          ...attrs,
          id,
        }, [
          schema.node('textBlock', { id: nanoid(8) }, [
            schema.node('textBlock_head', {
                id: nanoid(8),
            }, [])
          ]),
        ]);
      },
    },
  };