import {createHmac} from 'node:crypto';
export const defaultIceServers=[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}];
// Only temporary credentials leave the server. A failed configured relay must
// surface as an error rather than silently falling back to an unusable call.
export function cloudflareTurn({keyId='',apiToken='',fetcher=fetch,now=Date.now}={}){
  if(!keyId&&!apiToken)return null;
  if(!keyId||!apiToken)throw new Error('Configurer les deux variables CLOUDFLARE_TURN_KEY_ID et CLOUDFLARE_TURN_API_TOKEN.');
  let cached=null,expires=0,pending=null;
  return async()=>{
    if(cached&&now()<expires)return structuredClone(cached);
    if(!pending)pending=(async()=>{
      try{
        const response=await fetcher('https://rtc.live.cloudflare.com/v1/turn/keys/'+encodeURIComponent(keyId)+'/credentials/generate-ice-servers',{method:'POST',headers:{Authorization:'Bearer '+apiToken,'Content-Type':'application/json'},body:JSON.stringify({ttl:86400}),signal:AbortSignal.timeout(10000)});
        if(!response.ok)throw new Error('provider');
        const data=await response.json();
        const servers=data.iceServers?.filter(server=>{const urls=Array.isArray(server.urls)?server.urls:[server.urls];return urls.length&&urls.every(url=>typeof url==='string'&&/^turns?:/.test(url))&&typeof server.username==='string'&&typeof server.credential==='string';});
        if(!servers?.length)throw new Error('provider');
        cached=servers;expires=now()+3600000;return cached;
      }catch{const error=new Error('Relais vocal indisponible. Vérifiez la configuration Cloudflare TURN dans Railway.');error.status=503;throw error;}
      finally{pending=null;}
    })();
    return structuredClone(await pending);
  };
}
export function voiceIceServers({servers=defaultIceServers,turnUrls=[],turnSecret='',userId,now=Date.now()}){const result=servers.map(server=>({...server}));if(turnSecret&&turnUrls.length){const username=Math.floor(now/1000+3600)+':'+userId;result.push({urls:turnUrls,username,credential:createHmac('sha1',turnSecret).update(username).digest('base64')});}return result;}
