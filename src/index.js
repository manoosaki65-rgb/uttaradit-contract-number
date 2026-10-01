export default {
 async fetch(request,env){
  const u=new URL(request.url), p=u.pathname;
  if(!(p==="/api/contracts"||p.startsWith("/api/contracts/"))) return env.ASSETS.fetch(request);
  if(!env.DB) return Response.json({error:"Database DB is not configured"},{status:503});
  const id=p.split("/")[3]||null;
  const out=r=>({
   id:String(r.id), contract_no:r.contract_number||r.registration_number||"", fiscal_year:r.fiscal_year,
   contract_date:r.contract_date||"", subject:r.subject||"", vendor:r.counterparty_name||"",
   amount:r.contract_value, inventory_no:r.inventory_no||"", buyer:r.responsible_unit||"",
   fund_source:r.fund_source||"", note:r.notes||r.note||""
  });
  try{
   if(p==="/api/contracts"&&request.method==="GET"){
    const y=Number(u.searchParams.get("year")||2570);
    const {results=[]}=await env.DB.prepare("SELECT * FROM contract_register WHERE fiscal_year=? ORDER BY id DESC").bind(y).all();
    let next=1;
    for(const r of results){const s=String(r.registration_number||r.contract_number||"");const n=parseInt(s.split("/")[0],10);if(Number.isFinite(n)&&n>=next)next=n+1}
    return Response.json({items:results.map(out),next,year:y});
   }
   if(p==="/api/contracts"&&request.method==="POST"){
    const b=await request.json(); if(!b.contract_no||!b.subject)return Response.json({error:"กรุณากรอกเลขที่สัญญาและรายการ"},{status:400});
    const y=Number(b.fiscal_year||2570), now=new Date().toISOString(), no=String(b.contract_no).trim();
    const reg=no;
    const cols=await env.DB.prepare("PRAGMA table_info(contract_register)").all(); const names=new Set((cols.results||[]).map(x=>x.name));
    const data={id:crypto.randomUUID(),registration_number:reg,contract_number:no,fiscal_year:y,registered_date:String(b.contract_date||new Date().toISOString().slice(0,10)),contract_date:String(b.contract_date||""),subject:String(b.subject||""),counterparty_name:String(b.vendor||""),responsible_unit:String(b.buyer||""),contract_value:b.amount===""||b.amount==null?null:Number(b.amount),inventory_no:String(b.inventory_no||""),fund_source:String(b.fund_source||""),notes:String(b.note||""),source_system:"cloudflare-ui",created_at:now,updated_at:now};
    const keys=Object.keys(data).filter(k=>names.has(k)); const vals=keys.map(k=>data[k]);
    await env.DB.prepare(`INSERT INTO contract_register (${keys.join(",")}) VALUES (${keys.map(()=>"?").join(",")})`).bind(...vals).run();
    const row=await env.DB.prepare("SELECT * FROM contract_register WHERE fiscal_year=? AND contract_number=? ORDER BY id DESC LIMIT 1").bind(y,no).first();
    return Response.json({item:out(row)},{status:201});
   }
   if(id&&request.method==="DELETE"){await env.DB.prepare("DELETE FROM contract_register WHERE id=?").bind(id).run();return Response.json({ok:true});}
   return Response.json({error:"Method not allowed"},{status:405});
  }catch(e){return Response.json({error:String(e?.message||e)},{status:500})}
 }
};