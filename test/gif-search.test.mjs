import {test} from 'node:test';
import assert from 'node:assert/strict';
import {searchKlipy,klipyResults,readGifFavorites,toggleGifFavorite} from '../public/gif-search.mjs';
import {validGif,validRemoteGif,gifDataUrl} from '../public/media.mjs';
const item={provider:'klipy',url:'https://static.klipy.com/public/test.gif?token=delivery',title:'Bonjour',slug:'hello'};
test('remote GIFs only allow KLIPY HTTPS media and preserve delivery parameters',()=>{
  assert.ok(validGif(item));assert.equal(gifDataUrl(item),item.url);
  for(const url of ['javascript:alert(1)','https://static.klipy.com.evil.test/x','https://api.klipy.com/x','http://static.klipy.com/x','https://user@static.klipy.com/x','https://static.klipy.com:444/x'])assert.equal(validRemoteGif({...item,url}),false);
});
test('KLIPY search uses direct API, exact query, safe filter, paging and original order',async()=>{
  let captured;const result=await searchKlipy({key:'test-app-key',query:'chat drôle',page:2,fetcher:async(url,options)=>{captured={url,options};return Response.json({result:true,data:{has_next:true,data:[{title:'One',slug:'one',file:{sm:{gif:{url:item.url}}}},{title:'Two',slug:'two',file:{xs:{gif:{url:'https://static1.klipy.com/two.gif'}}}}]}});}});
  assert.equal(captured.url.hostname,'api.klipy.com');assert.equal(captured.url.searchParams.get('q'),'chat drôle');assert.equal(captured.url.searchParams.get('page'),'2');assert.equal(captured.url.searchParams.get('content_filter'),'high');assert.equal(captured.options.credentials,'omit');assert.deepEqual(result.items.map(x=>x.title),['One','Two']);assert.ok(result.hasNext);assert.equal(result.items[0].url,item.url);
});
test('KLIPY errors are readable without exposing key and empty query requests trends',async()=>{
  let path;await searchKlipy({key:'test-app-key',fetcher:async url=>{path=url.pathname;return Response.json({result:true,data:{data:[]}});}});assert.ok(path.endsWith('/trending'));
  await assert.rejects(searchKlipy({key:'test-app-key',fetcher:async()=>new Response('',{status:429})}),/Quota/);
  assert.throws(()=>klipyResults({result:false}),/invalide/);
});
test('favorites store references only and reject malformed or untrusted entries',()=>{
  const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
  assert.equal(toggleGifFavorite(storage,'alice',item).length,1);assert.deepEqual(readGifFavorites(storage,'bob'),[]);assert.equal(toggleGifFavorite(storage,'alice',item).length,0);
  values.set('alice','not json');assert.deepEqual(readGifFavorites(storage,'alice'),[]);
  values.set('alice',JSON.stringify([{...item,url:'https://evil.test/x'}]));assert.deepEqual(readGifFavorites(storage,'alice'),[]);
});
