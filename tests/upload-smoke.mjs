// Real production-image regression, using only a disposable CI container.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

assert.equal(process.env.NAKHL_UPLOAD_SMOKE, '1', 'This test is for disposable CI data only');
const container = 'nakhl-validation';
const origin = 'http://127.0.0.1:8080';
const adminToken = randomBytes(32).toString('hex');
const userToken = randomBytes(32).toString('hex');
const fixture = `
const {createClient} = await import('@libsql/client');
const db = createClient({url:'file:/app/data/nakhl.db'});
const tables=(await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_nakhl_migrations'")).rows;
for (const {name} of tables) {
  if(Number((await db.execute('SELECT COUNT(*) AS n FROM "'+name+'"')).rows[0].n)!==0) throw Error('Fresh boot inserted data into '+name);
}
// Fixtures exist only in the disposable CI container; never production startup.
await db.executeMultiple('CREATE TABLE IF NOT EXISTS ci_fixture_marker (id TEXT PRIMARY KEY);');
await db.execute({sql:'INSERT INTO AdminUser (id,username,passwordHash) VALUES (?,?,?)',args:['ci-admin','ci-admin','not-a-login-hash']});
await db.execute({sql:'INSERT INTO Category (id,name,slug) VALUES (?,?,?)',args:['ci-category','CI only','ci-only']});
await db.execute({sql:'INSERT INTO MenuItem (id,name,price,categoryId,updatedAt) VALUES (?,?,?,?,?)',args:['ci-menu','CI only',1000,'ci-category',new Date().toISOString()]});
const admin = {id:'ci-admin'};
const menu = (await db.execute('SELECT id FROM MenuItem LIMIT 1')).rows[0];
if (!menu) throw Error('CI fixture missing');
const expires = new Date(Date.now()+3600000).toISOString();
await db.execute({sql:'INSERT INTO AdminSession (id,token,adminId,expiresAt) VALUES (?,?,?,?)',args:['ci-upload-admin',${JSON.stringify(adminToken)},admin.id,expires]});
await db.execute({sql:'INSERT INTO User (id,phone,updatedAt) VALUES (?,?,?)',args:['ci-upload-user','09990000000',new Date().toISOString()]});
await db.execute({sql:'INSERT INTO Session (id,token,userId,expiresAt) VALUES (?,?,?,?)',args:['ci-upload-session',${JSON.stringify(userToken)},'ci-upload-user',expires]});
console.log(JSON.stringify({menuId:menu.id}));
db.close();`;
const {menuId} = JSON.parse(execFileSync('docker',['exec','-i',container,'node','--input-type=module'],{input:fixture,encoding:'utf8'}));
const adminCookie = `nakhl_admin=${adminToken}`;
const userCookie = `nakhl_session=${userToken}`;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5uQAAAAASUVORK5CYII=','base64');
function form(field='file', type='image/png', bytes=png) {
  const fd = new FormData();
  fd.append(field,new Blob([bytes],{type}),'ci.png');
  return fd;
}
async function request(path, options={}) {
  return fetch(origin+path,{...options,signal:AbortSignal.timeout(20000)});
}
async function upload(path, cookie, fd) {
  const res=await request(path,{method:'POST',headers:{cookie},body:fd});
  const data=await res.json();
  assert.equal(res.status,200,JSON.stringify(data));
  assert.equal(data.success,true,JSON.stringify(data));
  return data;
}
async function readImage(url) {
  assert.match(url,/^\/f\/(food|avatar|general)-[0-9a-f-]{36}\.png$/);
  const res=await request(url);
  assert.equal(res.status,200);
  assert.match(res.headers.get('content-type'),/image\/png/);
  assert.deepEqual(Buffer.from(await res.arrayBuffer()),png);
}
for (const path of ['/api/admin/upload','/api/profile/avatar','/api/admin/ai/test']) {
  assert.equal((await request(path,{method:'POST',body:form()})).status,401,`Auth/route regression: ${path}`);
}
const foodForm=form(); foodForm.append('kind','food');
const food=await upload('/api/admin/upload',adminCookie,foodForm);
const general=await upload('/api/admin/upload',adminCookie,form());
const avatar=await upload('/api/profile/avatar',userCookie,form());
const gallery=await upload(`/api/admin/menu/${menuId}/gallery`,adminCookie,form('files'));
assert.equal(gallery.urls.length,1);
const updated=await request(`/api/admin/menu/${menuId}`,{method:'PUT',headers:{cookie:adminCookie,'content-type':'application/json'},body:JSON.stringify({imageUrl:food.url,gallery:gallery.urls})});
const saved=await updated.json();
assert.equal(updated.status,200,JSON.stringify(saved));
assert.deepEqual(saved.item.gallery,gallery.urls);
const urls=[food.url,general.url,avatar.url,...gallery.urls];
for(const url of urls) await readImage(url);
for (const body of [form('file','text/plain'),form('file','image/png',Buffer.alloc(5*1024*1024+1)),new FormData()]) {
  const res=await request('/api/admin/upload',{method:'POST',headers:{cookie:adminCookie},body});
  assert.equal(res.status,400);
  assert.equal((await res.json()).success,false);
}
assert.equal((await request('/f/invalid-key.png')).status,404);
const snapshotScript = `
const {createClient}=await import('@libsql/client');
const {snapshotData}=await import('./scripts/data-integrity.mjs');
const db=createClient({url:'file:/app/data/nakhl.db'});
console.log(JSON.stringify([...await snapshotData(db)]));db.close();`;
const snapshot=()=>execFileSync('docker',['exec','-i',container,'node','--input-type=module'],{input:snapshotScript,encoding:'utf8'}).trim();
const beforeRestart=snapshot();
execFileSync('docker',['restart',container],{stdio:'pipe'});
let ready=false;
for(let n=0;n<60;n++) {
  try { ready=(await request('/api/health')).ok; } catch {}
  if(ready) break;
  await new Promise(resolve=>setTimeout(resolve,1000));
}
assert.equal(ready,true,'App did not recover after restart');
assert.equal(snapshot(),beforeRestart,'Restart modified existing records or inserted seed data');
for(const url of urls) await readImage(url);
const verify = `
const {createClient}=await import('@libsql/client');
const db=createClient({url:'file:/app/data/nakhl.db'});
console.log(JSON.stringify({
 menu:(await db.execute({sql:'SELECT imageUrl,gallery FROM MenuItem WHERE id=?',args:[${JSON.stringify(menuId)}]})).rows[0],
 user:(await db.execute("SELECT avatarUrl FROM User WHERE id='ci-upload-user'")).rows[0],
 uploads:(await db.execute("SELECT COUNT(*) AS count FROM Upload WHERE uploadedBy LIKE 'admin:%' OR uploadedBy='ci-upload-user'")).rows[0]
}));db.close();`;
const stored=JSON.parse(execFileSync('docker',['exec','-i',container,'node','--input-type=module'],{input:verify,encoding:'utf8'}));
assert.equal(stored.menu.imageUrl,food.url);
assert.deepEqual(JSON.parse(stored.menu.gallery),gallery.urls);
assert.equal(stored.user.avatarUrl,avatar.url);
assert.equal(Number(stored.uploads.count),4);
console.log('PASS: authenticated food/CMS/avatar/gallery uploads, /f/ bytes, gallery save, invalid input, and restart persistence');
