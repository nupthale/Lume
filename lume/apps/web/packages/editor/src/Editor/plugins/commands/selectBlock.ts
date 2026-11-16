import { getNearestAncestor, getRangeByNode } from '@editor/Editor/shared/index';
import { NodeSelection } from 'prosemirror-state';

export const isAtStart = (state, nodeName) => {
    const { $from } = state.selection;
    let isFirstChild = true;

    for (let d = $from.depth; d > 0; d--) {
      const node = $from.node(d)

      // 要求$from.index(d)每一层级的index都必须是0，第一个元素，且$from.parentOffset === 0
      if (node.type.name === nodeName) {
        // case 1: 光标在 query 内最开头
        // case 2: 光标在 query 的第一个 block 开头
        // case 3: 光标在 textBlock > textBlock_head 开头（嵌套链的第一个后代）
        // 这三种情况下该等式都成立
        return isFirstChild && $from.parentOffset === 0 && $from.index(d) === 0;
      } else {
        isFirstChild = $from.index(d) === 0 && isFirstChild;
      }
    }

    return false
}

export const selectBlock = (state, dispatch, nodeName) => {
  const { $from } = state.selection;
  const tr = state.tr;

  // 找到$from上层最近的nodeName， 选中node
  const nearestAncestor = getNearestAncestor($from, nodeName);
  if (!nearestAncestor) return false;

  const [from] = getRangeByNode(state, nearestAncestor)

  tr.setSelection(NodeSelection.create(tr.doc, from));

  dispatch(tr);

  return true;
}