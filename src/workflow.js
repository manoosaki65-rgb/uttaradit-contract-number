// Preserve old workflow fields under their original displayed meaning.
export function workflowFields(stage,hospital){
 const legacy=stage===(hospital?2:1);
 return legacy?{sent:"sent_at",received:"received_at",sender:"sent_by",receiver:"received_by"}:{sent:"other_sent_at",received:"other_received_at",sender:"other_sent_by",receiver:"other_received_by"};
}
export async function ensureWorkflowColumns(env,table){
 if(!["contract_register","hospital_contract_register"].includes(table))throw Error("Invalid register");
 const {results=[]}=await env.DB.prepare("PRAGMA table_info("+table+")").all();
 for(const name of ["sent_by","received_by","other_sent_at","other_received_at","other_sent_by","other_received_by"]){
  if(results.some(x=>x.name===name))continue;
  try{await env.DB.prepare("ALTER TABLE "+table+" ADD COLUMN "+name+" TEXT").run();}
  catch(e){if(!String(e?.message||e).toLowerCase().includes("duplicate column"))throw e;}
 }
}
export function workflowOutput(r,hospital){
 const out={};
 for(const stage of [1,2]){
  const f=workflowFields(stage,hospital);
  out["stage"+stage+"_sent_at"]=r[f.sent]||"";
  out["stage"+stage+"_received_at"]=r[f.received]||"";
  out["stage"+stage+"_sent_by"]=r[f.sender]||"";
  out["stage"+stage+"_received_by"]=r[f.receiver]||"";
 }
 return out;
}
