import type { SearchMessageHit, SessionRow } from './store.js'

/** max length of the stored session title (derived from the first user message) */
const TITLE_MAX = 60
/** column width of the title in the --list-sessions listing */
const TITLE_COL = 40
/** max length of the snippet in the --search listing */
const SNIPPET_COL = 80

/**
 * Session title derived from the first user message: surrounding whitespace
 * stripped, inner whitespace runs collapsed to single spaces, first 60
 * characters kept. Empty input yields an empty title.
 */
export function deriveTitle(message: string): string {
  return message.trim().replace(/\s+/g, ' ').slice(0, TITLE_MAX)
}

/**
 * Format the --list-sessions listing as plain text: aligned columns for id,
 * local-time created_at, title ("(no title)" when unset) and message count.
 * An empty list yields a friendly notice instead of a bare table header.
 */
export function formatSessionList(rows: SessionRow[]): string {
  if (rows.length === 0) return 'No sessions found.\n'
  const header =
    'ID'.padEnd(26) +
    '  ' +
    'CREATED'.padEnd(19) +
    '  ' +
    'TITLE'.padEnd(TITLE_COL) +
    '  ' +
    'MSGS'
  const lines = rows.map(
    (row) =>
      row.id.padEnd(26) +
      '  ' +
      formatLocalTime(row.createdAt).padEnd(19) +
      '  ' +
      displayTitle(row.title).padEnd(TITLE_COL) +
      '  ' +
      String(row.messageCount).padStart(4),
  )
  return [header, ...lines].join('\n') + '\n'
}

function displayTitle(title: string): string {
  if (title === '') return '(no title)'
  return title.length > TITLE_COL ? `${title.slice(0, TITLE_COL - 1)}…` : title
}

/**
 * Confirmation line for --delete-session: id plus the row counts removed
 * alongside the session (messages, facts, todos).
 */
export function formatSessionDeletion(
  id: string,
  counts: { messages: number; facts: number; todos: number },
): string {
  return `deleted session ${id} (${counts.messages} messages, ${counts.facts} facts, ${counts.todos} todos)\n`
}

/**
 * Format the --search listing as plain text: aligned columns for session id,
 * title, seq, role and a single-line snippet ("No matches." when the hit
 * list is empty).
 */
export function formatSearchResults(rows: SearchMessageHit[]): string {
  if (rows.length === 0) return 'No matches.\n'
  const header =
    'ID'.padEnd(26) +
    '  ' +
    'TITLE'.padEnd(TITLE_COL) +
    '  ' +
    'SEQ'.padStart(4) +
    '  ' +
    'ROLE'.padEnd(9) +
    '  ' +
    'SNIPPET'
  const lines = rows.map(
    (row) =>
      row.sessionId.padEnd(26) +
      '  ' +
      displayTitle(row.title).padEnd(TITLE_COL) +
      '  ' +
      String(row.seq).padStart(4) +
      '  ' +
      row.role.padEnd(9) +
      '  ' +
      displaySnippet(row.snippet),
  )
  return [header, ...lines].join('\n') + '\n'
}

/** collapse whitespace runs to single spaces and cap at SNIPPET_COL chars */
function displaySnippet(snippet: string): string {
  const single = snippet.replace(/\s+/g, ' ').trim()
  return single.length > SNIPPET_COL ? `${single.slice(0, SNIPPET_COL - 1)}…` : single
}

/** ISO timestamp -> local-timezone "YYYY-MM-DD HH:mm:ss" (fixed 19 chars) */
function formatLocalTime(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  )
}
