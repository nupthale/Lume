#!/usr/bin/env node
/**
 * 一键开发启动：web dev server (3201) + Electron 壳
 *
 * 流程：先启动 dataQuery vite dev server，轮询端口就绪后再启动 Electron
 * （其 dev 脚本自带 LUME_WEB_URL=http://localhost:3201），两者任一退出时
 * 连带清理另一个，避免残留进程占用端口。
 */
import { spawn } from 'node:child_process'
import net from 'node:net'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PORT = Number(process.env.LUME_WEB_PORT || 3201)
const isWin = process.platform === 'win32'
const children = []

const log = (msg) => console.log(`\x1b[36m[dev:app]\x1b[0m ${msg}`)

function start(name, command, args, cwd) {
  // posix 上以独立进程组启动，便于整组清理（pnpm 会再派生 vite/electron 子进程）
  const child = spawn(command, args, {
    cwd,
    stdio: 'inherit',
    shell: isWin,
    detached: !isWin,
  })
  children.push(child)
  log(`${name} started (pid ${child.pid})`)
  return child
}

function killAll() {
  for (const child of children) {
    if (child.exitCode !== null) continue
    try {
      if (isWin) {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'])
      } else {
        process.kill(-child.pid, 'SIGTERM')
      }
    } catch {
      // already gone
    }
  }
}

function waitForPort(port, timeoutMs = 90_000) {
  const startedAt = Date.now()
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const socket = net.connect(port, '127.0.0.1')
      socket.once('connect', () => {
        socket.destroy()
        resolve()
      })
      socket.once('error', () => {
        socket.destroy()
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`web dev server did not listen on :${port} within ${timeoutMs / 1000}s`))
        } else {
          setTimeout(tryOnce, 500)
        }
      })
    }
    tryOnce()
  })
}

try {
  log('starting web dev server (dataQuery, port ' + PORT + ')...')
  start('web', 'pnpm', ['--dir', 'apps/web/apps/dataQuery', 'dev'], ROOT)

  await waitForPort(PORT)
  log('web ready, starting electron...')
  const electron = start('electron', 'pnpm', ['--dir', 'apps/client', 'dev'], ROOT)

  // 关闭 Electron 窗口即整体退出（web server 一并清理）
  electron.on('exit', () => {
    log('electron exited, shutting down')
    killAll()
    process.exit(0)
  })
} catch (error) {
  console.error(`\x1b[31m[dev:app]\x1b[0m ${error.message}`)
  killAll()
  process.exit(1)
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    killAll()
    process.exit(0)
  })
}
