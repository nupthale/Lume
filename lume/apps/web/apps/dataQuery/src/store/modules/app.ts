
import { defineStore } from 'pinia';
import { store } from '@/store';

import { resetRouter } from '@/router';

interface AppState {
  // Page loading status
  pageLoading: boolean;
  // 页面跳转临时参数存储
  messageHrefParams: any;
  // 侧边栏收起
  sidebarCollapse: boolean;
}
let timeId: number;

export const useAppStore = defineStore({
  id: 'app',
  state: (): AppState => ({
    pageLoading: false,
    messageHrefParams: {},
    sidebarCollapse: localStorage.getItem('sidebar_collapse') === 'true',
  }),
  getters: {
    getPageLoading(): boolean {
      return this.pageLoading;
    },
    getMessageHrefParams(): any {
      return this.messageHrefParams;
    },
  },
  actions: {
    setPageLoading(loading: boolean): void {
      this.pageLoading = loading;
    },
    setSidebarCollapse(collapse) {
      localStorage.setItem('sidebar_collapse', collapse);
      this.sidebarCollapse = collapse;
    },
    async resetAllState() {
      resetRouter();
    },
    async setPageLoadingAction(loading: boolean): Promise<void> {
      if (loading) {
        clearTimeout(timeId);
        // Prevent flicker
        // @ts-ignore
        timeId = setTimeout(() => {
          this.setPageLoading(loading);
        }, 50);
      } else {
        this.setPageLoading(loading);
        clearTimeout(timeId);
      }
    },
    setMessageHrefParams(params: any): void {
      this.messageHrefParams = params;
    },
  },
});

// Need to be used outside the setup
export function useAppStoreWithOut() {
  return useAppStore(store);
}
