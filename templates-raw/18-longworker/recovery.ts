/**
 * ============================================================
 * recovery.ts — 崩溃恢复：启动扫描、消息校验、重新入队
 * ============================================================
 *
 * 场景：worker 进程死掉（OOM / 节点故障 / kill -9），内存里的
 * AgentRun、挂起的 Promise、Pending 的审批全部消失。
 * 但真相源在 DB：runs 状态机 + append-only messages + lease。
 *
 * 恢复流程（进程启动时执行一次）：
 *   1. findOrphanedRuns：lease 过期但状态仍是 RUNNING / WAITING_* 的 run
 *      （lease 心跳由 run.ts 维护；TTL 内不动的 run = worker 已死）
 *   2. validateAndPatch：校验消息序列，修补悬空 tool call
 *      （工具"已执行但结果未落库"的窗口期遗留物）
 *   3. 按状态分发：
 *      WAITING_APPROVAL → 保持原状（审批端卡片仍有效，等回调即可）
 *      WAITING_USER     → 保持原状（等用户说"继续"）
 *      RUNNING          → 修补后踢回 QUEUED，scheduler 重新调度，
 *                         从最后 checkpoint 的 messages 重放
 *
 * 为什么重放是安全的：
 *   - 已完成工具的 result 都在 messages 里 → 模型不重发这些 call
 *     （即使重发，idempotency 表也会拦截，见 tools.ts）
 *   - 半途而废的工具命中 IN_FLIGHT → 返回 SIDE_EFFECT_STATE_UNKNOWN
 *     → 模型走查询/人工路径，不会盲目二次副作用
 */

import type { RunRecord } from './types.js';
import type { RunStore } from './store.js';
import { findDanglingToolCalls, toolResultMessage } from './run.js';

export interface RecoveryReport {
  scanned: number;
  requeued: RunRecord[];
  keptWaiting: RunRecord[];
  patched: number; // 补了多少条悬空 tool result
}

export async function recoverOnBoot(store: RunStore): Promise<RecoveryReport> {
  const orphans = await store.findOrphanedRuns(Date.now());
  const report: RecoveryReport = { scanned: orphans.length, requeued: [], keptWaiting: [], patched: 0 };

  for (const rec of orphans) {
    // --- 修补协议：给崩溃窗口期的悬空 call 补结果 ---
    const messages = await store.loadMessages(rec.sessionId);
    const dangling = findDanglingToolCalls(messages);
    for (const callId of dangling) {
      // 语义：中断恢复的标记。模型看到后知道该动作没有可信结果
      await store.appendMessages(rec.runId, [toolResultMessage(callId, { ok: false, error: 'INTERRUPTED_BY_CRASH' })]);
      report.patched++;
    }

    // --- 按状态分发 ---
    if (rec.status === 'RUNNING') {
      // 踢回 QUEUED：scheduler 会 acquireLease 后从断点重放
      const ok = await store.transitionRun(rec.runId, 'RUNNING', 'QUEUED');
      if (ok) report.requeued.push(rec);
    } else {
      // WAITING_APPROVAL / WAITING_USER：外因恢复（审批回调 / 用户"继续"），
      // 什么都不用做，但 lease 要清掉，否则 resume 抢不到
      rec.lease = null;
      await store.saveRun(rec);
      report.keptWaiting.push(rec);
    }
  }

  return report;
}

/**
 * 全量消息校验（可用于运维巡检 / 恢复前的防御性检查）：
 * 除了悬空 tool call，还检查 tool result 是否有对应的 call 声明
 * （孤儿 result 通常意味着消息存储层出了问题）。
 */
export function validateMessages(messages: unknown[]): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  const declared = new Set<string>();
  const answered = new Set<string>();

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i] as { role: string; tool_calls?: { id: string }[]; tool_call_id?: string };
    if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
      for (const c of m.tool_calls) declared.add(c.id);
    }
    if (m.role === 'tool') {
      if (!m.tool_call_id) issues.push(`messages[${i}]: tool 消息缺 tool_call_id`);
      else {
        answered.add(m.tool_call_id);
        if (!declared.has(m.tool_call_id)) issues.push(`messages[${i}]: 孤儿 tool result（无对应 call）`);
      }
    }
  }

  for (const id of declared) if (!answered.has(id)) issues.push(`悬空 tool call（无配对 result）: ${id}`);
  return { valid: issues.length === 0, issues };
}
