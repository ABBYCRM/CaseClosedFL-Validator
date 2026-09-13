import type {OsintLookupReport} from "../../integrations/osint/types.js";
import type {FraudFinding} from "./types.js";

function finding(kind:string,observation:string,extra:Partial<FraudFinding>={}):FraudFinding{
  return{
    finding_id:`IDENTITY-OSINT-${kind}-${Math.random().toString(36).slice(2,8)}`,
    engine:"IDENTITY",
    finding_type:kind,
    result:"UNKNOWN",
    severity:"LOW",
    confidence:"LOW",
    observation,
    possible_benign_explanation:"Public registrations, phone metadata, or local breach-file hits have many benign explanations and are not identity proof.",
    recommended_followup:"Review observed OSINT detail in the HubSpot validation NOTE. Do not contact the claimant from the validator.",
    ...extra
  };
}

export function identityOsintCheckBuckets(osint?:OsintLookupReport){
  const performed:string[]=[];
  const unavailable:string[]=[];
  const notPerformed:string[]=[];
  if(!osint||!osint.enabled){
    notPerformed.push("IDENTITY_OSINT_LOOKUP");
    return {performed,unavailable,notPerformed};
  }
  performed.push("IDENTITY_OSINT_LOOKUP");
  for(const adapter of osint.adapters){
    if(adapter.status==="OBSERVED") performed.push(...adapter.checks_performed);
    else if(adapter.status==="UNAVAILABLE"||adapter.status==="SKIPPED"){
      unavailable.push(`${adapter.provider.toUpperCase()}_${adapter.unavailable_reason??adapter.status}`);
    }else if(adapter.status==="ERROR"){
      unavailable.push(`${adapter.provider.toUpperCase()}_ERROR`);
    }
  }
  return {performed,unavailable,notPerformed};
}

export function identityOsintFindings(osint?:OsintLookupReport):FraudFinding[]{
  if(!osint||!osint.enabled||!osint.ran) return [];
  const findings:FraudFinding[]=[];
  for(const adapter of osint.adapters){
    if(adapter.status!=="OBSERVED") continue;
    if(!adapter.findings.length){
      findings.push(finding(
        `OSINT_${adapter.provider.toUpperCase()}_NO_STRUCTURED_HITS`,
        `${adapter.provider} ran and produced no structured findings. That is UNKNOWN, not a fraud signal.`
      ));
      continue;
    }
    for(const item of adapter.findings){
      findings.push(finding(
        `OSINT_${adapter.provider.toUpperCase()}_${item.kind}`,
        item.observation,
        {reference_source:adapter.provider,evidence:{site:item.site,signal:item.signal}}
      ));
    }
  }
  return findings;
}
