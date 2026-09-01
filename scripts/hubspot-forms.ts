import { listForms } from "../src/integrations/hubspot/client.js";
for(const f of await listForms()) console.log(`${f.archived?"ARCHIVED":"ACTIVE"}\t${f.id}\t${f.name}\t${f.formType??""}`);
