export const defaultMicrophone={gain:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true,highpass:true};
export function microphoneSettings(input={}){
  const gain=Number(input.gain??1);
  return {...Object.fromEntries(Object.entries(defaultMicrophone).filter(([key])=>key!=='gain').map(([key,value])=>[key,typeof input[key]==='boolean'?input[key]:value])),gain:Number.isFinite(gain)?Math.max(0,Math.min(3,gain)):1};
}
export function microphoneConstraints(settings){return Object.fromEntries(['echoCancellation','noiseSuppression','autoGainControl'].map(key=>[key,settings[key]]));}
export function microphoneGraph(stream,settings,Context=globalThis.AudioContext||globalThis.webkitAudioContext){
  if(!Context)return null;
  const context=new Context();
  try{
    const source=context.createMediaStreamSource(stream),filter=context.createBiquadFilter(),gain=context.createGain(),limiter=context.createDynamicsCompressor(),destination=context.createMediaStreamDestination();
    filter.type='highpass';filter.Q.value=.7;limiter.threshold.value=-3;limiter.knee.value=0;limiter.ratio.value=20;limiter.attack.value=.003;limiter.release.value=.15;
    source.connect(filter);filter.connect(gain);gain.connect(limiter);limiter.connect(destination);
    const graph={context,stream:destination.stream,update(value){gain.gain.setTargetAtTime(value.gain,context.currentTime,.015);filter.frequency.setTargetAtTime(value.highpass?80:0,context.currentTime,.015);},async close(){source.disconnect();filter.disconnect();gain.disconnect();limiter.disconnect();destination.stream.getTracks().forEach(t=>t.stop());await context.close().catch(()=>{});}};
    graph.update(settings);return graph;
  }catch(error){context.close().catch(()=>{});throw error;}
}
