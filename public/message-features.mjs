export const reactionEmojis=['👍','💜','😂','🎉','🔥','👀','✅','🙏'];
export function mentionQuery(text,caret=text.length){return text.slice(0,caret).match(/(?:^|\s)@([a-z0-9_]*)$/i)?.[1]??null;}
export function mentions(text,username){return new RegExp('(^|[^a-z0-9_])@'+username+'(?![a-z0-9_])','i').test(text);}
export function canStartMessage({key,ctrlKey,metaKey,altKey,isComposing,defaultPrevented,editing,dialogOpen,conversationOpen,selection,activatable}){
  return !!conversationOpen&&!dialogOpen&&!editing&&!selection&&!defaultPrevented&&!isComposing&&!ctrlKey&&!metaKey&&!altKey&&typeof key==='string'&&key.length===1&&!(key===' '&&activatable);
}
export class TypingPresence{
  constructor({now=Date.now}={}){this.now=now;this.entries=new Map();}
  update({channelId,userId,active,expires}){const key=channelId+':'+userId;if(!active)this.entries.delete(key);else if(Number.isFinite(expires))this.entries.set(key,{channelId,userId,expires:Math.min(expires,this.now()+6000)});}
  users(channelId,me){const result=[];for(const[key,value]of this.entries){if(value.expires<=this.now())this.entries.delete(key);else if(value.channelId===channelId&&value.userId!==me)result.push(value.userId);}return result;}
}
