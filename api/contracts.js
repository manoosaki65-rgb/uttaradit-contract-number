import { db } from "hatchable";
export const access = "public";
export const methods = ["GET","POST"];
export default async function(req,res){
if(req.method==="GET"){
const year=Number(req.query.year||2569);
const {rows}=await db.query("SELECT * FROM contract_numbers WHERE fiscal_year=$1 ORDER BY split_part(contract_no,'/',1)::int DESC, created_at DESC",[year]);
const mx=await db.query("SELECT COALESCE(MAX(split_part(contract_no,'/',1)::int),0)::int AS n FROM contract_numbers WHERE fiscal_year=$1",[year]);
return res.json({items:rows,next:(mx.rows[0].n||0)+1,year});
}
const b=req.body||{}; const no=String(b.contract_no||"").trim(); const year=Number(b.fiscal_year||2569);
if(!no||!b.subject)return res.status(400).json({error:"กรุณากรอกเลขที่สัญญาและรายการ"});
try{
const {rows}=await db.query("INSERT INTO contract_numbers(contract_no,fiscal_year,contract_date,subject,vendor,amount,inventory_no,buyer,fund_source,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",[no,year,String(b.contract_date||""),String(b.subject||""),String(b.vendor||""),b.amount===""||b.amount==null?null:Number(b.amount),String(b.inventory_no||""),String(b.buyer||""),String(b.fund_source||""),String(b.note||"")]);
return res.status(201).json({item:rows[0]});
}catch(e){if(String(e.message).toLowerCase().includes("unique"))return res.status(409).json({error:"เลขที่สัญญานี้มีอยู่แล้ว"});throw e;}
}