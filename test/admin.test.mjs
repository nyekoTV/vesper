import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.mjs';
import {createIdentity,unlockIdentity,authenticationSecret,sealMessage} from '../public/crypto.mjs';
import {totp} from '../security.mjs';
const adminCode='Test-only-admin-code-2026!';
async function fixture(t){const directory=await mkdtemp(join(tmpdir(),'vesper-admin-')),origin='http://admin.test',app=createApp({databasePath:join(directory,'test.sqlite'),origin,requireEmailVerification:false,adminCode});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+app.server.address().port;t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});});
  async function request(path,{actor,data,method=data===undefined?'GET':'POST'}={}){const response=await fetch(base+path,{method,headers:{...(actor?{Cookie:actor.cookie}:{}),...(data===undefined?{}:{Origin:origin,'Content-Type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:response.status,result:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
  const domain=(await request('/api/config')).result.authDomain;
  async function register(username){const password='Test-private-password-'+username,identity=await createIdentity(password,username),authSecret=await authenticationSecret(password,username,domain),response=await request('/api/auth/register',{data:{username,email:username+'@example.test',authSecret,...identity,is_admin:true}});assert.equal(response.status,201);return {id:response.result.me.id,username,cookie:response.cookie,authSecret,identity,keys:await unlockIdentity(password,username,identity.vault),state:response.result};}
  return {app,request,register};
}
test('admin authorization, temporary elevation, moderation and audit',async t=>{
  const {app,request,register}=await fixture(t),nyeko=await register('nyeko'),bob=await register('bob'),carol=await register('carol');let spaceId,channelId;
  await t.test('a username or forged registration field does not grant administration',async()=>{assert.equal(nyeko.state.account.administrator,false);assert.equal((await request('/api/admin/status',{actor:nyeko})).status,403);app.db.prepare('UPDATE users SET is_admin=1 WHERE id=?').run(nyeko.id);assert.equal((await request('/api/admin/status',{actor:nyeko})).result.unlocked,false);assert.equal((await request('/api/admin/dashboard',{actor:nyeko})).status,403);assert.equal((await request('/api/admin/unlock',{actor:bob,data:{code:adminCode,authSecret:bob.authSecret}})).status,403);});
  await t.test('admin code plus password are required and secrets are hashed',async()=>{
    assert.equal((await request('/api/admin/unlock',{actor:nyeko,data:{code:'Wrong-but-long-code',authSecret:nyeko.authSecret}})).status,401);
    assert.equal((await request('/api/admin/unlock',{actor:nyeko,data:{code:adminCode,authSecret:'x'.repeat(44)}})).status,401);
    const unlocked=await request('/api/admin/unlock',{actor:nyeko,data:{code:adminCode,authSecret:nyeko.authSecret}});assert.equal(unlocked.status,200);assert.ok(unlocked.result.expires>Date.now());assert.ok(!app.db.prepare('SELECT value FROM settings WHERE key=?').get('admin_code_hash').value.includes(adminCode));
    const dashboard=(await request('/api/admin/dashboard',{actor:nyeko})).result;assert.equal(dashboard.counts.users,3);assert.equal(dashboard.accounts.find(user=>user.id===nyeko.id).administrator,true);assert.ok(!JSON.stringify(dashboard).includes(nyeko.authSecret));assert.ok(!JSON.stringify(dashboard).includes(nyeko.identity.vault.ciphertext));assert.ok(!JSON.stringify(dashboard).includes(adminCode));
  });
  await t.test('elevation is bound to a session and expires after fifteen minutes',async()=>{
    const other=await request('/api/auth/login',{data:{username:'nyeko',authSecret:nyeko.authSecret}});assert.equal(other.status,200);assert.equal((await request('/api/admin/dashboard',{actor:{cookie:other.cookie}})).status,403);
    app.db.prepare('UPDATE sessions SET admin_expires=0 WHERE admin_expires>0').run();assert.equal((await request('/api/admin/dashboard',{actor:nyeko})).status,403);app.db.prepare('UPDATE sessions SET admin_expires=? WHERE user_id=?').run(Date.now()+900000,nyeko.id);
  });
  await t.test('suspension revokes access, excludes recipients and protects the admin',async()=>{
    const created=await request('/api/spaces',{actor:nyeko,data:{name:'Community',icon:'✦'}});spaceId=created.result.spaceId;channelId=(await request('/api/state',{actor:nyeko})).result.spaces[0].channels.find(room=>room.kind==='text').id;const invitation=await request('/api/spaces/'+spaceId+'/invites',{actor:nyeko,data:{}});await request('/api/join',{actor:bob,data:{token:invitation.result.token}});
    assert.equal((await request('/api/admin/users/'+nyeko.id+'/suspend',{actor:nyeko,data:{suspended:true}})).status,403);
    assert.equal((await request('/api/admin/users/'+bob.id+'/suspend',{actor:nyeko,data:{suspended:true}})).status,200);assert.equal((await request('/api/state',{actor:bob})).status,401);assert.equal((await request('/api/auth/login',{data:{username:'bob',authSecret:bob.authSecret}})).status,403);assert.equal((await request('/api/channels/'+channelId+'/recipients',{actor:nyeko})).result.users.some(user=>user.id===bob.id),false);
    await request('/api/admin/users/'+bob.id+'/suspend',{actor:nyeko,data:{suspended:false}});const login=await request('/api/auth/login',{data:{username:'bob',authSecret:bob.authSecret}});assert.equal(login.status,200);bob.cookie=login.cookie;await request('/api/admin/users/'+carol.id+'/sessions',{actor:nyeko,data:{}});assert.equal((await request('/api/state',{actor:carol})).status,401);
  });
  await t.test('admin edits community metadata and moderates without plaintext access',async()=>{
    assert.equal((await request('/api/admin/spaces/'+spaceId,{actor:nyeko,data:{name:'Renamed',icon:'✳'},method:'PATCH'})).status,200);assert.equal((await request('/api/admin/channels/'+channelId,{actor:nyeko,data:{name:'news',topic:'Hello'},method:'PATCH'})).status,200);
    const roster=(await request('/api/channels/'+channelId+'/recipients',{actor:nyeko})).result,id=crypto.randomUUID(),payload=await sealMessage({text:'This is a private encrypted sentence.'},{id,channelId,authorId:nyeko.id},roster.users,nyeko.keys);assert.equal((await request('/api/channels/'+channelId+'/messages',{actor:nyeko,data:{payload,rosterHash:roster.hash}})).status,201);
    const dashboard=(await request('/api/admin/dashboard',{actor:nyeko})).result;assert.ok(!JSON.stringify(dashboard).includes('This is a private encrypted sentence.'));assert.equal(dashboard.messages[0].payload,undefined);assert.equal((await request('/api/admin/messages/'+id,{actor:nyeko,data:{},method:'DELETE'})).status,200);assert.equal((await request('/api/channels/'+channelId+'/messages',{actor:bob})).result.messages.length,0);assert.ok((await request('/api/admin/dashboard',{actor:nyeko})).result.audit.some(entry=>entry.action==='message_deleted'));
  });
  await t.test('instance controls actually close registrations and pause community writes',async()=>{
    assert.equal((await request('/api/admin/settings',{actor:nyeko,data:{registrationOpen:false,maintenance:true,announcement:'Test notice'},method:'PATCH'})).status,200);assert.equal((await request('/api/auth/register',{data:{}})).status,403);assert.equal((await request('/api/spaces',{actor:bob,data:{name:'blocked'}})).status,503);assert.equal((await request('/api/state',{actor:bob})).result.instance.announcement,'Test notice');assert.equal((await request('/api/admin/settings',{actor:nyeko,data:{registrationOpen:true,maintenance:false,announcement:''},method:'PATCH'})).status,200);
  });
  await t.test('code rotation locks old elevations and the old code no longer works',async()=>{
    const next='Changed-admin-code-for-tests!';assert.equal((await request('/api/admin/code',{actor:nyeko,data:{code:' '.repeat(30),authSecret:nyeko.authSecret},method:'PATCH'})).status,400);
    assert.equal((await request('/api/admin/code',{actor:nyeko,data:{code:next,authSecret:nyeko.authSecret},method:'PATCH'})).status,200);assert.equal((await request('/api/admin/dashboard',{actor:nyeko})).status,403);assert.equal((await request('/api/admin/unlock',{actor:nyeko,data:{code:adminCode,authSecret:nyeko.authSecret}})).status,401);assert.equal((await request('/api/admin/unlock',{actor:nyeko,data:{code:next,authSecret:nyeko.authSecret}})).status,200);assert.equal((await request('/api/admin/lock',{actor:nyeko,data:{}})).status,200);assert.equal((await request('/api/admin/dashboard',{actor:nyeko})).status,403);
  });
});
test('admin elevation also requires the second factor when A2F is enabled',async t=>{
  const {app,request,register}=await fixture(t),nyeko=await register('nyeko');app.db.prepare('UPDATE users SET is_admin=1 WHERE id=?').run(nyeko.id);const setup=await request('/api/account/mfa/setup',{actor:nyeko,data:{authSecret:nyeko.authSecret}}),enabled=await request('/api/account/mfa/enable',{actor:nyeko,data:{code:totp(setup.result.secret)}});assert.equal(enabled.status,200);
  assert.equal((await request('/api/admin/unlock',{actor:nyeko,data:{code:adminCode,authSecret:nyeko.authSecret}})).status,401);assert.equal((await request('/api/admin/unlock',{actor:nyeko,data:{code:adminCode,authSecret:nyeko.authSecret,otp:enabled.result.recoveryCodes[0]}})).status,200);
});
