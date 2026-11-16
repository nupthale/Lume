import { Node } from 'prosemirror-model';
import { EditorView, NodeView, ViewMutationRecord } from 'prosemirror-view';

import './index.less';


const svgIconHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-landmark-icon lucide-landmark"><path d="M10 18v-7"/><path d="M11.12 2.198a2 2 0 0 1 1.76.006l7.866 3.847c.476.233.31.949-.22.949H3.474c-.53 0-.695-.716-.22-.949z"/><path d="M14 18v-7"/><path d="M18 18v-7"/><path d="M3 22h18"/><path d="M6 18v-7"/></svg>';
export class MentionBranchView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement | null;
  node: Node;
  view: EditorView;

  constructor(node: Node, view: EditorView) {
    this.node = node;
    this.view = view;

    // 创建容器元素
    this.dom = document.createElement('span');
    this.dom.className = 'doc-mentionBranch';

    const iconWrap = document.createElement('span');
    iconWrap.setAttribute('contenteditable', 'false');
    iconWrap.innerHTML = svgIconHTML;

    const nameEl = document.createElement('span');
    nameEl.setAttribute('contenteditable', 'false');
    nameEl.innerText = node.attrs.name;

    this.dom.appendChild(iconWrap);
    this.dom.appendChild(nameEl);

    this.contentDOM = null;
  }

  update(node: Node) {
    if (node.type !== this.node.type) return false;

    this.node = node;

    return true;
  }

  ignoreMutation(record: ViewMutationRecord): boolean {
     // 忽略类名变化
    if (record.type === 'attributes' && ['class', 'style'].includes(record.attributeName!)) {
        return false;
    }

    return true;
  }

  destroy() {
  }
}

