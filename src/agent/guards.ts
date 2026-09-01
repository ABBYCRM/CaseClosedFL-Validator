import crypto from "node:crypto";
import { env } from "../config/env.js";
import type { SelfState } from "./state.js";

export const actionFingerprint = (tool:string, action:string, args:unknown) =>
  crypto.createHash("sha256").update(JSON.stringify({tool,action,args})).digest("hex");

export function assertBudgets(s:SelfState) {
  if (s.cycle >= env.MAX_CYCLES) throw new Error("CYCLE_BUDGET_EXHAUSTED");
  if (s.toolCalls >= env.MAX_TOOL_CALLS) throw new Error("TOOL_BUDGET_EXHAUSTED");
  if (s.modelCalls >= env.MAX_MODEL_CALLS) throw new Error("MODEL_BUDGET_EXHAUSTED");
}

export function mayExecute(s:SelfState, fp:string) {
  const failures = s.failedActions.filter(x => x === fp).length;
  return failures < env.MAX_IDENTICAL_FAILURES;
}

export function observeProgress(s:SelfState, before:number, after:number) {
  if (after > before) { s.noProgressCycles = 0; s.health = "HEALTHY"; return; }
  s.noProgressCycles += 1;
  if (s.noProgressCycles >= 2) { s.health = "LOOP_DETECTED"; s.issue = "STRATEGY_FAILURE"; }
  else s.health = "DEGRADED";
}
