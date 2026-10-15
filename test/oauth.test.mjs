import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';
import {createIdentity,authenticationSecret,unlockIdentity} from '../public/crypto.mjs';
import {totp} from '../security.mjs';

async function fixture(t,{required=true}={}){
  const origin='https://vesper.example.test',calls=[],provider={id:123,login:'synthetic',email:'tester@example.test',verified:true},time={value:Date.now()};
  const fetcher=async(url,options)=>{calls.push({url,options});if(url.endsWith('/access_token'))return Response.json({access_token:'synthetic-provider-token',token_type:'bearer'});if(url.endsWith('/user/emails'))return Response.json([{email:provider.email,primary:true,verified:provider.verified}]);return Response.json({id:provider.id,login:provider.login});};
  const app=createApp({databasePath:':memory:',origin,requireEmailVerification:required,github:{clientId:'synthetic-client',clientSecret:'synthetic-client-secret',fetcher,clock:()=>time.value}});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());const base='http://127.0.0.1:'+app.server.address().port;
  async function request(path,{cookie='',data,method=data?'POST':'GET'}={}){const response=await fetch(base+path,{method,redirect:'manual',headers:{Cookie:cookie,...(data?{Origin:origin,'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});const body=await response.text();return {status:response.status,location:response.headers.get('location'),cookies:response.headers.getSetCookie(),body,json:body?JSON.parse(body):null};}
  const cookie=(response,name)=>response.cookies.find(c=>c.startsWith(name+'='))?.split(';')[0]||'';
  async function start(){const result=await request('/api/oauth/github/start');return {result,state:new URL(result.location).searchParams.get('state'),browser:cookie(result,'vesper_github_flow')};}
  async function authorize(){const flow=await start(),callback=await request('/api/oauth/github/callback?state='+flow.state+'&code=synthetic-code',{cookie:flow.browser});assert.equal(callback.location,'/?github=ready');return cookie(callback,'vesper_github_proof');}
  const domain=(await request('/api/config')).json.authDomain,password='Synthetic-vault-password-2026!';
  async function credentials(username='nyeko'){return {username,email:provider.email,authSecret:await authenticationSecret(password,username,domain),...await createIdentity(password,username)};}
  return {app,request,cookie,start,authorize,credentials,provider,calls,time,password};
}

test('GitHub uses PKCE, browser-bound state, short-lived proofs and verified provider emails',async t=>{
  const f=await fixture(t),flow=await f.start(),params=new URL(flow.result.location).searchParams;
  assert.equal(params.get('scope'),'user:email');assert.equal(params.get('code_challenge_method'),'S256');assert.match(flow.result.cookies[0],/HttpOnly; SameSite=Lax/);assert.match(flow.result.cookies[0],/Secure/);
  const wrong=await f.request('/api/oauth/github/callback?state='+flow.state+'&code=code',{cookie:'vesper_github_flow=other-browser'});assert.equal(wrong.location,'/?github=error');assert.equal(f.calls.length,0);
  const proof=await f.authorize(),exchange=f.calls.find(c=>c.url.endsWith('/access_token'));assert.ok(exchange.options.body.get('code_verifier'));assert.equal(exchange.options.body.get('redirect_uri'),'https://vesper.example.test/api/oauth/github/callback');
  assert.equal((await f.request('/api/oauth/github/status',{cookie:proof})).json.email,f.provider.email);
  assert.doesNotMatch(JSON.stringify((await f.request('/api/oauth/github/status',{cookie:proof})).json),/synthetic-provider-token|synthetic-client-secret/);
  f.time.value+=600001;assert.equal((await f.request('/api/oauth/github/status',{cookie:proof})).json.ready,false);
  f.provider.verified=false;const denied=await f.start();assert.equal((await f.request('/api/oauth/github/callback?state='+denied.state+'&code=code',{cookie:denied.browser})).location,'/?github=error');
  const expiring=await f.start();f.time.value+=600001;assert.equal((await f.request('/api/oauth/github/callback?state='+expiring.state+'&code=code',{cookie:expiring.browser})).location,'/?github=error');
});

test('GitHub registration retains the encrypted vault, binds stable identity and cannot replay a proof',async t=>{
  const f=await fixture(t),input=await f.credentials();
  assert.equal((await f.request('/api/auth/register',{data:input})).status,403);
  const proof=await f.authorize();assert.equal((await f.request('/api/auth/register',{cookie:proof,data:{...input,email:'forged@example.test'}})).status,400);
  const registered=await f.request('/api/auth/register',{cookie:proof,data:{...input,is_admin:true}});assert.equal(registered.status,201);assert.equal(registered.json.account.emailVerified,true);assert.equal(registered.json.account.administrator,false);
  assert.ok(await unlockIdentity(f.password,input.username,registered.json.vault));assert.equal(f.app.db.prepare('SELECT github_id FROM users WHERE username=?').get(input.username).github_id,'123');
  assert.equal((await f.request('/api/oauth/github/status',{cookie:proof})).json.ready,false);
  assert.equal((await f.request('/api/auth/login',{data:input})).status,400);
  const next=await f.authorize();assert.equal((await f.request('/api/oauth/github/status',{cookie:next})).json.username,'nyeko');
  assert.equal((await f.request('/api/auth/login',{cookie:next,data:{...input,authSecret:'x'.repeat(44)}})).status,401);
  assert.equal((await f.request('/api/oauth/github/status',{cookie:next})).json.ready,true);
  assert.equal((await f.request('/api/auth/login',{cookie:next,data:input})).status,200);
  f.provider.id=999;const other=await f.authorize();assert.equal((await f.request('/api/auth/login',{cookie:other,data:input})).status,400);
});

test('linking an existing account requires its password and preserves MFA and administration',async t=>{
  const f=await fixture(t,{required:false}),input=await f.credentials(),created=await f.request('/api/auth/register',{data:input});assert.equal(created.status,201);
  const proof=await f.authorize();assert.equal((await f.request('/api/auth/login',{cookie:proof,data:{...input,authSecret:'x'.repeat(44)}})).status,401);
  assert.equal(f.app.db.prepare('SELECT github_id FROM users WHERE username=?').get('nyeko').github_id,null);
  // Use the application's MFA setup API so the real encryption key is retained.
  const session=f.cookie(created,'vesper'),setup=await f.request('/api/account/mfa/setup',{cookie:session,data:{authSecret:input.authSecret}});
  assert.equal(setup.status,200);const enabled=await f.request('/api/account/mfa/enable',{cookie:session,data:{code:totp(setup.json.secret)}});assert.equal(enabled.status,200);
  assert.equal((await f.request('/api/auth/login',{cookie:proof,data:input})).status,401);
  assert.equal(f.app.db.prepare('SELECT github_id FROM users WHERE username=?').get('nyeko').github_id,null);
  const linked=await f.request('/api/auth/login',{cookie:proof,data:{...input,otp:enabled.json.recoveryCodes[0]}});assert.equal(linked.status,200);assert.equal(linked.json.account.mfaEnabled,true);assert.equal(linked.json.account.emailVerified,true);
  assert.equal(f.app.db.prepare('SELECT is_admin FROM users WHERE username=?').get('nyeko').is_admin,0);
});
