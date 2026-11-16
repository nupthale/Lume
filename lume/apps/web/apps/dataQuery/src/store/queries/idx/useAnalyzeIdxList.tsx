import { Subject } from 'rxjs';

import { useQuery } from '@tanstack/vue-query';
import { getConfigQueryAnlsMetricList } from '@/api/dataQuery/configQuery';

export const updateTemplates$ = new Subject();

export const useAnalyzeIdxList = () => {
    const { data, refetch, isLoading, error } = useQuery({
        queryKey: ['analyze-idx-list'],
        queryFn: async () => {
            const { result } = await getConfigQueryAnlsMetricList();

            return result;
        },
    });

    return {
        idx: data,
        refetch,
        isLoading,
        error,
    };
}
