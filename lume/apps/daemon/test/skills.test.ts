import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createLogger } from '../src/util/logger.js'
import { makeLoadSkillTool } from '../src/skills/load-skill-tool.js'
import { SkillIndex, parseSkillFile } from '../src/skills/skills.js'
import { ToolRegistry, defaultTools } from '../src/tools/registry.js'
import type { ToolContext } from '../src/tools/types.js'

const logger = createLogger('error')
const dirs: string[] = []

async function makeDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'lume-skills-'))
  dirs.push(dir)
  return dir
}

/** write <root>/<name>/SKILL.md with the given frontmatter+body */
async function writeSkill(root: string, name: string, skillMd: string): Promise<void> {
  await mkdir(path.join(root, name), { recursive: true })
  await writeFile(path.join(root, name, 'SKILL.md'), skillMd, 'utf8')
}

/**
 * Create a fake project cwd and return { cwd, projectDir } where projectDir is
 * the <cwd>/.lume/skills/ directory SkillIndex will actually scan.
 */
async function makeProject(): Promise<{ cwd: string; projectDir: string }> {
  const cwd = await mkdtemp(path.join(tmpdir(), 'lume-skills-'))
  dirs.push(cwd)
  const projectDir = path.join(cwd, '.lume', 'skills')
  return { cwd, projectDir }
}

function makeIndex(cwd: string, builtin: string, user: string): SkillIndex {
  return new SkillIndex(cwd, logger, { builtin, user })
}

function toolCtx(cwd: string): ToolContext {
  return { cwd, signal: AbortSignal.timeout(5_000), maxOutputChars: 100_000 }
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

describe('parseSkillFile (frontmatter)', () => {
  it('extracts name/description and strips frontmatter from the body', () => {
    const parsed = parseSkillFile(
      `---\nname: demo\ndescription: a demo skill\n---\n\nStep 1. do things.`,
    )
    expect(parsed.name).toBe('demo')
    expect(parsed.description).toBe('a demo skill')
    expect(parsed.body).toBe('Step 1. do things.')
  })

  it('treats content without (or with unterminated) frontmatter as pure body', () => {
    expect(parseSkillFile('just body').body).toBe('just body')
    expect(parseSkillFile('---\nname: x').body).toBe('---\nname: x')
  })
})

describe('SkillIndex discovery', () => {
  it('merges builtin < user < project, last layer winning on collision', async () => {
    const builtin = await makeDir()
    const user = await makeDir()
    const { cwd, projectDir } = await makeProject()
    await writeSkill(builtin, 'deploy', '---\ndescription: builtin deploy\n---\nbuiltin body')
    await writeSkill(builtin, 'orphan', '---\ndescription: only in builtin\n---\nx')
    await writeSkill(user, 'deploy', '---\ndescription: user deploy\n---\nuser body')
    await writeSkill(projectDir, 'deploy', '---\ndescription: project deploy\n---\nproject body')

    const index = makeIndex(cwd, builtin, user)
    const skills = await index.refresh()

    const deploy = skills.find((s) => s.name === 'deploy')
    expect(deploy?.source).toBe('project')
    expect(deploy?.description).toBe('project deploy')
    expect(skills.find((s) => s.name === 'orphan')?.source).toBe('builtin')
    expect(skills).toHaveLength(2)
  })

  it('uses the directory name as the skill name; skips invalid or missing skills', async () => {
    const builtin = await makeDir()
    const user = await makeDir()
    const { cwd, projectDir } = await makeProject()
    // frontmatter name mismatches the dir -> dir name wins
    await writeSkill(projectDir, 'right-name', '---\nname: wrong-name\ndescription: d\n---\nbody')
    // no SKILL.md at all -> skipped
    await mkdir(path.join(projectDir, 'no-entry'), { recursive: true })
    // missing description -> skipped
    await writeSkill(projectDir, 'no-desc', '---\nname: x\n---\nbody')
    // dot-prefixed dir -> skipped
    await writeSkill(projectDir, '.hidden', '---\ndescription: d\n---\nbody')

    const skills = await makeIndex(cwd, builtin, user).refresh()
    expect(skills).toHaveLength(1)
    expect(skills[0]?.name).toBe('right-name')
  })

  it('treats missing layer directories as empty instead of failing', async () => {
    const cwd = await makeDir()
    const skills = await makeIndex(cwd, path.join(cwd, 'no-builtin'), path.join(cwd, 'no-user')).refresh()
    expect(skills).toEqual([])
  })

  it('load() returns the body without frontmatter and re-scans for skills added mid-session', async () => {
    const builtin = await makeDir()
    const user = await makeDir()
    const { cwd, projectDir } = await makeProject()
    await writeSkill(projectDir, 'demo', '---\ndescription: d\n---\n\nActual instructions.')

    const index = makeIndex(cwd, builtin, user)
    await index.refresh()
    const body = await index.load('demo')
    expect(body).toContain('skill: demo')
    expect(body).toContain('directory:')
    expect(body).toContain('Actual instructions.')
    // path anchoring note: every skill body is prefixed with absolute-path guidance
    expect(body).toContain('is relative to')
    expect(body).toContain('readable with read_file')
    expect(body).not.toContain('description:')
    expect(body).not.toContain('---')

    // a skill added after the last refresh still loads (one rescan fallback)
    await writeSkill(projectDir, 'late', '---\ndescription: late arrival\n---\nlate body')
    expect(await index.load('late')).toContain('late body')

    await expect(index.load('never-existed')).rejects.toThrow(/unknown skill/)
  })
})

describe('load_skill tool', () => {
  it('is wired into the registry: reads args, returns the skill body', async () => {
    const builtin = await makeDir()
    const user = await makeDir()
    const { cwd, projectDir } = await makeProject()
    await writeSkill(projectDir, 'demo', '---\ndescription: d\n---\nSkill instructions here.')

    const index = makeIndex(cwd, builtin, user)
    const registry = new ToolRegistry([...defaultTools(), makeLoadSkillTool(index)])
    await index.refresh()

    const result = await registry.execute('load_skill', { name: 'demo' }, toolCtx(cwd))
    expect(result.output).toContain('Skill instructions here.')

    await expect(registry.execute('load_skill', { name: 'nope' }, toolCtx(cwd))).rejects.toThrow(
      /unknown skill/,
    )
  })

  it('lets read_file read skill files via skillDirs, while other outside paths stay blocked', async () => {
    const builtin = await makeDir()
    const user = await makeDir()
    const { cwd, projectDir } = await makeProject()
    await writeSkill(projectDir, 'demo', '---\ndescription: d\n---\nSkill instructions here.')
    await mkdir(path.join(projectDir, 'demo', 'references'), { recursive: true })
    await writeFile(path.join(projectDir, 'demo', 'references', 'notes.md'), 'nested reference', 'utf8')
    const index = makeIndex(cwd, builtin, user)
    const registry = new ToolRegistry([...defaultTools(), makeLoadSkillTool(index)])
    await index.refresh()

    const skillDir = index.get('demo')?.dir as string
    const ctx = { ...toolCtx(cwd), skillDirs: index.roots() }

    // absolute path inside a discovered skill dir: readable
    const direct = await registry.execute(
      'read_file',
      { path: path.join(skillDir, 'SKILL.md') },
      ctx,
    )
    expect(direct.output).toContain('Skill instructions here.')

    // nested resource of the skill: readable too
    const nested = await registry.execute(
      'read_file',
      { path: path.join(skillDir, 'references', 'notes.md') },
      ctx,
    )
    expect(nested.output).toContain('nested reference')

    // outside cwd AND outside skill dirs: still blocked
    const outsider = await makeDir()
    await writeFile(path.join(outsider, 'secret.txt'), 'nope', 'utf8')
    await expect(
      registry.execute('read_file', { path: path.join(outsider, 'secret.txt') }, ctx),
    ).rejects.toThrow(/escapes the working directory/)

    // review phase agrees: boundary check passes for skill paths, fails for outsiders
    const { pathBoundaryCheck } = await import('../src/tools/read.js')
    expect(pathBoundaryCheck({ path: path.join(skillDir, 'SKILL.md') }, cwd, index.roots()).passed)
      .toBe(true)
    expect(pathBoundaryCheck({ path: path.join(outsider, 'secret.txt') }, cwd, index.roots()).passed)
      .toBe(false)
  })
})
