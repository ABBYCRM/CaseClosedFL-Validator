import { readFile,readdir } from "node:fs/promises";
import path from "node:path";
import { q,pool } from "../src/db/index.js";
import { upsertChunk } from "../src/rag/store.js";

async function ensureSource(row:{
  sourceId:string;
  jurisdiction?:string;
  caseTypes?:string[];
  dimension:string;
  authority:string;
  authorityLevel:string;
  url:string;
  access?:string;
  identifiers?:string[];
  notes?:string;
  metadata?:unknown;
}){
  const u=new URL(row.url);
  await q(`INSERT INTO knowledge_sources(source_id,jurisdiction,case_types,dimension,authority,authority_level,url,domain,access_mode,identifiers,notes,metadata)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    ON CONFLICT(source_id) DO UPDATE SET url=excluded.url,authority=excluded.authority,authority_level=excluded.authority_level,access_mode=excluded.access_mode,identifiers=excluded.identifiers,notes=excluded.notes,metadata=excluded.metadata`,
    [row.sourceId,row.jurisdiction??null,row.caseTypes??[],row.dimension,row.authority,row.authorityLevel,row.url,u.hostname,row.access??"PUBLIC",row.identifiers??[],row.notes??null,row.metadata??{}]);
}

for(const stateFile of await readdir("knowledge/jurisdictions")){
  const raw=await readFile(path.join("knowledge/jurisdictions",stateFile),"utf8"); const pack=JSON.parse(raw);
  for(const s of pack.sources){
    await ensureSource({sourceId:s.id,jurisdiction:pack.state,caseTypes:s.caseTypes,dimension:s.dimension,authority:s.authority,authorityLevel:s.authorityLevel,url:s.url,access:s.access,identifiers:s.identifiers,notes:s.notes,metadata:{timing:pack.timing??{}}});
    for(const ct of s.caseTypes) await upsertChunk({sourceId:s.id,jurisdiction:pack.state,caseType:ct,dimension:s.dimension,url:s.url,authorityLevel:s.authorityLevel,content:JSON.stringify({source:s,timing:pack.timing??{},rules:pack.rules??{}}),metadata:{source:s}},true);
  }
}
for(const file of await readdir("knowledge/case-types")){
  const raw=await readFile(path.join("knowledge/case-types",file),"utf8"); const skill=JSON.parse(raw);
  const sourceId=`CASE_${skill.caseType}`;
  await ensureSource({sourceId,caseTypes:[skill.caseType],dimension:"POLICY",authority:"CaseClosedFL",authorityLevel:"FIRST_PARTY",url:"https://caseclosedfl.com/",metadata:{skill}});
  await upsertChunk({sourceId,caseType:skill.caseType,dimension:"POLICY",url:"https://caseclosedfl.com/",authorityLevel:"FIRST_PARTY",content:raw,metadata:{skill}},true);
}
try {
  const intake=await readFile("knowledge/caseclosedfl/intake.json","utf8");
  await ensureSource({sourceId:"CASECLOSEDFL_INTAKE",dimension:"POLICY",authority:"CaseClosedFL",authorityLevel:"FIRST_PARTY",url:"https://caseclosedfl.com/",metadata:{type:"intake_contract"}});
  await upsertChunk({sourceId:"CASECLOSEDFL_INTAKE",dimension:"POLICY",url:"https://caseclosedfl.com/",authorityLevel:"FIRST_PARTY",content:intake,metadata:{type:"intake_contract"}},true);
} catch {}
try {
  for(const file of await readdir("skills")){
    if(!file.endsWith(".md"))continue;
    const content=await readFile(path.join("skills",file),"utf8");
    const sourceId=`SKILL_${file}`;
    await ensureSource({sourceId,dimension:"POLICY",authority:"CaseClosedFL",authorityLevel:"FIRST_PARTY",url:"https://caseclosedfl.com/",metadata:{type:"runtime_skill",file}});
    await upsertChunk({sourceId,dimension:"POLICY",url:"https://caseclosedfl.com/",authorityLevel:"FIRST_PARTY",content,metadata:{type:"runtime_skill",file}},true);
  }
} catch {}
await pool.end(); console.log("knowledge registry, intake contract, runtime skills and RAG chunks ingested");
