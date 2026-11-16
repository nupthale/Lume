import { computed, ref, watch } from 'vue';
import { useMenus } from '@/components/Layout/useMenus';

export const useMenuAuth = (menuKey: string) => {
    const { menus } = useMenus();
    const hasAuth = ref(false);

    const menuKeys = computed(() => menus?.value?.map(menu => menu.key));

    watch(menus, () => {
        hasAuth.value = menuKeys.value?.includes(menuKey);
    });

    return {
        hasAuth,
    }
}