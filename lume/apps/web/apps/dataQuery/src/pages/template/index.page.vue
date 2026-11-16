<script lang="tsx">
import { defineComponent, ref, h, watch, computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import i18next from 'i18next';
import { storeToRefs } from 'pinia';
import { Loading, TextButton } from '@zsfe/zsui';
import { Space } from 'ant-design-vue';

import Icon from '@/components/Icon/index.vue';
import FullScreenModal from '@/components/FullscreenModal/index.vue';
import { Editor } from '@editor/index';
import { useTemplate } from '@/store/queries/template/useTemplate.tsx';
import { useUserStore } from '@/store/modules/user';
import { useReportsStore } from '@/store/ui-states/reports/index.ts';

import DocLoadErrorIllustration from '@/components/icons/DocLoadErrorIllustration.vue';

import { updateConversationList$ } from '@/store/subscriptions/agent/observables/index.ts';
import PreviewSider from '@/modules/PreviewSider/index.vue';
import { useBlockSystemSave } from '@/hooks/useBlockSystemSave';

import Title from './modules/Title.vue';
import DocMeta from './meta/index.vue';
import Header from './modules/Header.vue';

import Actions from './modules/actions/index.vue';

import { defaultDoc } from '@editor/doc.ts';

import '@editor/index.css';

export default defineComponent({
  setup() {
    const route = useRoute();

    const fileIdRef = ref(route.params.id as string);

    // Watch for route param changes
    watch(() => route.params.id, (newId) => {
      fileIdRef.value = newId as string;
    });

    const router = useRouter();

    const reportsStore = useReportsStore();
    const { previewSiderVisible } = storeToRefs(reportsStore);

    const { template, pending, error } = useTemplate(fileIdRef);

    const userStore = useUserStore();
    const { userInfo } = storeToRefs(userStore);
    const user = computed(() => {
      return {
        name: userInfo.value?.realname || '',
        id: userInfo?.value?.id as any,
      };
    });

    useBlockSystemSave();

    const handleBack = () => {
      updateConversationList$.next({});

      router.replace('/reports');
    }

    const renderBody = () => {
      if (pending.value) {
        return (
          <div class="docs-empty" style={{ width: '140px' }}>
            <Loading style="width: 140px" />
          </div>
        );
      }

      if (error.value || !template.value) {
        return (
          <div class="docs-empty">
            <div class="docs-empty_illustration ">
              <DocLoadErrorIllustration />
            </div>
            <div class="docs-empty_text">
              {i18next.t('doc.loadFailed')}
            </div>
          </div>
        );
      }

      const docMetaComponent = defineComponent({
        setup() {
          return () => h(DocMeta, {
            user: user.value,
          })
        }
      });

      const docRef = computed(() => {
        let doc = defaultDoc;

        if (template.value?.templateContent) {
          try {
            doc = JSON.parse(template.value?.templateContent!);
          } catch(e) {
            console.error(e);
          }
        }

        return {
          fileId: template.value?.id,
          doc,
        };
      });
      
      return (
        <div class={["docs-container flex h-full overflow-hidden", previewSiderVisible.value ? 'previewSiderVisible' : '']}>
          <Editor
              key={template.value?.id}
              user={user.value}
              doc={docRef.value}
              docMetaComponent={docMetaComponent}
          >
            {{
              header: () => (
                <div>
                  <div class="customHeader h-[55px] flex items-center justify-between">
                    <Space align="center">
                        {{
                            split: () => (
                                <div class="divider"></div>
                            ),
                            default: () => (
                                <>
                                    <TextButton class="mt-0.5" onClick={() => handleBack()}>
                                        <Icon icon="arrow-down_outlined" size="16px" style="transform: rotate(180deg)"></Icon>
                                    </TextButton>
                                    <Title fileId={fileIdRef.value} />
                                </>
                            )
                        }}
                    </Space>
                    <Actions fileId={template.value?.id} />
                </div>
                  <Header file={template.value} />
                </div>
              ),
            }}
          </Editor>

          <PreviewSider />
        </div>
      );
    }

    return () => (
        <FullScreenModal 
          open
          headerHeight={0}
          class="editorFullscreenModal"
          onCancel={() => handleBack()}
        >
          {{
            header: () => '',
            default: () => renderBody(),
          }}
        </FullScreenModal>
    );
  }
});
</script>

<style>
</style>

<style scoped lang="less">
.docs-container.previewSiderVisible :deep(.doc-catalog-container) {
  display: none;
}

.customHeader {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 3;
  background: var(--blur-bg-filter);
  padding: 0 30px 0 10px;
  backdrop-filter: saturate(1.5) blur(16px);
  /* box-shadow: var(--fullscreen-modal-header-shadow); */
  border-bottom: 1px solid var(--default-border-color);
}

.docs-loading {
    text-align: center;
    margin: calc(50vh - 100px) auto;
    width: 140px;
    left: 0;
    right: 0;
}

.docs-empty {
    text-align: center;
    margin: 200px auto;
    width: 400px;
    left: 0;
    right: 0;
}

.docs-empty_illustration {
    display: flex;
    justify-content: center;
}

.docs-empty_text {
    color: var(--light-text-color);
}
</style>