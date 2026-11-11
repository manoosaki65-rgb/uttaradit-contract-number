# เอกสารแนบในระบบทะเบียนออกเลขที่สัญญาจังหวัด

## สถานะปัจจุบัน
- แก้ไขหน้าเว็บและ API แล้ว: แนบลิงก์ Google Drive/เอกสารเดิมได้โดยทันที
- อัปโหลด PDF, DOC, DOCX จากเครื่องพร้อมในโค้ด แต่จะถูกปิดไว้จนมี Cloudflare R2 + รหัสลับ เพื่อไม่ให้สัญญาถูกเปิดอ่านแบบสาธารณะ
- การเพิ่มคอลัมน์ `attachment_url` และ `attachment_name` กับตาราง `contract_register` ทำแบบเพิ่มอย่างเดียวโดย Worker เมื่อเรียก API ไม่ลบ/แก้ข้อมูลเดิม
- ตาราง `contract_files` เก็บชื่อไฟล์และคีย์อ้างอิง R2 แยกตามรหัสรายการสัญญา (รองรับหลายไฟล์ต่อสัญญา)
- ระบบจำกัดไฟล์ละ 15 MB

## เปิดใช้การอัปโหลดไฟล์จริง (ตั้งค่าครั้งเดียว)
1. เปิด Cloudflare Dashboard → R2 Object Storage → Create bucket: `uttaradit-contract-documents` ไม่ต้องเปิด Public Access
2. Cloudflare Workers → Worker `uttaradit-contract-number` → Settings → Bindings → Add binding → R2 bucket
   - Variable/Binding name: `CONTRACT_FILES`
   - Bucket: `uttaradit-contract-documents`
3. Workers → Settings → Variables and Secrets → Add **Secret**
   - Name: `CONTRACT_FILE_KEY`
   - Value: ตั้งรหัสสุ่มยาวที่เก็บไว้กับผู้ดูแลเท่านั้น (ห้ามใส่ไว้ในซอร์สโค้ดหรือแชต)
4. หาก Deploy จาก GitHub ด้วย Wrangler ให้เพิ่มใน `wrangler.jsonc` ก่อน deploy รอบถัดไป เพื่อไม่ให้ binding ถูกเขียนทับ:
   ```json
   "r2_buckets": [
     { "binding": "CONTRACT_FILES", "bucket_name": "uttaradit-contract-documents" }
   ]
   ```
   และคง `CONTRACT_FILE_KEY` เป็น Secret ใน Dashboard (ห้ามเพิ่มค่ารหัสลงไฟล์ config)
5. Redeploy/Restart Worker หากจำเป็น ตรวจ `/api/contracts/attachment-status` ต้องตอบ `upload_enabled: true`
6. เปิดทะเบียน เลือก PDF หรือ Word ได้หลายไฟล์ กรอกรหัสเดียวกันในช่องสำหรับไฟล์แนบ แล้วกดบันทึก
7. ทดสอบบนสัญญาที่มีอยู่ด้วยการแนบไฟล์ตัวอย่างที่ไม่เป็นความลับ เปิดไฟล์ และลบไฟล์ (ตรวจบนหน้าเว็บ ไม่ใช้ข้อมูลจริงในการทดสอบอัตโนมัติ)

## การใช้งานกับเอกสาร Google Drive เดิม
- เปิดไฟล์สัญญาใน Google Drive → Copy link → วางที่ช่อง 'ลิงก์เอกสารสัญญาใน Google Drive'
- ใส่ชื่อไฟล์ถ้าต้องการ แล้วบันทึกในหน้าเพิ่ม/แก้ไขสัญญา
- ตารางจะแสดงปุ่มเปิดลิงก์โดยตรง (เคารพสิทธิ์เข้าถึงที่กำหนดบน Google Drive)
- การบันทึกลิงก์ **ไม่ใช่** การคัดลอกไฟล์จาก Google Drive ไป R2
- ไม่ควรเปลี่ยนสิทธิ์ไฟล์ Drive เป็น 'ทุกคนที่มีลิงก์' โดยไม่จำเป็น

## ความปลอดภัย
- การอัปโหลด, เปิดและลบไฟล์ R2 ต้องใช้ `X-Contract-File-Key`; ไฟล์ R2 ไม่ได้ตั้งค่าเป็น public
- แอปทะเบียนเดิมยังเป็นเว็บที่เปิดหน้าได้จากลิงก์ ผู้ดูแลควรเปิด Cloudflare Access เพื่อจำกัดผู้ใช้สำหรับข้อมูลสัญญาและการแก้ทะเบียน
- หลีกเลี่ยงแนบไฟล์ที่มีข้อมูลส่วนบุคคลหรือข้อมูลธนาคารลงใน public Google Drive
- การลบทะเบียนสัญญาที่มีไฟล์อัปโหลดจะถูกระงับจนกว่าจะลบไฟล์แนบก่อน เพื่อไม่ให้เกิดไฟล์ค้าง
