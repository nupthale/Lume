import type { AppRouteRecordRaw } from '@/router/types';

import { PAGE_NOT_FOUND_ROUTE, REDIRECT_ROUTE } from '@/router/routes/basic';
import { LAYOUT } from '../constant';

export const RootRoute: AppRouteRecordRaw = {
  path: '/',
  name: 'App',
  component: LAYOUT,
  meta: {
    title: 'App',
  },
  redirect: '/index',
  children: [{
    path: '/index',
    name: 'Home',
    component: () => import('@/pages/home/index.page.vue'),
    meta: {
      title: '首页',
    },
  }, {
    path: '/analyze',
    name: 'Analyze',
    component: () => import('@/pages/analyze/index.page.vue'),
    meta: {
      title: '经营决策',
    },
  }, {
    path: '/chat/:agentType/:id',
    name: 'Chat',
    component: () => import('@/pages/chat/index.page.vue'),
    meta: {
      title: '问数',
      ignoreAuth: true,
    },
  }, {
    path: '/reports',
    name: 'Reports',
    component: () => import('@/pages/reports/index.page.vue'),
    meta: {
      title: '报告',
    },
  }, {
    path: '/report/:id',
    name: 'Report',
    component: () => import('@/pages/report/index.page.vue'),
    meta: {
      title: '报告',
      ignoreAuth: true,
    },
  }, {
    path: '/template/:id',
    name: 'Template',
    component: () => import('@/pages/template/index.page.vue'),
    meta: {
      title: '模板',
      ignoreAuth: true,
    },
  }]
};

export const LoginRoute: AppRouteRecordRaw = {
  path: '/login',
  name: 'Login',
  component: () => import('@/pages/sys/login/index.page.vue'),
  meta: {
    title: '登录',
  },
};

// Basic routing without permission
export const basicRoutes = [
  // IndexRoute,
  LoginRoute,
  RootRoute,
  REDIRECT_ROUTE,
  PAGE_NOT_FOUND_ROUTE,
];
