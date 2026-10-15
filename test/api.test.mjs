import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.mjs';
import {createIdentity,unlockIdentity,authenticationSecret,sealMessage,openMessage,signStatement} from '../public/crypto.mjs';
test('complete authenticated communication and access control',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'vesper-test-')),origin='http://vesper.test';let application=createApp({databasePath:join(directory,'test.sqlite'),origin,requireEmailVerification:false});
  await new Promise(resolve=>application.server.listen(0,'127.0.0.1',resolve));let base='http://127.0.0.1:'+application.server.address().port;
  t.after(async()=>{await application.close();await rm(directory,{recursive:true,force:true});});
  async function request(path,{actor,data,method=data===undefined?'GET':'POST',originHeader=origin}={}){const response=await fetch(base+path,{method,headers:{...(data===undefined?{}:{'Content-Type':'application/json',Origin:originHeader}),...(actor?{Cookie:actor.cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});const result=await response.json();return {status:response.status,result,cookie:response.headers.get('set-cookie')?.split(';')[0],headers:response.headers};}
  const domain=(await request('/api/config')).result.authDomain;
  async function register(username){const password='Private-long-passphrase-'+username,identity=await createIdentity(password,username),authSecret=await authenticationSecret(password,username,domain);const response=await request('/api/auth/register',{data:{username,email:username+'@example.test',displayName:username,authSecret,...identity}});assert.equal(response.status,201,JSON.stringify(response.result));return {id:response.result.me.id,cookie:response.cookie,state:response.result,username,authSecret,identity,keys:await unlockIdentity(password,username,identity.vault)};}
  const alice=await register('alice'),bob=await register('bob'),carol=await register('carol');let spaceId,textChannel,voiceChannel,privateChannel,messageId;
  await t.test('sessions, CSRF, incorrect credentials and safe profiles',async()=>{
    assert.equal((await request('/api/state')).status,401);
    assert.equal((await request('/api/spaces',{actor:alice,data:{name:'Blocked'},originHeader:'http://evil.example'})).status,403);
    const wrong=await request('/api/auth/login',{data:{username:'alice',authSecret:await authenticationSecret('wrong-passphrase','alice')}});assert.equal(wrong.status,401);
    assert.match(alice.cookie,/^vesper=/);const profile=await request('/api/profile',{actor:bob,data:{displayName:'Bob ✨',avatar:'🚀',bio:'Bonjour',accent:'#66ddaa',banner:'ocean',status:'away'},method:'PATCH'});assert.equal(profile.status,200);assert.equal(profile.result.displayName,'Bob ✨');assert.equal(profile.result.password_hash,undefined);
  });
  await t.test('new-account guide is acknowledged per user and persists',async()=>{
    assert.equal((await request('/api/state',{actor:alice})).result.account.onboardingSeen,false);
    assert.equal((await request('/api/onboarding/complete',{actor:alice,data:{}})).status,200);
    assert.equal((await request('/api/state',{actor:alice})).result.account.onboardingSeen,true);
    assert.equal((await request('/api/state',{actor:bob})).result.account.onboardingSeen,false);
  });
  await t.test('friend requests require recipient acceptance and cannot be modified by outsiders',async()=>{
    assert.equal((await request('/api/friends/request',{actor:alice,data:{username:'alice'}})).status,404);
    assert.equal((await request('/api/friends/request',{actor:alice,data:{username:'bob'}})).status,201);
    assert.equal((await request('/api/friends/request',{actor:alice,data:{username:'bob'}})).status,409);
    const pending=(await request('/api/state',{actor:bob})).result.friendRequests.incoming[0];assert.equal(pending.id,alice.id);assert.equal(pending.email,undefined);assert.equal((await request('/api/state',{actor:alice})).result.friends.length,0);
    assert.equal((await request('/api/friends/'+pending.friendshipId+'/accept',{actor:alice,data:{}})).status,403);
    assert.equal((await request('/api/friends/'+pending.friendshipId,{actor:carol,data:{},method:'DELETE'})).status,403);
    assert.equal((await request('/api/friends/'+pending.friendshipId+'/accept',{actor:bob,data:{}})).status,200);
    assert.equal((await request('/api/state',{actor:alice})).result.friends[0].id,bob.id);assert.equal((await request('/api/state',{actor:bob})).result.friends[0].id,alice.id);
  });
  await t.test('friends show realtime presence and respect invisible status',async()=>{
    const controller=new AbortController(),response=await fetch(base+'/api/events',{headers:{Cookie:bob.cookie},signal:controller.signal}),reader=response.body.getReader();
    try{assert.equal((await request('/api/state',{actor:alice})).result.friends[0].online,true);const profile=(await request('/api/state',{actor:bob})).result.me;
      assert.equal((await request('/api/profile',{actor:bob,data:{...profile,status:'invisible'},method:'PATCH'})).status,200);assert.equal((await request('/api/state',{actor:alice})).result.friends[0].online,false);
      await request('/api/profile',{actor:bob,data:{...profile,status:'away'},method:'PATCH'});
    }finally{await reader.cancel();controller.abort();}
  });
  await t.test('community, invitation, persistent membership and roles',async()=>{
    const created=await request('/api/spaces',{actor:alice,data:{name:'Les proches',icon:'✳'}});assert.equal(created.status,201);spaceId=created.result.spaceId;
    const invitation=await request('/api/spaces/'+spaceId+'/invites',{actor:alice,data:{}});assert.equal(invitation.status,201);
    for(const actor of [bob,carol])assert.equal((await request('/api/join',{actor,data:{token:invitation.result.token}})).status,200);
    const state=(await request('/api/state',{actor:alice})).result;const space=state.spaces.find(space=>space.id===spaceId);assert.equal(space.members.length,3);textChannel=space.channels.find(channel=>channel.kind==='text').id;voiceChannel=space.channels.find(channel=>channel.kind==='voice').id;
    assert.equal((await request('/api/spaces/'+spaceId+'/channels',{actor:bob,data:{name:'forbidden',kind:'text'}})).status,403);
    assert.equal((await request('/api/spaces/'+spaceId+'/roles',{actor:alice,data:{name:'Créatif',color:'#abcdef',permissions:{}}})).status,200);
    const roles=(await request('/api/state',{actor:alice})).result.spaces[0].roles;const creative=roles.find(role=>role.name==='Créatif');assert.equal((await request('/api/spaces/'+spaceId+'/members/'+bob.id,{actor:alice,data:{roleId:creative.id},method:'PATCH'})).status,200);
    assert.equal((await request('/api/spaces/'+spaceId+'/members/'+alice.id,{actor:bob,data:{},method:'DELETE'})).status,403);
  });
  await t.test('private channel visibility and exact recipient enforcement',async()=>{
    const created=await request('/api/spaces/'+spaceId+'/channels',{actor:alice,data:{name:'secret',kind:'text',private:true,access:[bob.id]}});assert.equal(created.status,201);privateChannel=created.result.channelId;
    assert.equal((await request('/api/channels/'+privateChannel+'/messages',{actor:carol})).status,403);
    assert.equal((await request('/api/state',{actor:carol})).result.spaces[0].channels.some(channel=>channel.id===privateChannel),false);
    const roster=(await request('/api/channels/'+privateChannel+'/recipients',{actor:bob})).result;assert.deepEqual(roster.users.map(user=>user.id).sort(),[alice.id,bob.id].sort());
    const id=crypto.randomUUID(),payload=await sealMessage({text:'Le contenu secret ne doit jamais être stocké en clair.'},{id,channelId:privateChannel,authorId:alice.id},roster.users,alice.keys);
    const forged={...payload,authorId:bob.id};assert.equal((await request('/api/channels/'+privateChannel+'/messages',{actor:alice,data:{payload:forged,rosterHash:roster.hash}})).status,400);
    assert.equal((await request('/api/channels/'+privateChannel+'/messages',{actor:alice,data:{payload,rosterHash:'old-roster'}})).status,409);
    const sent=await request('/api/channels/'+privateChannel+'/messages',{actor:alice,data:{payload,rosterHash:roster.hash}});assert.equal(sent.status,201,JSON.stringify(sent.result));messageId=id;
    const received=(await request('/api/channels/'+privateChannel+'/messages',{actor:bob})).result.messages[0];assert.equal((await openMessage(received.payload,bob.id,bob.keys,alice.identity.signingKey)).text,'Le contenu secret ne doit jamais être stocké en clair.');
    assert.ok(!application.db.prepare('SELECT payload FROM messages WHERE id=?').get(id).payload.includes('Le contenu secret'));
    assert.equal((await request('/api/state',{actor:carol})).result.spaces.find(space=>space.id===spaceId).lastActivity,0);
    const tampered=structuredClone(payload);tampered.ciphertext=payload.ciphertext.replace(/^./,payload.ciphertext[0]==='A'?'B':'A');assert.equal((await request('/api/channels/'+privateChannel+'/messages',{actor:alice,data:{payload:tampered,rosterHash:roster.hash}})).status,400);
  });
  await t.test('author edits, moderator pins and rejection of unauthorized modifications',async()=>{
    assert.equal((await request('/api/messages/'+messageId,{actor:bob,data:{pinned:true},method:'PATCH'})).status,403);
    assert.equal((await request('/api/messages/'+messageId,{actor:bob,data:{},method:'DELETE'})).status,403);
    assert.equal((await request('/api/messages/'+messageId,{actor:alice,data:{pinned:true},method:'PATCH'})).status,200);
    const roster=(await request('/api/channels/'+privateChannel+'/recipients',{actor:alice})).result;const payload=await sealMessage({text:'Version modifiée.'},{id:messageId,channelId:privateChannel,authorId:alice.id},roster.users,alice.keys);
    assert.equal((await request('/api/messages/'+messageId,{actor:alice,data:{payload,rosterHash:roster.hash},method:'PATCH'})).status,200);
    const row=(await request('/api/channels/'+privateChannel+'/messages',{actor:bob})).result.messages[0];assert.ok(row.edited);assert.equal(row.pinned,1);assert.equal((await openMessage(row.payload,bob.id,bob.keys,alice.identity.signingKey)).text,'Version modifiée.');
  });
  await t.test('realtime new-message events carry notification metadata; deletions stay silent',async()=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
    const response=await fetch(base+'/api/events',{headers:{Cookie:bob.cookie},signal:controller.signal}),reader=response.body.getReader(),decoder=new TextDecoder();let pending='';
    async function nextMessageEvent(){while(true){let boundary;while((boundary=pending.indexOf('\n\n'))>=0){const frame=pending.slice(0,boundary);pending=pending.slice(boundary+2);const line=frame.split('\n').find(line=>line.startsWith('data: '));if(line){const value=JSON.parse(line.slice(6));if(value.type==='messages')return value;}}const chunk=await reader.read();if(chunk.done)throw new Error('Event stream ended');pending+=decoder.decode(chunk.value,{stream:true});}}
    try{const roster=(await request('/api/channels/'+privateChannel+'/recipients',{actor:alice})).result,id=crypto.randomUUID(),payload=await sealMessage({text:'Notification privée'},{id,channelId:privateChannel,authorId:alice.id},roster.users,alice.keys);
      assert.equal((await request('/api/channels/'+privateChannel+'/messages',{actor:alice,data:{payload,rosterHash:roster.hash}})).status,201);
      const event=await nextMessageEvent();assert.equal(event.action,'created');assert.equal(event.messageId,id);assert.equal(event.authorId,alice.id);assert.equal(event.channelId,privateChannel);assert.equal(event.payload,undefined);
      assert.equal((await request('/api/messages/'+id,{actor:alice,data:{},method:'DELETE'})).status,200);assert.equal((await nextMessageEvent()).action,undefined);
    }finally{clearTimeout(timer);await reader.cancel();controller.abort();}
  });
  await t.test('private conversations cannot be joined or expanded through invitations',async()=>{
    const dm=await request('/api/dm',{actor:alice,data:{username:'bob'}});assert.equal(dm.status,201);assert.equal((await request('/api/dm',{actor:bob,data:{username:'alice'}})).result.spaceId,dm.result.spaceId);
    assert.equal((await request('/api/spaces/'+dm.result.spaceId+'/invites',{actor:alice,data:{}})).status,400);
    assert.equal((await request('/api/state',{actor:carol})).result.spaces.some(space=>space.id===dm.result.spaceId),false);
    const friend=(await request('/api/state',{actor:alice})).result.friends[0];assert.equal((await request('/api/friends/'+friend.friendshipId,{actor:alice,data:{},method:'DELETE'})).status,200);
    const afterRemoval=(await request('/api/state',{actor:bob})).result;assert.equal(afterRemoval.friends.length,0);assert.equal(afterRemoval.spaces.some(space=>space.id===dm.result.spaceId),true);
  });
  await t.test('voice membership and signaling authorization',async()=>{
    assert.equal((await request('/api/voice/join',{actor:alice,data:{channelId:textChannel}})).status,400);
    for(const actor of [alice,bob])assert.equal((await request('/api/voice/join',{actor,data:{channelId:voiceChannel}})).status,200);
    const unsigned={type:'offer',nonce:crypto.randomUUID(),sdp:{type:'offer',sdp:'test-signaling-only'}};const signature=await signStatement({channelId:voiceChannel,from:alice.id,to:bob.id,signal:unsigned},alice.keys);
    const signal={channelId:voiceChannel,to:bob.id,signal:{...unsigned,signature}};assert.equal((await request('/api/voice/signal',{actor:alice,data:signal})).status,200);assert.equal((await request('/api/voice/signal',{actor:carol,data:signal})).status,403);
    assert.equal((await request('/api/voice/signal',{actor:alice,data:{...signal,signal:{...signal.signal,sdp:{type:'offer',sdp:'modified'}}}})).status,400);
    assert.equal((await request('/api/voice/kick',{actor:carol,data:{channelId:voiceChannel,userId:bob.id}})).status,403);
    assert.equal((await request('/api/voice/kick',{actor:alice,data:{channelId:voiceChannel,userId:bob.id}})).status,200);
    assert.equal((await request('/api/voice/signal',{actor:alice,data:signal})).status,403);
  });
  await t.test('persistence across restart and session revocation',async()=>{
    await application.close();application=createApp({databasePath:join(directory,'test.sqlite'),origin,requireEmailVerification:false});await new Promise(resolve=>application.server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+application.server.address().port;
    assert.equal((await request('/api/channels/'+privateChannel+'/messages',{actor:bob})).result.messages.length,1);
    assert.equal((await request('/api/state',{actor:alice})).result.account.onboardingSeen,true);
    assert.equal((await request('/api/auth/logout',{actor:bob,data:{}})).status,200);assert.equal((await request('/api/state',{actor:bob})).status,401);
    const login=await request('/api/auth/login',{data:{username:'bob',authSecret:bob.authSecret}});assert.equal(login.status,200);bob.cookie=login.cookie;
    assert.equal((await request('/api/messages/'+messageId,{actor:alice,data:{},method:'DELETE'})).status,200);assert.equal((await request('/api/channels/'+privateChannel+'/messages',{actor:bob})).result.messages.length,0);
  });
});
