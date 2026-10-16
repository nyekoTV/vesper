import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gifUrl,importGif} from '../gif-import.mjs';
const bytes=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');
test('GIF importer restricts URLs and redirect destinations',async()=>{
  for(const url of ['http://tenor.com/x','https://localhost/x','https://tenor.com.evil.test/x','https://user:pass@tenor.com/x','https://tenor.com:444/x','file:///etc/passwd','https://127.0.0.1/x'])assert.throws(()=>gifUrl(url));
  let calls=0;await assert.rejects(importGif('https://tenor.com/view/test',{fetcher:async()=>{calls++;return new Response('',{status:302,headers:{location:'https://127.0.0.1/x'}});}}));assert.equal(calls,1);
});
test('GIF importer resolves provider page and embeds bytes',async()=>{
  const urls=[];const gif=await importGif('https://tenor.com/view/test',{fetcher:async url=>{urls.push(url.href);return urls.length===1?new Response('<meta content="Hello &amp; bye" property="og:title"><meta property="og:image" content="https://media.tenor.com/a/test.gif">',{headers:{'content-type':'text/html'}}):new Response(bytes,{headers:{'content-type':'image/gif'}});}});
  assert.equal(gif.title,'Hello & bye');assert.equal(gif.data,bytes.toString('base64'));assert.equal(urls.length,2);
});
test('GIF importer rejects non-GIF content and oversized streams',async()=>{
  await assert.rejects(importGif('https://media.giphy.com/a.gif',{fetcher:async()=>new Response('not a gif')}),/image GIF/);
  await assert.rejects(importGif('https://media.giphy.com/a.gif',{fetcher:async()=>new Response(new Uint8Array(512*1024+1))}),/512 Ko/);
  await assert.rejects(importGif('https://giphy.com/a',{fetcher:async()=>new Response('<meta property="og:image" content="https://evil.test/a.gif">',{headers:{'content-type':'text/html'}})}),/Aucun GIF/);
});
