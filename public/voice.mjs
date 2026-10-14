import {signStatement,verifyStatement} from './crypto.mjs';
export class VoiceRoom {
  constructor({api,me,identity,verifyPeer,onChange,onError,onSound=()=>{}}) {this.api=api;this.me=me;this.identity=identity;this.verifyPeer=verifyPeer;this.onChange=onChange;this.onError=onError;this.onSound=onSound;this.peers=new Map();this.channelId=null;this.muted=false;this.deafened=false;this.joining=false;this.volume=1;this.pending=[];this.seenSignals=new Set();}
  async join(channelId,deviceId) {
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Le micro nécessite localhost ou HTTPS.');
    if(this.channelId===channelId)return;
    await this.leave();this.joining=true;
    try{
      this.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,...(deviceId?{deviceId:{exact:deviceId}}:{})}});
      const state=await this.api('/api/voice/join',{channelId});this.channelId=channelId;this.iceServers=state.iceServers;this.muted=false;this.deafened=false;this.sync(state.users);this.joining=false;
      for(const event of this.pending.splice(0))await this.signal(event);this.onChange();this.onSound('join');
    }catch(error){this.joining=false;this.pending=[];this.stream?.getTracks().forEach(track=>track.stop());this.stream=null;throw error;}
  }
  async leave() {
    const wasJoined=this.channelId;this.channelId=null;this.pending=[];
    for(const {connection,audio}of this.peers.values()){connection.close();audio.remove();}this.peers.clear();this.stream?.getTracks().forEach(track=>track.stop());this.stream=null;
    if(wasJoined)try{await this.api('/api/voice/leave',{});}catch{}this.onChange();if(wasJoined)this.onSound('leave');
  }
  peer(userId) {
    if(this.peers.has(userId))return this.peers.get(userId);
    const connection=new RTCPeerConnection({iceServers:this.iceServers||[]});const audio=document.createElement('audio');audio.autoplay=true;audio.volume=this.volume;audio.muted=this.deafened;document.body.append(audio);
    const entry={connection,audio,candidates:[],status:'connexion'};this.peers.set(userId,entry);
    for(const track of this.stream.getTracks())connection.addTrack(track,this.stream);
    connection.ontrack=event=>{audio.srcObject=event.streams[0];audio.play().catch(()=>this.onError(new Error('Cliquez sur « Activer le son » pour autoriser l’audio.')));};
    connection.onicecandidate=event=>{if(event.candidate&&this.channelId)this.send(userId,{type:'candidate',candidate:event.candidate.toJSON()}).catch(this.onError);};
    connection.onconnectionstatechange=()=>{entry.status=connection.connectionState;this.onChange();};return entry;
  }
  async send(to,signal) {const channelId=this.channelId;if(!channelId)return;await this.verifyPeer(to);const signed={...signal,nonce:crypto.randomUUID()};const signature=await signStatement({channelId,from:this.me,to,signal:signed},this.identity);await this.api('/api/voice/signal',{channelId,to,signal:{...signed,signature}});}
  sync(users) {
    if(!this.channelId||!this.stream)return;
    const oldSize=this.peers.size;
    for(const [userId,entry]of this.peers)if(!users.includes(userId)){entry.connection.close();entry.audio.remove();this.peers.delete(userId);}
    for(const userId of users)if(userId!==this.me&&!this.peers.has(userId)){
      const {connection}=this.peer(userId);
      if(this.me<userId)(async()=>{await connection.setLocalDescription(await connection.createOffer());await this.send(userId,{type:'offer',sdp:connection.localDescription.toJSON()});})().catch(this.onError);
    }if(!this.joining&&this.peers.size!==oldSize)this.onSound(this.peers.size>oldSize?'peerJoin':'peerLeave');this.onChange();
  }
  async signal(event) {
    if(this.joining){if(this.pending.length<100)this.pending.push(event);return;}if(event.channelId!==this.channelId||!this.stream)return;
    const {signature,...signed}=event.signal;
    if(this.seenSignals.has(signed.nonce))return;
    if(!await verifyStatement({channelId:event.channelId,from:event.from,to:this.me,signal:signed},signature,await this.verifyPeer(event.from)))throw new Error('Signature vocale invalide.');
    this.seenSignals.add(signed.nonce);if(this.seenSignals.size>1000)this.seenSignals.delete(this.seenSignals.values().next().value);
    const entry=this.peer(event.from),connection=entry.connection,signal=signed;
    try{
      if(signal.type==='candidate'){if(connection.remoteDescription)await connection.addIceCandidate(signal.candidate);else entry.candidates.push(signal.candidate);return;}
      await connection.setRemoteDescription(signal.sdp);
      for(const candidate of entry.candidates.splice(0))await connection.addIceCandidate(candidate);
      if(signal.type==='offer'){await connection.setLocalDescription(await connection.createAnswer());await this.send(event.from,{type:'answer',sdp:connection.localDescription.toJSON()});}
    }catch(error){this.onError(error);}
  }
  mute(){if(!this.channelId)return;this.muted=!this.muted;this.stream?.getAudioTracks().forEach(track=>track.enabled=!this.muted);this.onChange();this.onSound(this.muted?'mute':'unmute');}
  deafen(){if(!this.channelId)return;this.deafened=!this.deafened;for(const entry of this.peers.values())entry.audio.muted=this.deafened;this.onChange();this.onSound(this.deafened?'deafen':'undeafen');}
  setVolume(value){const amount=Number(value);this.volume=Number.isFinite(amount)?Math.max(0,Math.min(1,amount)):1;for(const entry of this.peers.values())entry.audio.volume=this.volume;}
  async activateAudio(){for(const entry of this.peers.values())await entry.audio.play();}
}
