import { useSubscription } from '@vueuse/rxjs'
import { message } from 'ant-design-vue';

import { of, tap, catchError, debounce, timer } from 'rxjs';

import { updateConversationList$ } from '../observables/index';

export const useUpdateConversationList = ({ 
    refetch, 
}: { 
    refetch: () => void,
}) => {
    useSubscription(
        updateConversationList$.pipe(
            debounce(() => timer(300)),
            tap(() => {
                try {
                    refetch();
                } catch(e) {
                    console.error(e);
                }
            }),
            catchError((e) => {
                message.error('加载失败，请重试');
                return of(e);
            }),
        ).subscribe()
    );
}