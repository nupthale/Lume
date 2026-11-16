import { defHttp } from '@/utils/http/axios';
import { getMenuListResultModel } from './model/menuModel';
import { Result } from '../dataQuery/interface';

enum Api {
  GetMenuList = '/data-query-api/sys/permission/getUserPermissionByToken?appCode=Z_SMART_DATA_FRONT',
  SwitchVue3Menu = '/data-query-api/sys/switchVue3Menu',
}

/**
 * @description: Get user menu based on id
 */

export const getMenuList = () => {
  return new Promise((resolve) => {
    //为了兼容mock和接口数据
    defHttp.get<Result<getMenuListResultModel>>({ url: Api.GetMenuList }).then((res) => {
      if (Array.isArray(res.result)) {
        resolve(res.result);
      } else {
        resolve(res.result?.['menu']);
      }
    });
  });
};

/**
 * 切换成vue3菜单
 */
export const switchVue3Menu = () => {
  return new Promise(() => {
    defHttp.get({ url: Api.SwitchVue3Menu });
  });
};
