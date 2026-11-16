import { Subject } from 'rxjs';
import { useSubscription } from '@vueuse/rxjs'

import { tap } from 'rxjs';

import { useQuery } from '@tanstack/vue-query';
import { getConfigQuerySceneList } from '@/api/dataQuery/configQuery'; 

export const updateMetricsConfig$ = new Subject();

export const useMetricsConfig = () => {
    const { data, refetch, isLoading, error } = useQuery({
        queryKey: ['metrics-config'],
        queryFn: async () => {
            const { result } = await getConfigQuerySceneList();

            return result;
        },
    });

    useSubscription(
        updateMetricsConfig$.pipe(
            tap(() => {
                refetch();
            }),
        ).subscribe()
    );

    return {
        metrics: data,
        refetch,
        isLoading,
        error,
    };
}
