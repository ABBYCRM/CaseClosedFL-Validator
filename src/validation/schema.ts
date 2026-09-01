import { z } from "zod";
export const STATES=["FL","CA","AZ","TX","NY"] as const;
export const CASE_TYPES=["AUTO_ACCIDENT","TRUCK_ACCIDENT","MOTORCYCLE_ACCIDENT","RIDESHARE_ACCIDENT","BICYCLE_PEDESTRIAN","SLIP_FALL"] as const;
const Document=z.object({id:z.string().optional(),name:z.string().min(1),type:z.enum(["POLICE_REPORT","INCIDENT_REPORT","MEDICAL_RECORD","PHOTO","OTHER"]).default("OTHER"),url:z.string().url().optional(),text:z.string().optional(),source:z.enum(["CLIENT","GOVERNMENT","PROVIDER","OTHER"]).default("CLIENT")});
export const Lead=z.object({
  lead_id:z.string().min(1).max(200),state:z.enum(STATES),case_type:z.enum(CASE_TYPES),
  client:z.object({first_name:z.string().max(100).optional(),last_name:z.string().max(100).optional(),email:z.string().email().optional(),date_of_birth:z.string().optional()}).default({}),
  incident:z.object({date:z.string().optional(),county:z.string().max(120).optional(),city:z.string().max(120).optional(),agency:z.string().max(200).optional(),report_number:z.string().max(120).optional(),case_number:z.string().max(120).optional(),location:z.string().max(500).optional(),business_name:z.string().max(300).optional(),business_address:z.string().max(500).optional(),carrier_name:z.string().max(300).optional(),usdot_number:z.string().max(30).optional()}).default({}),
  medical:z.object({provider_name:z.string().max(300).optional(),provider_license:z.string().max(120).optional(),npi:z.string().max(30).optional()}).default({}),
  qualification:z.object({injured:z.enum(["YES","NO","UNSURE"]).optional(),medical_treatment:z.boolean().optional(),primary_fault:z.enum(["OTHER_PARTY","NOT_SURE","SHARED","CLIENT"]).optional(),client_claims_not_at_fault:z.boolean().optional(),already_represented:z.boolean().optional()}).default({}),
  documents:z.array(Document).max(20).default([]),
  authorization:z.object({external_record_access:z.boolean().default(false),record_purchase:z.boolean().default(false)}).default({external_record_access:false,record_purchase:false}),
  metadata:z.record(z.unknown()).default({})
});
export type Lead=z.infer<typeof Lead>;export type CaseType=Lead["case_type"];export type StateCode=Lead["state"];export type FinalStatus="VALIDATED"|"INCOMPLETE"|"CONTRADICTED";
export type IncompleteReason="MISSING_INFORMATION"|"RECORD_PENDING"|"SOURCE_UNAVAILABLE"|"AUTHORIZATION_REQUIRED"|"IDENTITY_NOT_CONFIRMED"|"FAULT_NOT_ESTABLISHED"|"INSUFFICIENT_EVIDENCE"|"MANUAL_REVIEW_REQUIRED"|"NOT_CORROBORATED";
