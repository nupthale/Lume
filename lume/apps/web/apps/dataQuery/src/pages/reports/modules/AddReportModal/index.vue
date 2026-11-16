<script lang="tsx">
import { defineComponent, ref, computed, toRef } from 'vue';
import { storeToRefs } from 'pinia';
import { useInfiniteScroll } from '@vueuse/core';
import { Modal } from 'ant-design-vue';
import { useRouter } from 'vue-router';

import { postDataReportDetailAdd } from '@/api/dataQuery/dataReportDetail';
import { useReportsStore } from '@/store/ui-states/reports/index';
import { useTemplates } from '@/store/queries/report/useTemplates';
import { ReportTemplateVO } from '@/api/dataQuery/interface';
import { updateReports$ } from '@/store/queries/report/useReports.tsx';

import { formatDiffTime } from '@/utils/date';

export default defineComponent({
    setup() {
        const router = useRouter();

        const reportsStore = useReportsStore();
        const { addReportModalVisible } = storeToRefs(reportsStore);

        const scrollContainerRef = ref<HTMLElement | null>(null);

        const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useTemplates({searchKey: toRef('')});
        
        const files = computed<ReportTemplateVO[]>(() => { 
            return data.value?.pages?.flatMap((page: any) => page?.result?.records ?? []) ?? [];
        });

        useInfiniteScroll(
            scrollContainerRef,
            () => {
                fetchNextPage();
            },
            {
                distance: 20,
                canLoadMore: () => hasNextPage.value && !isFetchingNextPage.value,
            }
        );

        const handleCreateReport = async (template: ReportTemplateVO) => {
            try {
                let { result } = await postDataReportDetailAdd({
                    templateId: template.id!,
                });

                router.push(`/report/${result}`);

                // 更新列表
                updateReports$.next({});
                reportsStore.setAddReportModalVisible(false);
            } catch(e) {
                console.error(e);
            }
        }

        return () => (
            <Modal
                centered
                open={addReportModalVisible.value}
                width={820} 
                title="使用模板创建"
                maskClosable 
                class="customModal"
                footer={null}
                onCancel={() => reportsStore.setAddReportModalVisible(false)}
            >
                <div class="my-4 min-h-[500px] max-h-[80vh] overflow-y-auto pt-3"  ref={scrollContainerRef}>
                    <div class="grid grid-cols-3 gap-3">
                        {
                            files.value.map((template: ReportTemplateVO) => (
                                <div class="item flex flex-col justify-between" onClick={() => handleCreateReport(template)}>
                                    <div class="w-full flex">
                                        <div class="mr-3 flex-shrink-0">
                                            {
                                                template.templateIcon ? (
                                                    <div class="w-[22px] flex items-center justify-center">
                                                        {template.templateIcon}
                                                    </div>
                                                ) : (
                                                    <div class="docIcon"></div>
                                                )
                                            }
                                        </div>

                                        <div class="flex-1 overflow-hidden">
                                            <div class="flex items-center">
                                                { template.templateName || '未命名模板'} 
                                            </div>
                                        </div>
                                    </div>
                                    <div class="mt-4">
                                        <div class="lightText">最近更新于 { formatDiffTime(template.updateTime!) }</div>
                                    </div>
                                </div>
                            ))
                        }
                    </div>
                </div>
                
            </Modal>
        );
    }
});
</script>

<style scoped>
.item {
    height: 142px;
    padding: 12px 16px;
    background: var(--B50);
    border: 1px solid var(--default-border-color);
    border-radius: 8px;
    cursor: pointer;
    /* box-shadow: rgba(31, 35, 41, 0.02) 0px -1px 2px 0px, rgba(31, 35, 41, 0.02) 0px 0px 16px 0px, rgba(31, 35, 41, 0.02) 0px 1px 2px 0px; */

    transition: all 0.2s linear;
}

.item:hover {
    border-color: var(--selection-border-color);
}

.docIcon {
    width: 22px;
    height: 22px;
    background: url('@/assets/journal-round.svg') no-repeat center;
    background-size: contain;
}
</style>