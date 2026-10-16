import {GIF_LIMIT,validGif} from './public/media.mjs';
const pageHosts=new Set(['tenor.com','www.tenor.com','giphy.com','www.giphy.com']);
export function gifUrl(value){
  let url;try{url=new URL(value);}catch{throw new Error('Collez un lien Tenor ou GIPHY valide.');}
  if(url.protocol!=='https:'||url.username||url.password||url.port||!(pageHosts.has(url.hostname)||['media.tenor.com','c.tenor.com','media.giphy.com','i.giphy.com'].includes(url.hostname)||/^media[0-9]\.(?:giphy|tenor)\.com$/.test(url.hostname)))throw new Error('Seuls les liens HTTPS Tenor et GIPHY sont acceptés.');
  return url;
}
async function download(value,fetcher,signal){
  let url=gifUrl(value);
  for(let i=0;i<4;i++){
    const response=await fetcher(url,{redirect:'manual',signal,headers:{Accept:'image/gif,text/html;q=0.8'}});
    if([301,302,303,307,308].includes(response.status)){await response.body?.cancel();url=gifUrl(new URL(response.headers.get('location'),url).href);continue;}
    if(!response.ok){await response.body?.cancel();throw new Error('Ce GIF est indisponible. Essayez son lien direct ou importez le fichier.');}
    const html=(response.headers.get('content-type')||'').includes('text/html'),limit=html?2*1024*1024:GIF_LIMIT;
    if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel();throw new Error(html?'Page trop volumineuse.':'Ce GIF dépasse 512 Ko. Choisissez une version plus légère.');}
    const reader=response.body.getReader(),chunks=[];let size=0;
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw new Error(html?'Page trop volumineuse.':'Ce GIF dépasse 512 Ko. Choisissez une version plus légère.');chunks.push(value);}}finally{await reader.cancel();}
    return {html,bytes:Buffer.concat(chunks)};
  }
  throw new Error('Trop de redirections pour ce GIF.');
}
const decode=value=>value.replace(/&amp;/g,'&').replace(/&#0*38;/g,'&').replace(/&quot;/g,'"');
export async function importGif(value,{fetcher=fetch}={}){
  const signal=AbortSignal.timeout(12000);let result=await download(value,fetcher,signal),title='GIF importé';
  if(result.html){
    const html=result.bytes.toString('utf8'),candidates=[];
    for(const tag of html.matchAll(/<meta\b[^>]*>/gi)){
      const attrs=Object.fromEntries([...tag[0].matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gs)].map(m=>[m[1].toLowerCase(),decode(m[3])]));
      const name=attrs.property||attrs.name;
      if(name==='og:title')title=attrs.content?.slice(0,80)||title;
      if(['og:image','og:image:url','og:image:secure_url','twitter:image'].includes(name)&&attrs.content)candidates.push(attrs.content);
    }
    const media=candidates.find(link=>{try{const u=gifUrl(link);return !pageHosts.has(u.hostname)&&/\.gif(?:$|[?#])/i.test(u.href);}catch{return false;}});
    if(!media)throw new Error('Aucun GIF trouvé. Copiez l’adresse de l’image GIF ou importez son fichier.');
    result=await download(media,fetcher,signal);
  }
  const gif={title,data:result.bytes.toString('base64')};
  if(result.html||!validGif(gif))throw new Error('Le lien doit contenir une image GIF animée.');
  return gif;
}
