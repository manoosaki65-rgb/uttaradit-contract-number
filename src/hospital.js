import {workflowFields,ensureWorkflowColumns,workflowOutput} from "./workflow.js";
import {ensureAttachmentSchema, filesForRows, handleAttachmentRequest} from "./attachments.js";
const error=(message,status=400)=>Response.json({error:message},{status});
const clean=v=>String(v??"").trim();
const cols=["contract_no","fiscal_year","contract_date","duration","subject","vendor","amount","inventory_no","buyer","fund_source","note","attachment_url","attachment_name"];
const create="CREATE TABLE IF NOT EXISTS hospital_contract_register (id TEXT PRIMARY KEY, contract_no TEXT NOT NULL UNIQUE, fiscal_year INTEGER NOT NULL, contract_date TEXT, duration TEXT, subject TEXT NOT NULL, vendor TEXT, amount REAL, inventory_no TEXT, buyer TEXT, fund_source TEXT, note TEXT, attachment_url TEXT, attachment_name TEXT, sent_at TEXT, received_at TEXT, sent_by TEXT, received_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)";
async function schema(env){
 await env.DB.batch([env.DB.prepare(create),env.DB.prepare("CREATE TABLE IF NOT EXISTS hospital_registry_migrations (name TEXT PRIMARY KEY)")]);
 const seed={"no":"1/2570","year":"2570","fund":"เงินบริจาค","buyer":"สุรชาติ","subject":"จ้างก่อสร้างปรับปรุงหอผู้ป่วยพิเศษศัลยกรรมกระดูกและข้อ และหอผู้ป่วยพิเศษ Sleep Test จำนวน 1 งาน","vendor":"ห้างหุ้นส่วนจำกัด หิรัญย์ทรัพย์ไพศาล","amount":"2090000","date":"12/10/2569","status":"ออกเลขแล้ว","inventory":"","duration":"13 ต.ค. 69 – 10 ม.ค. 70"};
 await env.DB.batch([
 env.DB.prepare("INSERT OR IGNORE INTO hospital_contract_register (id,contract_no,fiscal_year,contract_date,duration,subject,vendor,amount,inventory_no,buyer,fund_source,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM hospital_registry_migrations WHERE name='master-2570-001')").bind("hospital-master-2570-001",seed.no,Number(seed.year),"2026-10-12",seed.duration,seed.subject,seed.vendor,Number(seed.amount),seed.inventory,seed.buyer,seed.fund,new Date().toISOString(),new Date().toISOString()),
 env.DB.prepare("INSERT OR IGNORE INTO hospital_registry_migrations(name) VALUES('master-2570-001')")]);
 await ensureWorkflowColumns(env,"hospital_contract_register");
 await ensureAttachmentSchema(env);
}
const yearOK=y=>Number.isInteger(y)&&y>=2562&&y<=2570;
function data(b){
 const y=Number(b.fiscal_year),n=clean(b.contract_no);
 if(!yearOK(y)||!new RegExp("^[1-9][0-9]*/"+y+"$").test(n))throw Error("กรุณาระบุเลขสัญญาให้ตรงกับปีที่เลือก");
 if(!clean(b.subject))throw Error("กรุณากรอกรายการ");
 if(b.amount!==""&&b.amount!=null&&(!Number.isFinite(Number(b.amount))||Number(b.amount)<0))throw Error("วงเงินไม่ถูกต้อง");
 if(b.attachment_url&&!/^https:\/\//i.test(clean(b.attachment_url)))throw Error("ลิงก์ต้องขึ้นต้นด้วย https://");
 return cols.map(k=>k==="fiscal_year"?y:k==="amount"?(b.amount===""||b.amount==null?null:Number(b.amount)):clean(b[k]));
}
export async function handleHospital(request,env,path){
 if(!env.DB)return error("ยังไม่เชื่อม D1",503);
 if(request.method!=="GET"&&request.headers.get("Origin")&&request.headers.get("Origin")!==new URL(request.url).origin)return error("ไม่อนุญาตคำขอข้ามเว็บไซต์",403);
 try{
 await schema(env);
 const u=new URL(request.url), base="/api/hospital-contracts", method=request.method;
 const get=id=>env.DB.prepare("SELECT * FROM hospital_contract_register WHERE id=?").bind(id).first();
 if(path===base&&method==="GET"){
  const y=Number(u.searchParams.get("year")||2570);if(!yearOK(y))return error("ปีไม่ถูกต้อง");
  const {results=[]}=await env.DB.prepare("SELECT * FROM hospital_contract_register WHERE fiscal_year=? ORDER BY created_at DESC,id DESC").bind(y).all();
  return Response.json({items:await filesForRows(env,results.map(r=>({...r,...workflowOutput(r,true)}))),year:y,next:Math.max(0,...results.map(r=>Number(r.contract_no.split("/")[0])||0))+1,master_sync:false});
 }
 if(path===base&&method==="POST"){
  const b=await request.json();let vals;try{vals=data(b)}catch(e){return error(e.message);}
  const id="hospital-"+crypto.randomUUID(),at=new Date().toISOString();
  await env.DB.prepare("INSERT INTO hospital_contract_register (id,"+cols.join(",")+",created_at,updated_at) VALUES ("+Array(cols.length+3).fill("?").join(",")+")").bind(id,...vals,at,at).run();
  return Response.json({item:await get(id),master_sync:false},{status:201});
 }
 if(path===base+"/attachment-status"&&method==="GET")return Response.json({upload_enabled:Boolean(env.CONTRACT_FILES&&env.CONTRACT_FILE_KEY),max_mb:15,link_enabled:true});
 const m=path.match(/^\/api\/hospital-contracts\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?$/);
 if(!m)return error("ไม่พบหน้า",404);
 const id=decodeURIComponent(m[1]),sub=m[2]||"",r=await get(id);
 if(!r)return error("ไม่พบสัญญา",404);
 if(sub==="files")return handleAttachmentRequest(request,env,path.replace(base,"/api/contracts"),"hospital_contract_register");
 if(sub==="workflow"&&method==="PATCH"){
  const b=await request.json(),action=b.action,actor=clean(b.actor),stage=Number(b.stage??2);
  if(![1,2].includes(stage)||!["send","receive"].includes(action)||!actor||actor.length>120)return error("กรุณาระบุชื่อผู้ดำเนินการ");
  if(action==="receive"){
   if(!env.CONTRACT_RECEIVE_KEY)return error("ยังไม่ได้ตั้งรหัสรับแฟ้ม",503);
   if(request.headers.get("X-Contract-Workflow-Key")!==env.CONTRACT_RECEIVE_KEY)return error("รหัสรับแฟ้มไม่ถูกต้อง",403);
  }
  const f=workflowFields(stage,true),at=new Date().toISOString(),field=action==="send"?f.sent:f.received,person=action==="send"?f.sender:f.receiver;
  const condition=action==="send"?"("+f.sent+" IS NULL OR "+f.sent+"='')":"("+f.sent+" IS NOT NULL AND "+f.sent+"<>'') AND ("+f.received+" IS NULL OR "+f.received+"='')";
  const result=await env.DB.prepare("UPDATE hospital_contract_register SET "+field+"=?,"+person+"=?,updated_at=? WHERE id=? AND "+condition).bind(at,actor,at,id).run();
  if(!result.meta?.changes)return error("ส่งแฟ้มก่อนรับ หรือรายการนี้ถูกบันทึกแล้ว",409);
  return Response.json({item:await get(id),ok:true});
 }
 if(sub==="attachment"&&method==="PATCH"){
  const b=await request.json(),link=clean(b.attachment_url),name=clean(b.attachment_name);
  if(!/^https:\/\//i.test(link)||link.length>2048||name.length>240)return error("ลิงก์เอกสารไม่ถูกต้อง");
  await env.DB.prepare("UPDATE hospital_contract_register SET attachment_url=?,attachment_name=?,updated_at=? WHERE id=?").bind(link,name,new Date().toISOString(),id).run();
  return Response.json({item:await get(id),master_sync:false});
 }
 if(!sub&&method==="PUT"){
  const b=await request.json();let vals;try{vals=data(b)}catch(e){return error(e.message);}
  if(Number(b.fiscal_year)!==r.fiscal_year)return error("ห้ามเปลี่ยนปีสัญญา",409);
  if(clean(b.contract_no)!==r.contract_no)return error("ห้ามเปลี่ยนเลขที่สัญญาเดิม",409);
  await env.DB.prepare("UPDATE hospital_contract_register SET "+cols.map(k=>k+"=?").join(",")+",updated_at=? WHERE id=?").bind(...vals,new Date().toISOString(),id).run();
  return Response.json({item:await get(id),master_sync:false});
 }
 if(!sub&&method==="DELETE")return error("ยังไม่เปิดลบรายการในทะเบียนโรงพยาบาล",403);
 return error("ไม่รองรับคำขอ",405);
 }catch(e){return String(e?.message||e).includes("UNIQUE")?error("เลขที่สัญญานี้มีอยู่แล้ว",409):error("บันทึกหรืออ่านทะเบียนไม่สำเร็จ: "+String(e?.message||e),500);}
}
