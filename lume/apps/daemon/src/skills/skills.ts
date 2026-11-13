import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ToolError } from '../tools/types.js'
import type { Logger } from '../util/logger.js'

/**
 * Skill system: three-layer discovery with progressive disclosure.
 *
 * Layers (later wins on name collision):
 *   builtin  <daemon>/skills/        shipped with the daemon
 *   user     ~/.lume/skills/         personal, cross-project
 *   project  <cwd>/.lume/skills/     per-repository, highest priority
 *
 * Loading is two-stage: only name+description (SKILL.md frontmatter) enters
 * the system prompt; the body is fetched on demand via the load_skill tool.
 * Nested files (scripts/, assets/...) are never scanned here - the SKILL.md
 * body instructs the model to reach them through bash/read_file.
 */

export interface SkillMeta {
  name: string
  description: string
  dir: string
  source: 'builtin' | 'user' | 'project'
}

const MAX_DESCRIPTION_CHARS = 500
const VALID_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export class SkillIndex {
  private readonly dirs: Array<{ source: SkillMeta['source']; dir: string }>
  private skills = new Map<string, SkillMeta>()

  constructor(
    cwd: string,
    private readonly logger: Logger,
    dirs?: { builtin?: string; user?: string },
  ) {
    this.dirs = [
      { source: 'builtin', dir: dirs?.builtin ?? builtinSkillsDir() },
      { source: 'user', dir: dirs?.user ?? path.join(homedir(), '.lume', 'skills') },
      { source: 'project', dir: path.join(cwd, '.lume', 'skills') },
    ]
  }

  /**
   * Rescan all layers. Missing directories are normal (empty layer); a broken
   * layer never fails the turn - invalid skills are skipped with a warning.
   */
  async refresh(): Promise<SkillMeta[]> {
    const merged = new Map<string, SkillMeta>()
    for (const layer of this.dirs) {
      for (const meta of await scanLayer(layer, this.logger)) merged.set(meta.name, meta)
    }
    this.skills = merged
    return [...merged.values()]
  }

  /** The winning entry for a name, or undefined. */
  get(name: string): SkillMeta | undefined {
    return this.skills.get(name)
  }

  /** Absolute dirs of all discovered skills (readable roots for tools). */
  roots(): string[] {
    return [...this.skills.values()].map((s) => s.dir)
  }

  /**
   * Full SKILL.md body (frontmatter stripped) for a skill. Unknown names
   * trigger one rescan before giving up, so skills added mid-turn still load.
   */
  async load(name: string): Promise<string> {
    let meta = this.skills.get(name)
    if (meta === undefined) meta = (await this.refresh().then(() => this.skills.get(name)))
    if (meta === undefined) {
      throw new ToolError(
        `unknown skill: ${name} (call load_skill only with names from the system prompt)`,
      )
    }
    const content = await readFile(path.join(meta.dir, 'SKILL.md'), 'utf8')
    const { body } = parseSkillFile(content)
    const anchor =
      `# skill: ${meta.name}\n# directory: ${meta.dir}\n` +
      `# NOTE: every relative path in the instructions below (tools/, docs/, scripts/, ...)` +
      ` is relative to ${meta.dir} — run scripts with absolute paths` +
      ` (e.g. python3 ${meta.dir}/tools/xxx.py) or cd there first;\n` +
      `# its files are readable with read_file using absolute paths.\n\n`
    return anchor + body
  }
}

function builtinSkillsDir(): string {
  // src/skills/skills.ts -> ../../skills == apps/daemon/skills (dist mirrors src)
  return fileURLToPath(new URL('../../skills', import.meta.url))
}

async function scanLayer(
  layer: { source: SkillMeta['source']; dir: string },
  logger: Logger,
): Promise<SkillMeta[]> {
  let entries
  try {
    entries = await readdir(layer.dir, { withFileTypes: true })
  } catch {
    return [] // missing layer dir is normal, not an error
  }

  const out: SkillMeta[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    if (!VALID_NAME.test(entry.name)) {
      logger.warn('skill dir ignored: invalid name', { source: layer.source, dir: entry.name })
      continue
    }
    try {
      const meta = await readSkillMeta(path.join(layer.dir, entry.name), entry.name, layer.source)
      if (meta !== null) out.push(meta)
      else logger.warn('skill ignored: missing description', { source: layer.source, skill: entry.name })
    } catch (err) {
      logger.warn('skill ignored: unreadable SKILL.md', {
        source: layer.source,
        skill: entry.name,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return out
}

async function readSkillMeta(
  skillDir: string,
  dirName: string,
  source: SkillMeta['source'],
): Promise<SkillMeta | null> {
  const content = await readFile(path.join(skillDir, 'SKILL.md'), 'utf8')
  const { description } = parseSkillFile(content)
  if (description === undefined || description.length === 0) return null
  // the directory name is the canonical skill name; frontmatter name is advisory
  return {
    name: dirName,
    description: description.slice(0, MAX_DESCRIPTION_CHARS),
    dir: skillDir,
    source,
  }
}

/** Minimal frontmatter parser: only `name:` and `description:` single-line keys. */
export function parseSkillFile(content: string): {
  name?: string
  description?: string
  body: string
} {
  const lines = content.split('\n')
  if (lines[0]?.trim() !== '---') return { body: content }

  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if ((lines[i] ?? '').trim() === '---') {
      end = i
      break
    }
  }
  if (end === -1) return { body: content } // unterminated frontmatter: not frontmatter

  let name: string | undefined
  let description: string | undefined
  for (let i = 1; i < end; i++) {
    const match = /^(name|description):\s*(.*)$/.exec(lines[i] ?? '')
    if (match === null) continue
    const value = (match[2] ?? '').trim()
    if (match[1] === 'name') name = value
    else description = value
  }
  return { name, description, body: lines.slice(end + 1).join('\n').trim() }
}
