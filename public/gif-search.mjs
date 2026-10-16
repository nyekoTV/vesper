import {validRemoteGif} from './media.mjs';
export function klipyMedia(value){
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&/^static[12]?\.klipy\.com$/.test(url.hostname);}catch{return false;}
}
export function klipyResults(payload){
  if(payload.result===false||!Array.isArray(payload.data?.data))throw new Error('Réponse GIF invalide.');
  return {items:payload.data.data.map(row=>{
    const file=row.file?.sm?.gif||row.file?.xs?.gif||row.file?.md?.gif||row.file?.hd?.gif;
    return {provider:'klipy',url:klipyMedia(file?.url)?file.url:'',slug:String(row.slug||'').slice(0,180),title:String(row.title||'GIF').slice(0,160)};
  }),hasNext:payload.data.has_next===true};
}
export async function searchKlipy({key,query='',page=1,signal,fetcher=fetch}){
  if(!key)throw new Error('Recherche en attente de la configuration KLIPY.');
  const url=new URL('https://api.klipy.com/api/v1/'+encodeURIComponent(key)+'/gifs/'+(query?'search':'trending'));
  url.search=new URLSearchParams({page:String(Math.max(1,Math.min(100,page))),per_page:'24',locale:'fr',content_filter:'high',format_filter:'gif',...(query?{q:query}:{})});
  const response=await fetcher(url,{signal,credentials:'omit',referrerPolicy:'no-referrer'});
  if(!response.ok)throw new Error(response.status===429?'Quota GIF atteint. Réessayez plus tard.':response.status===401||response.status===403?'Clé KLIPY refusée. Vérifiez sa configuration.':'La recherche GIF est indisponible. Réessayez.');
  return klipyResults(await response.json());
}
export function readGifFavorites(storage,key){try{return JSON.parse(storage.getItem(key)||'[]').filter(validRemoteGif).slice(0,40);}catch{return [];}}
export function toggleGifFavorite(storage,key,item){
  if(!validRemoteGif(item))return readGifFavorites(storage,key);
  const old=readGifFavorites(storage,key),found=old.some(row=>row.url===item.url),next=found?old.filter(row=>row.url!==item.url):[item,...old].slice(0,40);
  storage.setItem(key,JSON.stringify(next));return next;
}
