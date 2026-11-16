import { Plugin, PluginKey } from 'prosemirror-state';
import { keymap } from 'prosemirror-keymap';

import { selectBlock } from '@editor/Editor/plugins/commands/selectBlock';

import { CoderView } from '../view';
import { ChartView } from '../chart';

export const coder = () => {
  return [
    new Plugin({
        key: new PluginKey('coder'),
        props: {
          nodeViews: {
            coder: (node, view, getPos) => {
              return node.attrs?.language === 'vis-id' ? new ChartView(node, view, getPos) : new CoderView(node, view, getPos);
            }
          },
        },
    }),
    keymap({
      Backspace: (state, dispatch, _view) => {
        // coder 比较特殊， nodeView里的stopEvent已经拦截了事件， 能到这里的一定是在atStart且是backspace的， 所以直接选择。
        return selectBlock(state, dispatch, 'coder');
      },
    })
  ];
};