import { PropType } from 'vue';
import { QueryFormSchema } from './types';

export default {
    items: {
        type: Array as PropType<QueryFormSchema[]>,
        default: [],
    },
    initialValue: {
        type: Object as PropType<Record<string, any>>,
        default: {},
    },
    values: {
        type: Object as PropType<Record<string, any>>,
        default: {},
    },
    showButtons: {
        type: Boolean,
        default: true,
    }
};