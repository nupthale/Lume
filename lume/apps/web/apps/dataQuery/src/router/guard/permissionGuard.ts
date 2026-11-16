import type {Router} from 'vue-router';
import { message } from 'ant-design-vue';

import { useUserStoreWithOut } from '@/store/modules/user';
import { usePermissionStoreWithOut } from '@/store/modules/permission';

import {PageEnum} from '@/enums/pageEnum';

import { isYiban, yibanToken } from '@/utils/yiban';

const whitePathList: PageEnum[] = [PageEnum.BASE_LOGIN, PageEnum.ERROR_PAGE, PageEnum.BASE_404];

const hasMenu = (menus, menu) => {
  return menus.find(item => {
    if (!item.children?.length) {
      return item.path === menu.path;
    } else {
      return hasMenu(item.children, menu);
    }
  });
}

export function createPermissionGuard(router: Router) {
  router.beforeEach(async (to, _from, next) => {
    // 命中白名单或任意 matched 路由标记了 ignoreAuth，直接放行
    const isIgnoreAuth = to.matched.some(record => record.meta?.ignoreAuth);
    if (whitePathList.includes(to.path as PageEnum) || isIgnoreAuth) {
      next();
      return;
    }

    const userStore = useUserStoreWithOut();
    const token = userStore.getToken;

    // 易办特殊逻辑

    if (!token) {
      // 易办特殊逻辑， 如果token不存在，但cookie里存在X-YiBan-Token， 则根据cookie的值设置token后刷新页面
      if (isYiban) {
        if (yibanToken) {
          userStore.setToken(yibanToken);

          location.href = location.href;
          return;
        } else {
          // 理论上在易办每次进入系统， 都会重新写入cookie，不存在没有token的情况，这里只是为了防止页面无限刷新做的兜底
          message.error('易办Token不存在，请尝试重新打开');
          return;
        }
      }

      let path = PageEnum.BASE_LOGIN;

      const redirectData: { path: string; replace: boolean; query?: Recordable<string> } = {
        path: path,
        replace: true,
      };
      if (to.path) {
        redirectData.query = {
          ...redirectData.query,
          redirect: to.path,
        };
      }
      next(redirectData);
      return;
    }

    const permisisonStore = usePermissionStoreWithOut();
    
    // 等待menus返回好
    if (!permisisonStore.backMenuList.length) {
      await permisisonStore.getMenus();
    }

    if (!hasMenu(permisisonStore.backMenuList, to)) {
      next({
        path: PageEnum.BASE_404,
      });
      return;
    }

    next();
  });
}
