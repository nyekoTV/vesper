import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NotificationSounds,shouldNotify,InteractionSounds,interactionTones} from '../public/notifications.mjs';
const storage=()=>{const map=new Map();return {getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value)};};
class AudioMock{constructor(){this.state='suspended';this.currentTime=0;this.destination={};this.notes=[];this.gains=[];}async resume(){this.state='running';}createOscillator(){const note={type:'',frequency:{setValueAtTime:value=>note.pitch=value},connect(){},disconnect(){},start:time=>note.startTime=time,stop:time=>note.stopTime=time};this.notes.push(note);return note;}createGain(){const gain={gain:{setValueAtTime(){},linearRampToValueAtTime:value=>gain.peak=value,exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};this.gains.push(gain);return gain;}}
const created=(id='m1')=>({type:'messages',action:'created',messageId:id,authorId:'other'});
test('notifications omit own messages, edits, disabled sound and busy status',()=>{assert.equal(shouldNotify(created(),{me:'me',status:'online'}),true);for(const options of [{me:'other',status:'online'},{me:'me',status:'busy'},{me:'me',status:'online',enabled:false}])assert.equal(shouldNotify(created(),options),false);assert.equal(shouldNotify({...created(),action:'edited'},{me:'me'}),false);assert.equal(shouldNotify({type:'state'},{me:'me'}),false);});
test('two soft notes, duplicate suppression, burst control and saved preferences',async()=>{
  let clock=1000;const data=storage(),sound=new NotificationSounds({storage:data,Context:AudioMock,clock:()=>clock});assert.equal(await sound.receive(created(),{me:'me',status:'online'}),true);assert.equal(sound.context.notes.length,2);assert.deepEqual(sound.context.notes.map(note=>note.pitch),[660,880]);assert.equal(await sound.receive(created(),{me:'me',status:'online'}),false);
  const anotherTab=new NotificationSounds({storage:data,Context:AudioMock,clock:()=>clock});assert.equal(await anotherTab.receive(created(),{me:'me',status:'online'}),false);assert.equal(await sound.receive(created('m2'),{me:'me',status:'online'}),false);clock+=1000;sound.volume=.6;assert.equal(await sound.receive(created('m3'),{me:'me',status:'online'}),true);assert.equal(sound.context.gains.at(-1).peak,.6*.16);
  sound.enabled=false;assert.equal(new NotificationSounds({storage:data,Context:AudioMock}).enabled,false);assert.equal(await sound.receive(created('m4'),{me:'me',status:'online'}),false);sound.volume=0;assert.equal(await sound.play({test:true}),false);
});
test('interaction effects use separate preferences and distinct voice tones',async()=>{
  const data=storage(),effects=new InteractionSounds({storage:data,Context:AudioMock}),notifications=new NotificationSounds({storage:data,Context:AudioMock});
  assert.equal(await effects.playEffect('join'),true);assert.deepEqual(effects.context.notes.map(note=>note.pitch),interactionTones.join.map(note=>note[1]));assert.notDeepEqual(interactionTones.mute,interactionTones.unmute);
  effects.enabled=false;assert.equal(await effects.playEffect('mute'),false);assert.equal(notifications.enabled,true);effects.volume=.2;assert.equal(await effects.playEffect('unmute',{test:true}),true);assert.equal(effects.context.gains.at(-1).peak,.2*.1);assert.equal(await effects.playEffect('unknown',{test:true}),false);
});
