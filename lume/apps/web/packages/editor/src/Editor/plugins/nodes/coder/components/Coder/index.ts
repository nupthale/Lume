import { h, render } from 'vue';
import { Subscription } from 'rxjs';
import { filter, tap } from 'rxjs/operators';

import {CodeJar} from 'codejar';
import { withLineNumbers } from "codejar-linenumbers";
import Prism from 'prismjs';

// 引入需要的语言包
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-markdown';
import 'prismjs/themes/prism.css';  // 主题样式

import Toolbar from '../Toolbar/index.vue';
import { EventEmit } from '../../../../../shared/event';
import { focusAtEnd$ } from '../../../../../event';

import 'codejar-linenumbers/es/codejar-linenumbers.css';
import './index.less';

export class Coder extends EventEmit {
    private editor: CodeJar  | null = null;

    private toolbarDOM: HTMLElement;
    private editorDOM: HTMLElement;
    private code: string = '';
    private language: string = '';

    private subscribers: Subscription[] = [];

    constructor(private mountNode: HTMLElement | null, private id: string) {
        super();

        this.toolbarDOM = document.createElement('div');
        this.toolbarDOM.classList.add('doc-component-codeToolbar');
        
        this.editorDOM = document.createElement('div');

        // 必须比 CodeJar 先注册 keydown：CodeJar 内部会拦截 Tab 并用 tab 替换选区，
        // 先注册才能在它之前 preventDefault，从而走自定义的整行缩进逻辑
        this.editorDOM.addEventListener('keydown', this.handleKeydown);

        this.editor = CodeJar(this.editorDOM, withLineNumbers(this.highlight), { tab: '\t' });

        this.mountNode?.appendChild(this.toolbarDOM);
        this.mountNode?.appendChild(this.editorDOM);

        this.initEvt();
    }

    highlight = (editor) => {
        let code = editor.textContent;

        if (Prism.languages[this.language]) {
            code = Prism.highlight(code, Prism.languages[this.language], this.language);
        }
        
        editor.innerHTML = code;
    };

    setLanguage(language: string) {
        if (!this.editorDOM) return;
        
        // 移除旧的语言类
        this.editorDOM.className = '';
        // 添加新的语言类
        this.editorDOM.classList.add('language-' + language);
    }

    render(code, language) {
        if (!this.editorDOM || !this.editor) return;

        this.code = code;
        this.language = language;

        this.renderToolbar();

        this.setLanguage(language);
        this.editor.updateCode(code);
    }

    renderToolbar = () => {
        render(h(Toolbar, {
            language: this.language,
            onChangeLanguage: (language) => {
                this.render(this.code, language); // 重新渲染代码块，语言改变

                this.setLanguage(language);
                this.emit('changeLanguage', language);
            },
        }), this.toolbarDOM);
    }

    isAtCodeStart = () => {
        const jar = this.editor;
        if (!jar) return false;

        try {
            // save() 返回相对整个代码文本的绝对偏移，能正确处理：
            // 1) Prism 高亮把文本拆成多个 text node，focusOffset 只是相对某个节点的偏移
            // 2) 有选区时 focus 是“移动端”，而这里关心的是选区起点是否在 0
            const pos = jar.save();
            return Math.min(pos.start, pos.end) === 0;
        } catch (e) {
            return false;
        }
    }

    handleKeydown = (e) => {
        if (!this.isAtCodeStart()) {
            e.stopPropagation();
        }

        if (e.key === 'Tab') {
            // 有选区时：对选中行整体缩进/取消缩进，而不是用 tab 替换选区
            const selection = window.getSelection();
            if (selection && !selection.isCollapsed) {
                e.preventDefault();
                this.indentLines(e.shiftKey);
            }
            // 无选区时：交给 CodeJar 默认处理（插入 tab / Shift+Tab 取消缩进）
            return;
        }

        // 检查是否是 Mod+A
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
            // 阻止默认行为
            e.preventDefault();

            // 全选代码内容
            const range = document.createRange();
            range.selectNodeContents(this.editorDOM);
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);
        }
    }

    /**
     * 对选区所在的行整体缩进（outdent=false）或取消缩进（outdent=true）
     */
    indentLines = (outdent: boolean) => {
        const jar = this.editor;
        if (!jar) return;

        try {
            const pos = jar.save();
            const code = jar.toString();
            const lines = code.split('\n');

            const start = Math.min(pos.start, pos.end);
            const end = Math.max(pos.start, pos.end);

            // 记录每行行首的偏移，并定位选区起止所在的行
            const lineStarts: number[] = [0];
            const deltas: number[] = [];
            let offset = 0;
            let startLine = 0;
            let endLine = 0;
            for (let i = 0; i < lines.length; i++) {
                if (start >= offset) startLine = i;
                if (end >= offset) endLine = i;
                deltas[i] = 0;
                offset += lines[i].length + (i < lines.length - 1 ? 1 : 0);
                lineStarts.push(offset);
            }

            // 对每一行做缩进/取消缩进，deltas 记录每行的字符变化量
            for (let i = startLine; i <= endLine; i++) {
                if (outdent) {
                    const removed = lines[i].match(/^(?:[ ]{4}|\t|[ ]{2})/)?.[0].length ?? 0;
                    if (removed > 0) {
                        lines[i] = lines[i].slice(removed);
                        deltas[i] = -removed;
                    }
                } else {
                    lines[i] = '\t' + lines[i];
                    deltas[i] = 1;
                }
            }

            const newCode = lines.join('\n');
            jar.recordHistory();
            jar.updateCode(newCode);

            // 光标偏移：加上所有位于光标之前的插入/删除字符数
            const adjust = (x: number) => {
                let d = 0;
                for (let i = startLine; i <= endLine; i++) {
                    if (lineStarts[i] < x) d += deltas[i];
                }
                return Math.min(Math.max(x + d, 0), newCode.length);
            };

            pos.start = adjust(pos.start);
            pos.end = adjust(pos.end);
            jar.restore(pos);
        } catch (e) {
            // 忽略异常，保持编辑器原状
        }
    }

    initEvt() {
        // keydown 已在 constructor 中注册（先于 CodeJar），这里不再重复监听
        this.editor?.onUpdate((code) => {
            this.code = code;
            this.emit('changeCode', code);
        });

        const focusAtEndSubscriber = focusAtEnd$.pipe(
            filter(({ id }) => Boolean(id && id === this?.id)),
            tap(() => {
                // 将光标移到编辑器末尾
                const range = document.createRange();
                range.selectNodeContents(this.editorDOM);
                range.collapse(false); // false 表示collapse到末尾
                const selection = window.getSelection();
                selection?.removeAllRanges();
                selection?.addRange(range);
            }),
        ).subscribe();
        this.subscribers.push(focusAtEndSubscriber);
    }

    destory = () => {
        super.destroy();

        if (!this.mountNode) {
           return;
        }

        // 清理 vue 组件
        render(null, this.toolbarDOM);

        this.editorDOM.removeEventListener('keydown', this.handleKeydown);

        this.subscribers.forEach((subscriber) => subscriber.unsubscribe());

        this.mountNode = null;
        this.editor = null;
        this.toolbarDOM.remove();
        this.editorDOM.remove();
    }
}