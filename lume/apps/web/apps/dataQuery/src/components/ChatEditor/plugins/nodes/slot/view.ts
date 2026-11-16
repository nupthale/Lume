import { Node } from 'prosemirror-model';
import { EditorView, NodeView, ViewMutationRecord } from 'prosemirror-view';
import { Subscription, combineLatest } from 'rxjs';
import { tap } from 'rxjs/operators';

import { selectionChange$, docChanged$ } from '../../../event';

import './index.less';
import { TextSelection } from 'prosemirror-state';

export class SlotView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  node: Node;
  view: EditorView;
  placeholderElement: HTMLElement | null = null;

  private subscribers: Subscription[] = [];

  constructor(node: Node, view: EditorView, private getPos: () => number | undefined) {
    this.node = node;
    this.view = view;

    // 创建容器元素
    this.dom = document.createElement('span');
    this.dom.className = 'doc-slot';

    this.contentDOM = document.createElement('span');

    this.dom.appendChild(this.contentDOM);

    const subscriber = combineLatest([selectionChange$, docChanged$]).pipe(
      tap(() => {
        this.updatePlaceholder();
      })
    ).subscribe();

    this.subscribers.push(subscriber);
  }

  getPlaceholderElement() {
    // 创建占位符容器
    const content = document.createElement('span');
    content.contentEditable = 'false';
    content.classList.add('placeholder');

    return content;
  }

  updatePlaceholder() {
    const hasNoContent = this.node.content?.size === 1 && this.node.firstChild?.textContent === '\u200B';
    debugger;
    if (!hasNoContent) {
      this.hidePlaceholder();
    } else {
      this.showPlaceholder();
    }
  }

  bindPlaceholderClick = () => {
    this.placeholderElement?.removeEventListener('click', this.handlePlaceholderClick);

    this.placeholderElement?.addEventListener('click', this.handlePlaceholderClick);
  }

  handlePlaceholderClick = () => {
    // focus at start
    const tr = this.view.state.tr;

    tr.setSelection(
      TextSelection.create(this.view.state.doc, this.getPos()! + 2)
    );

    this.view.dispatch(tr);
  }

  showPlaceholder() {
    const placeholderElement = this.dom.querySelector('.placeholder') as HTMLElement;

    this.placeholderElement = placeholderElement || this.getPlaceholderElement();

    this.placeholderElement.innerHTML = `<span class="lightText">${this.node.attrs.placeholder}</span>`;

    this.bindPlaceholderClick();

    this.dom.appendChild(this.placeholderElement);
  }

  hidePlaceholder() {
    const placeholderElement = this.dom.querySelector('.placeholder');
    placeholderElement?.remove();

    this.placeholderElement?.removeEventListener('click', this.handlePlaceholderClick);
    this.placeholderElement = null;
  }

  update(node: Node) {
    if (node.type !== this.node.type) return false;

    this.node = node;
    this.updatePlaceholder();

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

    this.subscribers.forEach(subscriber => subscriber.unsubscribe())
  }
}

