
import { Ref, watchEffect, computed } from 'vue';

import { useContentToVue } from './useConentToVue';

import { MessageType } from '../interface';

export const useMdToVue = (
    messageRef: Ref<MessageType | undefined>,
    answerLoading?: Ref<boolean>,
    isLast?: Ref<boolean>
) => {

    const showLoadingDotRef = computed(() => !!(answerLoading?.value && isLast?.value));

    const { parseAndUpdate, componentNode } = useContentToVue(showLoadingDotRef, isLast);

    watchEffect(() => {
        // 监听所有相关依赖，包括content、answerLoading和isLast
        const content = messageRef.value?.content;
        const loading = answerLoading?.value;
        const last = isLast?.value;
        console.info(loading, last);

        parseAndUpdate(content);
    });

    return {
        answerComponent: componentNode,
    };
}