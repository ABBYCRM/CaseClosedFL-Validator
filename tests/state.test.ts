import {describe,it,expect} from "vitest";
import {initialState} from "../src/agent/state.js";
import {beginExecutionCycle,finishExecutionCycle} from "../src/agent/control.js";
describe("self state",()=>{it("tracks the directive's execution state and budgets",()=>{const s=initialState();beginExecutionCycle(s,"SEARCH","find evidence");finishExecutionCycle(s,"SEARCH:TAVILY","result observed",true);expect(s.activeGoal).toBe("VALIDATE_CASECLOSED_LEAD");expect(s.resourceUsage.cycles).toBe(1);expect(s.expectedOutcome).toBe("find evidence");expect(s.observedOutcome).toBe("result observed");expect(s.remainingBudget.cycles).toBeGreaterThanOrEqual(0);});});
