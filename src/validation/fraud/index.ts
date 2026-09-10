import type {Lead} from "../schema.js";
import {runParallelFraudEngines} from "./engines.js";
import type {ParallelFraudResult} from "./types.js";

export async function evaluateFraudRisk(lead:Lead):Promise<ParallelFraudResult>{
  return runParallelFraudEngines(lead);
}

export function fraudRequiresManualReview(result:ParallelFraudResult){
  return result.aggregate.verdict==="HIGH_RISK"||result.aggregate.verdict==="MANUAL_REVIEW";
}

export function fraudDimensions(result:ParallelFraudResult){
  return {
    fraud_overall:result.aggregate.verdict,
    fraud_risk_score:result.aggregate.risk_score,
    fraud_assurance_level:result.aggregate.assurance_level,
    fraud_parallel_engines:Object.fromEntries(result.verdicts.map(v=>[v.engine,{verdict:v.verdict,risk_score:v.risk_score,assurance_level:v.assurance_level,summary:v.summary}])),
    fraud_findings:result.verdicts.flatMap(v=>v.findings)
  };
}
