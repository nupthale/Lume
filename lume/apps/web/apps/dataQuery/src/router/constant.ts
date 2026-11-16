export const REDIRECT_NAME = 'Redirect';

export const PAGE_NOT_FOUND_NAME = 'PageNotFound';

export const PAGE_NOT_FOUND_COMPONENT = () => import('@/pages/sys/exception/404.page.vue');

/**
 * @description: default layout
 */
export const LAYOUT = () => import('@/components/Layout/index.vue');