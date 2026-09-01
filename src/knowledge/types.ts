import type { CaseType,StateCode } from "../validation/schema.js";
export type Dimension="INCIDENT_EXISTENCE"|"FAULT_EVIDENCE"|"BUSINESS_EXISTENCE"|"PROVIDER_LICENSE"|"LITIGATION"|"CARRIER";
export interface SourceDefinition{id:string;state:StateCode;caseTypes:CaseType[];dimension:Dimension;authority:string;authorityLevel:"PRIMARY_GOVERNMENT"|"SECONDARY_GOVERNMENT"|"FEDERAL_GOVERNMENT";url:string;access:"PUBLIC"|"AUTHORIZED"|"MIXED";identifiers:string[];notes?:string;}
export interface JurisdictionPack{state:StateCode;sources:SourceDefinition[];timing?:Record<string,number>;rules?:Record<string,unknown>;}
export interface CaseSkill{caseType:CaseType;dimensions:Dimension[];requiredAny:string[];notes:string[];}
