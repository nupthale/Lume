<script lang="tsx">
import { defineComponent, PropType } from 'vue';
import { UserAvatar } from '@zsfe/zsui';
import { storeToRefs } from 'pinia';
import { Button, Modal } from 'ant-design-vue';
import { ScrollText } from 'lucide-vue-next';
import { useRouter } from 'vue-router';

import { defHttp } from "@/utils/http/axios";
import { postReportDetailGenerateReport } from '@/api/dataQuery/dataReportDetail.ts';
import { ReportDetailVO } from '@/api/dataQuery/interface';

import { useUserStore } from '@/store/modules/user.ts';

import EditorActions from '@/components/EditorActions/index.vue';
import { ReportStatusEnum } from '@/pages/reports/modules/Reports/interface.tsx';
import { updateReports$ } from '@/store/queries/report/useReports.tsx';

export default defineComponent({
    props: {
        fileId: String,
        report: Object as PropType<ReportDetailVO>, 
    },
    setup(props) {
        const router = useRouter();

        const userStore = useUserStore();
        const { userInfo } = storeToRefs(userStore);

        const handleGenerateReport = async (fileId) => {
          try {
            await postReportDetailGenerateReport({ id: fileId });

            updateReports$.next({});

            router.replace('/reports');
          } catch(e) {
            console.error(e);
          }
        }

        const handleDeleteFile = () => {
          Modal.confirm({
            title: '删除',
            content: () => <div>确定要删除当前报告吗？</div>,
            okText: '删除',
            okType: 'danger',
            cancelText: '取消',
            centered: true,
            onOk: async () => {
                try {
                    await defHttp.delete({
                        url: `/data-query-api/data/reportDetail/delete?id=${props.fileId}`,
                    })

                    updateReports$.next({});
                    router.replace('/reports');
                } catch(e) {
                    console.error(e);
                }
            }
          });
        }

        return () => (
            <div class="h-[28px] flex items-center">
                  <div class="flex items-center gap-4">
                    {
                      props.report?.templateId && [ReportStatusEnum.PENDING, ReportStatusEnum.FAILED].includes(props.report?.reportStatus! as ReportStatusEnum) && (
                        <Button type="primary" danger={props.report?.reportStatus === ReportStatusEnum.FAILED} ghost onClick={() => handleGenerateReport(props.fileId)}>
                          <div class="flex items-center gap-1">
                            <ScrollText size={18} />
                            {props.report?.reportStatus === ReportStatusEnum.PENDING ? '生成报告' : '重新生成'}
                          </div>
                        </Button>
                      )
                    }
                  </div>

                  <div class="ml-4">
                    <EditorActions fileId={props.fileId} onDeleteFile={handleDeleteFile} />
                  </div>

                  <div class="divider"></div>

                  <UserAvatar size="large" class="user" username={userInfo.value?.realname} showText={false} />
            </div>
        );
    }
});
</script>

<style scoped>
.user :deep(.zsui-user__avatar) {
  width: 32px!important;
  height: 32px!important;
  line-height: 32px!important;
}

.divider {
  width: 1px;
  height: 18px;
  background: var(--N400);
  margin: 0 16px;
}
</style>