import {ensureAttachmentSchema, filesForRows, handleAttachmentRequest} from "./attachments.js";
const text=v=>String(v??"");
const num=v=>v===""||v==null?null:Number(v);

async function schema(env){
  let {results=[]}=await env.DB.prepare("PRAGMA table_info(contract_register)").all();
  if(!results.some(c=>c.name==="contract_duration")){
    try{await env.DB.prepare("ALTER TABLE contract_register ADD COLUMN contract_duration TEXT").run();}
    catch(e){
      const s=String(e?.message||e);
      if(!s.toLowerCase().includes("duplicate column")) throw e;
    }
    ({results=[]}=await env.DB.prepare("PRAGMA table_info(contract_register)").all());
  }
  for (const name of ["attachment_url","attachment_name"]) {
    if (!results.some(c=>c.name===name)) {
      try { await env.DB.prepare("ALTER TABLE contract_register ADD COLUMN "+name+" TEXT").run(); }
      catch(e) { if (!String(e?.message||e).toLowerCase().includes("duplicate column")) throw e; }
    }
  }
  // Add workflow timestamps without changing existing contract numbers or document links.
  for (const name of ["sent_at","received_at"]) {
    const current=(await env.DB.prepare("PRAGMA table_info(contract_register)").all()).results||[];
    if (!current.some(c=>c.name===name)) {
      try { await env.DB.prepare("ALTER TABLE contract_register ADD COLUMN "+name+" TEXT").run(); }
      catch(e) { if (!String(e?.message||e).toLowerCase().includes("duplicate column")) throw e; }
    }
  }
  return (await env.DB.prepare("PRAGMA table_info(contract_register)").all()).results||results;
}
function out(r={}){
  return {
    id:String(r.id??r._rowid??r.rowid??""),
    contract_no:(()=>{const v=r.contract_number||r.registration_number||"";return String(v).startsWith("PENDING-")?"":v;})(),
    fiscal_year:r.fiscal_year,
    contract_date:r.contract_date||r.registered_date||"",
    duration:r.contract_duration||r.duration||"",
    subject:r.subject||"",
    vendor:r.counterparty_name||r.vendor||"",
    amount:r.contract_value??r.amount??null,
    inventory_no:r.inventory_no||"",
    buyer:r.responsible_unit||r.buyer||"",
    fund_source:r.fund_source||"",
    note:r.notes||r.note||"",
    attachment_url:r.attachment_url||"",
    attachment_name:r.attachment_name||"",
    sent_at:r.sent_at||"",
    received_at:r.received_at||""
  };
}
function mappedData(b, cols){
  const now=new Date().toISOString();
  const rawNo=text(b.contract_no).trim();
  const no=rawNo || `PENDING-${crypto.randomUUID()}`;
  const y=Number(b.fiscal_year||2570);
  const today=now.slice(0,10);
  const data={
    registration_number:no,
    contract_number:no,
    fiscal_year:y,
    registered_date:text(b.contract_date||today),
    contract_date:text(b.contract_date||""),
    contract_duration:text(b.duration||""),
    subject:text(b.subject||""),
    counterparty_name:text(b.vendor||""),
    vendor:text(b.vendor||""),
    responsible_unit:text(b.buyer||""),
    buyer:text(b.buyer||""),
    contract_value:num(b.amount),
    amount:num(b.amount),
    inventory_no:text(b.inventory_no||""),
    fund_source:text(b.fund_source||""),
    notes:text(b.note||""),
    note:text(b.note||""),
    attachment_url:text(b.attachment_url||"").trim(),
    attachment_name:text(b.attachment_name||"").trim(),
    source_system:"cloudflare-ui",
    created_at:now,
    updated_at:now
  };
  const byName=new Map(cols.map(c=>[c.name,c]));
  const idCol=byName.get("id");
  if(idCol){
    const t=text(idCol.type).toUpperCase();
    if(!(Number(idCol.pk)===1 && t.includes("INT"))) data.id=crypto.randomUUID();
  }
  for(const c of cols){
    if(c.name in data) continue;
    if(Number(c.notnull)!==1 || c.dflt_value!=null) continue;
    if(Number(c.pk)===1 && text(c.type).toUpperCase().includes("INT")) continue;
    const t=text(c.type).toUpperCase();
    data[c.name]=(t.includes("INT")||t.includes("REAL")||t.includes("NUM")||t.includes("DEC"))?0:"";
  }
  return data;
}
async function syncMaster(env,action,item,maxAttempts=3){
  if(!env.MASTER_SYNC_URL||!env.MASTER_SYNC_TOKEN)return {ok:false,skipped:true};
  let lastError="";
  for(let attempt=1;attempt<=maxAttempts;attempt++){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),30000);
    try{
      const response=await fetch(env.MASTER_SYNC_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:env.MASTER_SYNC_TOKEN||"",system:"contract",action,item}),signal:controller.signal,redirect:"follow"});
      const body=await response.text();
      clearTimeout(timer);
      let receipt;
      try{receipt=JSON.parse(body);}catch{receipt=null;}
      if(response.ok && receipt?.ok===true && receipt.system==="contract" &&
         receipt.id===String(item.id) && receipt.verified===true &&
         receipt.spreadsheet_id==="1eFV9JbOBkTYeg25vyVxiiZ8MA7KadHh7EHg03fodeHQ" &&
         receipt.sheet==="สัญญา 70")return {ok:true};
      lastError=response.ok?"Master did not confirm verified contract write":`Master HTTP ${response.status}`;
    }catch(e){clearTimeout(timer);lastError=String(e?.message||e);}
    if(attempt<maxAttempts)await new Promise(r=>setTimeout(r,250*attempt));
  }
  console.error("Master sync failed:",lastError);
  return {ok:false,error:lastError};
}

/* Durable, idempotent retries for failed Cloudflare -> Google Master writes.
   The D1 queue contains only contract IDs; it always reads the latest contract
   before retrying, and a revision token prevents an old attempt clearing a
   newer update. No new contract numbers are allocated by this queue. */
async function ensureMasterRetryTable(env){
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS contract_master_sync_queue (
    contract_id TEXT PRIMARY KEY,
    revision TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_retry_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_error TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`).run();
}
async function syncWithRetryQueue(env,item){
  let revision="", queueError="";
  try{
    await ensureMasterRetryTable(env);
    revision=crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO contract_master_sync_queue
      (contract_id,revision,attempts,next_retry_at,last_error,updated_at)
      VALUES (?,?,0,datetime('now'),' ',datetime('now'))
      ON CONFLICT(contract_id) DO UPDATE SET
      revision=excluded.revision, attempts=0,
      next_retry_at=datetime('now'),last_error='',updated_at=datetime('now')`)
      .bind(String(item.id),revision).run();
  }catch(e){
    queueError="Unable to save Master retry queue: "+String(e?.message||e);
    console.error(queueError);
  }
  const result=await syncMaster(env,"upsert",item);
  if(revision){
    try{
      if(result.ok){
        await env.DB.prepare("DELETE FROM contract_master_sync_queue WHERE contract_id=? AND revision=?")
          .bind(String(item.id),revision).run();
      }else{
        await env.DB.prepare(`UPDATE contract_master_sync_queue
          SET last_error=?,next_retry_at=datetime('now','+15 minutes')
          WHERE contract_id=? AND revision=?`)
          .bind(String(result.error||"Master sync not acknowledged").slice(0,1000),String(item.id),revision).run();
      }
    }catch(e){
      queueError="Unable to finalize Master retry queue: "+String(e?.message||e);
      console.error(queueError);
    }
  }
  if(result.ok)return result;
  return {...result,queued:Boolean(revision&&!queueError),
    error:[result.error,queueError].filter(Boolean).join("; ")};
}
async function retryMasterQueue(env){
  if(!env.DB)return;
  await ensureMasterRetryTable(env);
  const {results=[]}=await env.DB.prepare(`SELECT contract_id,revision FROM contract_master_sync_queue
    WHERE next_retry_at<=datetime('now') ORDER BY updated_at ASC LIMIT 4`).all();
  for(const job of results){
    try{
      const row=await env.DB.prepare("SELECT * FROM contract_register WHERE CAST(id AS TEXT)=? LIMIT 1")
        .bind(job.contract_id).first();
      if(!row){
        await env.DB.prepare("DELETE FROM contract_master_sync_queue WHERE contract_id=? AND revision=?")
          .bind(job.contract_id,job.revision).run();
        continue;
      }
      const result=await syncMaster(env,"upsert",out(row),1);
      if(result.ok){
        await env.DB.prepare("DELETE FROM contract_master_sync_queue WHERE contract_id=? AND revision=?")
          .bind(job.contract_id,job.revision).run();
      }else{
        await env.DB.prepare(`UPDATE contract_master_sync_queue SET attempts=attempts+1,
          last_error=?,next_retry_at=datetime('now','+15 minutes')
          WHERE contract_id=? AND revision=?`)
          .bind(String(result.error||"Master sync not acknowledged").slice(0,1000),job.contract_id,job.revision).run();
      }
    }catch(e){
      console.error("Master retry failed for contract ID",job.contract_id,String(e?.message||e));
    }
  }
}

export default {
 async fetch(request,env){
  const u=new URL(request.url), p=u.pathname;
  if(!(p==="/api/contracts"||p.startsWith("/api/contracts/"))) return env.ASSETS.fetch(request);
  const cors={"Access-Control-Allow-Origin":"https://chatgpt.com","Access-Control-Allow-Headers":"Content-Type, X-Registry-Key, X-Contract-File-Key, X-Contract-Workflow-Key","Access-Control-Allow-Methods":"GET,POST,PUT,PATCH,DELETE,OPTIONS"};
  if(request.method==="OPTIONS") return new Response(null,{headers:cors});
  if(!env.DB) return Response.json({error:"Database DB is not configured"},{status:503});
  const id=p.split("/")[3]||null;
  try{
   const cols=await schema(env);
   await ensureAttachmentSchema(env);
   const handled=await handleAttachmentRequest(request,env,p);
   if(handled)return handled;
   const names=new Set(cols.map(c=>c.name));
   if(p==="/api/contracts"&&request.method==="GET"){
    const y=Number(u.searchParams.get("year")||2570);
    const order="CASE WHEN contract_number LIKE 'PENDING-%' OR registration_number LIKE 'PENDING-%' THEN 0 ELSE 1 END ASC, rowid DESC";
    const {results=[]}=await env.DB.prepare(`SELECT rowid AS _rowid, * FROM contract_register WHERE fiscal_year=? ORDER BY ${order}`).bind(y).all();
    let next=1;
    for(const r of results){
      const s=text(r.contract_number||r.registration_number||"");
      const n=parseInt(s.split("/")[0],10);
      if(Number.isFinite(n)&&n>=next) next=n+1;
    }
    return Response.json({items:await filesForRows(env,results.map(out)),next,year:y});
   }
   if(p==="/api/contracts"&&request.method==="POST"){
    const b=await request.json();
    if(!b.subject) return Response.json({error:"กรุณากรอกรายการ"},{status:400});
    if(b.attachment_url&&!/^https:\/\//i.test(String(b.attachment_url).trim()))return Response.json({error:"ลิงก์เอกสารต้องขึ้นต้นด้วย https://"}, {status:400});
    const data=mappedData(b,cols);
    const keys=Object.keys(data).filter(k=>names.has(k));
    if(!keys.length) return Response.json({error:"ไม่พบคอลัมน์ที่รองรับในตาราง contract_register"},{status:500});
    const vals=keys.map(k=>data[k]);
    await env.DB.prepare(`INSERT INTO contract_register (${keys.map(k=>'"'+k+'"').join(",")}) VALUES (${keys.map(()=>"?").join(",")})`).bind(...vals).run();
    const row=names.has("id")&&data.id
      ? await env.DB.prepare("SELECT * FROM contract_register WHERE id=? LIMIT 1").bind(data.id).first()
      : await env.DB.prepare("SELECT * FROM contract_register ORDER BY rowid DESC LIMIT 1").first();
    const item=out(row);
    const master=await syncWithRetryQueue(env,item);
    return Response.json({item,master_sync:master.ok,master_warning:master.ok?null:"บันทึกทะเบียนแล้ว แต่ Master Google Sheet ยังไม่ซิงก์"},{status:201});
   }
   // Sending and receiving are separate, write-once actions. Never overwrite dates.
   if(id && p==="/api/contracts/"+encodeURIComponent(id)+"/workflow" && request.method==="PATCH"){
     const b=await request.json();
     const action=b.action;
     if(action!=="send" && action!=="receive") return Response.json({error:"ขั้นตอนไม่ถูกต้อง"},{status:400});
     // Staff may mark a contract as sent. Receiving is restricted to the supplies officer.
     if(action==="receive"){
       if(!env.CONTRACT_RECEIVE_KEY) return Response.json({error:"ยังไม่ได้ตั้งรหัสสิทธิ์รับสัญญาในระบบ"},{status:503});
       if(request.headers.get("X-Contract-Workflow-Key")!==env.CONTRACT_RECEIVE_KEY)
         return Response.json({error:"รหัสรับสัญญาไม่ถูกต้อง"},{status:403});
     }
     const existing=await env.DB.prepare("SELECT * FROM contract_register WHERE CAST(id AS TEXT)=? LIMIT 1").bind(id).first();
     if(!existing) return Response.json({error:"ไม่พบรายการสัญญา"},{status:404});
     if(Number(existing.fiscal_year)!==2570) return Response.json({error:"รองรับเฉพาะปี 2570"},{status:403});
     if(action==="send" && existing.sent_at) return Response.json({error:"รายการนี้บันทึกวันที่ส่งสัญญาแล้ว"},{status:409});
     if(action==="receive" && !existing.sent_at) return Response.json({error:"ต้องส่งสัญญาก่อนจึงจะรับได้"},{status:409});
     if(action==="receive" && existing.received_at) return Response.json({error:"รายการนี้รับสัญญาแล้ว"},{status:409});
     const at=new Date().toISOString();
     const field=action==="send"?"sent_at":"received_at";
     const condition=action==="send"?"sent_at IS NULL":"sent_at IS NOT NULL AND received_at IS NULL";
     const result=await env.DB.prepare(`UPDATE contract_register SET ${field}=?,updated_at=? WHERE CAST(id AS TEXT)=? AND ${condition}`)
       .bind(at,at,id).run();
     if(!result.meta?.changes) return Response.json({error:"มีการอัปเดตจากเครื่องอื่นแล้ว กรุณารีเฟรช"},{status:409});
     const row=await env.DB.prepare("SELECT * FROM contract_register WHERE CAST(id AS TEXT)=? LIMIT 1").bind(id).first();
     return Response.json({item:out(row),ok:true});
   }
   // Update a contract document link without rewriting the other contract fields.
   if(id&&p==="/api/contracts/"+encodeURIComponent(id)+"/attachment"&&request.method==="PATCH"){
     const existing=await env.DB.prepare("SELECT * FROM contract_register WHERE CAST(id AS TEXT)=? LIMIT 1").bind(id).first();
     if(!existing)return Response.json({error:"ไม่พบรายการสัญญา"},{status:404});
     if(Number(existing.fiscal_year)!==2570)return Response.json({error:"รองรับเฉพาะสัญญาปี 2570"},{status:403});
     const b=await request.json();
     const link=text(b.attachment_url).trim();
     const name=text(b.attachment_name).trim();
     if(!/^https:\/\//i.test(link))return Response.json({error:"กรุณาใส่ลิงก์ HTTPS ของเอกสาร"},{status:400});
     if(link.length>2048||name.length>240)return Response.json({error:"ลิงก์หรือชื่อไฟล์ยาวเกินกำหนด"},{status:400});
     await env.DB.prepare("UPDATE contract_register SET attachment_url=?, attachment_name=?, updated_at=? WHERE CAST(id AS TEXT)=?")
       .bind(link,name,new Date().toISOString(),id).run();
     const row=await env.DB.prepare("SELECT * FROM contract_register WHERE CAST(id AS TEXT)=? LIMIT 1").bind(id).first();
     const item=out(row);
     const master=await syncWithRetryQueue(env,item);
     return Response.json({item,master_sync:master.ok,master_warning:master.ok?null:"บันทึกลิงก์ในทะเบียนแล้ว แต่ Master Google Sheet ยังไม่ซิงก์"});
   }
   if(id&&request.method==="PUT"){
    const b=await request.json();
    if(!b.subject) return Response.json({error:"กรุณากรอกรายการ"},{status:400});
    if(b.attachment_url&&!/^https:\/\//i.test(String(b.attachment_url).trim()))return Response.json({error:"ลิงก์เอกสารต้องขึ้นต้นด้วย https://"}, {status:400});
    const data=mappedData(b,cols);
    delete data.id; delete data.created_at;
    const keys=Object.keys(data).filter(k=>names.has(k));
    const vals=keys.map(k=>data[k]);
    await env.DB.prepare(`UPDATE contract_register SET ${keys.map(k=>'"'+k+'"=?').join(",")} WHERE id=?`).bind(...vals,id).run();
    const row=await env.DB.prepare("SELECT * FROM contract_register WHERE id=? LIMIT 1").bind(id).first();
    const item=out(row);
    const master=await syncWithRetryQueue(env,item);
    return Response.json({item,master_sync:master.ok,master_warning:master.ok?null:"แก้ไขทะเบียนแล้ว แต่ Master Google Sheet ยังไม่ซิงก์"});
   }
   if(id&&request.method==="DELETE"){
    const n=await env.DB.prepare("SELECT COUNT(*) AS n FROM contract_files WHERE contract_id=?").bind(id).first();
    if(Number(n?.n||0)>0)return Response.json({error:"กรุณาลบไฟล์แนบสัญญาก่อนลบรายการ เพื่อไม่ให้ไฟล์ตกค้าง"},{status:409});
    let r=await env.DB.prepare("DELETE FROM contract_register WHERE id=?").bind(id).run();
    let changes=Number(r.meta?.changes||0);
    if(!changes){
      r=await env.DB.prepare("DELETE FROM contract_register WHERE rowid=?").bind(id).run();
      changes=Number(r.meta?.changes||0);
    }
    if(!changes) return Response.json({error:"ไม่พบรายการที่จะลบ"},{status:404});
    // A removed contract must never be re-sent from the retry queue.
    try{
      await ensureMasterRetryTable(env);
      await env.DB.prepare("DELETE FROM contract_master_sync_queue WHERE contract_id=?").bind(id).run();
    }catch(e){console.error("Master queue delete cleanup failed:",String(e?.message||e));}
    return Response.json({ok:true,changes});
   }
   return Response.json({error:"Method not allowed"},{status:405});
  }catch(e){
    const s=String(e?.message||e);
    return Response.json({error:s.includes("UNIQUE")?"เลขที่สัญญานี้มีอยู่แล้ว":s},{status:s.includes("UNIQUE")?409:500});
  }
 },
 async scheduled(_event,env,ctx){
   ctx.waitUntil(retryMasterQueue(env));
 }
};
