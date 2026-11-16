import { h, render } from 'vue';

import { EventEmit } from '../../../../../shared/event';
import Code from '../../../../../../../../../apps/dataQuery/src/components/Messages/hooks/extensions/Code/index.vue';

import './index.less';

export class Chart extends EventEmit {
    private chartDOM: HTMLElement;
    private code: string = '';
    private lang: string = 'vis-id';
    private viewType: string = '';

    constructor(private mountNode: HTMLElement | null) {
        super();

        this.chartDOM = document.createElement('div');
        this.chartDOM.classList.add('doc-component-chart');

        this.mountNode?.appendChild(this.chartDOM);
    }

    handleUpdateViewType = (type) => {
        this.viewType = type;

        this.emit('changeViewType', type);
    }

    render(code, lang, viewType) {
        if (!this.chartDOM) return;

        this.code = code;
        this.lang = lang;
        this.viewType = viewType;

        render(h(Code, {
            code: this.code,
            lang: this.lang,
            viewType: this.viewType,
            onUpdateViewType: this.handleUpdateViewType,
        }), this.chartDOM);
    }

    destory = () => {
        super.destroy();

        if (!this.mountNode) {
           return;
        }

        // 清理 vue 组件
        render(null, this.chartDOM);

        this.mountNode = null;
        this.chartDOM.remove();
    }
}