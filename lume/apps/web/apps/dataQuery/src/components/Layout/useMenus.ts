import { computed, h } from 'vue';

import { storeToRefs } from 'pinia';

import { usePermissionStore } from '@/store/modules/permission';
import Icon from '@/components/Icon/index.vue';

export const useMenus = (icons = {}) => {
  const permissionStore = usePermissionStore();
  const { backMenuList } = storeToRefs(permissionStore);

  const toMenu = (menus) => {
    if (!menus.length) {
      return null;
    }

    return menus.map(menu => ({
        key: menu.name,
        title: menu.meta?.title,
        label: menu.meta?.title,
        path: menu.path,
        icon: icons[menu.name] ? () => h(Icon, {
          size: '18px',
          icon: icons[menu.name],
        }) : () => h('div', {
          class: '-mr-5'
        }),
        _raw: menu,
        children: toMenu(menu.children || []),
    }));
  }

  const menus = computed(() => {
    return toMenu(backMenuList.value);
  });

  return {
    menus,
  };
};
