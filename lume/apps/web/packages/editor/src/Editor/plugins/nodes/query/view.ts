import { Node } from 'prosemirror-model';
import { EditorView } from 'prosemirror-view';

import { BaseBlockView } from '../_common/baseBlockView';
import { TopFloatMenuTrigger } from '../_common/topFloatMenuTrigger';

import { SubmitBtn } from './components/SubmitBtn/index';

import './index.less';

export class QueryView extends BaseBlockView {
  topFloatMenuTrigger: TopFloatMenuTrigger;

  submitBtn: SubmitBtn;

  constructor(public node: Node, public view: EditorView, public getPos: () => number | undefined) {
    super(node, view, getPos, undefined, true);

    // 创建容器元素
    this.dom.classList.add('doc-query');
    this.dom.classList.add('flex', 'items-stretch');

    const content = document.createElement('div');
    content.classList.add('flex-1');

    this.submitBtn = new SubmitBtn(this);

    this.contentDOM = content;

    this.dom.appendChild(this.submitBtn.init());
    this.dom.appendChild(content);

    this.topFloatMenuTrigger = new TopFloatMenuTrigger(this);
  }
  
  update(node: Node) {
    if (node.type !== this.node.type) return false;

    this.node = node; // 更新节点

    return true;
  }

  selectNode() {
    return true;
  }

  destroy() {
    this.topFloatMenuTrigger.destroy();

    this.submitBtn.destroy();

    super.destroy();
  }
}

