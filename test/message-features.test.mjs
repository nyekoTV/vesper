import test from 'node:test';
import assert from 'node:assert/strict';
import {TypingPresence,mentionQuery,mentions,canStartMessage} from '../public/message-features.mjs';
test('typing expires, stops, hides self and stays in the correct channel',()=>{
  let clock=100;const typing=new TypingPresence({now:()=>clock});typing.update({channelId:'private',userId:'alice',active:true,expires:6100});typing.update({channelId:'other',userId:'bob',active:true,expires:6100});
  assert.deepEqual(typing.users('private','bob'),['alice']);assert.deepEqual(typing.users('private','alice'),[]);clock=6101;assert.deepEqual(typing.users('private','bob'),[]);
  typing.update({channelId:'private',userId:'alice',active:true,expires:10000});typing.update({channelId:'private',userId:'alice',active:false});assert.deepEqual(typing.users('private','bob'),[]);
});
test('mentions match usernames, not substrings or email addresses',()=>{
  assert.equal(mentionQuery('Bonjour @nye'), 'nye');assert.equal(mentionQuery('mail@example.test'),null);assert.equal(mentionQuery('@'), '');assert.equal(mentions('Bonjour @nyeko !','nyeko'),true);assert.equal(mentions('@nyeko2','nyeko'),false);assert.equal(mentions('mail@nyeko','nyeko'),false);
});
test('typing anywhere starts a message but respects dialogs, edits, selection and shortcuts',()=>{
  const base={key:'é',conversationOpen:true};assert.equal(canStartMessage(base),true);
  for(const flag of ['ctrlKey','metaKey','altKey','isComposing','defaultPrevented','editing','dialogOpen','selection'])assert.equal(canStartMessage({...base,[flag]:true}),false,flag);
  assert.equal(canStartMessage({...base,conversationOpen:false}),false);assert.equal(canStartMessage({...base,key:'Escape'}),false);assert.equal(canStartMessage({...base,key:' ',activatable:true}),false);assert.equal(canStartMessage({...base,key:' ',activatable:false}),true);
});
