<script lang="tsx">
import { defineComponent } from 'vue';
import { UserAvatar } from '@zsfe/zsui';
import { storeToRefs } from 'pinia';
import { Modal } from 'ant-design-vue';
import { useRouter } from 'vue-router';

import { defHttp } from "@/utils/http/axios";

import { useUserStore } from '@/store/modules/user.ts';
import { updateReports$ } from '@/store/queries/report/useReports.tsx';

import EditorActions from '@/components/EditorActions/index.vue';

export default defineComponent({
    props: {
        fileId: String,
    },
    setup(props) {
        const router = useRouter();

        const userStore = useUserStore();
        const { userInfo } = storeToRefs(userStore);

        const handleDeleteFile = () => {
          Modal.confirm({
            title: '删除',
            content: () => <div>确定要删除当前模板吗？</div>,
            okText: '删除',
            okType: 'danger',
            cancelText: '取消',
            centered: true,
            onOk: async () => {
                try {
                    await defHttp.delete({
                        url: `/data-query-api/data/datareport/delete?id=${props.fileId}`,
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