<script lang="tsx">
import { defineComponent, onMounted, PropType, ref } from 'vue';
import { message } from 'ant-design-vue';
import i18next from 'i18next';

import { UserType } from '../Editor/interface';
import { contextStore } from '../Editor/store/context';
import { userStore } from '../Editor/store/user';
import Editor from './editor.vue';
import { exportPDF as exportEditorToPDF } from './exportPDF';
import type { ExportPDFOptions } from './exportPDF';

export default defineComponent({
  props: {
    doc: Object,
    docMetaComponent: {
      type: Object,
    },
    titleFormatter: {
      type: Function,
    },
    user: Object as PropType<UserType>
  },
  setup(props, { slots, expose }) {
    const userNotFound = ref(false);

    onMounted(() => {
      if (props.user) {
        userStore.getState().setUser(props.user);
      } else {
        userNotFound.value = true;
      }
    });

    const exportPDF = (options?: ExportPDFOptions) => {
      const view = contextStore.getState().editorView;

      if (!view) {
        message.error(i18next.t('export.failedMessage'));
        return Promise.reject(new Error('Editor is not ready'));
      }

      const hide = message.loading(i18next.t('common.exportPending'));

      return exportEditorToPDF(view, options).finally(() => hide());
    };

    expose({ exportPDF });

    return () => userNotFound.value ? (
      <div>user not found</div>
    ) : (
      <Editor 
        doc={props.doc} 
        user={props.user}
        docMetaComponent={props.docMetaComponent}
        titleFormatter={props.titleFormatter}
      >
        {slots}
      </Editor>
    );
  }
});
</script>