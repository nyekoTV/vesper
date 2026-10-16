import test from 'node:test';
import assert from 'node:assert/strict';
import {scryptSync} from 'node:crypto';
import {cloudflareTurn} from '../voice-config.mjs';
import {VoiceRoom} from '../public/voice.mjs';
import {createApp} from '../server.mjs';
import {grantAdministrator} from '../scripts/admin-user.mjs';

test('Cloudflare credentials stay server-side, cache concurrent requests and refresh',async()=>{
  let calls=0,clock=0;
  const provider=cloudflareTurn({keyId:'test-key',apiToken:'private-token',now:()=>clock,fetcher:async(url,input)=>{
    calls++;assert.equal(input.headers.Authorization,'Bearer private-token');assert.equal(JSON.parse(input.body).ttl,86400);
    assert.match(url,/test-key\/credentials\/generate-ice-servers$/);
    return {ok:true,json:async()=>({iceServers:[{urls:['stun:stun.example:3478']},{urls:['turns:relay.example:443?transport=tcp'],username:'temporary',credential:'temporary-password'}]})};
  }});
  const [a,b]=await Promise.all([provider(),provider()]);assert.equal(calls,1);assert.deepEqual(a,b);assert.equal(a.length,1);assert.ok(!JSON.stringify(a).includes('private-token'));
  a[0].credential='modified';assert.equal((await provider())[0].credential,'temporary-password');clock=3600001;await provider();assert.equal(calls,2);
});
test('configured TURN failure is explicit, sanitized and can recover',async()=>{
  assert.equal(cloudflareTurn(),null);assert.throws(()=>cloudflareTurn({keyId:'only'}));let fail=true;
  const provider=cloudflareTurn({keyId:'test',apiToken:'private-token',fetcher:async()=>{if(fail)throw Error('private-token');return {ok:true,json:async()=>({iceServers:[{urls:'turn:relay.example:3478',username:'u',credential:'p'}]})};}});
  await assert.rejects(provider(),error=>error.status===503&&!error.message.includes('private-token'));fail=false;assert.equal((await provider()).length,1);
});
test('voice connection timeout exits the indefinite connecting state',t=>{
  t.mock.timers.enable({apis:['setTimeout']});let changes=0;const room=new VoiceRoom({onChange:()=>changes++});room.channelId='test';
  const entry={status:'connecting',connection:{connectionState:'connecting'}};room.peers.set('peer',entry);room.watchConnection('peer',entry);t.mock.timers.tick(20001);assert.equal(entry.status,'failed');assert.equal(changes,1);
  entry.status='connected';entry.connection.connectionState='connected';room.watchConnection('peer',entry);t.mock.timers.tick(20001);assert.equal(entry.status,'connected');
});
test('console grant targets only the exact account and preserves existing admin code',async()=>{
  const app=createApp({databasePath:':memory:',origin:'http://localhost:4180',requireEmailVerification:false});
  try{
    const insert=app.db.prepare('INSERT INTO users(id,username,password_hash,salt,profile,public_key,signing_key,vault) VALUES(?,?,?,?,?,?,?,?)');
    for(const name of ['nyeko','other'])insert.run(name+'-id',name,'hash','salt','{}','{}','{}','{}');
    assert.throws(()=>grantAdministrator(app.db,'missing'));assert.equal(app.db.prepare('SELECT COUNT(*) n FROM settings WHERE key=?').get('admin_code_hash').n,0);
    const result=grantAdministrator(app.db,'nyeko');assert.equal(result.id,'nyeko-id');assert.ok(result.code.length>=16);
    const get=key=>app.db.prepare('SELECT value FROM settings WHERE key=?').get(key).value;
    assert.equal(scryptSync(result.code,get('admin_code_salt'),64,{N:32768,r:8,p:1,maxmem:67108864}).toString('hex'),get('admin_code_hash'));
    assert.equal(grantAdministrator(app.db,'nyeko').code,null);assert.equal(app.db.prepare('SELECT is_admin FROM users WHERE username=?').get('other').is_admin,0);
  }finally{await app.close();}
});
