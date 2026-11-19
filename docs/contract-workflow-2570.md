# การส่งและรับแฟ้มสัญญา
- เพิ่มปุ่ม ส่งสัญญา (จัดซื้อ) และ รับสัญญา (พัสดุ) ในตารางเดิม
- บันทึกเวลาส่งและรับใน D1 (sent_at, received_at) เฉพาะปีงบ 2570 ไม่ลบหรือแก้ข้อมูลเดิม
- ต้องส่งก่อนรับ; แต่ละขั้นตอนบันทึกได้ครั้งเดียว; เวลาอิง server แสดงตาม Asia/Bangkok
- ระบบรักษาลิงก์เอกสาร PDF และปุ่มแนบเอกสารเดิม
- API: PATCH /api/contracts/:id/workflow, body action=send หรือ receive
- ต้องตั้งค่า Cloudflare Worker secrets: CONTRACT_SEND_KEY และ CONTRACT_RECEIVE_KEY (คนละค่า) ก่อนใช้งานปุ่ม
- ตรวจสอบการเชื่อม Deploy จาก GitHub กับ Worker จริง และทดสอบก่อน merge / deploy
- วันที่ส่ง/รับยังบันทึกเฉพาะ D1; Master Google Sheet ยังไม่ได้เพิ่มคอลัมน์สำหรับวันที่ส่ง/รับ
