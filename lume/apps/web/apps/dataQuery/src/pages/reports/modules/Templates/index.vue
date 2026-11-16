<script lang="tsx">
import { defineComponent, computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useInfiniteScroll } from '@vueuse/core';
import { Dropdown, Menu } from 'ant-design-vue';
import { Ellipsis, Trash2 } from 'lucide-vue-next';
import { TextButton, UserAvatar } from '@zsfe/zsui';
import { useRouter, RouterView } from 'vue-router';

import DocsEmptyIllustration from '@/components/icons/DocsEmptyIllustration.vue';
import { useReportsStore } from '@/store/ui-states/reports/index';
import { useTemplates } from '@/store/queries/report/useTemplates';
import { ReportTemplateVO } from '@/api/dataQuery/interface';
import { formatDiffTime } from '@/utils/date';
import HighlightText from '@/components/HighlightText/index.vue';

import { useFileActions } from './hooks/useFileActions';
import { useMainScrollable } from '../../hooks/useMainScrollable';

export default defineComponent({
  setup() {
    const router = useRouter();

    const { isScrollable, scrollEl, scrollContentEl } = useMainScrollable();

    const reportStore = useReportsStore();
    const { searchText } = storeToRefs(reportStore);

    const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, refetch } = useTemplates({searchKey: searchText});

    const files = computed<ReportTemplateVO[]>(() => { 
        return data.value?.pages?.flatMap((page: any) => page?.result?.records ?? []) ?? [];
    });

    useInfiniteScroll(
        scrollEl,
        () => {
            fetchNextPage();
        },
        {
            distance: 20,
            canLoadMore: () => hasNextPage.value && !isFetchingNextPage.value,
        }
    );

    const {
        handleDeleteTemplate,
     } = useFileActions(refetch);

    const handleDocClick = (file) => {
        router.replace(`/template/${file.id}`);
    }

    const renderEmpty = () => {
        let text = '您还没有模板';

        if (searchText.value?.length) {
          text = '没有找到相关模板，试试其他关键词吧';
        }

        return (
            <div class="docs-empty">
                <div class="docs-empty_illustration ">
                    <DocsEmptyIllustration />
                </div>
                <div class="docs-empty_text">
                    {text}
                </div>
            </div>
        );
    }

    const renderDocs = () => {

        if (!files.value?.length && !isLoading.value) return renderEmpty();

        return files.value?.map((file) => (
            <div class="list-row" onClick={() => handleDocClick(file)}>
                <div class="flex items-center">
                    <div class="mr-3 flex-shrink-0">
                        {
                            file.templateIcon ? (
                                <div class="w-[22px] flex items-center justify-center">
                                    {file.templateIcon}
                                </div>
                            ) : (
                                <div class="docIcon"></div>
                            )
                        }
                    </div>

                    <div class="flex-1 overflow-hidden">
                        <div class="flex items-center">
                            <HighlightText text={file.templateName || '未命名模板'} highlightText={searchText.value}  />
                        </div>
                    </div>
                </div>
                <div>
                    <div class="flex items-center gap-2 lightColor">
                        <UserAvatar username={file?.realname} showText={false} />
                        {file?.realname || '-'}
                    </div>
                </div>
                <div class="lightColor">{formatDiffTime(file.createTime!)}</div>
                <div class="lightColor">{formatDiffTime(file.updateTime!)}</div>
                <div class="text-right" onClick={e => e.stopPropagation()}>
                    <Dropdown placement="bottomRight" trigger="click">
                        {{
                            default: () => (
                                <TextButton>
                                    <Ellipsis strokeWidth="1" width="20px" />
                                </TextButton>
                            ),
                            overlay: () => (
                                <div class="overlay" style="width: 170px;">
                                    <Menu>
                                        <Menu.Item onClick={() => handleDeleteTemplate(file)}>
                                            <div class="flex items-center">
                                                <Trash2 class="mr-2" width="14px" height="14" />
                                                删除
                                            </div>
                                        </Menu.Item>
                                    </Menu>
                                </div>
                            ),
                        }}
                    </Dropdown>
                </div>
            </div>
        ));
    }

    return () => (
      <div class="flex flex-col" style={{height: 'calc(100vh - 70px)'}}>
        <div class="list flex-1 overflow-y-auto" ref={scrollEl}>
            <div ref={scrollContentEl}>
                <div class="list-head">
                    <div>标题</div>
                    <div>归属</div>
                    <div>创建时间</div>
                    <div>最近更新</div>
                    <div class="text-right">操作</div>
                </div>
                <div class="list-body">
                    {renderDocs()}

                    {
                        !hasNextPage.value && isScrollable.value && (
                            <div class="docs-footer">
                                <span class="px-3.5">已经到底了</span>
                            </div>
                        )
                    }
                </div>
            </div>
        </div>

        <RouterView />
      </div>
    );
  }
});
</script>

<style scoped lang="less">

.list {
    padding: 0 24px 32px 12px;
}

.list-head, .list-row {
    position: relative;
    display: grid;
    grid-template-columns: 12fr 4fr 4fr 4fr 1fr;
    height: 52px;
    align-items: center;
    padding: 0 24px;
}

.list-head {
    color: var(--light-text-color);
    font-weight: 500;
}

.list-row {
    color: var(--text-color);
    font-weight: 400;
    border-radius: 8px;
    cursor: pointer;

    &:before {
        content: '';
        position: absolute;
        height: 1px;
        right: 4px;
        left: 14px;
        top: 0;
        background: var(--doclist-border-color);
    }

    &:hover {
        background: var(--fill-color);
    }

    &:hover:before {
        background: transparent;
    }

    &:hover .doc-favoriteBtn {
        opacity: 1;
    }
}

.doc-favoriteBtn {
    opacity: 0;
}

.list-row:hover + .list-row::before {
    background: var(--body-bg);
}

.docIcon {
    width: 22px;
    height: 22px;
    background: url('@/assets/journal-round.svg') no-repeat center;
    background-size: contain;
}

.docEmoji {
    font-size: 22px;
    width: 22px;
    display: flex;
    justify-content: center;
}

.docs-head {
    position: sticky;
    top: 0;
    background: var(--blur-bg);
    backdrop-filter: blur(4px);
    z-index: 1;

    padding: 18px 24px 18px 26px;
    font-size: 20px;
    font-weight: 500;
    border-bottom: 1px solid var(--default-border-color);
}

.docs-title {
    font-size: 20px!important;
    font-weight: 500!important;

    transition: color .3s ease;
}

.docs-title.active {
    color: var(--primary-text-color);
}

.docs-footer {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px 0;
    text-align: center;
    color: #8f959e;
}

.docs-footer:before {
    display: inline-flex;
    content: "";
    height: 1px;
    width: 5%;
    background: linear-gradient(90deg, #8f959e00, #8f959e);
}

.docs-footer:after {
    display: inline-flex;
    content: "";
    height: 1px;
    width: 5%;
    background: linear-gradient(90deg, #8f959e, #8f959e00);
}

.docs-empty, .docs-loading {
    text-align: center;
    margin: 100px auto;
    width: 400px;
    left: 0;
    right: 0;
}

.docs-empty_illustration {
    display: flex;
    justify-content: center;
}

.docs-empty_text {
    color: #646a73;
}

.docTag {
    color: #646a73;
    font-size: 12px;
}

.createDocBtn {
    padding: 4px 10px 4px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    box-shadow: none;
    outline: none;
}

.createDocBtn-blank {
    color: var(--createBlankDocBtn-color);
    background: var(--createBlankDocBtn-bg);
}

.createDocBtn-blank:hover {
    color: rgb(46, 109, 233);
    background: rgba(2, 82, 243, 0.24);
}

.createDocBtn-template {
    color: var(--createTemplateDocBtn-color);
    background: var(--createTemplateDocBtn-bg);
}

.createDocBtn-template:hover {
    color: rgb(94, 2, 210);
    background: rgba(94, 2, 210, 0.12);
}
</style>