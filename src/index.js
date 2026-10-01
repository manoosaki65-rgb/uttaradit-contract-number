export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/contracts" || url.pathname.startsWith("/api/contracts/")) {
      if (!env.DB) return Response.json({error:"Database DB is not configured"},{status:503});
      const id = url.pathname.split("/")[3] || null;
      try {
        if (url.pathname === "/api/contracts" && request.method === "GET") {
          const year = Number(url.searchParams.get("year") || 2570);
          const {results=[]} = await env.DB.prepare("SELECT * FROM contract_numbers WHERE fiscal_year=? ORDER BY CAST(substr(contract_no,1,instr(contract_no,'/')-1) AS INTEGER) DESC, created_at DESC").bind(year).all();
          const m = await env.DB.prepare("SELECT COALESCE(MAX(CAST(substr(contract_no,1,instr(contract_no,'/')-1) AS INTEGER)),0) n FROM contract_numbers WHERE fiscal_year=? AND instr(contract_no,'/')>1").bind(year).first();
          return Response.json({items:results,next:Number(m?.n||0)+1,year});
        }
        if (url.pathname === "/api/contracts" && request.method === "POST") {
          const b=await request.json(); if(!b.contract_no||!b.subject) return Response.json({error:"กรุณากรอกเลขที่สัญญาและรายการ"},{status:400});
          const rid=crypto.randomUUID(), now=new Date().toISOString();
          await env.DB.prepare("INSERT INTO contract_numbers(id,contract_no,fiscal_year,contract_date,subject,vendor,amount,inventory_no,buyer,fund_source,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(rid,String(b.contract_no).trim(),Number(b.fiscal_year||2570),String(b.contract_date||""),String(b.subject||""),String(b.vendor||""),b.amount===""||b.amount==null?null:Number(b.amount),String(b.inventory_no||""),String(b.buyer||""),String(b.fund_source||""),String(b.note||""),now,now).run();
          return Response.json({item:await env.DB.prepare("SELECT * FROM contract_numbers WHERE id=?").bind(rid).first()},{status:201});
        }
        if (id && request.method === "DELETE") { await env.DB.prepare("DELETE FROM contract_numbers WHERE id=?").bind(id).run(); return Response.json({ok:true}); }
        if (id && request.method === "PUT") {
          const b=await request.json(); if(!b.contract_no||!b.subject) return Response.json({error:"กรุณากรอกเลขที่สัญญาและรายการ"},{status:400});
          await env.DB.prepare("UPDATE contract_numbers SET contract_no=?,fiscal_year=?,contract_date=?,subject=?,vendor=?,amount=?,inventory_no=?,buyer=?,fund_source=?,note=?,updated_at=? WHERE id=?").bind(String(b.contract_no).trim(),Number(b.fiscal_year||2570),String(b.contract_date||""),String(b.subject||""),String(b.vendor||""),b.amount===""||b.amount==null?null:Number(b.amount),String(b.inventory_no||""),String(b.buyer||""),String(b.fund_source||""),String(b.note||""),new Date().toISOString(),id).run();
          return Response.json({item:await env.DB.prepare("SELECT * FROM contract_numbers WHERE id=?").bind(id).first()});
        }
        return Response.json({error:"Method not allowed"},{status:405});
      } catch(e) { const s=String(e?.message||e); return Response.json({error:s.includes("UNIQUE")?"เลขที่สัญญานี้มีอยู่แล้ว":s},{status:s.includes("UNIQUE")?409:500}); }
    }
    return env.ASSETS.fetch(request);
  }
};