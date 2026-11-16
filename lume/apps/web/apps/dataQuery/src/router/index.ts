import { createRouter, createWebHistory } from 'vue-router';

import { basicRoutes } from './routes';

const base = import.meta.env.VITE_PUBLIC_PATH;

export const router = createRouter({
  history: createWebHistory(base),
  // @ts-ignore
  routes: basicRoutes,
  strict: true,
});

export function resetRouter() {}
