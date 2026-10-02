const text=v=>String(v??"");
const num=v=>v===""||v==null?null:Number(v);

async function schema(env){
  const {results=[]}=await env.DB.prepare("PRAGMA table_info(contract_register)").all();
  return results;
}
function out(r={}){
  return {
    id:String(r.id??r._rowid??r.rowid??""),
    contract_no:(()=>{const v=r.contract_number||r.registration_number||"";return String(v).startsWith("PENDING-")?"":v;})(),
    fiscal_year:r.fiscal_year,
    contract_date:r.contract_date||r.registered_date||"",
    subject:r.subject||"",
    vendor:r.counterparty_name||r.vendor||"",
    amount:r.contract_value??r.amount??null,
    inventory_no:r.inventory_no||"",
    buyer:r.responsible_unit||r.buyer||"",
    fund_source:r.fund_source||"",
    note:r.notes||r.note||""
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

export default {
 async fetch(request,env){
  const u=new URL(request.url), p=u.pathname;
  if(!(p==="/api/contracts"||p.startsWith("/api/contracts/"))) return env.ASSETS.fetch(request);
  const cors={"Access-Control-Allow-Origin":"https://chatgpt.com","Access-Control-Allow-Headers":"Content-Type, X-Registry-Key","Access-Control-Allow-Methods":"GET,POST,PUT,DELETE,OPTIONS"};
  if(request.method==="OPTIONS") return new Response(null,{headers:cors});
  if(!env.DB) return Response.json({error:"Database DB is not configured"},{status:503});
  const id=p.split("/")[3]||null;
  try{
   const cols=await schema(env);
   const names=new Set(cols.map(c=>c.name));
   if(p==="/api/contracts"&&request.method==="GET"){
    const y=Number(u.searchParams.get("year")||2570);
    const order="rowid DESC";
    const {results=[]}=await env.DB.prepare(`SELECT rowid AS _rowid, * FROM contract_register WHERE fiscal_year=? ORDER BY ${order}`).bind(y).all();
    let next=1;
    for(const r of results){
      const s=text(r.contract_number||r.registration_number||"");
      const n=parseInt(s.split("/")[0],10);
      if(Number.isFinite(n)&&n>=next) next=n+1;
    }
    return Response.json({items:results.map(out),next,year:y});
   }
   if(p==="/api/contracts"&&request.method==="POST"){
    const b=await request.json();
    if(!b.subject) return Response.json({error:"กรุณากรอกรายการ"},{status:400});
    const data=mappedData(b,cols);
    const keys=Object.keys(data).filter(k=>names.has(k));
    if(!keys.length) return Response.json({error:"ไม่พบคอลัมน์ที่รองรับในตาราง contract_register"},{status:500});
    const vals=keys.map(k=>data[k]);
    await env.DB.prepare(`INSERT INTO contract_register (${keys.map(k=>'"'+k+'"').join(",")}) VALUES (${keys.map(()=>"?").join(",")})`).bind(...vals).run();
    const row=names.has("id")&&data.id
      ? await env.DB.prepare("SELECT * FROM contract_register WHERE id=? LIMIT 1").bind(data.id).first()
      : await env.DB.prepare("SELECT * FROM contract_register ORDER BY rowid DESC LIMIT 1").first();
    return Response.json({item:out(row)},{status:201});
   }
   if(id&&request.method==="PUT"){
    const b=await request.json();
    if(!b.subject) return Response.json({error:"กรุณากรอกรายการ"},{status:400});
    const data=mappedData(b,cols);
    delete data.id; delete data.created_at;
    const keys=Object.keys(data).filter(k=>names.has(k));
    const vals=keys.map(k=>data[k]);
    await env.DB.prepare(`UPDATE contract_register SET ${keys.map(k=>'"'+k+'"=?').join(",")} WHERE id=?`).bind(...vals,id).run();
    const row=await env.DB.prepare("SELECT * FROM contract_register WHERE id=? LIMIT 1").bind(id).first();
    return Response.json({item:out(row)});
   }
   if(id&&request.method==="DELETE"){
    let r=await env.DB.prepare("DELETE FROM contract_register WHERE id=?").bind(id).run();
    let changes=Number(r.meta?.changes||0);
    if(!changes){
      r=await env.DB.prepare("DELETE FROM contract_register WHERE rowid=?").bind(id).run();
      changes=Number(r.meta?.changes||0);
    }
    if(!changes) return Response.json({error:"ไม่พบรายการที่จะลบ"},{status:404});
    return Response.json({ok:true,changes});
   }
   return Response.json({error:"Method not allowed"},{status:405});
  }catch(e){
    const s=String(e?.message||e);
    return Response.json({error:s.includes("UNIQUE")?"เลขที่สัญญานี้มีอยู่แล้ว":s},{status:s.includes("UNIQUE")?409:500});
  }
 }
};