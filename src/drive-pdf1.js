const FOLDER = '1kQ-UinublxbMtc2iPfoQaLnv954sg3ct';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.metadata.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

function json(data,status=200) {
  return Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
}

async function authorizeDrive(secret) {
  const account=JSON.parse(secret);
  if (!account.client_email || !account.private_key) throw new Error('Invalid Drive credential');
  const encode=value=>base64url(new TextEncoder().encode(JSON.stringify(value)));
  const now=Math.floor(Date.now()/1000);
  const assertion=encode({alg:'RS256',typ:'JWT'})+'.'+encode({
    iss:account.client_email,scope:DRIVE_SCOPE,aud:TOKEN_URL,iat:now,exp:now+300
  });
  const key=await crypto.subtle.importKey('pkcs8',
    Uint8Array.from(atob(account.private_key.replace(/-----[^-]+-----|\s/g,'')),c=>c.charCodeAt(0)),
    {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(assertion));
  const response=await fetch(TOKEN_URL,{method:'POST',body:new URLSearchParams({
    grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:assertion+'.'+base64url(new Uint8Array(signature))
  }),signal:AbortSignal.timeout(10000)});
  const data=await response.json();
  if (!response.ok || !data.access_token) throw new Error('Drive service account authentication failed');
  return data.access_token;
}

async function listDrivePdfs(token) {
  const headers={Authorization:'Bearer '+token};
  const folder=await fetch('https://www.googleapis.com/drive/v3/files/'+FOLDER+'?supportsAllDrives=true&fields=id,mimeType,trashed,driveId',
    {headers,signal:AbortSignal.timeout(10000)});
  if (!folder.ok) throw new Error('Drive folder access denied');
  const metadata=await folder.json();
  if (metadata.id!==FOLDER || metadata.mimeType!=='application/vnd.google-apps.folder' || metadata.trashed) throw new Error('Drive folder unavailable');
  const files=[];
  const params=new URLSearchParams({
    q:"'"+FOLDER+"' in parents and trashed = false and mimeType = 'application/pdf'",
    fields:'nextPageToken,incompleteSearch,files(id,name,resourceKey)',pageSize:'1000',supportsAllDrives:'true',includeItemsFromAllDrives:'true'
  });
  if (metadata.driveId) {
    params.set('corpora','drive');
    params.set('driveId',metadata.driveId);
  }
  do {
    const response=await fetch('https://www.googleapis.com/drive/v3/files?'+params,{headers,signal:AbortSignal.timeout(10000)});
    const page=await response.json();
    if (!response.ok || page.incompleteSearch || !Array.isArray(page.files)) throw new Error('Drive file list unavailable');
    files.push(...page.files);
    if (!page.nextPageToken) return files;
    params.set('pageToken',page.nextPageToken);
  } while (true);
}

export async function matchPdf1(db,files) {
  const groups=new Map();
  for (const file of files) {
    if (!/^[\w-]+$/.test(file.id||'')) continue;
    const match=/^\s*(25\d{2})\s*-\s*(\d{1,5})\s*-\s*ค\.pdf\s*$/iu.exec(file.name);
    if (!match || !Number(match[2])) continue;
    const year=Number(match[1]), no=String(Number(match[2]));
    const key=no+'/'+year;
    const group=groups.get(key)||{year,no,files:[]};
    if (!group.files.some(previous=>previous.id===file.id)) group.files.push(file);
    groups.set(key,group);
  }
  const blank="TRIM(COALESCE(r.attachment_url,''))=''";
  const legacy="NOT EXISTS(SELECT 1 FROM contract_files f WHERE f.contract_id=CAST(r.id AS TEXT) AND LOWER(f.file_name) NOT LIKE '%ตรวจรับ%' AND LOWER(f.file_name) NOT LIKE '%pdf2%')";
  const normalized="COALESCE(NULLIF(TRIM(r.contract_number),''),TRIM(r.registration_number))";
  const matching=`r.fiscal_year=? AND LTRIM(${normalized},'0') IN (?,?)`;
  const candidates=new Map();
  for (const year of new Set([...groups.values()].map(group=>group.year))) {
    const rows=await db.prepare(`SELECT r.rowid AS row_id,${normalized} AS number,
      CASE WHEN ${blank} AND ${legacy} THEN 0 ELSE 1 END AS has_file
      FROM contract_register r WHERE r.fiscal_year=?`).bind(year).all();
    for (const row of rows.results||[]) {
      const parsed=/^(\d+)(?:\/(25\d{2}))?$/.exec(String(row.number));
      if (!parsed || (parsed[2]&&Number(parsed[2])!==year)) continue;
      const key=Number(parsed[1])+'/'+year;
      const found=candidates.get(key)||[];
      found.push(row);
      candidates.set(key,found);
    }
  }
  const summary={attached:[],alreadyAttached:[],notFound:[],ambiguous:[]};
  const updates=[];
  for (const [key,group] of groups) {
    const rows=candidates.get(key)||[];
    if (!rows.length) { summary.notFound.push(key); continue; }
    if (rows.length!==1) { summary.ambiguous.push(key); continue; }
    if (rows[0].has_file) { summary.alreadyAttached.push(key); continue; }
    if (group.files.length!==1) { summary.ambiguous.push(key); continue; }
    const [file]=group.files;
    const url=new URL('https://drive.google.com/file/d/'+file.id+'/view');
    if (file.resourceKey) url.searchParams.set('resourcekey',file.resourceKey);
    updates.push({key,statement:db.prepare(`UPDATE contract_register AS r SET attachment_url=?, attachment_name=?,
       updated_at=? WHERE rowid=? AND ${matching} AND ${blank} AND ${legacy}
       AND (SELECT COUNT(*) FROM contract_register r WHERE ${matching})=1`).bind(url.href,file.name,
         new Date().toISOString(),rows[0].row_id,group.year,group.no,key,group.year,group.no,key)});
  }
  for (let offset=0;offset<updates.length;offset+=40) {
    const batch=updates.slice(offset,offset+40);
    const results=await db.batch(batch.map(update=>update.statement));
    for (const [i,result] of results.entries()) {
      summary[result.meta?.changes===1?'attached':'ambiguous'].push(batch[i].key);
    }
  }
  return summary;
}

export async function importDrivePdf1(request,env) {
  if (!env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON || !env.PDF1_IMPORT_KEY) return json({
    error:'ยังไม่ได้ตั้งค่า Google Drive และรหัสนำเข้า PDF1 ที่ Cloudflare'
  },503);
  if (request.headers.get('Origin')!==new URL(request.url).origin || request.headers.get('X-PDF1-Import-Key')!==env.PDF1_IMPORT_KEY)
    return json({error:'รหัสนำเข้า PDF1 ไม่ถูกต้อง'},403);
  let files;
  try { files=await listDrivePdfs(await authorizeDrive(env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON)); }
  catch (error) {
    console.error('PDF1 Drive access failed',error.message);
    return json({error:'อ่าน Google Drive ไม่ได้ กรุณาตรวจสิทธิ์ดูโฟลเดอร์ของบัญชีบริการ'},502);
  }
  return json(await matchPdf1(env.DB,files));
}
