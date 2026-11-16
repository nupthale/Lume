import { onMounted, ref } from 'vue';
import { useResizeObserver } from '@vueuse/core'


export const useMaxHeight = () => {
    const containerRef = ref();
    const maxHeightRef = ref(0);

    const calc = () => {
        const el = containerRef.value;

        if (!el) return;

        const rect = el.getBoundingClientRect();
        maxHeightRef.value = rect.top - 20;
    }

    onMounted(() => {
        calc();
    });

    useResizeObserver(document.body, () => {
        calc();
    });

    return {
        containerRef,
        maxHeightRef,
    };
}