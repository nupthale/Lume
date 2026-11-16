import { Ref, watchEffect, ref } from 'vue';

import { getDataReportDetailGet } from '@/api/dataQuery/dataReportDetail';
import { ReportDetailVO } from '@/api/dataQuery/interface';


export const useReport = (id: Ref<string>) => {
    const report = ref<ReportDetailVO>();
    const isPending = ref(false);
    const error = ref(null);

    watchEffect(async () => {
        try {
            isPending.value = true;

            const { result } = await getDataReportDetailGet({
                id: id.value,
            });

            error.value = null;
            report.value = result;
        } catch(e) {
            error.value = e;
            console.error(e);
        } finally {
            isPending.value = false;
        }
    });

    return {
        report,
        pending: isPending,
        error,
    };
}