import { env } from "../config/env.js";
export type EpistemicState = "KNOWN" | "INFERRED" | "ASSUMED" | "UNKNOWN" | "CONTRADICTED";
export type AgentStep =
  | "RECEIVED" | "NORMALIZED" | "CLASSIFIED" | "REQUIREMENTS_CHECKED"
  | "SOURCES_SELECTED" | "INCIDENT_VALIDATION" | "IDENTITY_CORRELATION"
  | "FAULT_EVIDENCE" | "CASE_CHECKS" | "CONTRADICTION_CHECK"
  | "QUALIFICATION_ENGINE" | "COMPLETE";
export type Health = "HEALTHY" | "DEGRADED" | "LOOP_DETECTED" | "BLOCKED" | "UNSTABLE";
export type Issue = "INFORMATION_GAP" | "ASSUMPTION_FAILURE" | "REASONING_FAILURE" | "PLANNING_FAILURE" | "TOOL_FAILURE" | "EXECUTION_FAILURE" | "STRATEGY_FAILURE" | "NONE";

export interface Fact { key:string; value:unknown; state:EpistemicState; evidenceIds?:string[]; }
export interface ActionRecord { fingerprint:string; action:string; status:"SUCCESS"|"FAILURE"; at:string; }
export interface Budget { cycles:number; modelCalls:number; toolCalls:number; }
export interface ResourceUsage { cycles:number; modelCalls:number; toolCalls:number; }
export interface SelfState {
  activeGoal:"VALIDATE_CASECLOSED_LEAD"; currentPlan:AgentStep[]; currentStep:AgentStep; completedSteps:AgentStep[]; pendingSteps:AgentStep[];
  workingMemory:Record<string,unknown>; relevantLongTermMemory:string[]; assumptions:Fact[]; knownFacts:Fact[]; unknowns:string[]; uncertainties:string[];
  currentStrategy:string; alternativeStrategies:string[]; availableTools:string[]; toolStatus:Record<string,string>; previousToolResults:string[]; errors:string[]; warnings:string[]; blockers:string[];
  resourceUsage:ResourceUsage; remainingBudget:Budget; cycle:number; modelCalls:number; toolCalls:number; failedActions:string[]; actionHistory:ActionRecord[]; noProgressCycles:number;
  progress:number; confidence:number; expectedOutcome:string|null; observedOutcome:string|null; intendedAction:string|null; actualAction:string|null; health:Health; issue:Issue;
}
const PLAN:AgentStep[]=["RECEIVED","NORMALIZED","CLASSIFIED","REQUIREMENTS_CHECKED","SOURCES_SELECTED","INCIDENT_VALIDATION","IDENTITY_CORRELATION","FAULT_EVIDENCE","CASE_CHECKS","CONTRADICTION_CHECK","QUALIFICATION_ENGINE","COMPLETE"];
export function initialState():SelfState{return {activeGoal:"VALIDATE_CASECLOSED_LEAD",currentPlan:[...PLAN],currentStep:"RECEIVED",completedSteps:[],pendingSteps:PLAN.slice(1),workingMemory:{},relevantLongTermMemory:["CASECLOSEDFL_INTAKE","JURISDICTION_PACK","CASE_TYPE_SKILL","TOOL_POLICY"],assumptions:[],knownFacts:[],unknowns:[],uncertainties:[],currentStrategy:"DETERMINISTIC_PRIMARY_SOURCE_FIRST",alternativeStrategies:["GOVERNMENT_DOMAIN_DISCOVERY","ALTERNATIVE_READ_ONLY_TOOL","AUTHORIZED_BROWSER","REQUEST_ADDITIONAL_EVIDENCE"],availableTools:[],toolStatus:{},previousToolResults:[],errors:[],warnings:[],blockers:[],resourceUsage:{cycles:0,modelCalls:0,toolCalls:0},remainingBudget:{cycles:env.MAX_CYCLES,modelCalls:env.MAX_MODEL_CALLS,toolCalls:env.MAX_TOOL_CALLS},cycle:0,modelCalls:0,toolCalls:0,failedActions:[],actionHistory:[],noProgressCycles:0,progress:0,confidence:0,expectedOutcome:null,observedOutcome:null,intendedAction:null,actualAction:null,health:"HEALTHY",issue:"NONE"};}
export function advance(state:SelfState,step:AgentStep){if(!state.completedSteps.includes(state.currentStep))state.completedSteps.push(state.currentStep);state.currentStep=step;state.pendingSteps=state.currentPlan.filter(s=>!state.completedSteps.includes(s)&&s!==step);state.progress=Math.min(1,state.completedSteps.length/(state.currentPlan.length-1));}
export function syncBudget(state:SelfState){state.resourceUsage={cycles:state.cycle,modelCalls:state.modelCalls,toolCalls:state.toolCalls};state.remainingBudget={cycles:Math.max(0,env.MAX_CYCLES-state.cycle),modelCalls:Math.max(0,env.MAX_MODEL_CALLS-state.modelCalls),toolCalls:Math.max(0,env.MAX_TOOL_CALLS-state.toolCalls)};}
