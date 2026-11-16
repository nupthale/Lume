import { html, render } from 'lit-html';
import { Fragment, Slice } from 'prosemirror-model';
import { message } from 'ant-design-vue';

import { EventEmit } from '@editor/Editor/shared/event';

import { headers } from '../../../../../../../../../apps/dataQuery/src/api/agent/index';
import { openPreviewSider$ } from '../../../../../../../../../apps/dataQuery/src/modules/PreviewSider/event';
import { BaseBlockView } from '../../../_common/baseBlockView';

import { markdownToBlock } from '@editor/Editor/plugins/markdown/markdownToBlock';

import { getDocText } from './util';
import './index.less';

export class SubmitBtn extends EventEmit {

    private container: HTMLElement | null = null;

    private loading = false;

    private abortCtrl: AbortController | null = null;

    constructor(private queryNode: BaseBlockView) {
        super();

        this.queryNode = queryNode;
    }

    get id() {
        return this.queryNode.node.attrs.id;   
    }

    getQuery = () => {
        const query = getDocText(this.queryNode.node);

        console.info('###query', query);
        return query;
    }

    handlePreview = () => {
        const query = this.getQuery();

        if (!query?.trim()?.length) {
            message.info('请输入问题');

            return;
        }

        openPreviewSider$.next({ initQuestion: query });
    }

    handleSubmit = async () => {
        try {
            const query = this.getQuery();

            if (!query?.trim()?.length) {
                message.info('请输入问题');

                return;
            }

            this.loading = true;
            this.render();

            this.abortCtrl = new AbortController();

            const result = await fetch(`/data-query-api/data/datareport/generateQueryBlock?query=${query}`, {
                method: 'get',
                headers,
                signal: this.abortCtrl?.signal,
            });

            const json = await result.json();

            const md = json.result || '';

            if (!json.success || !md?.length) {
                throw Error('请求失败');
            }

            // let md = "\n\n```vis-id\n2085597278024126466\n```\n\n\n\n";
            // replace queryBlock with block;
            this.replaceBlock(md);

        } catch(e) {
            console.error('#erorr', e);
        } finally {
            this.loading = false;
            this.render();
        }
    }

    replaceBlock = (md) => {
        const view = this.queryNode.view;
        const { state, dispatch } = view;

        try {
            const root = markdownToBlock(md);
            console.info('###block', root);

            // body content
            if (root.lastChild?.content) {
                const nodes = root.lastChild.content.content;
                if (nodes.length > 0) {
                    const tr = state.tr;
                    const pos = this.queryNode.getPos()!;
                    const resolvedPos = view.state.doc.resolve(pos + 1);

                    tr.replaceRange(resolvedPos.before(), resolvedPos.after(), new Slice(Fragment.from(nodes), 0, 0));
                    dispatch(tr);
                }
            }
        } catch(e) {
            console.error('替换失败', e);
        }
    }

    handleStop = () => {
        this.abortCtrl?.abort();

        this.loading = false;
        this.render();
    }

    template() {
        if (this.loading) {
            return html`
                <div class="doc-queryBtns flex-shrink-0">
                    <div class="doc-querySubmitBtn !w-fit loading">
                        <div class="animate-spin origin-center">
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-loader-pinwheel-icon lucide-loader-pinwheel"><path d="M22 12a1 1 0 0 1-10 0 1 1 0 0 0-10 0"/><path d="M7 20.7a1 1 0 1 1 5-8.7 1 1 0 1 0 5-8.6"/><path d="M7 3.3a1 1 0 1 1 5 8.6 1 1 0 1 0 5 8.6"/><circle cx="12" cy="12" r="10"/></svg>
                        </div>
                        <div @click=${this.handleStop} class="doc-querySubmitBtn__stop">停止</div>
                    </div>
                </div>
            `;
        }

        return html`
            <div class="doc-queryBtns">
                <div class="doc-querySubmitBtn" @click=${this.handleSubmit}>
                    <div aria-label="执行" data-microtip-position="top" role="tooltip">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#A07CFE" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-send-horizontal-icon lucide-send-horizontal"><path d="M3.714 3.048a.498.498 0 0 0-.683.627l2.843 7.627a2 2 0 0 1 0 1.396l-2.842 7.627a.498.498 0 0 0 .682.627l18-8.5a.5.5 0 0 0 0-.904z"/><path d="M6 12h16"/></svg>
                    </div>
                </div>
                <div class="doc-querySubmitBtn" @click=${this.handlePreview}>
                    <div aria-label="预览" data-microtip-position="top" role="tooltip">
                        <svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-eye-icon lucide-eye"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>
                    </div>
                </div>
            </div>
        `;
    }

    init() {
        this.container = document.createElement('div');
        this.container.contentEditable = 'false';

        this.render();

        return this.container;
    }

    render() {
        if (!this.container) return;

        render(this.template(), this.container);
    }

    destroy() {
        this.abortCtrl?.abort();

        // 清空渲染内容
        render(null, this.container!);
    }
}