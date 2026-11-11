const ALLOWED = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
};
const MAX_BYTES = 15 * 1024 * 1024;
const error = (message, status = 400) => Response.json({error: message}, {status});

export async function ensureAttachmentSchema(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS contract_files (id TEXT PRIMARY KEY, contract_id TEXT NOT NULL, file_name TEXT NOT NULL, content_type TEXT NOT NULL, byte_size INTEGER NOT NULL, object_key TEXT NOT NULL, created_at TEXT NOT NULL)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_contract_files_contract ON contract_files(contract_id)").run();
}

export async function filesForRows(env, rows) {
  const {results = []} = await env.DB.prepare("SELECT id, contract_id, file_name, content_type, byte_size, created_at FROM contract_files ORDER BY created_at DESC").all();
  const grouped = new Map();
  for (const f of results) {
    if (!grouped.has(String(f.contract_id))) grouped.set(String(f.contract_id), []);
    grouped.get(String(f.contract_id)).push({
      id: f.id, file_name: f.file_name, content_type: f.content_type,
      byte_size: f.byte_size, created_at: f.created_at
    });
  }
  return rows.map(r => ({...r, files: grouped.get(String(r.id)) || []}));
}

export async function handleAttachmentRequest(request, env, path) {
  if (path === "/api/contracts/attachment-status" && request.method === "GET") {
    return Response.json({upload_enabled: Boolean(env.CONTRACT_FILES && env.CONTRACT_FILE_KEY), max_mb: 15, link_enabled: true});
  }
  const match = path.match(/^\/api\/contracts\/([^/]+)\/files(?:\/([^/]+))?$/);
  if (!match) return null;
  const contractId = decodeURIComponent(match[1]);
  const fileId = match[2] ? decodeURIComponent(match[2]) : null;
  if (!env.CONTRACT_FILES || !env.CONTRACT_FILE_KEY)
    return error("ยังไม่ได้เปิดพื้นที่เก็บไฟล์ R2 และตั้งรหัสป้องกันไฟล์", 503);
  if (request.headers.get("X-Contract-File-Key") !== env.CONTRACT_FILE_KEY)
    return error("รหัสเข้าถึงไฟล์ไม่ถูกต้อง", 403);

  if (request.method === "POST" && !fileId) {
    const contract = await env.DB.prepare("SELECT id FROM contract_register WHERE CAST(id AS TEXT)=? LIMIT 1").bind(contractId).first();
    if (!contract) return error("ไม่พบรายการสัญญา", 404);
    const form = await request.formData();
    const file = form.get("file");
    if (!file || typeof file.arrayBuffer !== "function") return error("กรุณาเลือกไฟล์");
    const originalName = String(file.name || "document").slice(0, 240);
    const extension = originalName.split(".").pop().toLowerCase();
    if (!ALLOWED[extension]) return error("รองรับเฉพาะ PDF, DOC และ DOCX");
    if (file.size < 1 || file.size > MAX_BYTES) return error("ไฟล์ต้องมีขนาดไม่เกิน 15 MB");
    const id = crypto.randomUUID();
    const objectKey = "contracts/" + encodeURIComponent(contractId) + "/" + id + "." + extension;
    const type = ALLOWED[extension];
    await env.CONTRACT_FILES.put(objectKey, file.stream(), {httpMetadata: {contentType: type}});
    try {
      await env.DB.prepare("INSERT INTO contract_files(id,contract_id,file_name,content_type,byte_size,object_key,created_at) VALUES(?,?,?,?,?,?,?)")
        .bind(id, contractId, originalName, type, file.size, objectKey, new Date().toISOString()).run();
    } catch (e) {
      await env.CONTRACT_FILES.delete(objectKey);
      throw e;
    }
    return Response.json({ok: true, file: {id, contract_id: contractId, file_name: originalName, byte_size: file.size, content_type: type}}, {status: 201});
  }
  if (fileId && (request.method === "GET" || request.method === "DELETE")) {
    const file = await env.DB.prepare("SELECT * FROM contract_files WHERE id=? AND contract_id=?").bind(fileId, contractId).first();
    if (!file) return error("ไม่พบไฟล์ในรายการนี้", 404);
    if (request.method === "DELETE") {
      await env.CONTRACT_FILES.delete(file.object_key);
      await env.DB.prepare("DELETE FROM contract_files WHERE id=? AND contract_id=?").bind(fileId, contractId).run();
      return Response.json({ok: true});
    }
    const obj = await env.CONTRACT_FILES.get(file.object_key);
    if (!obj) return error("ไม่พบไฟล์ต้นฉบับในพื้นที่จัดเก็บ", 404);
    const filename = encodeURIComponent(file.file_name);
    const disposition = file.content_type === "application/pdf" ? "inline" : "attachment";
    return new Response(obj.body, {headers: {
      "Content-Type": file.content_type,
      "Content-Disposition": disposition + "; filename*=UTF-8''" + filename,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store"
    }});
  }
  return error("Method not allowed", 405);
}