# เปิดการแนบ PDF/Word จากตารางสัญญา ปีงบประมาณ 2570

เว็บเดิม: https://uttaradit-contract-number.manoosaki65.workers.dev/

## ขอบเขตที่เตรียมไว้
- ใช้ Worker เดิม `uttaradit-contract-number` และ D1 เดิม ไม่สร้างเว็บ/DB ใหม่
- R2 binding: `CONTRACT_FILES`
- R2 bucket name: `uttaradit-contract-documents-2570`
- Secret: `CONTRACT_FILE_KEY` ต้องเป็นค่า Secret **ไม่เก็บใน GitHub**
- Backend มี API `GET /api/contracts/attachment-status`, `POST /api/contracts/:id/files`, `GET/DELETE /api/contracts/:id/files/:fileId`
- บันทึกไฟล์ที่ `contracts/<contract_id>/<uuid>.<extension>`; เก็บ metadata ใน D1 `contract_files`
- หน้าตารางมีปุ่มแนบและ drag/drop ต่อแถว; ตรวจ upload_enabled ก่อนใช้
- ไม่มีการแก้ไขรายการสัญญาปี 2569

## ขั้นตอน deploy (หลังได้สิทธิ์ Cloudflare)
1. ตรวจบัญชี Cloudflare ว่าเป็นเจ้าของ Worker `uttaradit-contract-number`.
2. เปิด R2, ตรวจว่ามี bucket `uttaradit-contract-documents-2570` หรือไม่ ถ้าไม่มีจึงสร้างขึ้นใหม่.
3. ตรวจ Worker > Settings > Bindings เพิ่ม `R2 bucket`: variable `CONTRACT_FILES` เลือก bucket ด้านบน.
4. เปิด Worker > Settings > Variables and Secrets > Add > Secret ตั้งชื่อ `CONTRACT_FILE_KEY` พร้อมค่าลับที่สุ่มขึ้นอย่างปลอดภัย (ห้ามโพสต์ลงแชตหรือ commit).
5. Deploy Worker เดิมจาก source ที่รวมการตั้งค่า `wrangler.jsonc` ใน branch นี้ (โปรดเช็ก secret ที่มีอยู่ก่อน; ห้ามทับ `MASTER_SYNC_TOKEN`).
6. Verify `/api/contracts/attachment-status` ต้องตอบ `upload_enabled:true`.
7. ใช้รายการสัญญาทดสอบหรือสร้างรายการทดสอบโดยไม่แก้ข้อมูลจริง ทดสอบ drag/drop PDF ขนาดเล็ก สังเกตว่ามีลิงก์ไฟล์ในแถวเดิมและเปิดกลับได้.
8. ตรวจไฟล์ใน bucket, metadata `contract_files`, และ sync Master ไม่ถูกกระทบ.

## ข้อควรระวัง
- ห้ามตั้งค่า Bucket เป็นสาธารณะ เพราะไฟล์สัญญาอาจมีข้อมูลคู่สัญญา
- ห้าม deploy config binding ถ้า R2 bucket ยังไม่ถูกสร้าง
- การอัปโหลดใช้ไฟล์ไม่เกิน 15 MB และรองรับ PDF, DOC, DOCX
- ปุ่มในหน้าเว็บยังใช้งานไม่ได้จนกว่า R2 + secret + deploy ครบ
