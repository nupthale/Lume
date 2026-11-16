import { Ref, watchEffect, ref } from 'vue';

import { getDatareportGet } from '@/api/dataQuery/dataReport';
import { ReportTemplate } from '@/api/dataQuery/interface';


export const useTemplate = (id: Ref<string>) => {
    const template = ref<ReportTemplate>();
    const isPending = ref(false);
    const error = ref(null);

    watchEffect(async () => {
        try {
            isPending.value = true;

            const { result } = await getDatareportGet({
                id: id.value,
            });

            error.value = null;
            template.value = result;
        } catch(e) {
            error.value = e;
            console.error(e);
        } finally {
            isPending.value = false;
        }
    });

    return {
        template,
        pending: isPending,
        error,
    };
}