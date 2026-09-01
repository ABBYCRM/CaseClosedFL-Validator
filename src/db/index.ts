import pg,{type QueryResultRow,type PoolClient} from "pg";
import { env } from "../config/env.js";
export const pool=new pg.Pool({connectionString:env.DATABASE_URL,ssl:/localhost|127\.0\.0\.1/.test(env.DATABASE_URL)?false:{rejectUnauthorized:false},max:10,idleTimeoutMillis:30_000});
export async function q<T extends QueryResultRow=any>(text:string,params:unknown[]=[]):Promise<T[]>{return (await pool.query(text,params)).rows as T[];}
export async function tx<T>(fn:(client:PoolClient)=>Promise<T>):Promise<T>{const client=await pool.connect();try{await client.query("BEGIN");const out=await fn(client);await client.query("COMMIT");return out;}catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}}
