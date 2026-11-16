<script lang="tsx">
import { defineComponent, ref, computed, watch } from 'vue';
import { Input } from 'ant-design-vue';
import { X } from 'lucide-vue-next';
import { useSubscription } from '@vueuse/rxjs';
import { filter, tap } from 'rxjs/operators';
import { EditorView } from 'prosemirror-view';
import {
    SearchQuery,
    getSearchState,
    setSearchState,
    findNext,
    findPrev,
    replaceNext,
    replaceAll,
} from 'prosemirror-search';
import { TextButton } from '@zsfe/zsui';

import { contextStore } from '../../store/context';
import { searchPanel$, docChanged$, selectionChange$ } from '../../event';

export default defineComponent({
    setup(_props) {
        const visible = ref(false);
        const activeTab = ref<'find' | 'replace'>('find');
        const searchText = ref('');
        const replaceText = ref('');
        // 当前匹配序号 / 匹配总数
        const currentIndex = ref(0);
        const matchCount = ref(0);

        const searchInputRef = ref();

        const query = computed(() => new SearchQuery({ search: searchText.value, replace: replaceText.value }));

        const getCountText = computed(() => `${currentIndex.value || 0}/${matchCount.value || 0}`);

        const getView = (): EditorView | null => contextStore.getState().editorView;

        // 应用查询并计算匹配数量
        const applyQuery = () => {
            const view = getView();
            if (!view) return;

            const tr = view.state.tr;
            tr.setMeta('addToHistory', false);
            setSearchState(tr, query.value);
            view.dispatch(tr);

            computeMatches();
        };

        // 统计全文匹配数量，以及当前选中所命中的匹配序号
        const computeMatches = () => {
            const view = getView();
            if (!view) return;

            const { state } = view;
            const searchState = getSearchState(state);

            if (!searchState || !searchState.query.valid) {
                matchCount.value = 0;
                currentIndex.value = 0;
                return;
            }

            const { from, to } = state.selection;
            let count = 0;
            let current = 0;

            for (let pos = 0;;) {
                const next = searchState.query.findNext(state, pos);
                if (!next) break;
                count++;
                if (next.from === from && next.to === to) current = count;
                pos = Math.max(next.to, pos + 1);
            }

            matchCount.value = count;
            currentIndex.value = current;
        };

        const runCommand = (command: (state, dispatch) => boolean, focusEditor = true) => {
            const view = getView();
            if (!view) return;

            command(view.state, view.dispatch);
            // 从输入框触发时不能抢焦点，否则输入框会失焦
            if (focusEditor) view.focus();

            computeMatches();
        };

        const handleFindNext = () => runCommand(findNext);
        const handleFindPrev = () => runCommand(findPrev);
        const handleReplace = () => runCommand(replaceNext);
        const handleReplaceAll = () => runCommand(replaceAll);

        // 替换文本变化时，同步更新编辑器中的查询，确保替换内容生效
        watch(replaceText, () => {
            if (searchText.value) {
                applyQuery();
            }
        });

        const handleSearchInput = (e) => {
            searchText.value = e.target.value || '';

            if (!searchText.value) {
                matchCount.value = 0;
                currentIndex.value = 0;
                return;
            }

            // 输入时只做全体高亮 + 计数，不选中匹配
            applyQuery();
        };

        const open = (mode: 'find' | 'replace') => {
            activeTab.value = mode;
            visible.value = true;

            // 恢复上次的查询
            if (searchText.value) {
                applyQuery();
            }

            setTimeout(() => {
                searchInputRef.value?.focus();
            }, 0);
        };

        const close = () => {
            visible.value = false;

            // 清除高亮
            if (searchText.value) {
                const view = getView();
                if (!view) return;

                const tr = view.state.tr;
                tr.setMeta('addToHistory', false);
                setSearchState(tr, new SearchQuery({ search: '' }));
                view.dispatch(tr);
            }
        };

        const handleKeydown = (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();

                // 在输入框内按 Enter 查找，焦点保持在输入框
                if (e.shiftKey) {
                    runCommand(findPrev, false);
                } else {
                    runCommand(findNext, false);
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                close();
            }
        };

        useSubscription(
            searchPanel$.pipe(
                filter(({ fileId }) => {
                    const docInfo = contextStore.getState().docInfo;

                    if (fileId && docInfo?.fileId) {
                        return fileId === docInfo.fileId;
                    }

                    return true;
                }),
                tap(({ mode }) => open(mode || 'find')),
            ).subscribe(),
        );

        // 文档或选区变化时，更新匹配计数
        useSubscription(docChanged$.pipe(tap(() => computeMatches())).subscribe());
        useSubscription(selectionChange$.pipe(tap(() => computeMatches())).subscribe());

        const renderTabs = () => {
            const tabs: { key: 'find' | 'replace', label: string }[] = [
                { key: 'find', label: '查找' },
                { key: 'replace', label: '替换' },
            ];

            return (
                <div class="flex items-center gap-6">
                    {tabs.map((tab) => (
                        <div
                            key={tab.key}
                            class={['search-tab', activeTab.value === tab.key ? 'active' : '']}
                            onClick={() => {
                                activeTab.value = tab.key;
                                open(tab.key);
                            }}
                        >
                            {tab.label}
                        </div>
                    ))}
                </div>
            );
        };

        const renderFooterBtn = (label: string, onClick: () => void, disabled: boolean, primary = false) => {
            return (
                <button
                    class={['footer-btn', primary ? 'primary' : '']}
                    disabled={disabled}
                    onClick={onClick}
                >
                    {label}
                </button>
            );
        };

        return () => visible.value ? (
            <div class="dropdownContainer search-replace-panel" onKeyDown={handleKeydown}>
                <div class="flex items-center justify-between relative">
                    {renderTabs()}
                    <TextButton class="absolute top-[-8px]" onClick={close}>
                        <X size={18} />
                    </TextButton>
                </div>

                <div class="divider"></div>

                <div class="flex flex-col gap-4 mt-4">
                    <div>
                        {activeTab.value === 'replace' && <div class="input-label">查找</div>}
                        <Input
                            ref={searchInputRef}
                            value={searchText.value}
                            onChange={handleSearchInput}
                            placeholder="请输入文字"
                            suffix={<span class="count-text">{getCountText.value}</span>}
                        />
                    </div>

                    {activeTab.value === 'replace' && (
                        <div>
                            <div class="input-label">替换为</div>
                            <Input
                                value={replaceText.value}
                                onChange={(e) => replaceText.value = e.target.value || ''}
                                placeholder="请输入文字"
                            />
                        </div>
                    )}

                    <div class="flex items-center justify-end gap-3 mt-2">
                        {activeTab.value === 'replace' && (
                            <>
                                {renderFooterBtn('全部替换', handleReplaceAll, !matchCount.value, true)}
                                {renderFooterBtn('替换', handleReplace, !matchCount.value)}
                            </>
                        )}
                        {renderFooterBtn('上一处', handleFindPrev, !matchCount.value)}
                        {renderFooterBtn('下一处', handleFindNext, !matchCount.value)}
                    </div>
                </div>
            </div>
        ) : null;
    }
});
</script>

<style>
/* 查找匹配高亮（全局）：所有匹配黄色背景，当前选中的匹配橙色 */
.ProseMirror-search-match {
    background-color: #ffc60a80;
}
</style>

<style scoped>
.search-replace-panel {
    position: fixed;
    top: 76px;
    right: 32px;
    z-index: 1100;
    width: 400px;
    padding: 16px;
}

.search-tab {
    position: relative;
    padding-bottom: 10px;
    font-size: 16px;
    color: var(--N900);
    cursor: pointer;
}

.search-tab.active {
    font-weight: 600;
    color: var(--B600);
}

.search-tab.active::after {
    content: '';
    position: absolute;
    left: 50%;
    bottom: 0;
    transform: translateX(-50%);
    width: 24px;
    height: 3px;
    border-radius: 2px;
    background: var(--B600);
}

.close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--N600);
    cursor: pointer;
}

.divider {
    height: 1px;
    margin-top: -1px;
    background: var(--doclist-border-color, var(--N200));
}

.input-label {
    margin-bottom: 6px;
    font-size: 13px;
    color: var(--N900);
}

.count-text {
    color: var(--N500);
}

.footer-btn {
    flex: 1;
    flex-shrink: 0;
    padding: 4px 11px;
    font-size: 14px;
    color: var(--N600);
    background: #fff;
    border: 1px solid var(--N300);
    border-radius: 6px;
    cursor: pointer;
}

.footer-btn:not(:disabled):hover {
    color: var(--B600);
    border-color: var(--B600);
}

.footer-btn.primary {
    color: #fff;
    background: var(--B600);
    border-color: var(--B600);
}

.footer-btn.primary:not(:disabled):hover {
    color: #fff;
    background: var(--B700);
    border-color: var(--B700);
}

.footer-btn:disabled {
    color: var(--N400);
    background: none;
    border-color: var(--N350);
    cursor: not-allowed;
}

.footer-btn.primary:disabled {
    background: var(--N50);
}
</style>
