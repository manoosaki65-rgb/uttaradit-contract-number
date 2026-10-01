import { db } from "hatchable";
export const access = "public";
export const methods = ["PUT","DELETE"];
export default async function(req,res){
const id=req.params.id;
if(req.method==="DELETE"){await db.query("DELETE FROM contract_numbers WHERE id=$1",[id]);return res.json({ok:true});}
const b=req.body||{};
if(!b.contract_no||!b.subject)return res.status(400).json({error:"กรุณากรอกเลขที่สัญญาและรายการ"});
try{
const {rows}=await db.query("UPDATE contract_numbers SET contract_no=$1,fiscal_year=$2,contract_date=$3,subject=$4,vendor=$5,amount=$6,inventory_no=$7,buyer=$8,fund_source=$9,note=$10,updated_at=now() WHERE id=$11 RETURNING *",[String(b.contract_no).trim(),Number(b.fiscal_year||2569),String(b.contract_date||""),String(b.subject||""),String(b.vendor||""),b.amount===""||b.amount==null?null:Number(b.amount),String(b.inventory_no||""),String(b.buyer||""),String(b.fund_source||""),String(b.note||""),id]);
if(!rows[0])return res.status(404).json({error:"ไม่พบรายการ"});return res.json({item:rows[0]});
}catch(e){if(String(e.message).toLowerCase().includes("unique"))return res.status(409).json({error:"เลขที่สัญญานี้มีอยู่แล้ว"});throw e;}
}