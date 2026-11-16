import { Node } from 'prosemirror-model';
import { EditorView } from 'prosemirror-view';

import { BaseBlockView } from '../_common/baseBlockView';
import { FloatMenuTrigger } from '../_common/floatMenuTrigger';

import { Chart } from './components/Chart/index';

import './index.less';

export class ChartView extends BaseBlockView {
  floatMenuTrigger: FloatMenuTrigger;

  chart: Chart;
  chartDOM: HTMLElement;
  containerDOM: HTMLElement;

  constructor(public node: Node, public view: EditorView, public getPos: () => number | undefined) {
    super(node, view, getPos, undefined, true);

    // 创建容器元素
    this.dom.classList.add('doc-chart');
    
    this.contentDOM = null;

    this.containerDOM = document.createElement('div');
    this.containerDOM.classList.add('doc-chart-container');
    this.containerDOM.contentEditable = 'false';

    this.chartDOM = document.createElement('div');
    this.chartDOM.classList.add('w-full');

    this.containerDOM.appendChild(this.chartDOM);

    // 组装DOM结构
    this.dom.appendChild(this.containerDOM);

    this.floatMenuTrigger = new FloatMenuTrigger(this);

    this.chart = new Chart(this.chartDOM);
    this.chart.render(node.textContent || '', node.attrs.language, node.attrs.viewType);

    this.initEvt();
  }

  selectNode() {
    // 返回 false 表示不要应用选中样式
    return false;
  }

  initEvt = () => {
    this.chart.on('changeViewType', (viewType) => this.updateViewType(viewType));
  }

  update(node: Node) {
    if (node.type !== this.node.type) return false;

    if (!this.containerDOM) return false;

    this.node = node; // 更新节点
    return true;
  }

  updateViewType = (type: string) => {
    const pos = this.getPos();
    if (pos === undefined) return;

    const tr = this.view.state.tr;

    tr.setNodeAttribute(pos, 'viewType', type);
    
    this.view.dispatch(tr);
  }

  destroy() {
    super.destroy();

    this.floatMenuTrigger.destroy();

    this.chart.destory();
  }
}

