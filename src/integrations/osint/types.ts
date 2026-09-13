export const OSINT_PROVIDERS=["holehe","phoneinfoga","mosint","h8mail"] as const;
export type OsintProvider=typeof OSINT_PROVIDERS[number];

export type OsintAdapterStatus="OBSERVED"|"UNAVAILABLE"|"ERROR"|"SKIPPED"|"DISABLED";
export type OsintTargetType="email"|"phone";

export interface OsintFinding{
  kind:string;
  observation:string;
  site?:string;
  signal?:string;
}

export interface OsintAdapterResult{
  provider:OsintProvider;
  capability:"EMAIL_REGISTRATION"|"PHONE_LOOKUP"|"EMAIL_RECON"|"LOCAL_BREACH";
  status:OsintAdapterStatus;
  target_type:OsintTargetType;
  target_redacted?:string;
  findings:OsintFinding[];
  errors:string[];
  unavailable_reason?:string;
  checks_performed:string[];
}

export interface OsintLookupReport{
  capability:"IDENTITY_OSINT_LOOKUP";
  enabled:boolean;
  ran:boolean;
  email_redacted?:string;
  phone_redacted?:string;
  adapters:OsintAdapterResult[];
  risk_flags:string[];
  unavailable:string[];
  errors:string[];
  contract:{
    evidence_only:true;
    unknown_is_not_fraud:true;
    no_claimant_contact:true;
    paid_apis_out_of_scope:true;
  };
}

export const OSINT_CONTRACT={
  evidence_only:true as const,
  unknown_is_not_fraud:true as const,
  no_claimant_contact:true as const,
  paid_apis_out_of_scope:true as const
};

export function emptyOsintReport(partial:Partial<OsintLookupReport>={}):OsintLookupReport{
  return{
    capability:"IDENTITY_OSINT_LOOKUP",
    enabled:false,
    ran:false,
    adapters:[],
    risk_flags:[],
    unavailable:[],
    errors:[],
    contract:OSINT_CONTRACT,
    ...partial
  };
}
