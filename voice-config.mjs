import {createHmac} from 'node:crypto';
export const defaultIceServers=[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}];
export function voiceIceServers({servers=defaultIceServers,turnUrls=[],turnSecret='',userId,now=Date.now()}){const result=servers.map(server=>({...server}));if(turnSecret&&turnUrls.length){const username=Math.floor(now/1000+3600)+':'+userId;result.push({urls:turnUrls,username,credential:createHmac('sha1',turnSecret).update(username).digest('base64')});}return result;}
