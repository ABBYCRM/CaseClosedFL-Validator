import type { EpistemicState } from "../agent/state.js";
export type SourceType="GOVERNMENT"|"CLIENT_DOCUMENT"|"LICENSE_REGISTRY"|"COURT"|"BUSINESS_REGISTRY"|"SEARCH_DISCOVERY"|"OTHER";
export interface EvidenceInput{claim:string;epistemicState:EpistemicState;sourceId?:string;sourceUrl?:string;sourceType:SourceType;toolExecutionId?:string;payload?:Record<string,unknown>;contentHash?:string;}
