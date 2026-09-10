export type FraudVerdict="PASS"|"PASS_WITH_WARNINGS"|"MANUAL_REVIEW"|"HIGH_RISK"|"UNABLE_TO_VALIDATE";
export type FraudConfidence="LOW"|"MEDIUM"|"HIGH"|"VERY_HIGH";
export type AssuranceLevel="LEVEL_0_UNABLE_TO_ANALYZE"|"LEVEL_1_VISUAL_CONSISTENCY_ONLY"|"LEVEL_2_DIGITAL_FORENSICS_CONSISTENT"|"LEVEL_3_MACHINE_READABLE_CONSISTENCY"|"LEVEL_4_CRYPTOGRAPHIC_PROVENANCE_VERIFIED"|"LEVEL_5_AUTHORITATIVE_ISSUER_VERIFIED";
export type FraudEngineName="DOCUMENT_AUTHENTICITY"|"DOCUMENT_TAMPERING"|"IDENTITY"|"SYNTHETIC_MEDIA"|"CLAIM_CONSISTENCY"|"CROSS_DOCUMENT"|"EXTERNAL_VERIFICATION";

export interface FraudFinding{
  finding_id:string;
  engine:FraudEngineName;
  document_id?:string;
  finding_type:string;
  result:"PASS"|"WARNING"|"FAIL"|"UNKNOWN"|"NOT_APPLICABLE";
  severity:"LOW"|"MEDIUM"|"HIGH"|"CRITICAL";
  confidence:FraudConfidence;
  observation:string;
  expected?:string;
  evidence?:unknown;
  reference_source?:string;
  reference_rule?:string;
  possible_benign_explanation?:string;
  recommended_followup?:string;
}

export interface FraudEngineVerdict{
  engine:FraudEngineName;
  verdict:FraudVerdict;
  risk_score:number;
  assurance_level:AssuranceLevel;
  findings:FraudFinding[];
  checks_performed:string[];
  checks_not_performed:string[];
  checks_unavailable:string[];
  summary:string;
}

export interface ParallelFraudResult{
  mode:"PARALLEL_INDEPENDENT_ENGINES";
  engine_version:"fraud-v1";
  verdicts:FraudEngineVerdict[];
  aggregate:{
    verdict:FraudVerdict;
    risk_score:number;
    assurance_level:AssuranceLevel;
    high_risk_engines:FraudEngineName[];
    manual_review_engines:FraudEngineName[];
    summary:string;
  };
}
