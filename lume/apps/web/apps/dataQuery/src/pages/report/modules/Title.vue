<script lang="tsx">
import { defineComponent, ref, computed } from 'vue';
import { useSubscription } from '@vueuse/rxjs';
import { debounceTime, tap, switchMap } from 'rxjs/operators';
import i18next from 'i18next';
import { Tag } from '@zsfe/zsui';

import { docChanged$, docInit$ } from '@editor/Editor/event'; 
import { getText } from '@editor/Editor/components/Catalog/util';
import { postReportDetailUpdate } from '@/api/dataQuery/dataReportDetail';
import { ReportDetailVO } from '@/api/dataQuery/interface';

enum SaveStatusEnum {
    INIT = 'init',
    SAVING = 'saving',
    SUCCESS = 'success',
    ERROR = 'error',
}

export default defineComponent({
  props: {
    id: String,
    fileId: String,
    report: Object as PropType<ReportDetailVO>,
  },  
  setup(props) {
    const statusRef = ref(SaveStatusEnum.INIT);

    const titleRef = ref('');

    useSubscription(
        docInit$.pipe(
            tap(({ doc }) => {
                titleRef.value = getText(doc.content?.[0]?.content) || i18next.t('doc.head.titlePlaceholder');
            }),
        ).subscribe(),
    );

    useSubscription(
        docChanged$.pipe(
            tap(({ doc }) => {
                titleRef.value = getText(doc.content?.[0]?.content) || i18next.t('doc.head.titlePlaceholder');
            }),
            debounceTime(400),
            tap(() => statusRef.value = SaveStatusEnum.SAVING),
            switchMap(async ({ doc }) => {
                try {
                    const title = getText(doc.content?.[0]?.content);
                    const updatedAt = new Date();

                    await postReportDetailUpdate({
                        id: props.fileId!,
                        reportName: title,
                        reportContent: JSON.stringify(doc),
                    });

                    console.info(title, updatedAt);

                    setTimeout(() => {
                        statusRef.value = SaveStatusEnum.SUCCESS;
                    }, 500);
                } catch(e) {
                    statusRef.value = SaveStatusEnum.ERROR;

                    console.error(e);
                }
            })
        ).subscribe()
    );

    const renderStatusText = computed(() => {
        if (statusRef.value === SaveStatusEnum.SAVING) {
            return i18next.t('doc.head.saving');
        }

        if (statusRef.value === SaveStatusEnum.SUCCESS) {
            return i18next.t('doc.head.saved');
        }

        if (statusRef.value === SaveStatusEnum.ERROR) {
            return i18next.t('doc.head.saveFailed');
        }
    });

    const renderStatus = () => {
        const map = {
            0: { text: '待生成', color: 'netrual' },
            1: { text: '生成中', color: 'blue' },
            2: { text: '已生成', color: 'green' },
            3: { text: '生成失败', color: 'red' },
        };

        // 如果是通过模板生成的，则展示状态，否则不展示
        if (!props.report?.templateId) {
            return '';
        }
        
        return (<Tag color={map[props.report?.reportStatus!]?.color}>{map[props.report?.reportStatus!]?.text}</Tag>);
    }

    return () => (
        <div>
            <div>
                <span class="mr-2">{titleRef.value || ''}</span>
                {renderStatus()}
            </div>
            <div class="doc-autosave">
                {renderStatusText.value}
            </div>
        </div>
    );
  }
});
</script>

<style scoped>
.doc-autosave {
    font-size: 12px;
    color: var(--light-text-color);
}
</style>