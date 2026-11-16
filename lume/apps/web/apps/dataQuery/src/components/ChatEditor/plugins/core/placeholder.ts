import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

const isEmptyParagraph = (node: ProseMirrorNode) =>
  node.type.name === 'paragraph' && node.nodeSize === 2;

export function placeholderPlugin(text: string) {
  return new Plugin({
    props: {
      decorations(state) {
        const { doc, selection } = state;
        const { $from } = selection;

        if (doc.childCount !== 1 || !isEmptyParagraph($from.parent)) {
          return null;
        }

        return DecorationSet.create(doc, [
          Decoration.node($from.before(), $from.after(), {
            class: 'is-editor-empty',
            'data-placeholder': text,
          }),
        ]);
      },
    },
  });
}