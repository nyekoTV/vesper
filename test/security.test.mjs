import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createApp} from '../server.mjs';
import {totp,encodeBase32,normalizeEmail} from '../security.mjs';
import {createIdentity,authenticationSecret} from '../public/crypto.mjs';
test('TOTP follows RFC 6238 vectors and email normalization rejects malformed input',()=>{const secret=encodeBase32(Buffer.from('12345678901234567890'));for(const [time,expected]of [[59,'94287082'],[1111111109,'07081804'],[1111111111,'14050471'],[1234567890,'89005924'],[2000000000,'69279037'],[20000000000,'65353130']])assert.equal(totp(secret,time*1000,8),expected);assert.equal(normalizeEmail(' Alice@Example.Test '),'alice@example.test');for(const invalid of ['not-an-email','a@localhost','a\n@example.test','a..b@example.test'])assert.throws(()=>normalizeEmail(invalid));});
test('email confirmation, restricted access, MFA, recovery codes and notifications metadata',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'vesper-security-')),delivered=[],origin='http://secure.test',application=createApp({databasePath:join(directory,'test.sqlite'),origin,sendVerificationEmail:async message=>delivered.push(message)});
  await new Promise(resolve=>application.server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+application.server.address().port;
  t.after(async()=>{await application.close();await rm(directory,{recursive:true,force:true});});
  let cookie;async function request(path,data,method=data===undefined?'GET':'POST'){const response=await fetch(base+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(data===undefined?{}:{Origin:origin,'Content-Type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:response.status,result:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
  const config=(await request('/api/config')).result,identity=await createIdentity('A-strong-test-passphrase','alice'),authSecret=await authenticationSecret('A-strong-test-passphrase','alice',config.authDomain),registration={username:'alice',email:'ALICE@example.test',authSecret,...identity};
  await t.test('email is mandatory, validated, unique, private and initially unverified',async()=>{
    assert.equal((await request('/api/auth/register',{...registration,email:undefined})).status,400);assert.equal((await request('/api/auth/register',{...registration,email:'broken'})).status,400);
    const created=await request('/api/auth/register',registration);assert.equal(created.status,201);cookie=created.cookie;assert.equal(created.result.account.email,'alice@example.test');assert.equal(created.result.account.emailVerified,false);assert.equal(created.result.me.email,undefined);assert.equal(delivered.length,1);assert.equal(created.result.verificationSent,true);
    assert.equal((await request('/api/auth/register',{...registration,username:'other'})).status,409);assert.equal((await request('/api/spaces',{name:'Blocked',icon:'✦'})).status,403);
    assert.equal((await request('/api/account/email/send',{})).status,429);
  });
  await t.test('wrong, expired and replayed email codes fail; correct confirmation unlocks access',async()=>{
    const code=delivered[0].code,wrong=code==='000000'?'111111':'000000';assert.equal((await request('/api/account/email/verify',{code:wrong})).status,400);
    application.db.prepare('UPDATE email_challenges SET expires=0').run();assert.equal((await request('/api/account/email/verify',{code})).status,400);application.db.prepare('UPDATE email_challenges SET expires=?').run(Date.now()+900000);
    const verified=await request('/api/account/email/verify',{code});assert.equal(verified.status,200);assert.equal(verified.result.account.emailVerified,true);assert.equal((await request('/api/account/email/verify',{code})).status,400);
    assert.equal((await request('/api/spaces',{name:'Verified',icon:'✦'})).status,201);
  });
  let secret,recoveryCodes;
  await t.test('MFA activation requires password and an authenticator proof; secrets remain private',async()=>{
    assert.equal((await request('/api/account/mfa/setup',{authSecret:'x'.repeat(44)})).status,401);
    const setup=await request('/api/account/mfa/setup',{authSecret});assert.equal(setup.status,200);secret=setup.result.secret;
    const pending=application.db.prepare('SELECT mfa_pending FROM users WHERE username=?').get('alice');assert.ok(!pending.mfa_pending.includes(secret));assert.equal((await request('/api/account/mfa/enable',{code:'wrong'})).status,400);
    const enabled=await request('/api/account/mfa/enable',{code:totp(secret)});assert.equal(enabled.status,200);recoveryCodes=enabled.result.recoveryCodes;assert.equal(recoveryCodes.length,10);
    const state=(await request('/api/state')).result;assert.equal(state.account.mfaEnabled,true);assert.equal(state.account.recoveryCodesRemaining,10);assert.ok(!JSON.stringify(state).includes(secret));assert.ok(!JSON.stringify(state).includes(recoveryCodes[0]));
  });
  await t.test('login requires MFA; TOTP and recovery codes cannot be replayed',async()=>{
    assert.equal((await request('/api/auth/login',{username:'alice',authSecret})).status,401);
    const recovered=await request('/api/auth/login',{username:'alice',authSecret,otp:recoveryCodes[0]});assert.equal(recovered.status,200);
    assert.equal((await request('/api/auth/login',{username:'alice',authSecret,otp:recoveryCodes[0]})).status,401);
    const next=totp(secret,Date.now()+30000),login=await request('/api/auth/login',{username:'alice',authSecret,otp:next});assert.equal(login.status,200);assert.equal((await request('/api/auth/login',{username:'alice',authSecret,otp:next})).status,401);
    assert.equal((await request('/api/account/mfa/disable',{authSecret:'x'.repeat(44),code:recoveryCodes[1]})).status,401);
    assert.equal((await request('/api/account/mfa/disable',{authSecret,code:recoveryCodes[1]})).status,200);assert.equal((await request('/api/state')).result.account.mfaEnabled,false);
  });
  await t.test('email changes require reauthentication and clear verified status',async()=>{
    assert.equal((await request('/api/account/email',{email:'new@example.test',authSecret:'x'.repeat(44)},'PATCH')).status,401);
    const changed=await request('/api/account/email',{email:'new@example.test',authSecret},'PATCH');assert.equal(changed.status,200);assert.equal(changed.result.account.emailVerified,false);assert.equal((await request('/api/spaces',{name:'Blocked again'})).status,403);
    assert.equal((await request('/api/account/email/send',{})).status,200);assert.equal(delivered.at(-1).to,'new@example.test');
  });
});
test('legacy database migration preserves accounts and does not invent an email',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'vesper-migration-')),path=join(directory,'legacy.sqlite'),legacy=new DatabaseSync(path);
  legacy.exec('CREATE TABLE users(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, salt TEXT NOT NULL, profile TEXT NOT NULL, public_key TEXT NOT NULL, signing_key TEXT NOT NULL, vault TEXT NOT NULL)');legacy.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run('old','old','hash','salt','{}','{}','{}','{}');legacy.close();const app=createApp({databasePath:path});
  t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});});const account=app.db.prepare('SELECT * FROM users WHERE id=?').get('old');assert.equal(account.username,'old');assert.equal(account.email,null);assert.equal(account.email_verified,0);assert.equal(account.password_hash,'hash');
});
