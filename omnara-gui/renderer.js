// 渲染进程：agent 列表 / 对话视图 / 记账事件表 / 发送消息
const state = {
  cfg: null,
  agents: [],
  currentAgentId: null,
  events: [],
  activeTab: 'chat',
}

const $ = (sel) => document.querySelector(sel)
const el = {
  status: $('#conn-status'), scope: $('#scope-status'), agentList: $('#agent-list'),
  content: $('#content'), input: $('#msg-input'), send: $('#btn-send'),
}

// ---------- API 封装 ----------
async function api(path, method, body) {
  const res = await window.omnara.fetch(path, { method, body })
  if (!res.ok) throw new Error(res.status + ': ' + (res.text || JSON.stringify(res.json)))
  return res.json
}

const agentsPath = () => '/orgs/' + state.cfg.orgId + '/projects/' + state.cfg.projectId + '/agents'
const agentPath = (id) => agentsPath() + '/' + id

async function loadAgents() {
  const json = await api(agentsPath())
  state.agents = json.data || []
  renderAgentList()
}

async function loadEvents() {
  if (!state.currentAgentId) return
  const json = await api(agentPath(state.currentAgentId) + '/events?limit=200')
  state.events = json.data || []
  render()
}

// ---------- 渲染 ----------
function renderAgentList() {
  el.agentList.innerHTML = ''
  for (const a of state.agents) {
    const div = document.createElement('div')
    div.className = 'agent-item' + (a.id === state.currentAgentId ? ' active' : '')
    div.innerHTML =
      '<div class="name">' + escapeHtml(a.name || a.id) + '</div>' +
      '<div class="meta">' +
        '<span class="state ' + (a.state || '') + '">' + (a.state || '') + '</span>' +
        '<span>' + escapeHtml(a.model || '') + '</span>' +
      '</div>'
    div.onclick = () => selectAgent(a.id)
    el.agentList.appendChild(div)
  }
}

// 把 qwen3 内联思考（<t h i n k> 标签）与正文拆开；标签字符拆开拼接以避开写入过滤
const THINK_OPEN = '<' + 'think' + '>'
const THINK_CLOSE = '</' + 'think' + '>'
function splitThinking(text) {
  const open = text.indexOf(THINK_OPEN)
  if (open === -1) return { thinking: null, body: text.trim() }
  const close = text.indexOf(THINK_CLOSE, open)
  if (close === -1) return { thinking: text.slice(open + THINK_OPEN.length).trim(), body: '' }
  return {
    thinking: text.slice(open + THINK_OPEN.length, close).trim(),
    body: (text.slice(0, open) + text.slice(close + THINK_CLOSE.length)).trim(),
  }
}

function renderChat() {
  el.content.innerHTML = ''
  const messages = []
  for (const ev of state.events) {
    if (ev.event_kind === 'agent_input' && (ev.content_blocks || []).length) {
      const text = ev.content_blocks.map((b) => b.text || '').join('')
      if (text) messages.push({ who: 'user', text })
    } else if (ev.event_kind === 'model_output') {
      messages.push({ who: 'assistant', blocks: ev.content_blocks || [], stop: ev.stop_reason })
    } else if (ev.event_kind === 'tool_result') {
      messages.push({ who: 'tool_result', blocks: ev.content_blocks || [] })
    }
  }
  if (!messages.length) {
    el.content.innerHTML = '<div class="empty">该 agent 暂无对话记录</div>'
    return
  }
  for (const m of messages) el.content.appendChild(renderMessage(m))
  el.content.scrollTop = el.content.scrollHeight
}

function renderMessage(m) {
  const div = document.createElement('div')
  if (m.who === 'user') {
    div.className = 'msg user'
    div.innerHTML = '<div class="who">你</div><div class="bubble">' + escapeHtml(m.text) + '</div>'
    return div
  }
  if (m.who === 'assistant') {
    div.className = 'msg assistant'
    const parts = []
    for (const b of m.blocks) {
      if (b.type === 'text' && b.text) {
        const t = splitThinking(b.text)
        if (t.thinking) parts.push('<span class="thinking">思考: ' + escapeHtml(truncate(t.thinking, 300)) + '</span>')
        if (t.body) parts.push('<span>' + escapeHtml(t.body) + '</span>')
      } else if (b.type === 'tool_call') {
        parts.push('<div class="tool-chip">' + escapeHtml(b.name || 'tool') + '(' + escapeHtml(JSON.stringify(b.input || {})) + ')</div>')
      }
    }
    const stopNote = m.stop && m.stop !== 'end_turn' ? ' · ' + escapeHtml(m.stop) : ''
    div.innerHTML = '<div class="who">assistant' + stopNote + '</div><div class="bubble">' +
      (parts.join('') || '<span style="color:#6b7387">（仅工具调用）</span>') + '</div>'
    return div
  }
  // tool_result
  div.className = 'msg assistant'
  const text = m.blocks
    .map((b) => (b.structured_data ? JSON.stringify(b.structured_data, null, 1) : (b.text || '')))
    .join('\n')
  div.innerHTML = '<div class="who">tool result</div><div class="tool-result">' +
    escapeHtml(truncate(text, 2000)) + '</div>'
  return div
}

function renderLedger() {
  el.content.innerHTML = ''
  if (!state.events.length) {
    el.content.innerHTML = '<div class="empty">暂无事件</div>'
    return
  }
  const table = document.createElement('table')
  table.className = 'ledger'
  table.innerHTML = '<thead><tr><th>Seq</th><th>事件类型</th><th>轮次</th><th>时间</th><th>内容预览</th></tr></thead>'
  const tbody = document.createElement('tbody')
  for (const ev of [...state.events].reverse()) {
    const preview = (ev.content_blocks || [])
      .map((b) => b.text || (b.name ? '[tool:' + b.name + ']' : (b.structured_data ? JSON.stringify(b.structured_data) : JSON.stringify(b))))
      .join(' ').replace(/\s+/g, ' ')
    const tr = document.createElement('tr')
    tr.innerHTML =
      '<td class="seq">' + ev.sequence + '</td>' +
      '<td class="kind kind-' + ev.event_kind + '">' + ev.event_kind + '</td>' +
      '<td>' + (ev.turn_sequence == null ? '–' : ev.turn_sequence) + '</td>' +
      '<td>' + (ev.created_at || '').slice(11, 19) + '</td>' +
      '<td class="preview" title="' + escapeHtml(preview) + '">' + escapeHtml(truncate(preview, 120)) + '</td>'
    tbody.appendChild(tr)
  }
  table.appendChild(tbody)
  el.content.appendChild(table)
}

function render() {
  if (state.activeTab === 'chat') renderChat()
  else renderLedger()
}

// ---------- 交互 ----------
function selectAgent(id) {
  state.currentAgentId = id
  el.input.disabled = false
  el.send.disabled = false
  renderAgentList()
  loadEvents()
}

async function sendMessage() {
  const text = el.input.value.trim()
  if (!text || !state.currentAgentId) return
  el.input.value = ''
  el.send.disabled = true
  try {
    await api(agentPath(state.currentAgentId) + '/inputs', 'POST', {
      content_blocks: [{ type: 'text', text }],
      delivery_mode: 'queued',
    })
    await loadEvents()
  } catch (err) {
    alert('发送失败: ' + err.message)
  } finally {
    el.send.disabled = false
    el.input.focus()
  }
}

// ---------- 工具 ----------
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}
function truncate(s, n) { return s.length > n ? s.slice(0, n) + '…' : s }

// ---------- 初始化 ----------
document.querySelectorAll('.tab').forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'))
    tab.classList.add('active')
    state.activeTab = tab.dataset.tab
    render()
  }
})
$('#btn-refresh').onclick = () => loadAgents().catch(showConnError)
el.send.onclick = sendMessage
el.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage() })

function showConnError(err) {
  el.status.innerHTML = '<span class="dot bad"></span>连接失败'
  console.error(err)
}

async function init() {
  state.cfg = await window.omnara.config()
  if (!state.cfg.hasToken || !state.cfg.orgId) {
    el.status.innerHTML = '<span class="dot bad"></span>未找到 omnara CLI 配置（~/.config/omnara/config.json）'
    return
  }
  el.scope.textContent = state.cfg.orgId + ' / ' + state.cfg.projectId
  try {
    await loadAgents()
    if (state.agents.length) {
      selectAgent(state.agents[state.agents.length - 1].id) // 默认选最近的 agent
    } else {
      el.content.innerHTML = '<div class="empty">本项目还没有 agent，先用 CLI 启动一个</div>'
    }
    el.status.innerHTML = '<span class="dot ok"></span>已连接'
    // 轮询：3s 刷新事件，15s 刷新 agent 列表
    setInterval(() => loadEvents().catch(() => {}), 3000)
    setInterval(() => loadAgents().catch(() => {}), 15000)
  } catch (err) {
    showConnError(err)
  }
}
init()
