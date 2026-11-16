import { Schema } from 'prosemirror-model';
import { TextSelection, Plugin, PluginKey } from 'prosemirror-state';
import { keymap } from 'prosemirror-keymap';

import { selectBlock, isAtStart } from '@editor/Editor/plugins/commands/selectBlock';

import { QueryView } from './view';

// 选区恰好覆盖query内的一个textBlock时（mod+a全选），
// 只删除textBlock_head里的inline内容， 保留textBlock节点本身（query内必须保留一个textBlock）
const deleteTextBlockContent = (state: any, dispatch: any) => {
  const { from, to } = state.selection;
  const node = state.doc.nodeAt(from);

  if (
    !node ||
    node.type.name !== 'textBlock' ||
    to !== from + node.nodeSize
  ) {
    return false;
  }

  const $from = state.doc.resolve(from);
  if ($from.parent.type.name !== 'query') {
    return false;
  }

  const tr = state.tr;
  // from是textBlock开始， head内容开始于from+2（textBlock开标签+head开标签）
  const head = node.firstChild;
  const headContentStart = from + 2;
  const headContentEnd = headContentStart + head.content.size;

  if (headContentEnd > headContentStart) {
    tr.delete(headContentStart, headContentEnd);
    tr.setSelection(TextSelection.create(tr.doc, headContentStart));
    dispatch(tr);
  }

  return true;
}

export function query(_schema: Schema): Plugin[] {
  return [
    new Plugin({
      key: new PluginKey('query'),
      props: {
        nodeViews: {
          query: (node, view, getPos) => {
            return new QueryView(node, view, getPos);
          }
        },
      }
    }),
    keymap({
      Backspace: (state, dispatch, _view) => {
        // 如果$from在query的最开始位置， 则selectBlock
        // 注意：有选区时（如ctrl+a全选）应该删除选中文本，不应该selectBlock
        if (state.selection.empty) {
          if (isAtStart(state, 'query')) {
            return selectBlock(state, dispatch, 'query');
          }

          return false;
        }

        // 全选query内的textBlock后按Backspace： 只删除文本， 保留textBlock
        return deleteTextBlockContent(state, dispatch);
      },
    })
  ];
}
