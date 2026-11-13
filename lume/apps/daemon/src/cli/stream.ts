import readline from 'node:readline'
import {
  type OutboundEvent,
  OutboundEventSchema,
  PROTOCOL_VERSION,
  parseInboundMessage,
} from '@lume/protocol'
import type { Agent } from '../core/agent.js'
import type { Frontend } from '../core/frontend.js'
import { PermissionManager } from '../core/permission.js'
import type { Logger } from '../util/logger.js'
import { LineWriter } from '../util/stdout-writer.js'

/**
 * stream-json skin: the daemon becomes a long-lived child process driven by
 * NDJSON over stdio. stdout carries protocol events; stdin accepts protocol
 * messages. Logs go to stderr only.
 *
 * `sessionId` is the persistent session id from the store (created or resumed
 * at startup); it is announced in the ready event so GUI drivers can later
 * resume the same conversation with `--session <id>`.
 */
export function runStreamMode(agent: Agent, logger: Logger, sessionId: string): Promise<void> {
  return new Promise((resolve) => {
    const writer = new LineWriter()
    const permissions = new PermissionManager()

    const emit = (event: OutboundEvent): void => {
      // validate outbound events in production: a malformed event is a bug
      const checked = OutboundEventSchema.safeParse(event)
      if (!checked.success) {
        logger.error('refusing to emit invalid event', {
          type: (event as { type?: string }).type,
          issues: checked.error.issues.map((i) => i.message).join('; '),
        })
        return
      }
      writer.writeLine(event)
    }

    const frontend: Frontend = {
      emit,
      requestPermission(req) {
        const promise = permissions.suspend(req.id)
        emit({
          type: 'permission_request',
          turn_id: req.turnId,
          id: req.id,
          call_id: req.callId,
          tool: req.tool,
          args: req.args,
          reason: req.reason,
        })
        return promise
      },
    }
    // bind the frontend to the agent's emit path
    agent.attachFrontend(frontend)

    emit({
      type: 'ready',
      protocol_version: PROTOCOL_VERSION,
      session_id: sessionId,
      model: agent.modelName,
    })

    let shuttingDown = false
    const shutdown = (reason: string) => {
      if (shuttingDown) return
      shuttingDown = true
      logger.info('shutting down', { reason })
      agent.stop()
      permissions.rejectAll()
      rl.close()
      void writer.flush().then(async () => {
        // in-flight turn work (post-turn summarization) must settle before
        // the store is closed by main()'s finally
        await agent.idle()
        writer.close()
        // stdin stays open after `shutdown` (unlike EOF); release the handle
        // so the process can exit once the event loop drains
        process.stdin.destroy()
        resolve()
      })
    }

    const rl = readline.createInterface({ input: process.stdin })
    rl.on('line', (line) => {
      let msg: ReturnType<typeof parseInboundMessage>
      try {
        msg = parseInboundMessage(line)
      } catch (err) {
        emit({
          type: 'error',
          error: {
            code: 'protocol_error',
            message: `malformed inbound message: ${err instanceof Error ? err.message : String(err)}`,
          },
          fatal: false,
        })
        return
      }
      if (msg === null) return

      switch (msg.type) {
        case 'user_message':
          agent.submit(msg.content)
          break
        case 'permission_response':
          if (!permissions.respond(msg.id, msg.approve)) {
            emit({
              type: 'error',
              error: {
                code: 'protocol_error',
                message: `unknown or stale permission id: ${msg.id}`,
              },
              fatal: false,
            })
          }
          break
        case 'interrupt':
          agent.interrupt(msg.turn_id)
          permissions.rejectAll()
          break
        case 'shutdown':
          shutdown('shutdown message')
          break
      }
    })
    rl.on('close', () => shutdown('stdin closed'))

    const onSignal = (signal: NodeJS.Signals) => shutdown(`signal ${signal}`)
    process.once('SIGTERM', onSignal)
    process.once('SIGINT', onSignal)
  })
}
