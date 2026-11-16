import type { AppRouteRecordRaw, Menu } from '@/router/types';

import { defineStore } from 'pinia';
import { store } from '@/store';

import { getMenuList } from '@/api/sys/menu';
import { getPermCode } from '@/api/sys/user';

// 系统权限
interface AuthItem {
  // 菜单权限编码，例如：“sys:schedule:list,sys:schedule:info”,多个逗号隔开
  action: string;
  // 权限策略1显示2禁用
  type: string | number;
  // 权限状态(0无效1有效)
  status: string | number;
  // 权限名称
  describe?: string;
  isAuth?: boolean;
}

interface PermissionState {
  // Permission code list
  permCodeList: string[] | number[];
  backMenuList: Menu[];
  isBackMenuLoading: boolean;
  // 用户所拥有的权限
  authList: AuthItem[];
  // 全部权限配置
  allAuthList: AuthItem[];
}

export const usePermissionStore = defineStore({
  id: 'app-permission',
  state: (): PermissionState => ({
    permCodeList: [],
    // Backstage menu list
    backMenuList: [],
    isBackMenuLoading: true,
    authList: [],
    allAuthList: [],
  }),
  getters: {
    getPermCodeList(): string[] | number[] {
      return this.permCodeList;
    },
    getBackMenuList(): Menu[] {
      return this.backMenuList;
    },
  },
  actions: {
    setPermCodeList(codeList: string[]) {
      this.permCodeList = codeList;
    },

    setBackMenuList(list: Menu[]) {
      this.backMenuList = list;
    },
    resetState(): void {
      this.permCodeList = [];
      this.backMenuList = [];
    },
    async changePermissionCode() {
      const systemPermission = await getPermCode();
      const codeList = systemPermission.codeList;
      this.setPermCodeList(codeList);
      this.setAuthData(systemPermission);
    },
    async getMenus() {
      // 从后台获取权限码，
      // 这个函数可能只需要执行一次，并且实际的项目可以在正确的时间被放置
      let routeList: AppRouteRecordRaw[] = [];
      try {
        this.isBackMenuLoading = true;

        this.changePermissionCode();
        routeList = (await getMenuList()) as AppRouteRecordRaw[];
      } catch (error) {
        console.error(error);
      } finally {
        this.isBackMenuLoading = false;
      }

      this.setBackMenuList(routeList);

      return routeList;
    },
    setAuthData(systemPermission) {
      this.authList = systemPermission.auth;
      this.allAuthList = systemPermission.allAuth;
    },
    hasPermission(key: string) {
      const allCodeList = this.getPermCodeList as string[];

      return allCodeList.includes(key);
    }
  },
});

// 需要在设置之外使用
export function usePermissionStoreWithOut() {
  return usePermissionStore(store);
}
