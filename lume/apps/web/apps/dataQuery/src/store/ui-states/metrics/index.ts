
import { defineStore } from 'pinia';
import { SceneInfoReqVO } from '@/api/dataQuery/interface';

interface State {
    metricsModalVisible: boolean,
    metricsConfigModalForm: SceneInfoReqVO;
}

export const useMetricsStore = defineStore({
    id: 'metrics-store',
    state: (): State => ({
        metricsModalVisible: false,
        metricsConfigModalForm: {},
    }),
    persist: true,
    getters: {},
    actions: {
        setMetricsModalVisible(data) {
            this.metricsModalVisible = data;
        },
        setMetricsConfigModalForm(data) {
            this.metricsConfigModalForm = data;
        }
    },
});