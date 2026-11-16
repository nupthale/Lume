import { useSubscription } from '@vueuse/rxjs';
import { tap } from 'rxjs/operators';

import { contextStore } from '@editor/Editor/store/context';
import { editorBlur$ } from '@editor/Editor/event';

export const useEditorBlur = () => {
    useSubscription(
        editorBlur$.pipe(
            tap(() => {
                const view = contextStore.getState().editorView;
                if (view) {
                    // // // 清除选择
                    // const { state } = view;
                    // const tr = state.tr;
                    // tr.setSelection(TextSelection.create(tr.doc, 0, 0));
                    // view.dispatch(tr);

                    view.dom.blur();
                }
            })
        ).subscribe()
    );
}