import { createApp } from 'vue';
import { VueQueryPlugin } from '@tanstack/vue-query';
import { queryClient } from '@/store/queries/client';
import { message } from 'ant-design-vue';

import { store } from '@/store';
import { router } from '@/router';
import { setupRouterGuard } from '@/router/guard';
import '@/store/subscriptions/index';
import { initI18n } from '@/i18n/index';

import '@shared/design/token.css';
import './style.less';
import '@zsfe/zsui/es/style.css';
import App from './App.vue';

const app = createApp(App);

app.use(store);
app.use(router);
setupRouterGuard(router);
initI18n();

app.use(VueQueryPlugin, {
  queryClient,
});

message.config({
  maxCount: 1,
});

app.mount('#app');
