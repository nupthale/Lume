import { Subject } from 'rxjs';
import { debounceTime, switchMap, tap } from 'rxjs/operators';

import { useSubscription } from '@vueuse/rxjs';

import { getDatareportGenerateQueryBlock } from '../../../../../apps/dataQuery/src/api/dataQuery/dataReport';
import { contextStore } from '@editor/Editor/store/context';

export const submitAIQuery$ = new Subject<{ queryNodeId: string, query: string }>();

export const stopAIQuery$ = new Subject<{ queryNodeId: string; }>();

export const useAIQuery = () => {
    useSubscription(
        submitAIQuery$.pipe(
            debounceTime(200),
            switchMap(async ({ query }) => {
                try {
                    const { result } = await getDatareportGenerateQueryBlock({
                        query,
                    });

                    // markdown 文本
                    return result;
                } catch(e) {
                    console.error(e);
                }
            }),
            tap((result) => {
                const editorView = contextStore.getState().editorView;
            })
        ).subscribe()
    )
}