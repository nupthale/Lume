import { Node } from 'prosemirror-model';
import { EditorView, NodeView, ViewMutationRecord } from 'prosemirror-view';

import './index.less';
import { MentionTypeEnum } from '@editor/Editor/interface';

const svgIconHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-decimals-arrow-right-icon lucide-decimals-arrow-right"><path d="M10 18h10"/><path d="m17 21 3-3-3-3"/><path d="M3 11h.01"/><rect x="15" y="3" width="5" height="8" rx="2.5"/><rect x="6" y="3" width="5" height="8" rx="2.5"/></svg>';
const indexGroupIconHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-layers-icon lucide-layers"><path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/></svg>';

export class MentionIndexView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement | null;
  node: Node;
  view: EditorView;

  constructor(node: Node, view: EditorView) {
    this.node = node;
    this.view = view;

    // 创建容器元素
    this.dom = document.createElement('span');
    this.dom.className = `doc-mentionIndex ${node.attrs.type === MentionTypeEnum.INDEXGROUP ? 'indexGroup' : ''}`;

    const iconWrap = document.createElement('span');
    iconWrap.setAttribute('contenteditable', 'false');
    iconWrap.innerHTML = node.attrs.type === MentionTypeEnum.INDEXGROUP ? indexGroupIconHTML : svgIconHTML;

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

