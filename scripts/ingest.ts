import { readFile,readdir } from "node:fs/promises";
import path from "node:path";
import { q,pool } from "../src/db/index.js";
import { upsertChunk } from "../src/rag/store.js";

for(const stateFile of await readdir("knowledge/jurisdictions")){
  const raw=await readFile(path.join("knowledge/jurisdictions",stateFile),"utf8"); const pack=JSON.parse(raw);
  for(const s of pack.sources){
    const u=new URL(s.url);
    await q(`INSERT INTO knowledge_sources(source_id,jurisdiction,case_types,dimension,authority,authority_level,url,domain,access_mode,identifiers,notes,metadata)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT(source_id) DO UPDATE SET url=excluded.url,authority=excluded.authority,authority_level=excluded.authority_level,access_mode=excluded.access_mode,identifiers=excluded.identifiers,notes=excluded.notes,metadata=excluded.metadata`,
      [s.id,pack.state,s.caseTypes,s.dimension,s.authority,s.authorityLevel,s.url,u.hostname,s.access,s.identifiers,s.notes??null,{timing:pack.timing??{}}]);
    for(const ct of s.caseTypes) await upsertChunk({sourceId:s.id,jurisdiction:pack.state,caseType:ct,dimension:s.dimension,url:s.url,authorityLevel:s.authorityLevel,content:JSON.stringify({source:s,timing:pack.timing??{},rules:pack.rules??{}}),metadata:{source:s}},true);
  }
}
for(const file of await readdir("knowledge/case-types")){
  const raw=await readFile(path.join("knowledge/case-types",file),"utf8"); const skill=JSON.parse(raw);
  await upsertChunk({sourceId:`CASE_${skill.caseType}`,caseType:skill.caseType,dimension:"POLICY",content:raw,metadata:{skill}},true);
}
try {const intake=await readFile("knowledge/caseclosedfl/intake.json","utf8");await upsertChunk({sourceId:"CASECLOSEDFL_INTAKE",dimension:"POLICY",url:"https://caseclosedfl.com/",authorityLevel:"FIRST_PARTY",content:intake,metadata:{type:"intake_contract"}},true);} catch {}
try {for(const file of await readdir("skills")){if(!file.endsWith(".md"))continue;const content=await readFile(path.join("skills",file),"utf8");await upsertChunk({sourceId:`SKILL_${file}`,dimension:"POLICY",content,metadata:{type:"runtime_skill",file}},true);}} catch {}
await pool.end(); console.log("knowledge registry, intake contract, runtime skills and RAG chunks ingested");
