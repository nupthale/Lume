
import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { keymap } from 'prosemirror-keymap';

import { SlotView } from './view';

export function slot(): Plugin[] {
  return [
    new Plugin({
      key: new PluginKey('slot'),
      props: {
        nodeViews: {
          slot: (node, view, getPos) => {
            return new SlotView(node, view, getPos);
          }
        },
      },
    }),
    keymap({
      'ArrowRight': (state, dispatch, _view) => {
        // 如果在node最末尾位置arrowRight， 则移出node
        const { $from } = state.selection;

        const node = $from.node();

        if (node.type.name === 'slot' && $from.end() === $from.start() + $from.parentOffset) {
          const tr = state.tr;

          tr.setSelection(
            TextSelection.create(state.doc, Math.min($from.after() + 1, state.doc.nodeSize))
          )

          dispatch?.(tr);

          return true;
        }

        return false;
      },
      'Backspace': (state, dispatch, _view) => {
        // 如果在node最开始位置backspace， 相当于arrowLeft
        const { $from } = state.selection;

        if ($from.parent.type.name === 'slot' && $from.parentOffset <= 1) {
          const tr = state.tr;

          tr.setSelection(
            TextSelection.create(state.doc, Math.max($from.start() - 1, 0))
          )

          dispatch?.(tr);

          return true;
        }

        return false;
      },
    })
  ];
}