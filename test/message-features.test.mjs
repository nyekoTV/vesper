import test from 'node:test';
import assert from 'node:assert/strict';
import {TypingPresence,mentionQuery,mentions} from '../public/message-features.mjs';
test('typing expires, stops, hides self and stays in the correct channel',()=>{
  let clock=100;const typing=new TypingPresence({now:()=>clock});typing.update({channelId:'private',userId:'alice',active:true,expires:6100});typing.update({channelId:'other',userId:'bob',active:true,expires:6100});
  assert.deepEqual(typing.users('private','bob'),['alice']);assert.deepEqual(typing.users('private','alice'),[]);clock=6101;assert.deepEqual(typing.users('private','bob'),[]);
  typing.update({channelId:'private',userId:'alice',active:true,expires:10000});typing.update({channelId:'private',userId:'alice',active:false});assert.deepEqual(typing.users('private','bob'),[]);
});
test('mentions match usernames, not substrings or email addresses',()=>{
  assert.equal(mentionQuery('Bonjour @nye'), 'nye');assert.equal(mentionQuery('mail@example.test'),null);assert.equal(mentionQuery('@'), '');assert.equal(mentions('Bonjour @nyeko !','nyeko'),true);assert.equal(mentions('@nyeko2','nyeko'),false);assert.equal(mentions('mail@nyeko','nyeko'),false);
});
