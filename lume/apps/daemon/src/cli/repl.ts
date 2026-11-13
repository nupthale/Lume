import readline from 'node:readline'
import type { OutboundEvent } from '@lume/protocol'
import type { Agent } from '../core/agent.js'
import type { Frontend } from '../core/frontend.js'
import { PermissionManager } from '../core/permission.js'
import type { Logger } from '../util/logger.js'
import { style } from '../util/style.js'

/**
 * Terminal REPL skin: the same agent core, rendered for humans.
 * Permission prompts suspend the turn until y/n is entered.
 *
 * `sessionId` is shown in the banner so the user can note it down and later
 * resume the conversation with `--session <id>`.
 *
 * Commands: /exit (quit), /interrupt (abort current turn), /help.
 */
export function runReplMode(agent: Agent, logger: Logger, sessionId: string): Promise<void> {
  return new Promise((resolve) => {
    const permissions = new PermissionManager()
    /** active permission question (REPL's own suspension slot) */
    let question: { answer: (approve: boolean) => void; prompt: string } | null = null

    const write = (s: string) => process.stdout.write(s)

    // streaming-thought state: the first thought_delta opens the thought
    // line; the next non-thought output closes it. Providers that only expose
    // reasoning after completion fall back to the full `thought` event.
    let thoughtOpen = false
    let sawThoughtDelta = false
    const closeThought = () => {
      if (!thoughtOpen) return
      thoughtOpen = false
      write('\n')
    }

    const renderers: Array<(e: OutboundEvent) => void> = [
      (e) => {
        if (e.type !== 'assistant_message_started') return
        sawThoughtDelta = false
      },
      (e) => {
        if (e.type !== 'thought_delta') return
        if (!thoughtOpen) {
          thoughtOpen = true
          sawThoughtDelta = true
          write(`\n${style.dim('⏺ thought: ')}`)
        }
        write(style.dim(e.delta))
      },
      (e) => {
        if (e.type !== 'assistant_delta') return
        closeThought()
        write(e.delta)
      },
      (e) => {
        if (e.type !== 'assistant_message_completed') return
        closeThought()
        write('\n')
      },
      (e) => {
        if (e.type !== 'thought') return
        // full-snapshot event: render once only when the reasoning was not
        // already streamed via deltas (delta-streamed providers skip this)
        if (!sawThoughtDelta) {
          write(`\n${style.dim(`⏺ thought: ${e.content.trim()}`)}\n`)
        }
      },
      (e) => {
        if (e.type !== 'turn_completed') return
        write('\n')
        rl.prompt()
      },
      (e) => {
        if (e.type !== 'tool_call_requested') return
        closeThought()
        write(`${style.yellow(`⏺ ${style.bold(e.tool)}`)} ${style.dim(JSON.stringify(e.args))}\n`)
      },
      (e) => {
        if (e.type !== 'review_completed') return
        if (!e.approved) {
          write(
            `${style.red(
              `⏻ review blocked: ${e.checks
                .filter((c) => !c.passed)
                .map((c) => c.detail)
                .join('; ')}`,
            )}\n`,
          )
        }
      },
      (e) => {
        if (e.type !== 'tool_completed') return
        const preview =
          e.result.length > 400
            ? `${e.result.slice(0, 400)}\n… (${e.result.length} chars)`
            : e.result
        write(`${style.dim(`  ⎿ ${preview.trim().replace(/\n/g, '\n    ⎿ ')}`)}\n`)
      },
      (e) => {
        if (e.type !== 'tool_failed') return
        write(`${style.red(`  ⎿ ${e.error.message}`)}\n`)
      },
      (e) => {
        if (e.type !== 'verification_completed') return
        if (!e.passed) {
          write(`${style.yellow(`  ⚠ verification failed: ${e.note ?? ''}`)}\n`)
        }
      },
      (e) => {
        if (e.type !== 'turn_failed') return
        closeThought()
        write(`${style.red(`✖ turn failed (${e.error.code}): ${e.error.message}`)}\n\n`)
        rl.prompt()
      },
      (e) => {
        if (e.type !== 'user_message_queued') return
        write(`${style.dim(`… queued (position ${e.queue_length})`)}\n`)
      },
    ]

    const frontend: Frontend = {
      emit(event) {
        for (const render of renderers) render(event)
      },
      requestPermission(req) {
        return new Promise((answer) => {
          question = {
            answer,
            prompt: `allow ${style.bold(req.tool)} ${style.dim(JSON.stringify(req.args))}? [y/n] `,
          }
          write(`\n${style.yellow('permission requested')}: ${question.prompt}`)
          // NOTE: do not pause readline here - the pending y/n answer arrives
          // as the next line event and is routed to the question
        })
      },
    }
    agent.attachFrontend(frontend)

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: style.cyan('lume> '),
    })

    const commands: Record<string, () => void> = {
      '/help': () => write('commands: /exit, /interrupt, /help\n'),
      '/exit': () => finish('exit command'),
      '/interrupt': () => interruptTurn(),
    }

    rl.on('line', (line) => {
      const trimmed = line.trim()

      // routing: an open permission question takes precedence
      const q = question
      if (q !== null) {
        question = null
        const approve = /^y(es)?$/i.test(trimmed)
        q.answer(approve)
        write(approve ? style.green('  ✓ allowed\n') : style.red('  ✖ denied\n'))
        rl.prompt()
        return
      }

      if (trimmed.length === 0) {
        rl.prompt()
        return
      }
      const command = commands[trimmed]
      if (command !== undefined) {
        command()
        return
      }
      agent.submit(trimmed)
    })

    let finished = false

    /**
     * Abort the current turn and release any pending permission question.
     * The open y/n answer slot is REPL-local (the `question` variable), so
     * PermissionManager alone never resolves it — without this, an interrupt
     * during a permission wait hangs the turn forever.
     */
    function interruptTurn(): void {
      agent.interrupt()
      const q = question
      if (q !== null) {
        question = null
        q.answer(false)
        write(style.red('  ✖ denied (interrupted)\n'))
      }
      permissions.rejectAll()
    }

    function finish(reason: string): void {
      if (finished) return
      finished = true
      logger.info('repl exiting', { reason })
      agent.stop()
      const q = question
      if (q !== null) {
        question = null
        q.answer(false)
      }
      permissions.rejectAll()
      rl.close()
      // in-flight turn work (post-turn summarization) must settle before
      // the store is closed by main()'s finally
      void agent.idle().then(() => resolve())
    }

    rl.on('close', () => finish('stdin closed'))
    process.on('SIGINT', () => {
      // in a TTY, SIGINT during a busy turn acts as interrupt, not exit;
      // repeated Ctrl+C while busy keeps interrupting (never kills mid-turn,
      // which would corrupt the transcript)
      if (agent.isBusy) {
        interruptTurn()
        return
      }
      finish('SIGINT')
    })
    process.once('SIGTERM', () => finish('SIGTERM'))

    write(
      `${style.bold('lume')} ${style.dim(`model=${agent.modelName}`)}\n` +
        `${style.dim(`session ${sessionId}`)}\n` +
        `${style.dim('type /help for commands; /exit to quit')}\n`,
    )
    rl.prompt()
  })
}
