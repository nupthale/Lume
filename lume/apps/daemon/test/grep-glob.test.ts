import { mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { globTool } from '../src/tools/glob.js'
import { grepTool, grepWithNode } from '../src/tools/grep.js'
import { defaultTools, ToolRegistry } from '../src/tools/registry.js'
import type { ToolContext } from '../src/tools/types.js'

function ctx(cwd: string, skillDirs?: string[]): ToolContext {
  return {
    cwd,
    signal: new AbortController().signal,
    maxOutputChars: 50_000,
    ...(skillDirs !== undefined ? { skillDirs } : {}),
  }
}

async function makeGrepTree(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'lume-grep-'))
  await writeFile(join(cwd, 'app.ts'), "export const x = 'needle'\n// TODO: fix me\n")
  await writeFile(join(cwd, 'app.test.ts'), 'needle in test\n')
  await writeFile(join(cwd, 'notes.md'), 'The needle hides\n')
  await mkdir(join(cwd, 'src'), { recursive: true })
  await writeFile(join(cwd, 'src/util.ts'), 'needle deep\n')
  await mkdir(join(cwd, 'node_modules'), { recursive: true })
  await writeFile(join(cwd, 'node_modules/pkg.js'), 'needle inside node_modules\n')
  await mkdir(join(cwd, 'dist'), { recursive: true })
  await writeFile(join(cwd, 'dist/bundle.js'), 'needle inside dist\n')
  return cwd
}

describe('grep tool', () => {
  const registry = new ToolRegistry()

  it('reports matches as path:line:content and skips node_modules/dist', async () => {
    const cwd = await makeGrepTree()
    const res = await registry.execute('grep', { pattern: 'needle' }, ctx(cwd))
    const lines = res.output.split('\n')
    expect(lines).toContain("app.ts:1:export const x = 'needle'")
    expect(lines).toContain('app.test.ts:1:needle in test')
    expect(lines).toContain('notes.md:1:The needle hides')
    expect(lines).toContain('src/util.ts:1:needle deep')
    expect(lines).toHaveLength(4)
    expect(res.output).not.toContain('node_modules')
    expect(res.output).not.toContain('bundle.js')

    // the pure-Node fallback produces the same lines (order may differ)
    const nodeOut = await grepWithNode({ pattern: 'needle' }, ctx(cwd))
    expect(nodeOut.split('\n').sort()).toEqual([...lines].sort())
  })

  it('honors ignore_case (rg path and Node path)', async () => {
    const cwd = await makeGrepTree()
    const none = await registry.execute('grep', { pattern: 'todo' }, ctx(cwd))
    expect(none.output).toBe('no matches')
    const hits = await registry.execute('grep', { pattern: 'todo', ignore_case: true }, ctx(cwd))
    expect(hits.output).toContain('app.ts:2:// TODO: fix me')

    expect(await grepWithNode({ pattern: 'todo' }, ctx(cwd))).toBe('no matches')
    const nodeHits = await grepWithNode({ pattern: 'todo', ignore_case: true }, ctx(cwd))
    expect(nodeHits).toContain('app.ts:2:// TODO: fix me')
  })

  it('filters files by glob', async () => {
    const cwd = await makeGrepTree()
    const md = await registry.execute('grep', { pattern: 'needle', glob: '*.md' }, ctx(cwd))
    expect(md.output.split('\n')).toEqual(['notes.md:1:The needle hides'])

    const nodeSrc = await grepWithNode({ pattern: 'needle', glob: 'src/*.ts' }, ctx(cwd))
    expect(nodeSrc.split('\n')).toEqual(['src/util.ts:1:needle deep'])
  })

  it('caps output lines at head_limit', async () => {
    const cwd = await makeGrepTree()
    await writeFile(
      join(cwd, 'many.txt'),
      `${Array.from({ length: 10 }, (_, i) => `hit ${i}`).join('\n')}\n`,
    )
    const limited = await registry.execute('grep', { pattern: 'hit', head_limit: 3 }, ctx(cwd))
    expect(limited.output.split('\n')).toHaveLength(3)
    const limitedNode = await grepWithNode({ pattern: 'hit', head_limit: 3 }, ctx(cwd))
    expect(limitedNode.split('\n')).toHaveLength(3)
  })

  it('emits context lines grep-style (path-line-content)', async () => {
    const cwd = await makeGrepTree()
    await writeFile(join(cwd, 'ctx.txt'), 'one\ntwo\nthree\nfour\nfive\n')
    const expected = ['ctx.txt-2-two', 'ctx.txt:3:three', 'ctx.txt-4-four']
    const nodeOut = await grepWithNode({ pattern: 'three', context: 1 }, ctx(cwd))
    expect(nodeOut.split('\n')).toEqual(expected)
    const rgOut = await registry.execute('grep', { pattern: 'three', context: 1 }, ctx(cwd))
    expect(rgOut.output.split('\n')).toEqual(expected)
  })

  it('rejects paths outside cwd and skill directories', async () => {
    const cwd = await makeGrepTree()
    const c = ctx(cwd)
    await expect(registry.execute('grep', { pattern: 'x', path: '../../etc' }, c)).rejects.toThrow(
      /escapes the working directory/,
    )
    await expect(grepWithNode({ pattern: 'x', path: '../../etc' }, c)).rejects.toThrow(
      /escapes the working directory/,
    )
    await expect(
      registry.execute('glob', { pattern: '*', path: '../../etc' }, c),
    ).rejects.toThrow(/escapes the working directory/)
  })

  it('reads inside skillDirs when the path points there', async () => {
    const cwd = await makeGrepTree()
    const skillDir = await mkdtemp(join(tmpdir(), 'lume-skill-'))
    await writeFile(join(skillDir, 'skill-data.txt'), 'needle skill\n')
    const c = ctx(cwd, [skillDir])
    const rgRes = await registry.execute(
      'grep',
      { pattern: 'needle skill', path: join(skillDir, 'skill-data.txt') },
      c,
    )
    expect(rgRes.output).toContain('skill-data.txt:1:needle skill')
    const nodeRes = await grepWithNode(
      { pattern: 'needle skill', path: join(skillDir, 'skill-data.txt') },
      c,
    )
    expect(nodeRes).toContain('skill-data.txt:1:needle skill')
  })

  it('reports invalid regexes clearly', async () => {
    const cwd = await makeGrepTree()
    await expect(registry.execute('grep', { pattern: '(' }, ctx(cwd))).rejects.toThrow(
      /invalid regex/,
    )
    await expect(grepWithNode({ pattern: '(' }, ctx(cwd))).rejects.toThrow(/invalid regex/)
  })

  it('returns no matches for absent patterns and errors on missing paths', async () => {
    const cwd = await makeGrepTree()
    expect((await registry.execute('grep', { pattern: 'zzzz_nothing' }, ctx(cwd))).output).toBe(
      'no matches',
    )
    expect(await grepWithNode({ pattern: 'zzzz_nothing' }, ctx(cwd))).toBe('no matches')
    await expect(
      registry.execute('grep', { pattern: 'x', path: 'missing-dir' }, ctx(cwd)),
    ).rejects.toThrow(/cannot search/)
  })
})

async function makeGlobTree(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'lume-glob-'))
  await writeFile(join(cwd, 'a.ts'), 'a')
  await writeFile(join(cwd, 'b.ts'), 'b')
  await writeFile(join(cwd, 'ax.ts'), 'ax')
  await writeFile(join(cwd, 'old.ts'), 'old')
  await writeFile(join(cwd, 'new.ts'), 'new')
  await mkdir(join(cwd, 'docs'), { recursive: true })
  await writeFile(join(cwd, 'docs/readme.md'), 'readme')
  await mkdir(join(cwd, 'src/deep'), { recursive: true })
  await writeFile(join(cwd, 'src/main.ts'), 'main')
  await writeFile(join(cwd, 'src/deep/leaf.ts'), 'leaf')
  await mkdir(join(cwd, 'node_modules'), { recursive: true })
  await writeFile(join(cwd, 'node_modules/x.ts'), 'x')
  return cwd
}

describe('glob tool', () => {
  const registry = new ToolRegistry()

  it('supports ** across directories and skips node_modules', async () => {
    const cwd = await makeGlobTree()
    const res = await registry.execute('glob', { pattern: '**/*.ts' }, ctx(cwd))
    expect(res.output.split('\n').sort()).toEqual(
      ['a.ts', 'ax.ts', 'b.ts', 'new.ts', 'old.ts', 'src/deep/leaf.ts', 'src/main.ts'].sort(),
    )
  })

  it('matches * and ? within one segment', async () => {
    const cwd = await makeGlobTree()
    const top = await registry.execute('glob', { pattern: '*' }, ctx(cwd))
    expect(top.output.split('\n').sort()).toEqual(['a.ts', 'ax.ts', 'b.ts', 'new.ts', 'old.ts'])

    const q = await registry.execute('glob', { pattern: 'a?.ts' }, ctx(cwd))
    expect(q.output.split('\n')).toEqual(['ax.ts'])
  })

  it('expands {a,b} alternations', async () => {
    const cwd = await makeGlobTree()
    const res = await registry.execute('glob', { pattern: '{a,b}.ts' }, ctx(cwd))
    expect(res.output.split('\n').sort()).toEqual(['a.ts', 'b.ts'])
  })

  it('matches directory-scoped patterns', async () => {
    const cwd = await makeGlobTree()
    const docs = await registry.execute('glob', { pattern: 'docs/*.md' }, ctx(cwd))
    expect(docs.output.split('\n')).toEqual(['docs/readme.md'])

    const allSrc = await registry.execute('glob', { pattern: 'src/**/*.ts' }, ctx(cwd))
    expect(allSrc.output.split('\n').sort()).toEqual(['src/main.ts', 'src/deep/leaf.ts'].sort())

    // '*' stays within one segment: from the src root only direct children hit
    const direct = await registry.execute('glob', { pattern: '*', path: 'src' }, ctx(cwd))
    expect(direct.output.split('\n')).toEqual(['src/main.ts'])
  })

  it('sorts by mtime, newest first, and honors head_limit', async () => {
    const cwd = await makeGlobTree()
    const at = (secs: number) => new Date(secs * 1_000)
    await utimes(join(cwd, 'new.ts'), at(3_000), at(3_000))
    await utimes(join(cwd, 'a.ts'), at(2_000), at(2_000))
    await utimes(join(cwd, 'old.ts'), at(1_000), at(1_000))

    const sorted = await registry.execute('glob', { pattern: '{new,old,a}.ts' }, ctx(cwd))
    expect(sorted.output.split('\n')).toEqual(['new.ts', 'a.ts', 'old.ts'])

    const limited = await registry.execute(
      'glob',
      { pattern: '**/*.ts', head_limit: 2 },
      ctx(cwd),
    )
    expect(limited.output.split('\n')).toHaveLength(2)
  })

  it('returns no matches for unmatched patterns and errors on missing roots', async () => {
    const cwd = await makeGlobTree()
    expect((await registry.execute('glob', { pattern: 'zz*' }, ctx(cwd))).output).toBe(
      'no matches',
    )
    await expect(
      registry.execute('glob', { pattern: '*', path: 'missing' }, ctx(cwd)),
    ).rejects.toThrow(/cannot search/)
  })

  it('accepts roots inside skillDirs', async () => {
    const cwd = await makeGlobTree()
    const skillDir = await mkdtemp(join(tmpdir(), 'lume-skill-'))
    await writeFile(join(skillDir, 'guide.md'), 'guide')
    const res = await registry.execute(
      'glob',
      { pattern: '*.md', path: skillDir },
      ctx(cwd, [skillDir]),
    )
    expect(res.output).toContain('guide.md')
  })
})

describe('grep/glob registration', () => {
  it('registers both tools with read risk', () => {
    const tools = new Map(defaultTools().map((t) => [t.name, t]))
    expect(tools.get('grep')).toBe(grepTool)
    expect(tools.get('glob')).toBe(globTool)
    expect(grepTool.risk).toBe('read')
    expect(globTool.risk).toBe('read')
  })
})
