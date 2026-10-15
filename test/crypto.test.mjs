import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createIdentity,unlockIdentity,sealMessage,openMessage,authenticationSecret} from '../public/crypto.mjs';
test('encrypted vault, multi-recipient message, signatures and integrity',async()=>{
  const password='a-private-passphrase-2026',alice=await createIdentity(password,'alice'),bob=await createIdentity('another-private-password','bob');
  const aliceKeys=await unlockIdentity(password,'alice',alice.vault),bobKeys=await unlockIdentity('another-private-password','bob',bob.vault);
  await assert.rejects(unlockIdentity('wrong-password','alice',alice.vault));
  const content={text:'Message privé : café, 🚀 et <script>',attachment:{name:'test.txt',data:'dGVzdA=='}},payload=await sealMessage(content,{id:crypto.randomUUID(),channelId:'channel',authorId:'alice'},[{id:'alice',publicKey:alice.publicKey},{id:'bob',publicKey:bob.publicKey}],aliceKeys);
  assert.deepEqual(await openMessage(payload,'bob',bobKeys,alice.signingKey),content);
  assert.deepEqual(await openMessage(payload,'alice',aliceKeys,alice.signingKey),content);
  assert.ok(!JSON.stringify(payload).includes('Message privé'));assert.ok(!JSON.stringify(alice.vault).includes('private'));
  await assert.rejects(openMessage({...payload,ciphertext:payload.ciphertext.replace(/^./,payload.ciphertext[0]==='A'?'B':'A')},'bob',bobKeys,alice.signingKey),/Signature/);
  await assert.rejects(openMessage(payload,'outsider',bobKeys,alice.signingKey),/précède/);
  assert.notEqual(await authenticationSecret(password,'alice'),await authenticationSecret(password,'bob'));
});
