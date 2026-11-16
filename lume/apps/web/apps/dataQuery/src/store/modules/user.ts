import type { UserInfo, LoginInfo } from '#/store';
import type { ErrorMessageMode } from '#/axios';
import { defineStore } from 'pinia';
import { store } from '@/store';
import { RoleEnum } from '@/enums/roleEnum';
import { PageEnum } from '@/enums/pageEnum';
import { getAuthCache, setAuthCache } from '@/utils/auth/index';
import { ROLES_KEY, TOKEN_KEY, USER_INFO_KEY } from '@/enums/cacheEnum.ts';

import { GetUserInfoModel, LoginParams } from '@/api/sys/model/userModel';
import { doLogout, getUserInfo, loginApi } from '@/api/sys/user';
import { usePermissionStore } from './permission.js';

import { isArray } from '@/utils/is';
import { gotoPage } from '@/utils';

interface UserState {
  appKey: string;
  userInfo: Nullable<UserInfo>;
  token: string | undefined;
  roleList: RoleEnum[];
  dictItems: [];
  sessionTimeout?: boolean;
  lastUpdateTime: number;
  tenantid?: string | number;
  loginInfo?: Nullable<LoginInfo>;
}

export const useUserStore = defineStore({
  id: 'app-user',
  state: (): UserState => ({
    appKey: 'd35mgsnmbu2qeq346fkg',
    // appKey: 'd352ik4l0bd6ggku67mg',
    // 用户信息
    userInfo: null,
    /** token */
    token: undefined,
    // 角色列表
    roleList: [],
    // 字典
    dictItems: [],
    // session过期时间
    sessionTimeout: false,
    // Last fetch time
    lastUpdateTime: 0,
    //租户id
    tenantid: '',
    //登录返回信息
    loginInfo: null,
  }),
  getters: {
    getUserInfo(): Nullable<UserInfo> {
      return this.userInfo || getAuthCache<UserInfo>(USER_INFO_KEY) || {};
    },
    /** 获取 token */
    getToken(): string {
      return this.token || getAuthCache<string>(TOKEN_KEY);
    },
    getLoginInfo(): Nullable<LoginInfo> {
      return this.loginInfo || null;
    },
    getAllDictItems() {
      // @ts-ignore
      return this.dictItems;
    },
    getRoleList(): RoleEnum[] {
      return this.roleList.length > 0 ? this.roleList : getAuthCache<RoleEnum[]>(ROLES_KEY);
    },
    getSessionTimeout(): boolean {
      return !!this.sessionTimeout;
    },
    getLastUpdateTime(): number {
      return this.lastUpdateTime;
    },
    getTenant() {
      // @ts-ignore
      return this.tenantid;
    },
  },
  actions: {
    /** 设置token */
    setToken(info: string | undefined) {
      this.token = info ? info : ''; // for null or undefined value
      setAuthCache(TOKEN_KEY, info);
    },
    setRoleList(roleList: RoleEnum[]) {
      this.roleList = roleList;
      setAuthCache(ROLES_KEY, roleList);
    },
    setUserInfo(info: UserInfo | null) {
      this.userInfo = info;
      this.lastUpdateTime = new Date().getTime();
      setAuthCache(USER_INFO_KEY, info);
    },
    setLoginInfo(info: LoginInfo | null) {
      this.loginInfo = info;
    },
    setAllDictItems(dictItems) {
      this.dictItems = dictItems || [];
    },
    setTenant(id) {
      this.tenantid = id;
    },
    setSessionTimeout(flag: boolean) {
      this.sessionTimeout = flag;
    },
    resetState() {
      this.userInfo = null;
      this.dictItems = [];
      this.roleList = [];
      this.sessionTimeout = false;
    },
    /**
     * 登录事件
     */
    async login(
      params: LoginParams & {
        goHome?: boolean;
        mode?: ErrorMessageMode;
      }
    ): Promise<GetUserInfoModel | null> {
      try {
        const { goHome = true, mode, ...loginParams } = params;
        const data = await loginApi(loginParams, mode);

        this.setToken(data.token);
        return this.afterLoginAction(goHome, data);
      } catch (error) {
        return Promise.reject(error);
      }
    },
    /**
     * 登录完成处理
     * @param goHome
     */
    async afterLoginAction(goHome?: boolean, data?: any): Promise<any | null> {
      if (!this.getToken) return null;
      //获取用户信息
      await this.getUserInfoAction();
      const sessionTimeout = this.sessionTimeout;
      if (sessionTimeout) {
        this.setSessionTimeout(false);
      } else {
        const permissionStore = usePermissionStore();
        const result = await permissionStore.getMenus();

        await this.setLoginInfo({ ...data, isLogin: true });
        //update-end-author:liusq date:2022-5-5 for: 登录成功后缓存拖拽模块的接口前缀

        // 跳转有权限的第一个页面
        if (goHome) {
          const home = result?.[0]?.path;
          gotoPage(home as any);
        }
      }
      return data;
    },
    /**
     * 获取用户信息
     */
    async getUserInfoAction(): Promise<UserInfo | null> {
      // @ts-ignore
      const { userInfo, sysAllDictItems } = await getUserInfo(); 
      if (userInfo) {
        const { roles = [] } = userInfo;
        if (isArray(roles)) {
          const roleList = roles.map((item) => item.value) as RoleEnum[];
          this.setRoleList(roleList);
        } else {
          userInfo.roles = [];
          this.setRoleList([]);
        }
        this.setUserInfo(userInfo);
      }
      /**
       * 添加字典信息到缓存
       * @updateBy:lsq
       * @updateDate:2021-09-08
       */
      if (sysAllDictItems) {
        this.setAllDictItems(sysAllDictItems);
      }
      return userInfo;
    },
    /**
     * 退出登录
     */
    async logout(goLogin = true) {
      if (this.getToken) {
        try {
          await doLogout();
        } catch {
          console.log('注销Token失败');
        }
      }

      this.setToken(undefined);
      this.setSessionTimeout(false);
      this.setUserInfo(null);
      this.setLoginInfo(null);

      //update-end-author:liusq date:2022-5-5 for: 退出登录后清除拖拽模块的接口前缀

      goLogin && gotoPage(PageEnum.BASE_LOGIN);
    },
    /**
     * 退出询问
     */
    confirmLoginOut() {
      this.logout();
    },
  },
});

// Need to be used outside the setup
export function useUserStoreWithOut() {
  return useUserStore(store);
}
