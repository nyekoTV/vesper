import {microphoneSettings,microphoneConstraints,microphoneGraph} from './microphone.mjs';
import {signStatement,verifyStatement} from './crypto.mjs';
export class VoiceRoom {
  constructor({api,me,identity,verifyPeer,onChange,onError,onSound=()=>{}}){Object.assign(this,{api,me,identity,verifyPeer,onChange,onError,onSound});this.peers=new Map();this.channelId=null;this.muted=false;this.deafened=false;this.joining=false;this.volume=1;this.outputId='';this.pending=[];this.seenSignals=new Set();this.speaking=new Set();this.meters=new Map();this.epoch=0;this.microphone=microphoneSettings();}
  async join(channelId,deviceId){
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Le micro nécessite localhost ou HTTPS.');if(this.channelId===channelId||this.joining)return;
    await this.leave();this.joining=true;const epoch=this.epoch;
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:{...microphoneConstraints(this.microphone),...(deviceId?{deviceId:{exact:deviceId}}:{})}});
      if(epoch!==this.epoch){stream.getTracks().forEach(t=>t.stop());return;}this.rawStream=stream;this.microphoneGraph=microphoneGraph(stream,this.microphone);this.stream=this.microphoneGraph?.stream||stream;if(this.microphoneGraph)await this.microphoneGraph.context.resume();if(epoch!==this.epoch)return;
      const state=await this.api('/api/voice/join',{channelId});if(epoch!==this.epoch)return;
      this.channelId=channelId;this.iceServers=state.iceServers||[];this.hasRelay=this.iceServers.some(s=>(Array.isArray(s.urls)?s.urls:[s.urls]).some(url=>/^turns?:/.test(url)));
      this.muted=false;this.deafened=false;this.watchLevel(this.me,this.stream);this.sync(state.users);this.joining=false;
      for(const event of this.pending.splice(0))await this.signal(event);this.onChange();this.onSound('join');
    }catch(error){this.joining=false;this.pending=[];if(this.channelId)await this.leave();else await this.releaseMicrophone();throw error;}finally{if(epoch===this.epoch)this.joining=false;}
  }
  async leave(){
    const joined=this.channelId;this.epoch++;this.channelId=null;this.joining=false;this.pending=[];clearTimeout(this.levelTimer);this.levelTimer=null;
    for(const id of [...this.peers.keys()])this.removePeer(id);for(const meter of this.meters.values())meter.source.disconnect();this.meters.clear();this.speaking.clear();
    await this.releaseMicrophone();if(this.levelContext){await this.levelContext.close().catch(()=>{});this.levelContext=null;}
    if(joined)try{await this.api('/api/voice/leave',{});}catch{}this.onChange();if(joined)this.onSound('leave');
  }
  async releaseMicrophone(){this.rawStream?.getTracks().forEach(t=>t.stop());this.rawStream=null;this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;const graph=this.microphoneGraph;this.microphoneGraph=null;if(graph)await graph.close();}
  applyMute(){for(const stream of [this.stream,this.rawStream])stream?.getAudioTracks().forEach(t=>t.enabled=!this.muted);}
  async setMicrophoneSettings(input){const next=microphoneSettings({...this.microphone,...input}),changed=JSON.stringify(microphoneConstraints(next))!==JSON.stringify(microphoneConstraints(this.microphone));if(changed)for(const track of this.rawStream?.getAudioTracks()||[])await track.applyConstraints(microphoneConstraints(next));this.microphone=next;this.microphoneGraph?.update(next);}
  removePeer(id){const entry=this.peers.get(id);if(!entry)return;clearTimeout(entry.restartTimer);clearTimeout(entry.connectTimer);entry.connection.onconnectionstatechange=null;entry.connection.onicecandidate=null;entry.connection.close();entry.audio.srcObject=null;entry.audio.remove();this.peers.delete(id);this.meters.get(id)?.source.disconnect();this.meters.delete(id);this.speaking.delete(id);}
  watchLevel(id,stream){
    const Context=globalThis.AudioContext||globalThis.webkitAudioContext;if(!Context||this.meters.has(id))return;
    try{this.levelContext??=new Context();this.levelContext.resume().catch(()=>{});const source=this.levelContext.createMediaStreamSource(stream),analyser=this.levelContext.createAnalyser();analyser.fftSize=256;source.connect(analyser);this.meters.set(id,{source,analyser,data:new Uint8Array(256)});this.readLevels();}catch{}
  }
  readLevels(){
    if(this.levelTimer||!this.channelId)return;
    const tick=()=>{if(!this.channelId)return;let changed=false;for(const[id,meter]of this.meters){meter.analyser.getByteTimeDomainData(meter.data);const energy=Math.sqrt(meter.data.reduce((sum,v)=>sum+((v-128)/128)**2,0)/meter.data.length);const active=energy>.035&&!(id===this.me&&this.muted);if(active!==this.speaking.has(id)){changed=true;if(active)this.speaking.add(id);else this.speaking.delete(id);}}if(changed)this.onChange();this.levelTimer=setTimeout(tick,160);};tick();
  }
  peer(userId){
    if(this.peers.has(userId))return this.peers.get(userId);
    const connection=new RTCPeerConnection({iceServers:this.iceServers||[],iceCandidatePoolSize:2,iceTransportPolicy:this.forceRelay?'relay':'all'}),audio=document.createElement('audio');audio.autoplay=true;audio.volume=this.volume;audio.muted=this.deafened;audio.setAttribute('playsinline','');document.body.append(audio);
    const entry={connection,audio,candidates:[],status:'connecting',queue:Promise.resolve(),offered:false,restarts:0,iceErrors:new Set()};this.peers.set(userId,entry);this.watchConnection(userId,entry);
    if(this.outputId)this.applyOutput(audio).catch(this.onError);
    for(const track of this.stream.getTracks())connection.addTrack(track,this.stream);
    connection.onicecandidateerror=event=>{entry.iceErrors.add(Number(event.errorCode));};
    connection.ontrack=event=>{if(!this.channelId||this.peers.get(userId)!==entry)return;const stream=event.streams[0]||new MediaStream([event.track]);audio.srcObject=stream;this.watchLevel(userId,stream);audio.play().catch(()=>{entry.autoplayBlocked=true;this.onChange();});};
    connection.onicecandidate=event=>{if(event.candidate&&this.channelId)this.send(userId,{type:'candidate',candidate:event.candidate.toJSON()}).catch(this.onError);};
    connection.onconnectionstatechange=()=>{entry.status=connection.connectionState;if(entry.status==='connected'){clearTimeout(entry.connectTimer);clearTimeout(entry.restartTimer);entry.restartTimer=null;entry.restarts=0;}else if(['failed','disconnected'].includes(entry.status)&&entry.restarts<2&&!entry.restartTimer){entry.restartTimer=setTimeout(()=>{entry.restartTimer=null;if(!this.channelId||this.peers.get(userId)!==entry||entry.status==='connected')return;entry.restarts++;entry.status='connecting';this.watchConnection(userId,entry);this.onChange();if(this.me<userId)this.offer(userId,true).catch(this.onError);else this.send(userId,{type:'restart'}).catch(this.onError);},entry.status==='failed'?300:3500);}this.onChange();};return entry;
  }
  watchConnection(userId,entry){clearTimeout(entry.connectTimer);entry.connectTimer=setTimeout(()=>{
    if(this.peers.get(userId)!==entry||!this.channelId||entry.connection.connectionState==='connected')return;
    entry.status='failed';this.onChange();
  },20000);}
  async reconnect(relayOnly=false){const channelId=this.channelId;if(!channelId)return;const deviceId=(this.rawStream||this.stream)?.getAudioTracks()[0]?.getSettings?.().deviceId;this.forceRelay=!!relayOnly;await this.leave();await this.join(channelId,deviceId);}
  async diagnostics(){
    const report={relayConfigured:!!this.hasRelay,relayForced:!!this.forceRelay,microphone:this.stream?.getAudioTracks().map(t=>({enabled:t.enabled,state:t.readyState}))||[],peers:[]};
    for(const entry of this.peers.values()){
      const connection=entry.connection,stats=await connection.getStats(),row={connection:connection.connectionState,ice:connection.iceConnectionState,gathering:connection.iceGatheringState,signaling:connection.signalingState,localDescription:!!connection.localDescription,remoteDescription:!!connection.remoteDescription,localCandidates:{},remoteCandidates:{},iceErrorCodes:[...entry.iceErrors],audioSent:0,audioReceived:0};
      stats.forEach(stat=>{if(stat.type==='local-candidate'||stat.type==='remote-candidate'){const target=stat.type==='local-candidate'?row.localCandidates:row.remoteCandidates;target[stat.candidateType]=(target[stat.candidateType]||0)+1;}
        if(stat.type==='transport'){row.dtls=stat.dtlsState;const pair=stats.get(stat.selectedCandidatePairId);if(pair){const local=stats.get(pair.localCandidateId),remote=stats.get(pair.remoteCandidateId);row.selectedPair={state:pair.state,localType:local?.candidateType,remoteType:remote?.candidateType,protocol:local?.protocol,relayProtocol:local?.relayProtocol};}}
        if(stat.kind==='audio'||stat.mediaType==='audio'){if(stat.type==='inbound-rtp')row.audioReceived+=stat.bytesReceived||0;if(stat.type==='outbound-rtp')row.audioSent+=stat.bytesSent||0;}
      });report.peers.push(row);
    }return report;
  }
  enqueue(entry,task){const result=entry.queue.then(task);entry.queue=result.catch(error=>this.onError(error));return result;}
  offer(userId,restart=false){const entry=this.peer(userId),channelId=this.channelId;if(entry.offered&&!restart)return Promise.resolve();entry.offered=true;return this.enqueue(entry,async()=>{if(this.channelId!==channelId||this.peers.get(userId)!==entry)return;await entry.connection.setLocalDescription(await entry.connection.createOffer(restart?{iceRestart:true}:{}));await this.send(userId,{type:'offer',sdp:entry.connection.localDescription.toJSON()});});}
  async send(to,signal){const channelId=this.channelId;if(!channelId)return;await this.verifyPeer(to);if(this.channelId!==channelId)return;const signed={...signal,nonce:crypto.randomUUID()},signature=await signStatement({channelId,from:this.me,to,signal:signed},this.identity);await this.api('/api/voice/signal',{channelId,to,signal:{...signed,signature}});}
  sync(users){
    if(!this.channelId||!this.stream)return;const oldSize=this.peers.size;for(const id of this.peers.keys())if(!users.includes(id))this.removePeer(id);
    for(const id of users)if(id!==this.me){const entry=this.peer(id);if(this.me<id&&!entry.offered)this.offer(id).catch(this.onError);}
    if(!this.joining&&this.peers.size!==oldSize)this.onSound(this.peers.size>oldSize?'peerJoin':'peerLeave');this.onChange();
  }
  async signal(event){
    if(this.joining){if(this.pending.length<100)this.pending.push(event);return;}if(event.channelId!==this.channelId||!this.stream)return;
    const {signature,...signed}=event.signal;if(this.seenSignals.has(signed.nonce))return;
    if(!await verifyStatement({channelId:event.channelId,from:event.from,to:this.me,signal:signed},signature,await this.verifyPeer(event.from)))throw new Error('Signature vocale invalide.');
    if(event.channelId!==this.channelId)return;this.seenSignals.add(signed.nonce);if(this.seenSignals.size>1000)this.seenSignals.delete(this.seenSignals.values().next().value);
    const entry=this.peer(event.from),connection=entry.connection,channelId=this.channelId;
    if(signed.type==='restart'){if(this.me<event.from)await this.offer(event.from,true);return;}
    await this.enqueue(entry,async()=>{if(channelId!==this.channelId||this.peers.get(event.from)!==entry)return;
      if(signed.type==='candidate'){if(connection.remoteDescription)await connection.addIceCandidate(signed.candidate);else entry.candidates.push(signed.candidate);return;}
      await connection.setRemoteDescription(signed.sdp);for(const candidate of entry.candidates.splice(0))await connection.addIceCandidate(candidate);
      if(signed.type==='offer'){await connection.setLocalDescription(await connection.createAnswer());await this.send(event.from,{type:'answer',sdp:connection.localDescription.toJSON()});}
    });
  }
  mute(){if(!this.channelId||this.deafened)return;this.muted=!this.muted;this.applyMute();this.onChange();this.onSound(this.muted?'mute':'unmute');}
  deafen(){if(!this.channelId)return;if(!this.deafened){this.mutedBeforeDeafen=this.muted;this.muted=true;}else this.muted=!!this.mutedBeforeDeafen;this.deafened=!this.deafened;this.applyMute();for(const e of this.peers.values())e.audio.muted=this.deafened;this.onChange();this.onSound(this.deafened?'deafen':'undeafen');}
  setVolume(value){const amount=Number(value);this.volume=Number.isFinite(amount)?Math.max(0,Math.min(1,amount)):1;for(const e of this.peers.values())e.audio.volume=this.volume;}
  async applyOutput(audio){if(typeof audio.setSinkId!=='function'){if(this.outputId)throw new Error('Ce navigateur utilise la sortie audio du système.');return;}await audio.setSinkId(this.outputId);}
  async setOutputDevice(id){const previous=this.outputId;this.outputId=id||'';try{for(const e of this.peers.values())await this.applyOutput(e.audio);}catch(error){this.outputId=previous;for(const e of this.peers.values())await this.applyOutput(e.audio).catch(()=>{});throw error;}}
  async activateAudio(){await this.microphoneGraph?.context.resume();await this.levelContext?.resume();for(const e of this.peers.values()){await e.audio.play();e.autoplayBlocked=false;}this.onChange();}
}
