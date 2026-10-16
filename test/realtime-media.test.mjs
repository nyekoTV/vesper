import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {mergeMessages,reconcileChildren} from '../public/chat-sync.mjs';
import {validGif,gifDataUrl,gifCatalog,GIF_LIMIT} from '../public/media.mjs';
import {voiceIceServers,defaultIceServers} from '../voice-config.mjs';
import {VoiceRoom} from '../public/voice.mjs';
import {createHmac} from 'node:crypto';

test('new messages preserve earlier history, order and message DOM nodes',()=>{
  const first={id:'a',seq:1},last={id:'z',seq:60};const rows=mergeMessages([first,last],[{id:'z',seq:60,edited:true},{id:'b',seq:61}]);assert.equal(rows[0],first);assert.equal(rows[1].edited,true);assert.equal(rows.length,3);
  const parent={children:[],get firstElementChild(){return this.children[0]||null;},insertBefore(node,cursor){node.moves++;const index=this.children.indexOf(node);if(index>=0)this.children.splice(index,1);this.children.splice(cursor?this.children.indexOf(cursor):this.children.length,0,node);}};
  const node=name=>({name,moves:0,get nextElementSibling(){return parent.children[parent.children.indexOf(this)+1]||null;},remove(){parent.children.splice(parent.children.indexOf(this),1);}});
  const a=node('playing GIF'),b=node('focused message'),c=node('incoming');parent.children=[a,b];reconcileChildren(parent,[a,b,c]);assert.equal(a.moves,0);assert.equal(b.moves,0);assert.deepEqual(parent.children,[a,b,c]);reconcileChildren(parent,[a,c]);assert.deepEqual(parent.children,[a,c]);assert.equal(a.moves,0);
});
test('local GIF catalog is valid, bounded and rejects external or oversized content',async()=>{
  for(const gif of gifCatalog){const bytes=await readFile(new URL('../public'+gif.url,import.meta.url));const value={data:bytes.toString('base64')};assert.ok(validGif(value));assert.ok(gifDataUrl(value).startsWith('data:image/gif;base64,'));assert.ok(bytes.length<GIF_LIMIT);}
  assert.equal(validGif({data:'https://external.example/tracker.gif'}),false);assert.equal(validGif({data:Buffer.from('<svg onload=evil()>').toString('base64')}),false);assert.equal(validGif({data:'R0lGODlh'+'A'.repeat(GIF_LIMIT*2)}),false);
});
test('voice uses STUN by default and generates temporary user-specific TURN credentials',()=>{
  assert.equal(defaultIceServers.length,2);const secret='synthetic-turn-shared-secret',servers=voiceIceServers({turnUrls:['turn:relay.example:3478'],turnSecret:secret,userId:'alice',now:1000000}),turn=servers.at(-1);assert.equal(turn.username,'4600:alice');assert.equal(turn.credential,createHmac('sha1',secret).update(turn.username).digest('base64'));assert.ok(!JSON.stringify(servers).includes(secret));assert.equal(voiceIceServers({servers:[],turnSecret:secret,userId:'alice'}).length,0);
});
test('audio output applies to all peers and rolls back on a failed device switch',async()=>{
  const applied=[],room=new VoiceRoom({onChange:()=>{},onError:()=>{}});room.outputId='previous';room.peers.set('a',{audio:{setSinkId:async id=>applied.push(['a',id])}});room.peers.set('b',{audio:{setSinkId:async id=>{if(id==='missing')throw Error('NotFound');applied.push(['b',id]);}}});await room.setOutputDevice('headset');assert.equal(room.outputId,'headset');await assert.rejects(room.setOutputDevice('missing'));assert.equal(room.outputId,'headset');assert.deepEqual(applied.slice(-2),[['a','headset'],['b','headset']]);
});
