import type { ConfigEnv } from 'vite';

import { resolve } from 'path';

import { loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import vueJsx from '@vitejs/plugin-vue-jsx';

function pathResolve(dir: string) {
  return resolve(process.cwd(), '.', dir);
}

export default ({ mode }: ConfigEnv) => {
  const root = process.cwd();

  const { VITE_PUBLIC_PATH } = loadEnv(mode, root);

  return {
    base: VITE_PUBLIC_PATH,
    build: {
      // 1M, 单位是Byte
      chunkSizeWarningLimit: 1024 * 1024,
      minify: false, 
    },
    server: {
      // Listening on all local IPs
      host: true,
      port: 3201,
      
      // 🛡️ 防御配置：解决 WSL2/Docker/网络盘/软链接 下文件监听失效
      watch: {
        usePolling: true,         // 强制轮询（开发环境可接受轻微 CPU 增加）
        interval: 100,
      },

      // Load proxy configuration from .env
      proxy: {
        // '/api': {
        //   target: 'http://10.56.63.32:32300/api',
        //   changeOrigin: true,
        //   rewrite: (path) => path.replace(new RegExp(`^\/api`), ''),
        // },
        // '/data-query-api/sys': {
        //   // 测试环境
        //   target: 'http://10.58.228.100/data-query-api/sys',
        //   changeOrigin: true,
        //   rewrite: (path) => path.replace(new RegExp(`^\/data-query-api\/sys`), ''),
        // },
        // '/data-query-api': {
        //   // polo
        //   target: 'http://10.53.188.76:7040/data-query-api',
        //   changeOrigin: true,
        //   rewrite: (path) => path.replace(new RegExp(`^\/data-query-api`), ''),
        // },
        '/data-query-api': {
          // 测试环境
          target: 'http://10.58.228.100/data-query-api',
          changeOrigin: true,
          rewrite: (path) => path.replace(new RegExp(`^\/data-query-api`), ''),
        },
        // '/data-query-api': {
        //   // 线上
        //   target: 'http://10.56.38.188/data-query-api',
        //   changeOrigin: true,
        //   rewrite: (path) => path.replace(new RegExp(`^\/data-query-api`), ''),
        // },
      },
    },
    plugins: [vue(), vueJsx()],
    resolve: {
      alias: [
        {
          find: /@\//,
          replacement: pathResolve('src') + '/',
        },

        {
          find: /#\//,
          replacement: pathResolve('src/types') + '/',
        },

        {
          find: /@shared\//,
          replacement: pathResolve('../../shared') + '/',
        },
        {
          find: /@editor\//,
          replacement: pathResolve('../../packages/editor/src') + '/',
        }
      ],
    },
  };
};
