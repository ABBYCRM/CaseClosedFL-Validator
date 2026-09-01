import { env } from "../config/env.js";
import type { SelfState } from "./state.js";
import { syncBudget } from "./state.js";

export function beginExecutionCycle(state:SelfState,intendedAction:string,expectedOutcome:string){
  if(state.cycle>=env.MAX_CYCLES)throw new Error("CYCLE_BUDGET_EXHAUSTED");
  if(state.toolCalls>=env.MAX_TOOL_CALLS)throw new Error("TOOL_BUDGET_EXHAUSTED");
  state.cycle++;state.intendedAction=intendedAction;state.actualAction=null;state.expectedOutcome=expectedOutcome;state.observedOutcome=null;syncBudget(state);
}
export function finishExecutionCycle(state:SelfState,actualAction:string,observedOutcome:string,progressed:boolean){
  state.actualAction=actualAction;state.observedOutcome=observedOutcome;
  if(progressed){state.noProgressCycles=0;state.health="HEALTHY";state.issue="NONE";}
  else{state.noProgressCycles++;state.health=state.noProgressCycles>=2?"LOOP_DETECTED":"DEGRADED";state.issue=state.noProgressCycles>=2?"STRATEGY_FAILURE":"TOOL_FAILURE";}
  syncBudget(state);
}
export function classifyBlocker(state:SelfState,message:string){
  state.blockers.push(message);state.health="BLOCKED";
  if(/AUTHORIZATION|MISSING|UNKNOWN/i.test(message))state.issue="INFORMATION_GAP";
  else if(/TOOL|COMPOSIO|STEEL|HTTP|TIMEOUT/i.test(message))state.issue="TOOL_FAILURE";
  else state.issue="EXECUTION_FAILURE";
}
