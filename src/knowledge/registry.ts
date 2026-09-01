import fs from "node:fs";import path from "node:path";import type { JurisdictionPack,CaseSkill,SourceDefinition,Dimension } from "./types.js";import type { CaseType,StateCode } from "../validation/schema.js";
function readJson<T>(p:string):T|null{if(!fs.existsSync(p))return null;return JSON.parse(fs.readFileSync(p,"utf8")) as T;}
export function loadJurisdiction(state:StateCode){return readJson<JurisdictionPack>(path.resolve(`knowledge/jurisdictions/${state}.json`));}
export function loadCaseType(caseType:CaseType){return readJson<CaseSkill>(path.resolve(`knowledge/case-types/${caseType}.json`));}
export function sourcesFor(state:StateCode,caseType:CaseType,dimension:Dimension):SourceDefinition[]{return loadJurisdiction(state)?.sources.filter(s=>s.dimension===dimension&&s.caseTypes.includes(caseType))??[];}
export function assertConfiguredUrl(source:SourceDefinition){const u=new URL(source.url);if(!/^https:$/.test(u.protocol))throw new Error(`INVALID_SOURCE_URL:${source.id}`);return u;}
