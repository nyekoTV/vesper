import test from 'node:test';
import assert from 'node:assert/strict';
import {microphoneSettings,microphoneConstraints,microphoneGraph} from '../public/microphone.mjs';
import {VoiceRoom} from '../public/voice.mjs';
test('microphone processing clamps gain, connects only to the outgoing stream and cleans up',async()=>{
  const nodes=[],param=()=>({value:0,setTargetAtTime(value){this.value=value;}}),node=type=>{const result={type,gain:param(),frequency:param(),Q:param(),threshold:param(),knee:param(),ratio:param(),attack:param(),release:param(),connect(other){this.next=other;},disconnect(){this.disconnected=true;}};nodes.push(result);return result;};let stopped=false,closed=false;
  class Context{currentTime=0;createMediaStreamSource(){return node('source');}createBiquadFilter(){return node('filter');}createGain(){return node('gain');}createDynamicsCompressor(){return node('limiter');}createMediaStreamDestination(){return {...node('stream'),stream:{getTracks:()=>[{stop(){stopped=true;}}]}};}async close(){closed=true;}}
  const settings=microphoneSettings({gain:7,echoCancellation:false}),graph=microphoneGraph({},settings,Context);assert.equal(settings.gain,3);assert.deepEqual(microphoneConstraints(settings),{echoCancellation:false,noiseSuppression:true,autoGainControl:true});assert.equal(nodes[0].next,nodes[1]);assert.equal(nodes[2].next,nodes[3]);assert.equal(nodes[3].next.stream,graph.stream);assert.equal(nodes[2].gain.value,3);
  graph.update(microphoneSettings({gain:.5,highpass:false}));assert.equal(nodes[2].gain.value,.5);assert.equal(nodes[1].frequency.value,0);await graph.close();assert.ok(stopped&&closed);assert.ok(nodes.slice(0,4).every(n=>n.disconnected));
});
test('deafening disables raw and transmitted microphones, preserving a previous manual mute',()=>{
  const raw={enabled:true},sent={enabled:true},audio={muted:false},room=new VoiceRoom({onChange:()=>{}});room.channelId='voice';room.stream={getAudioTracks:()=>[sent]};room.rawStream={getAudioTracks:()=>[raw]};room.peers.set('peer',{audio});
  room.deafen();assert.ok(room.deafened&&room.muted&&audio.muted);assert.equal(raw.enabled,false);assert.equal(sent.enabled,false);room.mute();assert.equal(sent.enabled,false);room.deafen();assert.equal(room.muted,false);assert.equal(sent.enabled,true);assert.equal(raw.enabled,true);
  room.mute();room.deafen();room.deafen();assert.equal(room.muted,true);assert.equal(sent.enabled,false);assert.equal(raw.enabled,false);
});
test('microphone settings update live browser constraints without reacquiring permission',async()=>{
  const applied=[],updates=[],room=new VoiceRoom({});room.rawStream={getAudioTracks:()=>[{applyConstraints:async value=>applied.push(value)}]};room.microphoneGraph={update:value=>updates.push(value)};
  await room.setMicrophoneSettings({gain:2});assert.equal(applied.length,0);assert.equal(updates.at(-1).gain,2);await room.setMicrophoneSettings({noiseSuppression:false});assert.equal(applied.at(-1).noiseSuppression,false);
  room.rawStream={getAudioTracks:()=>[{applyConstraints:async()=>{throw Error('Unsupported');}}]};await assert.rejects(room.setMicrophoneSettings({echoCancellation:false}));assert.equal(room.microphone.echoCancellation,true);
});
