import type { ToolSchema } from '../providers/types.js'
import { bashTool } from './bash.js'
import { editFileTool } from './edit.js'
import { globTool } from './glob.js'
import { grepTool } from './grep.js'
import { readFileTool } from './read.js'
import { type ToolContext, type ToolDefinition, ToolError, type ToolResult } from './types.js'
import { writeFileTool } from './write.js'

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>()

  constructor(tools: ToolDefinition[] = defaultTools()) {
    for (const tool of tools) {
      if (this.tools.has(tool.name)) throw new Error(`duplicate tool: ${tool.name}`)
      this.tools.set(tool.name, tool)
    }
  }

  has(name: string): boolean {
    return this.tools.has(name)
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name)
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()]
  }

  /** JSON Schemas for the LLM tool definitions. */
  getSchemas(): ToolSchema[] {
    return this.list().map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }))
  }

  /** Validate and execute a tool call. Throws ToolError on any failure. */
  async execute(name: string, rawArgs: unknown, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name)
    if (tool === undefined) {
      throw new ToolError(`unknown tool: ${name}`)
    }

    let args: Record<string, unknown>
    if (typeof rawArgs === 'string') {
      try {
        args = JSON.parse(rawArgs) as Record<string, unknown>
      } catch {
        throw new ToolError(`tool arguments are not valid JSON: ${rawArgs.slice(0, 200)}`)
      }
    } else if (rawArgs !== null && typeof rawArgs === 'object') {
      args = rawArgs as Record<string, unknown>
    } else {
      throw new ToolError('tool arguments must be a JSON object')
    }

    const parsed = tool.argsSchema.safeParse(args)
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
      throw new ToolError(`invalid arguments: ${issues}`)
    }

    const timeoutMs = tool.timeoutMs
    return await withTimeout(
      tool.execute(parsed.data as Record<string, unknown>, ctx),
      timeoutMs,
      name,
    )
  }
}

function withTimeout(
  p: Promise<ToolResult>,
  timeoutMs: number,
  toolName: string,
): Promise<ToolResult> {
  return new Promise<ToolResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new ToolError(`tool ${toolName} timed out after ${timeoutMs}ms`, { timeout: true }))
    }, timeoutMs)
    p.then(
      (result) => {
        clearTimeout(timer)
        resolve(result)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

export function defaultTools(): ToolDefinition[] {
  return [bashTool, readFileTool, writeFileTool, editFileTool, grepTool, globTool]
}
