import { Plugin } from 'prosemirror-state';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';

export function baseKeymapPlugin(): Plugin[] {
  return [
    keymap({
        Enter: () => {
          // 阻止回车， 回车就直接提交chat
          return true;
        },
        'Shift-Enter': (state, dispatch, view) => {
          return baseKeymap.Enter(state, dispatch, view);
        },
        'ArrowUp': (state) => {
          // 如果编辑器内容为空， 则组织arrowup和arrowdown
          if (!state.doc.textContent?.length) {
            return true;
          }
          return false;
        },
        'ArrowDown': (state) => {
          // 如果编辑器内容为空， 则组织arrowup和arrowdown
          if (!state.doc.textContent?.length) {
            return true;
          }
          return false;
        },
    }),
    keymap(baseKeymap),
  ];
}