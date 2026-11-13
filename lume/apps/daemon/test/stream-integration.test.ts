import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { DaemonProc } from './helpers/daemon-proc.js'

/**
 * Integration smoke test: spawns the REAL daemon binary in stream mode with
 * the scripted fake provider and drives a full conversation over stdio,
 * including the permission suspension round-trip.
 */

const procs: DaemonProc[] = []
afterAll(() => {
  for (const p of procs) p.kill()
})

describe('stream mode integration (fake provider)', () => {
  it('drives a full conversation with a permission round-trip', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'lume-smoke-'))
    const proc = new DaemonProc({
      LUME_PROVIDER: 'fake',
      LUME_MODEL: 'fake-model',
      LUME_API_BASE_URL: 'http://localhost:1/v1',
      LUME_CWD: cwd,
      LUME_DB_PATH: join(cwd, 'lume.db'),
    })
    procs.push(proc)

    const ready = await proc.waitFor((e) => e.type === 'ready')
    expect(ready).toMatchObject({ type: 'ready', protocol_version: 1 })

    proc.send({ type: 'user_message', content: 'list the directory' })

    const permission = await proc.waitFor((e) => e.type === 'permission_request')
    expect(permission).toMatchObject({ type: 'permission_request', tool: 'bash' })

    proc.send({
      type: 'permission_response',
      id: (permission as { id: string }).id,
      approve: true,
    })

    const toolCompleted = await proc.waitFor((e) => e.type === 'tool_completed')
    expect(toolCompleted.type).toBe('tool_completed')

    const verification = await proc.waitFor((e) => e.type === 'verification_completed')
    expect(verification).toMatchObject({ type: 'verification_completed', passed: true })

    const turnCompleted = await proc.waitFor((e) => e.type === 'turn_completed')
    expect(turnCompleted).toMatchObject({
      type: 'turn_completed',
      final_text: expect.stringContaining('listed'),
    })

    const code = await proc.exit()
    expect(code).toBe(0)
  }, 30000)

  it('exits cleanly on shutdown message and reports malformed inbound lines', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'lume-smoke-'))
    const proc = new DaemonProc({
      LUME_PROVIDER: 'fake',
      LUME_MODEL: 'fake-model',
      LUME_API_BASE_URL: 'http://localhost:1/v1',
      LUME_CWD: cwd,
      LUME_DB_PATH: join(cwd, 'lume.db'),
    })
    procs.push(proc)

    await proc.waitFor((e) => e.type === 'ready')

    proc.writeRaw('this is not json')
    const protoError = await proc.waitFor((e) => e.type === 'error')
    expect(protoError).toMatchObject({ type: 'error', error: { code: 'protocol_error' } })

    proc.send({ type: 'shutdown' })
    const code = await proc.waitExit()
    expect(code).toBe(0)
  }, 30000)
})
