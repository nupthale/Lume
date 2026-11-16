import { useSubscription } from '@vueuse/rxjs';
import { filter, tap } from 'rxjs/operators';
import { ref, Ref } from 'vue';
import { message } from 'ant-design-vue';
import i18next from 'i18next';
import { EditorView } from 'prosemirror-view';
import { Fragment, Node } from 'prosemirror-model';

import { getText } from '@editor/Editor/components/Catalog/util';

import { removeComment } from '../plugins/core/copyPaste';
import { exportToJSON$, exportToMarkdown$, exportToPDF$ } from '../event';
import { toMarkdown } from '../shared/markdown';
import { exportPDF } from '../../EditorComponent/exportPDF';

const clone = (node: Fragment | Node) => {
    if (node instanceof Fragment) {
        const content = node.content.map(item => clone(item))

        return Fragment.from(content);
    }

    if (!(node instanceof Node)) {
        return node;
    }

    if (node.isText) {
        return removeComment(node);
    }

    if (!node.isBlock) {
        return node;
    }

    const content: Node[] = [];
    node.content.forEach(item => {
        content.push(clone(item));
    });

    return node.type.create(node.attrs, content, node.marks);
}

export const useExport = (getView: () => EditorView | null) => {
    const isExporting = ref(false);

    const serializeDoc = (_fileId) => {
        // 去除comment
        const view = getView();

        const doc = view!.state.doc;
        const newDoc = clone(doc);
        const docJSON = newDoc.toJSON();

        const title = getText(docJSON.content?.[0]?.content) || i18next.t('doc.head.titlePlaceholder');

        return {
            doc: docJSON,
            title,
        };
    }

    const downloadJson = (json) => {
        // 导出json文件
        const dataStr = JSON.stringify(json, null, 2);
        const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
        
        const exportFileDefaultName = `${json.title}.json`;
        
        const linkElement = document.createElement('a');
        linkElement.setAttribute('href', dataUri);
        linkElement.setAttribute('download', exportFileDefaultName);
        linkElement.click();
    }

    const downloadMarkdown = (title: string, markdown: string) => {
        // 导出markdown文件
        const dataUri = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(markdown);
        
        const exportFileDefaultName = `${title}.md`;
        
        const linkElement = document.createElement('a');
        linkElement.setAttribute('href', dataUri);
        linkElement.setAttribute('download', exportFileDefaultName);
        linkElement.click();
    }

    useSubscription(
        exportToJSON$.pipe(
            filter(() => !isExporting.value),
            tap(({ fileId }) => {
                isExporting.value = true;

                const hide = message.loading(i18next.t('common.exportPending'));

                try {
                    const json = serializeDoc(fileId);

                    // 导出json文件
                    downloadJson(json);
                } catch(e) {
                    message.error(i18next.t('export.failedMessage'));
                    console.error(e);
                } finally {
                    isExporting.value = false;

                    hide();
                }
            }),
        ).subscribe(),
    );

    useSubscription(
        exportToMarkdown$.pipe(
            filter(() => !isExporting.value),
            tap(({ fileId }) => {
                isExporting.value = true;

                const hide = message.loading(i18next.t('common.exportPending'));

                try {
                    const json = serializeDoc(fileId);

                    const markdown = toMarkdown(json.title, json.doc);

                    // 导出markdown文件
                    downloadMarkdown(json.title, markdown);
                } catch(e) {
                    message.error(i18next.t('export.failedMessage'));
                    console.error(e);
                } finally {
                    isExporting.value = false;

                    hide();
                }
            })
        ).subscribe(),
    );

    useSubscription(
        exportToPDF$.pipe(
            filter(() => !isExporting.value),
            tap(({ title }) => {
                isExporting.value = true;

                const hide = message.loading(i18next.t('common.exportPending'));

                const view = getView();

                if (!view) {
                    message.error(i18next.t('export.failedMessage'));
                    isExporting.value = false;
                    hide();
                    return;
                }

                // 导出 PDF 文件（html2canvas + jsPDF，无打印弹窗）
                exportPDF(view, { title })
                    .catch(e => {
                        message.error(i18next.t('export.failedMessage'));
                        console.error(e);
                    })
                    .finally(() => {
                        isExporting.value = false;
                        hide();
                    });
            })
        ).subscribe(),
    );
}