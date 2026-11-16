import { app, BrowserWindow, ipcMain } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const DAEMON_DIR = fileURLToPath(new URL('../daemon/', import.meta.url))
const PRELOAD_PATH = fileURLToPath(new URL('./preload.cjs', import.meta.url))
const WEB_DIST_INDEX = fileURLToPath(new URL('../web/apps/dataQuery/dist/index.html', import.meta.url))
const DAEMON_ARGS = ['tsx', '--env-file=.env', 'src/index.ts']

// 应用图标（apps/client/public 下）
const PUBLIC_DIR = fileURLToPath(new URL('./public/', import.meta.url))
const ICON_ICNS = path.join(PUBLIC_DIR, 'AppIcon.icns') // macOS 打包
const ICON_ICO = path.join(PUBLIC_DIR, 'icon.ico') // Windows 窗口/任务栏/打包
const ICON_PNG = path.join(PUBLIC_DIR, 'icon.png') // macOS 运行时 Dock 图标

class DaemonManager {
  constructor(broadcast) {
    this.broadcast = broadcast
    this.processes = new Map()
    this.children = new Set()
    this.permissionRequests = new Map()
    this.resuming = new Map()
  }

  async createConversation() {
    return this.startStream([])
  }

  // Resume an existing session: spawn a daemon with `--session <id>` so old
  // conversations keep working after app restart. Concurrent callers share one spawn.
  resumeConversation(conversationId) {
    const pending = this.resuming.get(conversationId)
    if (pending) return pending

    const promise = this.startStream(['--session', conversationId])
      .then(() => this.resuming.delete(conversationId))
      .catch((error) => {
        this.resuming.delete(conversationId)
        throw error
      })
    this.resuming.set(conversationId, promise)
    return promise
  }

  async ensureConversation(conversationId) {
    if (!this.processes.has(conversationId)) {
      await this.resumeConversation(conversationId)
    }
  }

  startStream(extraArgs) {
    const child = spawn('npx', [...DAEMON_ARGS, '--mode', 'stream', ...extraArgs], {
      cwd: DAEMON_DIR,
      env: process.env,
    })
    this.children.add(child)

    return new Promise((resolve, reject) => {
      let buffer = ''
      let startupStderr = ''
      let conversationId
      let settled = false

      const rejectStartup = (message) => {
        if (settled) return
        settled = true
        const detail = startupStderr.trim()
        reject(new Error(detail ? `${message}\n${detail}` : message))
      }

      const handleLine = (line) => {
        if (!line.trim()) return

        let event
        try {
          event = JSON.parse(line)
        } catch {
          return
        }

        if (!conversationId && event.type === 'ready') {
          conversationId = event.session_id
          this.processes.set(conversationId, child)
        }

        if (!conversationId) return

        if (event.type === 'permission_request') {
          this.permissionRequests.set(event.id, conversationId)
        }

        this.broadcast(conversationId, event)

        if (!settled && event.type === 'ready') {
          settled = true
          resolve({ conversationId })
        }
      }

      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk) => {
        buffer += chunk
        let newlineIndex
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newlineIndex)
          buffer = buffer.slice(newlineIndex + 1)
          handleLine(line)
        }
      })
      child.stdout.on('end', () => {
        if (buffer) handleLine(buffer)
        buffer = ''
      })

      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk) => {
        if (!settled) startupStderr += chunk
      })

      child.once('error', (error) => {
        rejectStartup(`Failed to start daemon: ${error.message}`)
      })
      child.once('close', (code, signal) => {
        this.children.delete(child)
        if (conversationId && this.processes.get(conversationId) === child) {
          this.processes.delete(conversationId)
          this.clearPermissionRequests(conversationId)
        }
        rejectStartup(
          `Daemon exited before session.ready (code ${code ?? 'none'}, signal ${signal ?? 'none'})`,
        )
      })
    })
  }

  async listConversations() {
    const stdout = await this.runDaemonCommand(['--list-sessions', '--json'])
    return JSON.parse(stdout)
  }

  async getMessages(conversationId) {
    const stdout = await this.runDaemonCommand(['--dump-session', conversationId])
    return JSON.parse(stdout)
  }

  async deleteConversation(conversationId) {
    const child = this.processes.get(conversationId)
    if (child) {
      this.processes.delete(conversationId)
      child.kill()
    }
    this.clearPermissionRequests(conversationId)
    await this.runDaemonCommand(['--delete-session', conversationId])
  }

  async sendMessage(conversationId, content) {
    await this.ensureConversation(conversationId)
    this.sendCommand(conversationId, { type: 'user_message', content })
  }

  interrupt(conversationId) {
    // Nothing to interrupt when no daemon is running (e.g. stale conversation
    // or already-finished turn) — swallow instead of throwing.
    if (this.processes.has(conversationId)) {
      this.sendCommand(conversationId, { type: 'interrupt' })
    }
  }

  async feedback(conversationId, messageSeq, likeType) {
    await this.runDaemonCommand([
      '--feedback',
      conversationId,
      String(messageSeq),
      String(likeType),
    ])
  }

  permissionResponse(requestId, approved) {
    const conversationId = this.permissionRequests.get(requestId)
    if (!conversationId) {
      throw new Error(`No running daemon for permission request ${requestId}`)
    }

    this.sendCommand(conversationId, {
      type: 'permission_response',
      id: requestId,
      approve: approved,
    })
    this.permissionRequests.delete(requestId)
  }

  sendCommand(conversationId, command) {
    const child = this.processes.get(conversationId)
    if (!child || child.stdin.destroyed) {
      throw new Error(`No running daemon for conversation ${conversationId}`)
    }
    child.stdin.write(`${JSON.stringify(command)}\n`)
  }

  clearPermissionRequests(conversationId) {
    for (const [requestId, ownerId] of this.permissionRequests) {
      if (ownerId === conversationId) this.permissionRequests.delete(requestId)
    }
  }

  async runDaemonCommand(args) {
    try {
      const { stdout } = await execFileAsync('npx', [...DAEMON_ARGS, ...args], {
        cwd: DAEMON_DIR,
        env: process.env,
      })
      return stdout
    } catch (error) {
      const detail = typeof error.stderr === 'string' ? error.stderr.trim() : ''
      throw new Error(detail || error.message)
    }
  }

  killAll() {
    this.processes.clear()
    this.permissionRequests.clear()
    this.resuming.clear()
    for (const child of this.children) child.kill()
    this.children.clear()
  }
}

const daemonManager = new DaemonManager((conversationId, event) => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('lume:event', { conversationId, event })
  }
})

ipcMain.handle('lume:createConversation', () => daemonManager.createConversation())
ipcMain.handle('lume:listConversations', () => daemonManager.listConversations())
ipcMain.handle('lume:getMessages', (_event, conversationId) =>
  daemonManager.getMessages(conversationId),
)
ipcMain.handle('lume:deleteConversation', (_event, conversationId) =>
  daemonManager.deleteConversation(conversationId),
)
ipcMain.handle('lume:sendMessage', (_event, conversationId, content) =>
  daemonManager.sendMessage(conversationId, content),
)
ipcMain.handle('lume:interrupt', (_event, conversationId) =>
  daemonManager.interrupt(conversationId),
)
ipcMain.handle('lume:feedback', (_event, conversationId, messageSeq, likeType) =>
  daemonManager.feedback(conversationId, messageSeq, likeType),
)
ipcMain.handle('lume:permissionResponse', (_event, requestId, approved) =>
  daemonManager.permissionResponse(requestId, approved),
)

const TITLEBAR_HEIGHT = 36
const isMac = process.platform === 'darwin'

// 融合标题栏样式：由主进程注入，不改动 web 源码
const TITLEBAR_CSS = isMac
  ? `
/* macOS：红绿灯悬浮于侧栏顶部，Logo 下移避让；Logo 区作为拖拽区 */
.sider .wrapper { padding-top: 56px !important; -webkit-app-region: drag; }
.sider .wrapper * { -webkit-app-region: no-drag; }
/* 侧栏收起时的展开按钮下移，避让窗口按钮 */
.fixed.top-\\[15px\\].left-4 { top: 56px !important; }
`
  : `
/* Windows：内容整体下移一条标题栏带（背景即 body 的 sider 色，随主题自适应），带内可拖拽 */
#app { top: ${TITLEBAR_HEIGHT}px !important; }
body::before {
  content: '';
  position: fixed;
  top: 0; left: 0; right: 0;
  height: ${TITLEBAR_HEIGHT}px;
  -webkit-app-region: drag;
  z-index: 1;
}
.fixed.top-\\[15px\\].left-4 { top: ${TITLEBAR_HEIGHT + 10}px !important; }
`

async function createWindow() {
  const window = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1430, // 与 web 应用 style.less 的 min-width 对齐，避免横向滚动条
    minHeight: 760,
    center: true,
    // Windows/Linux：窗口与任务栏图标（macOS 窗口图标由系统忽略，Dock 见下方 setIcon）
    icon: isMac ? undefined : ICON_ICO,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
    },
    // 融合窗口控制按钮：mac 红绿灯悬浮在侧栏顶部；Windows 用系统绘制的
    // titleBarOverlay（右上角最小化/最大化/关闭），颜色跟随侧栏主题
    ...(isMac
      ? {
          titleBarStyle: 'hidden',
          trafficLightPosition: { x: 16, y: 22 },
        }
      : {
          titleBarStyle: 'hidden',
          titleBarOverlay: {
            color: '#f4f7fd',
            symbolColor: '#646a73',
            height: TITLEBAR_HEIGHT,
          },
        }),
  })

  window.webContents.on('did-finish-load', () => {
    window.webContents.insertCSS(TITLEBAR_CSS, { cssOrigin: 'author' })
    if (!isMac) watchThemeForTitlebar(window)
  })

  if (process.env.LUME_WEB_URL) {
    await window.loadURL(process.env.LUME_WEB_URL)
  } else if (existsSync(WEB_DIST_INDEX)) {
    await window.loadFile(WEB_DIST_INDEX)
  } else {
    await window.loadURL('http://localhost:5173')
  }
}

// Windows：跟随 web 端明暗主题刷新 titleBarOverlay 颜色（浅/深两套与 token.css 对齐）
function watchThemeForTitlebar(window) {
  if (window.__lumeThemeTimer) clearInterval(window.__lumeThemeTimer)

  const apply = async () => {
    try {
      const theme = await window.webContents.executeJavaScript(
        `document.documentElement.getAttribute('data-theme') || ''`,
      )
      const dark = theme === 'dark'
      window.setTitleBarOverlay({
        color: dark ? '#292929' : '#f4f7fd',
        symbolColor: dark ? '#a6a6a6' : '#646a73',
        height: TITLEBAR_HEIGHT,
      })
    } catch {
      // window closed
    }
  }

  apply()
  window.__lumeThemeTimer = setInterval(apply, 2000)
  window.once('closed', () => clearInterval(window.__lumeThemeTimer))
}

app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => daemonManager.killAll())
app.disableHardwareAcceleration()

// macOS：运行时替换 Dock 图标（开发模式下默认显示 Electron 图标）
if (isMac && app.dock) {
  try {
    app.dock.setIcon(ICON_PNG)
  } catch (error) {
    console.error('failed to set dock icon:', error)
  }
}

app.whenReady().then(createWindow)
