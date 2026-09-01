import { readdir,readFile } from "node:fs/promises";
import { fetchPublic } from "../src/tools/http.js";
for(const f of await readdir("knowledge/jurisdictions")){
  const p=JSON.parse(await readFile(`knowledge/jurisdictions/${f}`,"utf8"));
  for(const s of p.sources){try{const r=await fetchPublic(s.url);console.log(`${s.id}\t${r.status}\t${r.url}`);}catch(e:any){console.log(`${s.id}\tERROR\t${e.message}`);}}
}
