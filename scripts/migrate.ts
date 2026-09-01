import { readFile,readdir } from "node:fs/promises";
import { pool } from "../src/db/index.js";
const files=(await readdir("migrations")).filter((x:string)=>x.endsWith(".sql")).sort();
for(const f of files){await pool.query(await readFile(`migrations/${f}`,"utf8")); console.log(`applied ${f}`);}
await pool.end();
