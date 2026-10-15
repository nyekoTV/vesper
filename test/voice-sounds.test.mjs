import {test} from 'node:test';
import assert from 'node:assert/strict';
import {VoiceRoom} from '../public/voice.mjs';
test('voice sounds follow successful joins and actual mute/deafen transitions',async t=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator'),track={enabled:true,stopped:false,stop(){this.stopped=true;}},stream={getAudioTracks:()=>[track],getTracks:()=>[track]};
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async()=>stream}}});t.after(()=>{if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);else delete globalThis.navigator;});
  const notes=[],room=new VoiceRoom({api:async path=>path.endsWith('/join')?{users:['me'],iceServers:[]}: {},me:'me',onChange:()=>{},onError:error=>{throw error;},onSound:name=>notes.push(name)});
  await room.join('vocal');room.mute();assert.equal(track.enabled,false);room.mute();assert.equal(track.enabled,true);room.deafen();assert.equal(room.deafened,true);room.deafen();await room.leave();assert.equal(track.stopped,true);room.mute();assert.deepEqual(notes,['join','mute','unmute','deafen','undeafen','leave']);
  const denied=[];const failed=new VoiceRoom({api:async()=>{throw new Error('Join denied');},me:'me',onChange:()=>{},onError:()=>{},onSound:name=>denied.push(name)});await assert.rejects(failed.join('bad'));assert.deepEqual(denied,[]);
});
