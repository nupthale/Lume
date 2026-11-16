
import { defineStore } from 'pinia';

interface State {
    tab: number;
    searchText: string;
    addReportModalVisible: boolean;
    previewSiderVisible: boolean;
}

export const useReportsStore = defineStore({
    id: 'reports-store',
    state: (): State => ({
       tab: 1,
       searchText: '',
       addReportModalVisible: false,
       previewSiderVisible: false,
    }),
    persist: true,
    getters: {},
    actions: {
        setTab(tab) {
            this.tab = tab;
        },
        setSearchText(text) {
            this.searchText = text || '';
        },
        setAddReportModalVisible(visible) {
            this.addReportModalVisible = visible;
        },
        setPreviewSiderVisible(visible) {
            this.previewSiderVisible = visible;
        }
    },
});