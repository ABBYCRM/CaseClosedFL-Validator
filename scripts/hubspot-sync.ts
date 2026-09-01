import { pool } from "../src/db/index.js";
import { syncHubSpotOnce } from "../src/integrations/hubspot/worker.js";
try{console.log(JSON.stringify(await syncHubSpotOnce(),null,2));}finally{await pool.end();}
