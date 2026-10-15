import {randomBytes,createHash} from 'node:crypto';
import {normalizeEmail} from './security.mjs';

// The provider proves identity; the vault password and Vesper MFA still apply.
export function githubIdentity({db,origin,clientId,clientSecret,fetcher=fetch,clock=Date.now}){
  const enabled=!!clientId&&!!clientSecret,flows=new Map(),proofs=new Map();
  const columns=db.prepare('PRAGMA table_info(users)').all();
  if(!columns.some(c=>c.name==='github_id'))db.exec('ALTER TABLE users ADD COLUMN github_id TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_github_id ON users(github_id) WHERE github_id IS NOT NULL');
  const random=()=>randomBytes(32).toString('base64url');
  const cookie=(name,value,age,lax=false)=>`${name}=${value}; HttpOnly; SameSite=${lax?'Lax':'Strict'}; Path=/; Max-Age=${age}${origin.startsWith('https:')?'; Secure':''}`;
  const cookies=req=>Object.fromEntries((req.headers.cookie||'').split(';').map(v=>v.trim().split('=')));
  const prune=()=>{for(const map of [flows,proofs])for(const[k,v]of map)if(v.expires<=clock())map.delete(k);};
  const fail=message=>{const e=new Error(message);e.status=400;throw e;};
  const callback=origin+'/api/oauth/github/callback';
  const redirect=(res,url,values)=>{res.writeHead(303,{Location:url,'Cache-Control':'no-store','Set-Cookie':values});res.end();};
  function proof(req){prune();return proofs.get(cookies(req).vesper_github_proof)||null;}
  function check(req,user,address){
    const p=proof(req);if(!p){if(user?.github_id)fail('Continuez avec GitHub avant de déverrouiller votre coffre.');return null;}
    const owner=db.prepare('SELECT id FROM users WHERE github_id=?').get(p.subject);
    if(owner&&owner.id!==user?.id)fail('Cette identité GitHub est déjà liée à un autre compte.');
    if(user?.github_id&&user.github_id!==p.subject)fail('Ce compte est lié à une autre identité GitHub.');
    if(address!==p.email)fail('Utilisez l’adresse vérifiée fournie par GitHub pour ce compte.');
    return p;
  }
  function bind(req,res,user,address){const p=check(req,user,address);if(!p)return;db.prepare('UPDATE users SET github_id=?,email_verified=1 WHERE id=?').run(p.subject,user.id);proofs.delete(cookies(req).vesper_github_proof);res.setHeader('Set-Cookie',cookie('vesper_github_proof','',0));}
  async function handle(req,res,url){
    if(!url.pathname.startsWith('/api/oauth/github/'))return false;
    if(!enabled)fail('La connexion GitHub n’est pas encore configurée sur ce serveur.');
    if(req.method!=='GET')fail('Méthode non autorisée.');prune();
    if(url.pathname==='/api/oauth/github/status'){
      const p=proof(req),linked=p?db.prepare('SELECT username FROM users WHERE github_id=?').get(p.subject):null;
      res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(p?{ready:true,email:p.email,username:linked?.username||null,login:p.login}:{ready:false}));return true;
    }
    if(url.pathname==='/api/oauth/github/start'){
      if(flows.size>=1000)fail('Trop de connexions en cours. Réessayez plus tard.');
      const state=random(),browser=random(),verifier=random();flows.set(state,{browser,verifier,expires:clock()+600000});
      const dest=new URL('https://github.com/login/oauth/authorize');dest.search=new URLSearchParams({client_id:clientId,redirect_uri:callback,scope:'user:email',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',allow_signup:'false'});
      redirect(res,dest.href,[cookie('vesper_github_flow',browser,600,true),cookie('vesper_github_proof','',0)]);return true;
    }
    if(url.pathname==='/api/oauth/github/callback'){
      const key=url.searchParams.get('state'),flow=flows.get(key);flows.delete(key);
      if(!flow||flow.browser!==cookies(req).vesper_github_flow||url.searchParams.has('error')||!url.searchParams.get('code')){redirect(res,'/?github=error',[cookie('vesper_github_flow','',0,true),cookie('vesper_github_proof','',0)]);return true;}
      try{
        const exchange=await fetcher('https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,code:url.searchParams.get('code'),redirect_uri:callback,code_verifier:flow.verifier}),signal:AbortSignal.timeout(10000),redirect:'error'});
        if(!exchange.ok)throw Error();const token=await exchange.json();if(!token.access_token||token.token_type!=='bearer')throw Error();
        const options={headers:{Authorization:'Bearer '+token.access_token,Accept:'application/vnd.github+json','User-Agent':'Vesper'},signal:AbortSignal.timeout(10000),redirect:'error'};
        const profileResponse=await fetcher('https://api.github.com/user',options),emailResponse=await fetcher('https://api.github.com/user/emails',options);
        if(!profileResponse.ok||!emailResponse.ok)throw Error();const profile=await profileResponse.json(),emails=await emailResponse.json();
        const verified=emails.filter(e=>e.verified===true).sort((a,b)=>Number(b.primary)-Number(a.primary))[0];
        if(!Number.isSafeInteger(profile.id)||profile.id<=0||!verified)throw Error();
        if(proofs.size>=1000)throw Error();const ticket=random();proofs.set(ticket,{subject:String(profile.id),login:String(profile.login||''),email:normalizeEmail(verified.email),expires:clock()+600000});
        redirect(res,'/?github=ready',[cookie('vesper_github_flow','',0,true),cookie('vesper_github_proof',ticket,600)]);
      }catch{redirect(res,'/?github=error',[cookie('vesper_github_flow','',0,true),cookie('vesper_github_proof','',0)]);}
      return true;
    }
    fail('Route GitHub inconnue.');
  }
  return {enabled,handle,proof,check,bind};
}
