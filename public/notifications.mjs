export function shouldNotify(event,{me,status,enabled=true}){return enabled&&status!=='busy'&&event.type==='messages'&&event.action==='created'&&typeof event.messageId==='string'&&event.authorId!==me;}
export class NotificationSounds {
  constructor({storage=globalThis.localStorage,Context=globalThis.AudioContext||globalThis.webkitAudioContext,clock=()=>Date.now()}={}){this.storage=storage;this.Context=Context;this.clock=clock;this.context=null;this.seen=new Set();this.lastPlay=-Infinity;}
  get enabled(){return this.storage.getItem('vesper-notification-sound')!=='off';}
  set enabled(value){this.storage.setItem('vesper-notification-sound',value?'on':'off');}
  get volume(){const value=Number(this.storage.getItem('vesper-notification-volume')??'.35');return Number.isFinite(value)?Math.max(0,Math.min(1,value)):.35;}
  set volume(value){this.storage.setItem('vesper-notification-volume',String(Math.max(0,Math.min(1,Number(value)))));}
  async unlock(){try{if(!this.Context)return false;this.context??=new this.Context();if(this.context.state==='suspended')await this.context.resume();return this.context.state==='running';}catch{return false;}}
  async receive(event,{me,status}){
    if(!shouldNotify(event,{me,status,enabled:this.enabled})||this.seen.has(event.messageId))return false;
    this.seen.add(event.messageId);if(this.seen.size>256)this.seen.delete(this.seen.values().next().value);
    const key='vesper-notification-last:'+me;let previous;try{previous=JSON.parse(this.storage.getItem(key)||'null');}catch{}
    if(previous?.id===event.messageId)return false;
    this.storage.setItem(key,JSON.stringify({id:event.messageId,at:this.clock()}));
    if(this.clock()-this.lastPlay<700)return false;
    return this.play();
  }
  async play({test=false}={}){
    if((!test&&!this.enabled)||this.volume===0||!await this.unlock())return false;
    this.lastPlay=this.clock();const start=this.context.currentTime;
    for(const [delay,frequency]of [[0,660],[.1,880]]){
      const oscillator=this.context.createOscillator(),gain=this.context.createGain();oscillator.type='sine';oscillator.frequency.setValueAtTime(frequency,start+delay);
      gain.gain.setValueAtTime(0,start+delay);gain.gain.linearRampToValueAtTime(this.volume*.16,start+delay+.012);gain.gain.exponentialRampToValueAtTime(.0001,start+delay+.22);
      oscillator.connect(gain);gain.connect(this.context.destination);oscillator.start(start+delay);oscillator.stop(start+delay+.23);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
    }return true;
  }
}
export const interactionTones={
  click:[[0,520,.055]],open:[[0,440,.08],[.065,660,.11]],close:[[0,600,.07],[.06,400,.1]],success:[[0,620,.08],[.08,830,.13]],error:[[0,250,.1],[.12,210,.15]],send:[[0,570,.08],[.06,760,.09]],
  join:[[0,440,.1],[.08,660,.12],[.17,880,.14]],leave:[[0,760,.1],[.09,550,.12],[.18,350,.14]],mute:[[0,600,.1],[.1,330,.12]],unmute:[[0,330,.1],[.1,660,.12]],deafen:[[0,420,.1],[.1,260,.12]],undeafen:[[0,260,.1],[.1,540,.12]],peerJoin:[[0,620,.1],[.1,790,.12]],peerLeave:[[0,540,.1],[.1,390,.12]]
};
export class InteractionSounds extends NotificationSounds {
  get enabled(){return this.storage.getItem('vesper-interaction-sound')!=='off';}
  set enabled(value){this.storage.setItem('vesper-interaction-sound',value?'on':'off');}
  get volume(){const value=Number(this.storage.getItem('vesper-interaction-volume')??'.3');return Number.isFinite(value)?Math.max(0,Math.min(1,value)):.3;}
  set volume(value){this.storage.setItem('vesper-interaction-volume',String(Math.max(0,Math.min(1,Number(value)))));}
  async playEffect(name,{test=false}={}){
    if((!test&&!this.enabled)||this.volume===0||!interactionTones[name]||!await this.unlock())return false;
    if(!test&&name==='click'&&this.clock()-this.lastPlay<90)return false;
    this.lastPlay=this.clock();const start=this.context.currentTime;
    for(const[delay,frequency,duration]of interactionTones[name]){const oscillator=this.context.createOscillator(),gain=this.context.createGain();oscillator.type='sine';oscillator.frequency.setValueAtTime(frequency,start+delay);gain.gain.setValueAtTime(0,start+delay);gain.gain.linearRampToValueAtTime(this.volume*.1,start+delay+.008);gain.gain.exponentialRampToValueAtTime(.0001,start+delay+duration);oscillator.connect(gain);gain.connect(this.context.destination);oscillator.start(start+delay);oscillator.stop(start+delay+duration+.01);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};}return true;
  }
}
