// 主进程：窗口管理 + API 代理（绕开渲染进程 CORS 限制）
const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')

let mainWindow = null

// 读取 omnara CLI 的配置（token / org / project），GUI 与 CLI 共享同一身份
function loadOmnaraConfig() {
  const configPath = path.join(os.homedir(), '.config', 'omnara', 'config.json')
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    return {
      apiUrl: cfg.api_url || 'http://localhost:8000/api/v1',
      orgId: cfg.org_id,
      projectId: cfg.project_id,
      hasToken: Boolean(cfg.token),
    }
  } catch {
    return { apiUrl: 'http://localhost:8000/api/v1', orgId: null, projectId: null, hasToken: false }
  }
}

function getToken() {
  const configPath = path.join(os.homedir(), '.config', 'omnara', 'config.json')
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8')).token
  } catch {
    return null
  }
}

ipcMain.handle('omnara:config', () => loadOmnaraConfig())

// 统一 API 代理：渲染进程调用 window.omnara.fetch(path, { method, body })
ipcMain.handle('omnara:fetch', async (_event, { path: apiPath, method = 'GET', body }) => {
  const cfg = loadOmnaraConfig()
  const token = getToken()
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (method !== 'GET') headers['Idempotency-Key'] = crypto.randomUUID()

  try {
    const res = await fetch(cfg.apiUrl + apiPath, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* 非 JSON 响应 */ }
    return { status: res.status, ok: res.ok, json, text: json ? undefined : text }
  } catch (err) {
    return { status: 0, ok: false, json: null, text: String(err) }
  }
})

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'Omnara GUI',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  mainWindow.loadFile(path.join(__dirname, 'index.html'))
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
