import { homedir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { expandHomePath, loadConfig } from '../src/config/config.js'

/** minimal env satisfying the pre-existing required fields */
const baseEnv: NodeJS.ProcessEnv = {
  LUME_API_BASE_URL: 'http://localhost:9999/v1',
  LUME_MODEL: 'test-model',
  LUME_CWD: '/tmp',
}

describe('expandHomePath', () => {
  it('expands a bare ~ and ~/-prefixed paths to the home directory', () => {
    expect(expandHomePath('~')).toBe(homedir())
    expect(expandHomePath('~/.lume/lume.db')).toBe(path.join(homedir(), '.lume', 'lume.db'))
  })

  it('leaves absolute, relative, and non-user tilde paths untouched', () => {
    expect(expandHomePath('/abs/path/db.sqlite')).toBe('/abs/path/db.sqlite')
    expect(expandHomePath('relative/db.sqlite')).toBe('relative/db.sqlite')
    expect(expandHomePath('~otheruser/x')).toBe('~otheruser/x')
    expect(expandHomePath('')).toBe('')
  })
})

describe('loadConfig memory settings', () => {
  it('defaults dbPath to ~/.lume/lume.db with ~ expanded', () => {
    const config = loadConfig({ ...baseEnv })
    expect(config.dbPath).toBe(path.join(homedir(), '.lume', 'lume.db'))
  })

  it('expands ~ in the LUME_DB_PATH env value', () => {
    const config = loadConfig({ ...baseEnv, LUME_DB_PATH: '~/custom/lume.db' })
    expect(config.dbPath).toBe(path.join(homedir(), 'custom', 'lume.db'))
  })

  it('keeps an absolute LUME_DB_PATH as-is', () => {
    const config = loadConfig({ ...baseEnv, LUME_DB_PATH: '/tmp/alt.db' })
    expect(config.dbPath).toBe('/tmp/alt.db')
  })

  it('defaults contextK/summarizeThreshold to 30/20 and coerces env strings', () => {
    const defaults = loadConfig({ ...baseEnv })
    expect(defaults.contextK).toBe(30)
    expect(defaults.summarizeThreshold).toBe(20)

    const overridden = loadConfig({
      ...baseEnv,
      LUME_CONTEXT_K: '7',
      LUME_SUMMARIZE_THRESHOLD: '3',
    })
    expect(overridden.contextK).toBe(7)
    expect(overridden.summarizeThreshold).toBe(3)
  })

  it('embedModel is undefined when unset, set when provided', () => {
    expect(loadConfig({ ...baseEnv }).embedModel).toBeUndefined()
    expect(loadConfig({ ...baseEnv, LUME_EMBED_MODEL: 'bge-m3' }).embedModel).toBe('bge-m3')
    // empty string counts as unset (Layer 3 disabled)
    expect(loadConfig({ ...baseEnv, LUME_EMBED_MODEL: '' }).embedModel).toBeUndefined()
  })
})
