import i18next from 'i18next';
import { EditorView } from 'prosemirror-view';

import { getText } from '@editor/Editor/components/Catalog/util';

export interface ExportPDFOptions {
    /** PDF 文件名，默认取文档 title 块文本 */
    title?: string;
}

// A4：210mm x 297mm，四周页边距
const PAGE_MARGIN = 10; // mm
const CONTENT_WIDTH_MM = 210 - PAGE_MARGIN * 2; // 190mm
const CONTENT_HEIGHT_MM = 297 - PAGE_MARGIN * 2; // 277mm

// 渲染倍率，2 倍保证文字清晰
const RENDER_SCALE = 2;
// JPEG 压缩质量
const JPEG_QUALITY = 0.92;
// 编辑器内容区宽度（与 .w-[820px] 一致）
const CONTENT_WIDTH = 820;

interface PageRange {
    start: number;
    end: number;
}

const getDocTitle = (view: EditorView, fallbackTitle?: string) => {
    if (fallbackTitle) return fallbackTitle;

    const docJSON = view.state.doc.toJSON();

    return getText(docJSON.content?.[0]?.content) || i18next.t('doc.head.titlePlaceholder');
};

/**
 * 按文档顶层块智能分页，避免文字/图片被拦腰截断
 */
const paginate = (
    totalHeight: number,
    pageHeight: number,
    blocks: Array<{ top: number, bottom: number }>,
) => {
    const pages: PageRange[] = [];
    let pageStart = 0;
    let index = 0;

    while (index < blocks.length) {
        const block = blocks[index];
        const blockTop = Math.max(block.top, pageStart);

        if (block.bottom - pageStart <= pageHeight) {
            index++;
            continue;
        }

        if (blockTop - pageStart >= pageHeight / 2) {
            pages.push({ start: pageStart, end: blockTop });
            pageStart = blockTop;
        } else {
            pages.push({ start: pageStart, end: pageStart + pageHeight });
            pageStart += pageHeight;
        }
    }

    if (pageStart < totalHeight - 1) {
        pages.push({ start: pageStart, end: totalHeight });
    }

    if (!pages.length) {
        pages.push({ start: 0, end: totalHeight });
    }

    return pages;
};

/**
 * 克隆后直接移除的编辑态元素（协作光标、拖拽手柄、各类操作条/工具栏、占位符等）
 */
const REMOVE_SELECTORS = [
    '.ProseMirror-yjs-cursor',
    '.ProseMirror-cursor',
    '.doc-block-drag',
    '.doc-table-operation',
    '.doc-table-resizers',
    '.doc-table-scrollbar',
    '.doc-columns-operation',
    '.doc-columns-resizers',
    '.doc-columns-scrollbar',
    '.doc-component-imageToolbar',
    '.doc-image-resizer',
    '.doc-component-iframeToolbar',
    '.doc-component-iframeInput',
    '.doc-component-iframeSubmit',
    '.doc-component-codeToolbar',
    '.doc-title-header',
    '.doc-placeholder__btn',
    '.doc-highlight-iconBtn',
    '.doc-autocomplete-typing',
    '.doc-placeholder',
    '.ProseMirror-placeholder',
    '.doc-queryBtns',
    '.doc-querySubmitBtn',
];

/**
 * 需要从克隆节点移除的编辑态 class（selected / focused 等）
 */
const EDIT_STATE_CLASSES = [
    'selected',
    'focused',
    'doc-image--focused',
    'ProseMirror-selectednode',
];

/**
 * 横向滚动容器导出时需展开，避免表格/分栏内容被截断
 */
const OVERFLOW_EXPAND_SELECTORS = [
    '.doc-table-component',
    '.doc-table-component-inner',
    '.doc-table-wrap',
    '.doc-columns-component',
    '.doc-columns-component-inner',
    '.doc-columns-content',
];

/**
 * 用 inline style 做导出覆盖（不注入 style 标签，避免序列化进 foreignObject 时规则丢失）。
 * 伪元素（query 渐变边框、头像）、inline 元素背景位置等由浏览器原生渲染，无需处理。
 */
const applyExportStyles = (root: HTMLElement) => {
    const prose = root.querySelector('.prose, .ProseMirror') as HTMLElement | null;
    if (prose) {
        prose.style.minHeight = '0';
        prose.style.outline = 'none';
        prose.style.backgroundColor = '#ffffff';
        prose.style.caretColor = 'transparent';
    }

    OVERFLOW_EXPAND_SELECTORS.forEach(selector => {
        root.querySelectorAll<HTMLElement>(selector).forEach(el => {
            el.style.overflow = 'visible';
        });
    });

    // 评论标记去除下划线和背景
    ['.doc-comment', '.doc-comment-active'].forEach(selector => {
        root.querySelectorAll<HTMLElement>(selector).forEach(el => {
            el.style.borderBottom = 'none';
            el.style.background = 'none';
        });
    });
};

/**
 * cloneNode 不会复制 canvas 的位图内容（克隆出的 canvas 是空画布），
 * 图表（ECharts 等）导出会空白。
 * 在克隆前把原始 DOM 中每个 canvas 快照为 dataURL，
 * 再按文档序一一对应替换克隆树中的 canvas 为 img。
 * img 使用原始 canvas 的 CSS 尺寸，保持布局不变。
 */
const snapshotCanvases = (originalRoot: HTMLElement, clonedRoot: HTMLElement) => {
    const originalCanvases = Array.from(originalRoot.querySelectorAll('canvas'));
    const clonedCanvases = Array.from(clonedRoot.querySelectorAll('canvas'));

    originalCanvases.forEach((canvas, i) => {
        const cloned = clonedCanvases[i];
        if (!cloned) return;

        try {
            const dataUrl = canvas.toDataURL('image/png');
            const img = document.createElement('img');
            img.src = dataUrl;
            // 用原始 canvas 的 CSS 尺寸，避免 devicePixelRatio 缩放导致尺寸错位
            const width = canvas.getBoundingClientRect().width || canvas.width;
            const height = canvas.getBoundingClientRect().height || canvas.height;
            img.style.width = `${width}px`;
            img.style.height = `${height}px`;
            img.style.display = 'block';
            cloned.replaceWith(img);
        } catch (e) {
            // 跨域污染的 canvas 无法 toDataURL，保留原样
            console.warn('exportPDF: canvas snapshot failed', e);
        }
    });
};

/**
 * 等待图表动画播放完成：VChart 等图表库默认带入场动画（渐入/生长），
 * 主题切换触发的重建会重新播放动画，固定延时无法保证截到完整画面。
 * 轮询比较所有 canvas 的位图内容，连续两轮无变化即认为稳定。
 */
const waitForChartsStable = async (root: HTMLElement, timeout = 3000) => {
    const getFingerprint = () => {
        const canvases = Array.from(root.querySelectorAll('canvas'));
        return canvases.map(canvas => {
            try {
                return canvas.toDataURL('image/png');
            } catch {
                // 跨域污染的 canvas 无法 toDataURL，视为稳定
                return 'X';
            }
        }).join('|');
    };

    const pollInterval = 150;
    let last = getFingerprint();
    const start = Date.now();

    while (Date.now() - start < timeout) {
        await new Promise<void>(resolve => setTimeout(resolve, pollInterval));
        const current = getFingerprint();

        if (current === last) return; // 两轮无变化，动画结束
        last = current;
    }
    // 超时兜底：按当前状态导出
};

/**
 * 从所有样式表收集 CSS 自定义属性名（--xxx）
 */
const collectVarNames = (): Set<string> => {
    const names = new Set<string>();
    const varRe = /(--[a-zA-Z0-9-]+)\s*:/g;

    Array.from(document.styleSheets).forEach(sheet => {
        let rules: CSSRuleList | null = null;
        try {
            rules = sheet.cssRules;
        } catch {
            return; // 跨域样式表无法读取
        }
        if (!rules) return;

        for (let i = 0; i < rules.length; i++) {
            const text = rules[i].cssText;
            if (!text.includes('--')) continue;

            let m: RegExpExecArray | null;
            varRe.lastIndex = 0;
            while ((m = varRe.exec(text))) {
                names.add(m[1]);
            }
        }
    });

    return names;
};

/**
 * 同步探取 light 主题的变量值：
 * 摘掉 data-theme → 读 computed（此时为 light 值）→ 立即恢复。
 * 全程在同一同步代码块内完成，浏览器不会渲染中间态；
 * theme store 的 MutationObserver 在微任务时机读到的已是恢复后的值，不会触发图表重绘。
 */
const probeLightVars = (htmlEl: HTMLElement, varNames: Set<string>): Map<string, string> => {
    const wasDark = htmlEl.getAttribute('data-theme') === 'dark';
    if (wasDark) htmlEl.removeAttribute('data-theme');

    const computed = getComputedStyle(htmlEl);
    const lightVars = new Map<string, string>();
    varNames.forEach(name => {
        const value = computed.getPropertyValue(name).trim();
        if (value) lightVars.set(name, value);
    });

    if (wasDark) htmlEl.setAttribute('data-theme', 'dark');

    return lightVars;
};

/**
 * 把当前（dark）主题的变量值内联到 html.style：
 * 内联样式优先级高于 :root 规则，随后移除 data-theme 时页面视觉完全不变
 */
const freezeThemeVars = (htmlEl: HTMLElement, varNames: Set<string>): string[] => {
    const computed = getComputedStyle(htmlEl);
    const applied: string[] = [];

    varNames.forEach(name => {
        const value = computed.getPropertyValue(name).trim();
        if (value) {
            htmlEl.style.setProperty(name, value);
            applied.push(name);
        }
    });

    return applied;
};

const unfreezeThemeVars = (htmlEl: HTMLElement, applied: string[]) => {
    applied.forEach(name => htmlEl.style.removeProperty(name));
};

/**
 * 图表按 light 重绘期间，用同背景色色块盖住图表容器，
 * 遮住 dark→light→dark 的位图闪变（页面其余部分因变量冻结保持不变）
 */
const coverCharts = (scope: HTMLElement): Array<{ chart: HTMLElement, cover: HTMLElement, originalPosition: string }> => {
    const covers: Array<{ chart: HTMLElement, cover: HTMLElement, originalPosition: string }> = [];

    scope.querySelectorAll<HTMLElement>('.doc-chart-container').forEach(chart => {
        // 向上找最近的非透明背景色
        let bg = 'rgba(0, 0, 0, 0)';
        let el: HTMLElement | null = chart;
        while (el && bg === 'rgba(0, 0, 0, 0)') {
            bg = getComputedStyle(el).backgroundColor;
            el = el.parentElement;
        }
        if (bg === 'rgba(0, 0, 0, 0)') {
            bg = getComputedStyle(document.body).backgroundColor;
        }

        // 容器临时设为 relative，让 cover 精确覆盖且随滚动不错位
        const originalPosition = chart.style.position;
        chart.style.position = 'relative';

        const cover = document.createElement('div');
        cover.style.cssText = `position:absolute;inset:0;z-index:99;background:${bg};`;
        chart.appendChild(cover);
        covers.push({ chart, cover, originalPosition });
    });

    return covers;
};

const uncoverCharts = (covers: Array<{ chart: HTMLElement, cover: HTMLElement, originalPosition: string }>) => {
    covers.forEach(({ chart, cover, originalPosition }) => {
        cover.remove();
        chart.style.position = originalPosition;
    });
};

/**
 * 把 ProseMirror 文档内容直接导出为 PDF 文件（无打印弹窗）。
 *
 * 渲染采用 modern-screenshot（SVG foreignObject 方案）：
 * 把克隆 DOM + 每个元素的计算样式序列化进 SVG，由浏览器原生引擎渲染成 canvas。
 * 相比 html2canvas 重新实现布局引擎，原生渲染能 100% 还原：
 * - inline 元素背景位置（mark 高亮、mention 标签）
 * - 伪元素（query 块渐变 mask 边框、头像）
 * - mask-composite / z-index 堆叠
 * - canvas 图表（自动转位图）
 *
 * dark mode 处理：导出必须产出 light 效果，但页面视觉全程不变（无遮罩、无闪变）。
 * 原理：先探取 light 变量值设到离屏 root 上（供导出内容解析），
 * 再把 dark 变量值内联冻结到 html.style（内联优先级高于 :root 规则），
 * 然后移除 data-theme —— 页面视觉不变，但 theme store 的 MutationObserver
 * 感知到属性变化驱动图表按 light 重绘（canvas 位图是导出所需的）；
 * 图表重绘期间用同背景色色块盖住图表容器，导出完成后逆向恢复。
 */
export const exportPDF = async (view: EditorView, options?: ExportPDFOptions): Promise<void> => {
    const title = getDocTitle(view, options?.title);

    // 编辑器内容容器：.w-[820px].pb-[72px].mx-auto
    const editorContentEl = view.dom.closest('.w-\\[820px\\]') as HTMLElement | null
        || view.dom.parentElement as HTMLElement | null;
    if (!editorContentEl) throw new Error('Cannot find editor content container');

    // dark 模式处理：页面视觉完全不变（无遮罩、无闪变）
    // 1. 同步探取 light 变量值（浏览器不渲染中间态，图表 store 感知不到）
    // 2. 把 dark 变量值内联到 html.style（内联优先级高于 :root 规则）
    // 3. 移除 data-theme：CSS 规则层变 light，但内联 dark 值覆盖 → 页面视觉不变；
    //    theme store 的 MutationObserver 感知到属性变化 → 图表按 light 重绘（canvas 位图）
    // 4. 图表重绘期间用同背景色色块盖住图表容器
    const htmlEl = document.documentElement;
    const isDark = htmlEl.getAttribute('data-theme') === 'dark';
    let lightVars: Map<string, string> | null = null;
    let frozenVars: string[] = [];
    let covers: Array<{ chart: HTMLElement, cover: HTMLElement, originalPosition: string }> = [];

    // 离屏克隆容器（820px 宽白底，与编辑器内容区一致）。
    // dark 模式下 root 显式声明 light 变量值：主文档 html 上内联的 dark 值
    // 不会影响 root 子树，克隆内容在 root 内解析为 light
    const root = document.createElement('div');
    root.style.cssText = `
        position: fixed;
        top: 0;
        left: -20000px;
        width: ${CONTENT_WIDTH}px;
        background: #ffffff;
        z-index: -1;
    `;

    try {
        // 失焦真实编辑器，隐藏光标和选区
        view.dom.blur();
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) selection.removeAllRanges();

        if (isDark) {
            const varNames = collectVarNames();
            lightVars = probeLightVars(htmlEl, varNames);
            frozenVars = freezeThemeVars(htmlEl, varNames);
            htmlEl.removeAttribute('data-theme');
            covers = coverCharts(editorContentEl);

            // root 内声明 light 变量，供克隆内容解析
            lightVars.forEach((value, name) => {
                root.style.setProperty(name, value);
            });

            // 图表经 MutationObserver → isDark watch → 重建，是异步链路，
            // 且重建会重播入场动画；先等响应式链路启动，再轮询位图稳定
            await new Promise<void>(resolve => setTimeout(resolve, 150));
            await waitForChartsStable(editorContentEl);
        }

        // 主题就绪后再克隆，canvas 快照才能拿到 light 主题的位图
        const clonedContent = editorContentEl.cloneNode(true) as HTMLElement;

        // cloneNode 不复制 canvas 位图，用原始 DOM 快照替换克隆树中的 canvas
        snapshotCanvases(editorContentEl, clonedContent);

        // 克隆出的编辑区不再是 contenteditable
        const clonedProse = clonedContent.querySelector('.prose, .ProseMirror') as HTMLElement | null;
        if (clonedProse) {
            clonedProse.removeAttribute('contenteditable');
        }

        root.appendChild(clonedContent);
        document.body.append(root);

        // 清理编辑态元素
        REMOVE_SELECTORS.forEach(selector => {
            root.querySelectorAll(selector).forEach(el => el.remove());
        });

        // 移除编辑态 class（selected / focused 等）
        EDIT_STATE_CLASSES.forEach(cls => {
            root.querySelectorAll(`.${cls}`).forEach(el => el.classList.remove(cls));
        });

        // inline style 覆盖
        applyExportStyles(root);

        // 等主题切换生效、布局稳定
        await new Promise<void>(resolve => requestAnimationFrame(() => {
            requestAnimationFrame(() => resolve());
        }));

        // 等字体加载
        try {
            await Promise.resolve(document.fonts.ready);
        } catch { /* ignore */ }

        // 按需加载
        const [{ domToCanvas }, { jsPDF }] = await Promise.all([
            import('modern-screenshot'),
            import('jspdf'),
        ]);

        const canvas = await domToCanvas(root, {
            scale: RENDER_SCALE,
            backgroundColor: '#ffffff',
        });

        const cssWidth = canvas.width / RENDER_SCALE;
        const totalHeight = canvas.height / RENDER_SCALE;
        const pxPerMm = cssWidth / CONTENT_WIDTH_MM;
        const pageHeightPx = CONTENT_HEIGHT_MM * pxPerMm;

        // 顶层块边界（基于 root 坐标系）
        const baseTop = root.getBoundingClientRect().top;
        const blocks = Array.from(
            root.querySelectorAll<HTMLElement>('.doc-block, .doc-title-container'),
        )
            .map(el => {
                const rect = el.getBoundingClientRect();

                return {
                    top: Math.max(0, rect.top - baseTop),
                    bottom: Math.min(totalHeight, rect.bottom - baseTop),
                };
            })
            .filter(b => b.bottom > b.top);

        const pages = paginate(totalHeight, pageHeightPx, blocks);

        const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
        pdf.setProperties({ title });

        pages.forEach((page, index) => {
            const sliceHeightPx = page.end - page.start;
            if (sliceHeightPx <= 0) return;

            if (index > 0) pdf.addPage();

            // 从整图裁出当前页内容
            const slice = document.createElement('canvas');
            slice.width = canvas.width;
            slice.height = Math.max(1, Math.round(sliceHeightPx * RENDER_SCALE));

            const ctx = slice.getContext('2d')!;
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, slice.width, slice.height);
            ctx.drawImage(
                canvas,
                0, Math.round(page.start * RENDER_SCALE), canvas.width, slice.height,
                0, 0, canvas.width, slice.height,
            );

            pdf.addImage(
                slice.toDataURL('image/jpeg', JPEG_QUALITY), 'JPEG',
                PAGE_MARGIN, PAGE_MARGIN,
                CONTENT_WIDTH_MM, sliceHeightPx / pxPerMm,
            );
        });

        pdf.save(`${title}.pdf`);
    } finally {
        root.remove();

        if (isDark) {
            // 恢复 data-theme：theme store 感知 → 图表按 dark 重绘（仍被 cover 盖住）；
            // html.style 上冻结的 dark 值与 :root[data-theme=dark] 规则值一致，
            // 解冻前后页面视觉均不变
            htmlEl.setAttribute('data-theme', 'dark');
            await waitForChartsStable(editorContentEl);
            unfreezeThemeVars(htmlEl, frozenVars);
            uncoverCharts(covers);
        }
    }
};
