import { NodeSpec, DOMOutputSpec, Schema } from 'prosemirror-model';
import { nanoid } from 'nanoid';

export const footnoteSchema: Record<string, NodeSpec> = {
    // 行内脚注引用，例如正文中的 [^1]
    footnoteReference: {
      inline: true,
      group: 'inline',
      atom: true, // 无内容，光标不可进入
      selectable: false,
      attrs: {
        id: { default: '' },
        // 原始标识，如 "1"、"note"
        label: { default: '' },
      },
      parseDOM: [{
        tag: 'sup.footnote-reference',
        getAttrs(dom: any) {
          return {
            label: dom.getAttribute('data-label'),
          }
        },
      }],
      toDOM(node): DOMOutputSpec {
        return ['sup', {
          class: 'footnote-reference',
          'data-label': node.attrs.label,
        }, node.attrs.label || '']
      },
      create(schema: Schema, attrs) {
        return schema.nodes['footnoteReference'].create({
          ...attrs,
          id: nanoid(8),
        }, []);
      },
    },

    // 块级脚注定义，例如 [^1]: 脚注内容
    footnoteDefinition: {
      group: 'block',
      content: 'block+',
      selectable: true,
      attrs: {
        id: { default: '' },
        label: { default: '' },
      },
      parseDOM: [{
        tag: 'div.footnote-definition',
        getAttrs(dom: any) {
          return {
            label: dom.getAttribute('data-label'),
          }
        },
      }],
      toDOM(node): DOMOutputSpec {
        return ['div', {
          class: 'footnote-definition',
          'data-label': node.attrs.label,
        }, 0]
      },
      create(schema: Schema, attrs, children) {
        return schema.nodes['footnoteDefinition'].create({
          ...attrs,
          id: nanoid(8),
        }, children);
      },
    },
  };
