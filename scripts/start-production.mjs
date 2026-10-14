import {resolve,isAbsolute} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export function validateProduction(env){
  let origin;
  try{origin=new URL(env.ORIGIN);}catch{throw new Error('ORIGIN doit contenir l’origine HTTPS publique de Vesper.');}
  if(origin.protocol!=='https:'||origin.origin!==env.ORIGIN)throw new Error('ORIGIN doit être une origine HTTPS exacte, sans chemin ni slash final.');
  if(!env.DATA_FILE||!isAbsolute(env.DATA_FILE))throw new Error('DATA_FILE doit pointer vers une base sur le volume persistant (chemin absolu).');
  if(!env.RESEND_API_KEY||!env.MAIL_FROM)throw new Error('Configurer RESEND_API_KEY et MAIL_FROM pour vérifier les comptes en ligne.');
  if(env.RAILWAY_ENVIRONMENT_ID&&env.RAILWAY_VOLUME_MOUNT_PATH!=='/data')throw new Error('Monter un volume Railway sur /data avant de démarrer.');
  if(env.RAILWAY_ENVIRONMENT_ID&&env.DATA_FILE!=='/data/vesper.sqlite')throw new Error('Sur Railway, utiliser DATA_FILE=/data/vesper.sqlite.');
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  validateProduction(process.env);
  const child=spawn(process.execPath,[fileURLToPath(new URL('../server.mjs',import.meta.url))],{
    stdio:'inherit',env:{...process.env,NODE_ENV:'production',HOST:'0.0.0.0',REQUIRE_EMAIL_VERIFICATION:'1'}
  });
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
  child.on('error',()=>{console.error('Impossible de démarrer Vesper.');process.exitCode=1;});
  child.on('exit',(code,signal)=>{process.exitCode=code??(signal?1:0);});
}
