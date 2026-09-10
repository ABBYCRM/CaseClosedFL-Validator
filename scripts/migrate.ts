import { readFile,readdir } from "node:fs/promises";
import { pool } from "../src/db/index.js";

await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
)`);

const files=(await readdir("migrations")).filter((x:string)=>x.endsWith(".sql")).sort();
const applied=new Set((await pool.query("SELECT filename FROM schema_migrations")).rows.map((row:{filename:string})=>row.filename));
for(const f of files){
  if(applied.has(f)){console.log(`skip ${f}`);continue;}
  await pool.query(await readFile(`migrations/${f}`,"utf8"));
  await pool.query("INSERT INTO schema_migrations(filename) VALUES($1)",[f]);
  console.log(`applied ${f}`);
}
await pool.end();
