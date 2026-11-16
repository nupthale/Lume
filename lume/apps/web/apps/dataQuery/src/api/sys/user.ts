import { defHttp } from '@/utils/http/axios';
import { LoginParams, LoginResultModel, GetUserInfoModel } from './model/userModel';
import { Result } from '../dataQuery/interface';

import { ErrorMessageMode } from '#/axios';
import { gotoPage } from '@/utils/index';
import { PageEnum } from '@/enums/pageEnum';

enum Api {
  Login = '/data-query-api/sys/login',
  phoneLogin = '/data-query-api/sys/phoneLogin',
  Logout = '/data-query-api/sys/logout',
  GetUserInfo = '/data-query-api/sys/user/getUserInfo',
  // 获取系统权限
  // 1、查询用户拥有的按钮/表单访问权限
  // 2、所有权限
  // 3、系统安全模式
  GetPermCode = '/data-query-api/sys/permission/getPermCode?appCode=Z_SMART_DATA_FRONT',
  //新加的获取图形验证码的接口
  getInputCode = '/data-query-api/sys/randomImage',
  //获取短信验证码的接口
  getCaptcha = '/data-query-api/sys/sms',
  //注册接口
  registerApi = '/data-query-api/sys/user/register',
  //校验用户接口
  checkOnlyUser = '/data-query-api/sys/user/checkOnlyUser',
  //SSO登录校验
  validateCasLogin = '/data-query-api/sys/cas/client/validateLogin',
  //校验手机号
  phoneVerify = '/data-query-api/sys/user/phoneVerification',
  //修改密码
  passwordChange = '/data-query-api/sys/user/passwordChange',
  //第三方登录
  thirdLogin = '/data-query-api/sys/thirdLogin/getLoginUser',
  //第三方登录
  getThirdCaptcha = '/data-query-api/sys/thirdSms',
  //获取二维码信息
  getLoginQrcode = '/data-query-api/sys/getLoginQrcode',
  //监控二维码扫描状态
  getQrcodeToken = '/data-query-api/sys/getQrcodeToken',
  // 获取分支机构列表
  getBranchList = '/data-query-api/sys/sysDepart/queryBrnOrgList',
  // 产品设置的机构列表, 写死几个机构
  getProductConfigBranchList = '/data-query-api/sys/sysDepart/listAll?id=1011,1013,1090,1091',
  // 获取前台人员列白哦
  getEmployeeList = '/data-query-api/sys/employee/queryEmployeeList?frontFlag=1',
}

/**
 * @description: user login api
 */
export function loginApi(params: LoginParams, mode: ErrorMessageMode = 'modal'): any {
  return new Promise((resolve) => {
    defHttp.post<Result<LoginResultModel>>(
      {
        url: Api.Login,
        params,
      },
      {
        errorMessageMode: mode,
      }
    ).then(res => {
      resolve(res.result);
    });
  });
}

/**
 * @description: getUserInfo
 */
export function getUserInfo() {
  return new Promise((resolve) => {
    defHttp.get<Result<GetUserInfoModel>>({ url: Api.GetUserInfo }, { errorMessageMode: 'none' }).then((res) => {
      resolve(res.result);
    }).catch((e) => {
      // update-begin--author:zyf---date:20220425---for:【VUEN-76】捕获接口超时异常,跳转到登录界面
      if (e && (e.message.includes('timeout') || e.message.includes('401'))) {
        gotoPage(PageEnum.BASE_LOGIN);
      }
      // update-end--author:zyf---date:20220425---for:【VUEN-76】捕获接口超时异常,跳转到登录界面
    })
  });
}

export function getPermCode(): any {
  return new Promise((resolve) => {
    defHttp.get({ url: Api.GetPermCode }).then((res) => {
      resolve(res.result);
    });
  });
}

export function doLogout() {
  return defHttp.get({ url: Api.Logout });
}

export function getCodeInfo(currdatetime): Promise<string> {
  const url = Api.getInputCode + `/${currdatetime}`;
  return new Promise((resolve) => {
    defHttp.get({ url: url }).then((res) => {
      resolve(res.result);
    });
  });
}

/**
 * SSO登录校验
 */
export async function validateCasLogin(params) {
  const url = Api.validateCasLogin;
  return defHttp.get({ url: url, params });
}

export function getBranchList(): Promise<{ result: { id: string, name: string }[] }> {
  const url = Api.getBranchList;
  return new Promise((resolve) => {
    defHttp.get({ url: url }).then((res) => {
      const options = res.result?.map(item => ({
        id: item.orgCode,
        name: item.departName,
      })) || [];

      resolve({
        result: options,
      });
    });
  });
}

export function getProductConfigBranchList(): Promise<{ result: { id: string, name: string }[] }> {
  const url = Api.getProductConfigBranchList;
  return new Promise((resolve) => {
    defHttp.get({ url: url }).then((res) => {
      const options = res.result?.map(item => ({
        id: item.orgCode,
        name: item.departName,
      })) || [];

      resolve({
        result: options,
      });
    });
  });
}


export function getEmployeeList(params): Promise<{ result: { id: string, name: string, department: string }[] }> {
  const url = Api.getEmployeeList;
  return new Promise((resolve) => {
    defHttp.get({ url: url, params }).then((res) => {
      const options = res.result?.map(item => ({
        id: item.id,
        name: item.name,
        department: item.departText,
      })) || [];

      resolve({
        result: options,
      });
    });
  });
}