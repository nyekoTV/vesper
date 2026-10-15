import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync,readFileSync,writeFileSync,existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, randomInt, scrypt, timingSafeEqual, createHash, createHmac, createPublicKey, verify } from 'node:crypto';
import { promisify } from 'node:util';
import { canonical } from './public/crypto.mjs';
import {normalizeEmail,encodeBase32,encryptMfa,decryptMfa,matchTotp,resendMailer} from './security.mjs';
import {installAdmin} from './admin.mjs';
import {githubIdentity} from './oauth.mjs';
const hashPassword = promisify(scrypt), ROOT = dirname(fileURLToPath(import.meta.url));
const json = value => JSON.stringify(value), parse = value => JSON.parse(value);
const fail = (status, message) => { const error = new Error(message); error.status = status; throw error; };
const text = (value, max = 100) => { if (typeof value !== 'string' || !value.trim() || value.length > max) fail(400,'Texte invalide.'); return value.trim(); };
const id = () => randomUUID(), now = () => Date.now();
const permissions = ['manageChannels','manageRoles','moderateMessages'];
const publicUser = row => ({ id: row.id, username: row.username, ...parse(row.profile), publicKey: parse(row.public_key), signingKey: parse(row.signing_key) });
export function createApp({ databasePath = resolve(ROOT,'data/vesper.sqlite'), origin = 'http://localhost:4180', iceServers = [], secureCookies = origin.startsWith('https:'),sendVerificationEmail=null,requireEmailVerification=!!sendVerificationEmail||!['localhost','127.0.0.1'].includes(new URL(origin).hostname),adminCode=null,github={} } = {}) {
  if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, salt TEXT NOT NULL, profile TEXT NOT NULL, public_key TEXT NOT NULL, signing_key TEXT NOT NULL, vault TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS spaces(id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL DEFAULT 'community', pair TEXT UNIQUE);
    CREATE TABLE IF NOT EXISTS roles(id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE, name TEXT NOT NULL, color TEXT NOT NULL, permissions TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS members(space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id), role_id TEXT NOT NULL REFERENCES roles(id), PRIMARY KEY(space_id,user_id));
    CREATE TABLE IF NOT EXISTS channels(id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE, name TEXT NOT NULL, topic TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL, private INTEGER NOT NULL DEFAULT 0, access TEXT NOT NULL DEFAULT '[]');
    CREATE TABLE IF NOT EXISTS messages(seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE, author_id TEXT NOT NULL REFERENCES users(id), payload TEXT NOT NULL, created INTEGER NOT NULL, edited INTEGER, pinned INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS messages_channel ON messages(channel_id,seq);
    CREATE TABLE IF NOT EXISTS invites(token TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE, expires INTEGER NOT NULL, uses INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS email_challenges(user_id TEXT PRIMARY KEY REFERENCES users(id),code_hash TEXT NOT NULL,expires INTEGER NOT NULL,tries INTEGER NOT NULL,sent INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS friendships(id TEXT PRIMARY KEY,pair TEXT UNIQUE NOT NULL,sender_id TEXT NOT NULL REFERENCES users(id),recipient_id TEXT NOT NULL REFERENCES users(id),status TEXT NOT NULL CHECK(status IN ('pending','accepted')),created INTEGER NOT NULL);
  `);
  const oauth=githubIdentity({db,origin,...github});
  const userColumns=new Set(db.prepare('PRAGMA table_info(users)').all().map(column=>column.name));
  for(const [column,type]of Object.entries({email:'TEXT',email_verified:'INTEGER NOT NULL DEFAULT 0',mfa_secret:'TEXT',mfa_pending:'TEXT',mfa_pending_expires:'INTEGER',mfa_last_counter:'INTEGER NOT NULL DEFAULT -1',recovery_hashes:"TEXT NOT NULL DEFAULT '[]'",mfa_failures:'INTEGER NOT NULL DEFAULT 0',mfa_locked_until:'INTEGER NOT NULL DEFAULT 0',onboarding_seen:'INTEGER NOT NULL DEFAULT 1',is_admin:'INTEGER NOT NULL DEFAULT 0',suspended:'INTEGER NOT NULL DEFAULT 0',admin_failures:'INTEGER NOT NULL DEFAULT 0',admin_locked_until:'INTEGER NOT NULL DEFAULT 0'}))if(!userColumns.has(column))db.exec(`ALTER TABLE users ADD COLUMN ${column} ${type}`);
  if(!db.prepare('PRAGMA table_info(sessions)').all().some(column=>column.name==='admin_expires'))db.exec('ALTER TABLE sessions ADD COLUMN admin_expires INTEGER NOT NULL DEFAULT 0');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users(email) WHERE email IS NOT NULL');
  let mfaKey;
  if(databasePath===':memory:')mfaKey=randomBytes(32);else{const keyPath=databasePath+'.mfa-key';if(!existsSync(keyPath))writeFileSync(keyPath,randomBytes(32),{flag:'wx',mode:0o600});mfaKey=readFileSync(keyPath);if(mfaKey.length!==32)throw new Error('Clé MFA locale invalide.');}
  const get = (sql,...values) => db.prepare(sql).get(...values), all = (sql,...values) => db.prepare(sql).all(...values), run = (sql,...values) => db.prepare(sql).run(...values);
  run('INSERT OR IGNORE INTO settings VALUES(?,?)','authDomain',randomBytes(32).toString('hex'));
  const authDomain=get('SELECT value FROM settings WHERE key=?','authDomain').value;
  const digest=value=>createHash('sha256').update(value).digest('hex');
  const emailCodeHash=(user,code)=>createHmac('sha256',mfaKey).update('email:'+user.id+':'+user.email+':'+code).digest('hex');
  function email(value){try{return normalizeEmail(value);}catch(error){fail(400,error.message);}}
  async function checkPassword(user,secret){if(typeof secret!=='string'||secret.length!==44)fail(400,'Secret d’authentification invalide.');const hash=await hashPassword(secret,user.salt,64,{N:32768,r:8,p:1,maxmem:67108864});if(!timingSafeEqual(hash,Buffer.from(user.password_hash,'hex')))fail(401,'Mot de passe incorrect.');}
  function revokeOtherSessions(userId,token){run('DELETE FROM sessions WHERE user_id=? AND token<>?',userId,token);for(const entry of streams.get(userId)||[])if(entry.token!==token)entry.response.end();}
  function consumeMfa(user,code){
    if(user.mfa_locked_until>now())fail(429,'Double authentification temporairement bloquée. Réessayez dans cinq minutes.');
    const normalized=typeof code==='string'?code.replace(/[\s-]/g,'').toLowerCase():'';
    const recovery=parse(user.recovery_hashes),recoveryIndex=/^[a-f0-9]{20}$/.test(normalized)?recovery.indexOf(digest(normalized)):-1;
    if(recoveryIndex>=0){recovery.splice(recoveryIndex,1);run('UPDATE users SET recovery_hashes=?,mfa_failures=0,mfa_locked_until=0 WHERE id=?',json(recovery),user.id);return;}
    const counter=user.mfa_secret?matchTotp(decryptMfa(user.mfa_secret,mfaKey),normalized,user.mfa_last_counter):null;
    if(counter!==null){run('UPDATE users SET mfa_last_counter=?,mfa_failures=0,mfa_locked_until=0 WHERE id=?',counter,user.id);return;}
    const failures=user.mfa_failures+1;run('UPDATE users SET mfa_failures=?,mfa_locked_until=? WHERE id=?',failures>=5?0:failures,failures>=5?now()+300000:0,user.id);fail(401,'Code de double authentification invalide ou déjà utilisé.');
  }
  async function issueVerification(user){
    if(!user.email)fail(400,'Ajoutez d’abord une adresse e-mail.');if(user.email_verified)fail(409,'Adresse déjà vérifiée.');if(!sendVerificationEmail)fail(503,'Le service d’envoi d’e-mails n’est pas configuré.');
    const previous=get('SELECT sent FROM email_challenges WHERE user_id=?',user.id);if(previous&&now()-previous.sent<60000)fail(429,'Attendez une minute avant de demander un autre code.');
    const code=randomInt(1000000).toString().padStart(6,'0');run('INSERT OR REPLACE INTO email_challenges VALUES(?,?,?,?,?)',user.id,emailCodeHash(user,code),now()+900000,0,now());
    try{await sendVerificationEmail({to:user.email,code});}catch{run('DELETE FROM email_challenges WHERE user_id=?',user.id);fail(503,'L’e-mail n’a pas pu être envoyé. Réessayez plus tard.');}
  }
  const transaction = action => { db.exec('BEGIN'); try { const result = action(); db.exec('COMMIT'); return result; } catch(error) { db.exec('ROLLBACK'); throw error; } };
  const streams = new Map(), voice = new Map(), attempts = new Map();let closing=false;
  const allowedOrigins = new Set([origin]);
  const configuredUrl = new URL(origin);
  if(configuredUrl.protocol==='http:'&&['localhost','127.0.0.1'].includes(configuredUrl.hostname)){
    allowedOrigins.add(`http://localhost:${configuredUrl.port}`);
    allowedOrigins.add(`http://127.0.0.1:${configuredUrl.port}`);
  }
  function member(spaceId,userId) {
    const row = get('SELECT m.*,r.permissions,s.owner_id,s.kind FROM members m JOIN roles r ON r.id=m.role_id JOIN spaces s ON s.id=m.space_id WHERE m.space_id=? AND m.user_id=?',spaceId,userId);
    if (!row) fail(403,'Vous ne faites pas partie de cet espace.'); return row;
  }
  function can(spaceId,userId,permission) { const row = member(spaceId,userId); return row.owner_id === userId || !!parse(row.permissions)[permission]; }
  function requirePermission(spaceId,userId,permission) { if (!can(spaceId,userId,permission)) fail(403,'Votre rôle ne permet pas cette action.'); }
  function channelAccess(channelId,userId) {
    const channel = get('SELECT * FROM channels WHERE id=?',channelId); if (!channel) fail(404,'Salon introuvable.');
    const membership = member(channel.space_id,userId);
    if (channel.private && membership.owner_id !== userId && !parse(channel.access).includes(userId)) fail(403,'Salon privé.');
    return channel;
  }
  function allowed(channel,userId) { try { channelAccess(channel.id,userId); return true; } catch { return false; } }
  function send(userId,event) { for (const entry of streams.get(userId) || []) entry.response.write('data: '+json(event)+'\n\n'); }
  function notifySpace(spaceId,event={ type: 'state' }) { for (const row of all('SELECT user_id FROM members WHERE space_id=?',spaceId)) send(row.user_id,event); }
  function notifyFriends(userId){for(const row of all('SELECT sender_id,recipient_id FROM friendships WHERE sender_id=? OR recipient_id=?',userId,userId))send(row.sender_id===userId?row.recipient_id:row.sender_id,{type:'state'});}
  function notifyChannel(channel,event) { for (const row of all('SELECT user_id FROM members WHERE space_id=?',channel.space_id)) if (allowed(channel,row.user_id)) send(row.user_id,event); }
  function voiceState(channelId) { const channel = get('SELECT * FROM channels WHERE id=?',channelId); if (channel) notifyChannel(channel,{type:'voice',channelId,users:[...(voice.get(channelId)?.keys() || [])]}); }
  function leaveVoice(userId) { for (const [channelId,users] of voice) if (users.delete(userId)) { if (!users.size) voice.delete(channelId); voiceState(channelId); } }
  function cleanupVoice(spaceId) { for (const [channelId,users] of voice) { const channel=get('SELECT * FROM channels WHERE id=?',channelId); if (!channel || channel.space_id===spaceId) for (const userId of [...users.keys()]) if (!channel || !allowed(channel,userId)) { users.delete(userId);send(userId,{type:'voice-kick'}); } if (!users.size) voice.delete(channelId); else voiceState(channelId); } }
  function state(userId) {
    const me = get('SELECT * FROM users WHERE id=?',userId);
    const spaces = all('SELECT s.* FROM spaces s JOIN members m ON m.space_id=s.id WHERE m.user_id=?',userId).map(space => {
      const members = all('SELECT u.*,m.role_id FROM users u JOIN members m ON m.user_id=u.id WHERE m.space_id=?',space.id).map(row => ({...publicUser(row),roleId:row.role_id,online:streams.has(row.id)}));
      const roles = all('SELECT * FROM roles WHERE space_id=?',space.id).map(role=>({id:role.id,name:role.name,color:role.color,permissions:parse(role.permissions)}));
      const channels = all('SELECT * FROM channels WHERE space_id=?',space.id).filter(channel=>allowed(channel,userId)).map(channel=>({id:channel.id,name:channel.name,topic:channel.topic,kind:channel.kind,private:!!channel.private,access:parse(channel.access),voiceUsers:[...(voice.get(channel.id)?.keys()||[])]}));
      return {id:space.id,name:space.name,icon:space.icon,ownerId:space.owner_id,kind:space.kind,members,roles,channels,lastActivity:space.kind==='dm'?(get('SELECT MAX(m.created) AS latest FROM messages m JOIN channels c ON c.id=m.channel_id WHERE c.space_id=?',space.id).latest||0):0};
    });
    const friends=[],friendRequests={incoming:[],outgoing:[]};
    for(const friendship of all('SELECT * FROM friendships WHERE sender_id=? OR recipient_id=? ORDER BY created DESC',userId,userId)){
      const peer=get('SELECT * FROM users WHERE id=?',friendship.sender_id===userId?friendship.recipient_id:friendship.sender_id);
      const person={...publicUser(peer),friendshipId:friendship.id,online:friendship.status==='accepted'&&streams.has(peer.id)&&parse(peer.profile).status!=='invisible'};
      if(friendship.status==='accepted')friends.push(person);else friendRequests[friendship.recipient_id===userId?'incoming':'outgoing'].push(person);
    }
    return {me:{...publicUser(me),online:streams.has(userId)},account:{email:me.email,emailVerified:!!me.email_verified,mfaEnabled:!!me.mfa_secret,recoveryCodesRemaining:parse(me.recovery_hashes).length,verificationRequired:requireEmailVerification,mailConfigured:!!sendVerificationEmail,onboardingSeen:!!me.onboarding_seen,administrator:!!me.is_admin},vault:parse(me.vault),spaces,friends,friendRequests,iceServers,instance:admin.settings()};
  }
  function roster(channel) {
    const users = all('SELECT u.* FROM users u JOIN members m ON m.user_id=u.id WHERE m.space_id=? ORDER BY u.id',channel.space_id).filter(row=>!row.suspended&&allowed(channel,row.id)).map(publicUser);
    return { users, hash: createHash('sha256').update(canonical(users.map(user=>({id:user.id,publicKey:user.publicKey,signingKey:user.signingKey})))).digest('hex') };
  }
  function validatePublicKey(key) { if (!key || key.kty!=='EC' || key.crv!=='P-256' || key.d) fail(400,'Clé publique invalide.'); try { createPublicKey({key,format:'jwk'}); } catch { fail(400,'Clé publique invalide.'); } }
  function validatePayload(payload,userId,channel,rosterHash,messageId) {
    if (!payload || payload.v!==1 || payload.authorId!==userId || payload.channelId!==channel.id || typeof payload.id!=='string' || !/^[0-9a-f-]{36}$/i.test(payload.id) || (messageId && payload.id!==messageId)) fail(400,'Message chiffré invalide.');
    const recipients=roster(channel);if(recipients.hash!==rosterHash)fail(409,'Les membres ont changé. Réessayez.');
    const base64=(value,max)=>typeof value==='string' && value.length<=max && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
    if(!base64(payload.iv,16) || Buffer.from(payload.iv,'base64').length!==12 || !base64(payload.ciphertext,240000) || !base64(payload.signature,100))fail(400,'Chiffrement invalide.');
    validatePublicKey(payload.ephemeral);
    if(!payload.envelopes || canonical(Object.keys(payload.envelopes).sort())!==canonical(recipients.users.map(user=>user.id).sort()))fail(400,'Destinataires invalides.');
    for(const envelope of Object.values(payload.envelopes))if(!envelope || !base64(envelope.iv,16) || Buffer.from(envelope.iv,'base64').length!==12 || !base64(envelope.ciphertext,64) || Buffer.from(envelope.ciphertext,'base64').length!==48)fail(400,'Enveloppe invalide.');
    const {signature,...signed}=payload;const user=get('SELECT signing_key FROM users WHERE id=?',userId);
    let verified=false;try{verified=verify('sha256',Buffer.from(canonical(signed)),{key:createPublicKey({key:parse(user.signing_key),format:'jwk'}),dsaEncoding:'ieee-p1363'},Buffer.from(signature,'base64'));}catch{}
    if(!verified)fail(400,'Signature invalide.');
  }
  function createSpace(userId,name,icon,kind='community',otherId=null) {
    return transaction(()=>{
      const spaceId=id(), roleId=id();run('INSERT INTO spaces VALUES(?,?,?,?,?,?)',spaceId,name,icon,userId,kind,otherId?[userId,otherId].sort().join(':'):null);
      run('INSERT INTO roles VALUES(?,?,?,?,?)',roleId,spaceId,'Membre','#a5b4fc',json({}));
      if(kind==='community'){run('INSERT INTO roles VALUES(?,?,?,?,?)',id(),spaceId,'Modération','#38d9b4',json({manageChannels:true,moderateMessages:true}));run('INSERT INTO roles VALUES(?,?,?,?,?)',id(),spaceId,'Administration','#c49bff',json(Object.fromEntries(permissions.map(key=>[key,true]))));}
      run('INSERT INTO members VALUES(?,?,?)',spaceId,userId,roleId);if(otherId)run('INSERT INTO members VALUES(?,?,?)',spaceId,otherId,roleId);
      run('INSERT INTO channels VALUES(?,?,?,?,?,?,?)',id(),spaceId,kind==='dm'?'discussion':'général','Un endroit pour se retrouver.','text',0,'[]');
      if(kind==='community')run('INSERT INTO channels VALUES(?,?,?,?,?,?,?)',id(),spaceId,'Le salon','Discussion vocale, jusqu’à 6 participants.','voice',0,'[]');
      return spaceId;
    });
  }
  async function body(request) { let size=0,chunks=[]; for await(const chunk of request){size+=chunk.length;if(size>350000)fail(413,'Envoi trop volumineux.');chunks.push(chunk);} try{return parse(Buffer.concat(chunks).toString());}catch{fail(400,'Requête JSON invalide.');} }
  function authenticate(request) {
    const token=(request.headers.cookie||'').split(';').map(value=>value.trim()).find(value=>value.startsWith('vesper='))?.slice(7);
    const digest=token?createHash('sha256').update(token).digest('hex'):'';
    const session=get('SELECT s.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>? AND u.suspended=0',digest,now());if(!session)fail(401,'Connectez-vous pour continuer.');return session;
  }
  function sessionCookie(userId,response) { const token=randomBytes(32).toString('hex');run('INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)',createHash('sha256').update(token).digest('hex'),userId,now()+7*86400000);response.setHeader('Set-Cookie',`vesper=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${secureCookies?'; Secure':''}`); }
  function rateLimit(request,key,max=30) { const bucket=(request.socket.remoteAddress||'unknown')+':'+key;const item=attempts.get(bucket)||{time:now(),count:0};if(now()-item.time>60000){item.time=now();item.count=0;}item.count++;attempts.set(bucket,item);if(item.count>max)fail(429,'Trop de tentatives. Réessayez dans une minute.'); }
  const admin=installAdmin({db,code:adminCode,body,replyError:fail,rateLimit,checkPassword,consumeMfa,send,
    revokeUser:userId=>{run('DELETE FROM sessions WHERE user_id=?',userId);send(userId,{type:'session-revoked'});for(const entry of streams.get(userId)||[])entry.response.end();leaveVoice(userId);notifyFriends(userId);},
    notifyAll:event=>{if(event?.type==='messages'){const channel=get('SELECT * FROM channels WHERE id=?',event.channelId);if(channel)notifyChannel(channel,event);}else for(const userId of streams.keys())send(userId,{type:'state'});},
    voiceSnapshot:()=>[...voice].map(([channelId,users])=>({channelId,name:get('SELECT name FROM channels WHERE id=?',channelId)?.name||'Vocal',users:[...users.keys()].map(userId=>{const user=get('SELECT id,username FROM users WHERE id=?',userId);return user;})})),
    kickVoice:(channelId,userId)=>{const users=voice.get(channelId);if(!users)fail(404,'Salon vocal inactif.');for(const target of userId?[userId]:[...users.keys()]){if(!users.has(target))fail(404,'Participant introuvable.');users.delete(target);send(target,{type:'voice-kick'});}if(!users.size)voice.delete(channelId);voiceState(channelId);}
  });
  const server=http.createServer(async(request,response)=>{
    response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Referrer-Policy','no-referrer');response.setHeader('X-Frame-Options','DENY');
    response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const reply=(status,value)=>{response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});response.end(json(value));};
    try{
      const url=new URL(request.url,origin),path=url.pathname,method=request.method;
      if(path.startsWith('/api/oauth/github/')){rateLimit(request,'oauth',30);await oauth.handle(request,response,url);return;}
      if(!path.startsWith('/api/')){
        if(method!=='GET')fail(405,'Méthode non autorisée.');const routes={'/':'index.html','/app.mjs':'app.mjs','/crypto.mjs':'crypto.mjs','/voice.mjs':'voice.mjs','/styles.css':'styles.css','/search.mjs':'search.mjs','/notifications.mjs':'notifications.mjs','/mfa-qrcode.mjs':'mfa-qrcode.mjs','/vendor/qrcode.mjs':'vendor/qrcode.mjs'};
        const file=routes[path];if(!file)fail(404,'Page introuvable.');const contents=await readFile(resolve(ROOT,'public',file));response.writeHead(200,{'Content-Type':file.endsWith('.css')?'text/css; charset=utf-8':file.endsWith('.mjs')?'text/javascript; charset=utf-8':'text/html; charset=utf-8','Cache-Control':'no-cache'});response.end(contents);return;
      }
      if(method!=='GET' && !allowedOrigins.has(request.headers.origin))fail(403,'Origine non autorisée.');
      if(method!=='GET' && !request.headers['content-type']?.startsWith('application/json'))fail(415,'JSON requis.');
      if(path==='/api/config'&&method==='GET'){reply(200,{authDomain,mailConfigured:!!sendVerificationEmail,githubConfigured:oauth.enabled,verificationRequired:requireEmailVerification,registrationOpen:admin.settings().registrationOpen});return;}
      if(path==='/api/auth/register' && method==='POST'){
        if(!admin.settings().registrationOpen)fail(403,'Les inscriptions sont temporairement fermées.');
        rateLimit(request,'auth',10);const input=await body(request),username=text(input.username,24).toLowerCase(),address=email(input.email);if(!/^[a-z0-9_]{3,24}$/.test(username))fail(400,'Identifiant : 3 à 24 lettres, chiffres ou _.');
        if(requireEmailVerification&&oauth.enabled&&!sendVerificationEmail&&!oauth.proof(request))fail(403,'Continuez avec GitHub pour vérifier votre identité avant de créer votre compte.');
        oauth.check(request,null,address);
        if(typeof input.authSecret!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(input.authSecret))fail(400,'Secret d’authentification invalide.');
        validatePublicKey(input.publicKey);validatePublicKey(input.signingKey);
        if(!input.vault||input.vault.v!==1||typeof input.vault.ciphertext!=='string'||input.vault.ciphertext.length>6000||!/^.{24}$/.test(input.vault.salt||'')||!/^.{16}$/.test(input.vault.iv||''))fail(400,'Coffre de clés invalide.');
        const salt=randomBytes(16).toString('hex'),hash=(await hashPassword(input.authSecret,salt,64,{N:32768,r:8,p:1,maxmem:67108864})).toString('hex'),userId=id();
        if(get('SELECT id FROM users WHERE username=?',username))fail(409,'Cet identifiant est déjà utilisé.');
        if(get('SELECT id FROM users WHERE email=?',address))fail(409,'Cette adresse e-mail est déjà associée à un compte.');
        transaction(()=>{run('INSERT INTO users(id,username,password_hash,salt,profile,public_key,signing_key,vault,email,onboarding_seen) VALUES(?,?,?,?,?,?,?,?,?,0)',userId,username,hash,salt,json({displayName:text(input.displayName||username,40),bio:'',avatar:'✦',accent:'#8b7cf8',banner:'aurora',status:'online'}),json(input.publicKey),json(input.signingKey),json(input.vault),address);oauth.bind(request,response,get('SELECT * FROM users WHERE id=?',userId),address);});
        let verificationSent=false;if(sendVerificationEmail)try{await issueVerification(get('SELECT * FROM users WHERE id=?',userId));verificationSent=true;}catch{}
        sessionCookie(userId,response);reply(201,{...state(userId),verificationSent});return;
      }
      if(path==='/api/auth/login'&&method==='POST'){
        rateLimit(request,'auth',10);const input=await body(request),username=text(input.username,24).toLowerCase();if(typeof input.authSecret!=='string'||input.authSecret.length!==44)fail(400,'Secret d’authentification invalide.');
        const user=get('SELECT * FROM users WHERE username=?',username);const hash=await hashPassword(input.authSecret,user?.salt||'invalid-user-salt',64,{N:32768,r:8,p:1,maxmem:67108864});
        if(!user||!timingSafeEqual(hash,Buffer.from(user.password_hash,'hex')))fail(401,'Identifiant ou mot de passe incorrect.');const freshUser=get('SELECT * FROM users WHERE id=?',user.id);if(freshUser.suspended)fail(403,'Ce compte est suspendu.');oauth.check(request,freshUser,freshUser.email);if(freshUser.mfa_secret)consumeMfa(freshUser,input.otp);oauth.bind(request,response,freshUser,freshUser.email);sessionCookie(user.id,response);reply(200,state(user.id));return;
      }
      const session=authenticate(request),userId=session.user_id;
      if(method!=='GET')rateLimit(request,'write',120);
      if(path==='/api/state'&&method==='GET'){reply(200,state(userId));return;}
      if(path==='/api/onboarding/complete'&&method==='POST'){run('UPDATE users SET onboarding_seen=1 WHERE id=?',userId);reply(200,{ok:true});return;}
      if(path==='/api/account/email'&&method==='PATCH'){
        rateLimit(request,'reauth',10);const input=await body(request),account=get('SELECT * FROM users WHERE id=?',userId);await checkPassword(account,input.authSecret);if(account.mfa_secret)consumeMfa(get('SELECT * FROM users WHERE id=?',userId),input.otp);
        const address=email(input.email);if(get('SELECT id FROM users WHERE email=? AND id<>?',address,userId))fail(409,'Cette adresse e-mail est déjà associée à un compte.');
        if(address!==account.email){transaction(()=>{run('UPDATE users SET email=?,email_verified=0 WHERE id=?',address,userId);run('DELETE FROM email_challenges WHERE user_id=?',userId);});revokeOtherSessions(userId,session.token);if(requireEmailVerification){leaveVoice(userId);for(const entry of streams.get(userId)||[])entry.response.end();}}
        reply(200,state(userId));return;
      }
      if(path==='/api/account/email/send'&&method==='POST'){rateLimit(request,'email',5);await issueVerification(get('SELECT * FROM users WHERE id=?',userId));reply(200,{ok:true});return;}
      if(path==='/api/account/email/verify'&&method==='POST'){
        rateLimit(request,'email-check',10);const input=await body(request),account=get('SELECT * FROM users WHERE id=?',userId),challenge=get('SELECT * FROM email_challenges WHERE user_id=?',userId);
        if(!challenge||challenge.expires<now()||challenge.tries>=5)fail(400,'Code expiré ou bloqué. Demandez un nouveau code.');
        if(typeof input.code!=='string'||!/^\d{6}$/.test(input.code)||!timingSafeEqual(Buffer.from(challenge.code_hash),Buffer.from(emailCodeHash(account,input.code)))){run('UPDATE email_challenges SET tries=tries+1 WHERE user_id=?',userId);fail(400,'Code de vérification incorrect.');}
        transaction(()=>{run('UPDATE users SET email_verified=1 WHERE id=?',userId);run('DELETE FROM email_challenges WHERE user_id=?',userId);});reply(200,state(userId));return;
      }
      if(path==='/api/account/mfa/setup'&&method==='POST'){
        rateLimit(request,'reauth',10);const input=await body(request),account=get('SELECT * FROM users WHERE id=?',userId);await checkPassword(account,input.authSecret);if(account.mfa_secret)fail(409,'Double authentification déjà activée.');
        const secret=encodeBase32(randomBytes(20));run('UPDATE users SET mfa_pending=?,mfa_pending_expires=? WHERE id=?',encryptMfa(secret,mfaKey),now()+600000,userId);
        reply(200,{secret,otpauth:'otpauth://totp/'+encodeURIComponent('Vesper:'+account.username)+'?secret='+secret+'&issuer=Vesper&algorithm=SHA1&digits=6&period=30'});return;
      }
      if(path==='/api/account/mfa/enable'&&method==='POST'){
        rateLimit(request,'mfa-enable',5);const input=await body(request),account=get('SELECT * FROM users WHERE id=?',userId);if(!account.mfa_pending||account.mfa_pending_expires<now()||account.mfa_secret)fail(400,'Configuration expirée ou déjà activée.');
        const counter=matchTotp(decryptMfa(account.mfa_pending,mfaKey),input.code);if(counter===null)fail(400,'Code Authenticator invalide.');
        const recoveryCodes=Array.from({length:10},()=>randomBytes(10).toString('hex'));run('UPDATE users SET mfa_secret=mfa_pending,mfa_pending=NULL,mfa_pending_expires=NULL,mfa_last_counter=?,recovery_hashes=?,mfa_failures=0,mfa_locked_until=0 WHERE id=?',counter,json(recoveryCodes.map(digest)),userId);revokeOtherSessions(userId,session.token);reply(200,{recoveryCodes});return;
      }
      if(path==='/api/account/mfa/disable'&&method==='POST'){
        rateLimit(request,'reauth',10);const input=await body(request),account=get('SELECT * FROM users WHERE id=?',userId);await checkPassword(account,input.authSecret);if(!account.mfa_secret)fail(409,'Double authentification inactive.');consumeMfa(get('SELECT * FROM users WHERE id=?',userId),input.code);
        run("UPDATE users SET mfa_secret=NULL,mfa_pending=NULL,mfa_pending_expires=NULL,mfa_last_counter=-1,recovery_hashes='[]',mfa_failures=0,mfa_locked_until=0 WHERE id=?",userId);revokeOtherSessions(userId,session.token);reply(200,{ok:true});return;
      }
      if(requireEmailVerification&&!get('SELECT email_verified FROM users WHERE id=?',userId).email_verified&&path!=='/api/auth/logout')fail(403,'Vérifiez votre adresse e-mail pour accéder à la communauté.');
      if(await admin.handle({path,method,request,session,reply}))return;
      if(admin.settings().maintenance&&method!=='GET'&&!['/api/auth/logout','/api/voice/leave'].includes(path))fail(503,'Les actions de communauté sont temporairement en pause.');
      if(path==='/api/events'&&method==='GET'){
        const list=streams.get(userId)||new Set();if(list.size>=6)fail(429,'Trop de connexions actives.');
        response.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive'});response.write('data: '+json({type:'ready'})+'\n\n');
        const entry={response,token:session.token};list.add(entry);streams.set(userId,list);
        const timer=setInterval(()=>{if(!get('SELECT token FROM sessions WHERE token=? AND expires>?',session.token,now()))response.end();else response.write(': heartbeat\n\n');},20000);timer.unref();
        for(const row of all('SELECT space_id FROM members WHERE user_id=?',userId))notifySpace(row.space_id);notifyFriends(userId);
        request.on('close',()=>{clearInterval(timer);list.delete(entry);if(!list.size){streams.delete(userId);const timeout=setTimeout(()=>{if(!closing&&!streams.has(userId)){leaveVoice(userId);for(const row of all('SELECT space_id FROM members WHERE user_id=?',userId))notifySpace(row.space_id);notifyFriends(userId);}},3000);timeout.unref();}});return;
      }
      if(path==='/api/auth/logout'&&method==='POST'){run('DELETE FROM sessions WHERE token=?',session.token);leaveVoice(userId);for(const entry of streams.get(userId)||[])if(entry.token===session.token)entry.response.end();response.setHeader('Set-Cookie','vesper=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');reply(200,{ok:true});return;}
      if(path==='/api/profile'&&method==='PATCH'){
        const input=await body(request);const current=parse(get('SELECT profile FROM users WHERE id=?',userId).profile);
        const profile={displayName:text(input.displayName,40),bio:typeof input.bio==='string'?input.bio.slice(0,240):current.bio,avatar:text(input.avatar,8),accent:/^#[0-9a-f]{6}$/i.test(input.accent)?input.accent:current.accent,banner:['aurora','sunset','ocean','midnight'].includes(input.banner)?input.banner:current.banner,status:['online','away','busy','invisible'].includes(input.status)?input.status:current.status};
        run('UPDATE users SET profile=? WHERE id=?',json(profile),userId);for(const row of all('SELECT space_id FROM members WHERE user_id=?',userId))notifySpace(row.space_id);notifyFriends(userId);reply(200,publicUser(get('SELECT * FROM users WHERE id=?',userId)));return;
      }
      if(path==='/api/spaces'&&method==='POST'){const input=await body(request);if(all('SELECT space_id FROM members WHERE user_id=?',userId).length>=50)fail(400,'Limite de 50 espaces atteinte.');const spaceId=createSpace(userId,text(input.name,50),text(input.icon||'✦',8));reply(201,{spaceId});return;}
      if(path==='/api/join'&&method==='POST'){
        const input=await body(request);const invite=get('SELECT * FROM invites WHERE token=? AND expires>? AND uses<20',text(input.token,100),now());if(!invite)fail(404,'Invitation expirée ou introuvable.');
        if(!get('SELECT user_id FROM members WHERE space_id=? AND user_id=?',invite.space_id,userId)){if(all('SELECT user_id FROM members WHERE space_id=?',invite.space_id).length>=100)fail(400,'Limite de 100 membres atteinte.');const role=all('SELECT * FROM roles WHERE space_id=?',invite.space_id).find(role=>permissions.every(key=>!parse(role.permissions)[key]));if(!role)fail(409,'Aucun rôle sans privilèges disponible.');transaction(()=>{run('INSERT INTO members VALUES(?,?,?)',invite.space_id,userId,role.id);run('UPDATE invites SET uses=uses+1 WHERE token=?',invite.token);});notifySpace(invite.space_id);}
        reply(200,{spaceId:invite.space_id});return;
      }
      if(path==='/api/dm'&&method==='POST'){
        const input=await body(request),target=get('SELECT * FROM users WHERE username=?',text(input.username,24).toLowerCase());if(!target||target.id===userId)fail(404,'Autre utilisateur introuvable.');const pair=[userId,target.id].sort().join(':');let space=get('SELECT * FROM spaces WHERE pair=?',pair);const spaceId=space?.id||createSpace(userId,'Conversation','↗','dm',target.id);notifySpace(spaceId);reply(201,{spaceId});return;
      }
      let match;
      if(path==='/api/friends/request'&&method==='POST'){
        const input=await body(request),target=get('SELECT * FROM users WHERE username=?',text(input.username,24).toLowerCase());if(!target||target.id===userId)fail(404,'Autre utilisateur introuvable.');
        const pair=[userId,target.id].sort().join(':');if(get('SELECT id FROM friendships WHERE pair=?',pair))fail(409,'Vous êtes déjà amis ou une demande est en attente.');
        if(get('SELECT COUNT(*) AS count FROM friendships WHERE sender_id=? AND status=?',userId,'pending').count>=50)fail(429,'Vous avez déjà 50 demandes en attente.');
        run('INSERT INTO friendships VALUES(?,?,?,?,?,?)',id(),pair,userId,target.id,'pending',now());send(target.id,{type:'state'});send(userId,{type:'state'});reply(201,{ok:true});return;
      }
      if((match=path.match(/^\/api\/friends\/([^/]+)(\/accept)?$/))&&['POST','DELETE'].includes(method)){
        const friendship=get('SELECT * FROM friendships WHERE id=?',match[1]);if(!friendship)fail(404,'Demande ou amitié introuvable.');
        if(method==='POST'){if(!match[2]||friendship.recipient_id!==userId||friendship.status!=='pending')fail(403,'Seul le destinataire peut accepter cette demande.');run('UPDATE friendships SET status=? WHERE id=?','accepted',friendship.id);}else{if(match[2]||![friendship.sender_id,friendship.recipient_id].includes(userId))fail(403,'Vous ne pouvez pas modifier cette amitié.');run('DELETE FROM friendships WHERE id=?',friendship.id);}
        send(friendship.sender_id,{type:'state'});send(friendship.recipient_id,{type:'state'});reply(200,{ok:true});return;
      }
      if((match=path.match(/^\/api\/spaces\/([^/]+)\/invites$/))&&method==='POST'){requirePermission(match[1],userId,'manageChannels');if(member(match[1],userId).kind==='dm')fail(400,'Les conversations privées ne peuvent pas être rejointes.');const token=randomBytes(18).toString('hex');run('INSERT INTO invites VALUES(?,?,?,0)',token,match[1],now()+86400000);reply(201,{token,expires:now()+86400000});return;}
      if((match=path.match(/^\/api\/spaces\/([^/]+)\/channels$/))&&method==='POST'){
        const spaceId=match[1];requirePermission(spaceId,userId,'manageChannels');const input=await body(request);if(member(spaceId,userId).kind==='dm')fail(400,'Salon fixe pour les conversations privées.');
        const channelId=id(),access=Array.isArray(input.access)?input.access:[];for(const target of access)member(spaceId,target);if(!['text','voice'].includes(input.kind))fail(400,'Type de salon invalide.');
        run('INSERT INTO channels VALUES(?,?,?,?,?,?,?)',channelId,spaceId,text(input.name,40),String(input.topic||'').slice(0,160),input.kind,input.private?1:0,json(access));notifySpace(spaceId);reply(201,{channelId});return;
      }
      if((match=path.match(/^\/api\/channels\/([^/]+)$/))&&['PATCH','DELETE'].includes(method)){
        const channel=channelAccess(match[1],userId);requirePermission(channel.space_id,userId,'manageChannels');if(member(channel.space_id,userId).kind==='dm')fail(400,'Salon fixe pour les conversations privées.');
        if(method==='DELETE'){for(const target of voice.get(channel.id)?.keys()||[])send(target,{type:'voice-kick'});voice.delete(channel.id);run('DELETE FROM channels WHERE id=?',channel.id);}else{const input=await body(request),access=Array.isArray(input.access)?input.access:parse(channel.access);for(const target of access)member(channel.space_id,target);run('UPDATE channels SET name=?,topic=?,private=?,access=? WHERE id=?',text(input.name,40),String(input.topic||'').slice(0,160),input.private?1:0,json(access),channel.id);cleanupVoice(channel.space_id);}
        notifySpace(channel.space_id);reply(200,{ok:true});return;
      }
      if((match=path.match(/^\/api\/spaces\/([^/]+)\/roles(?:\/([^/]+))?$/))&&['POST','PATCH','DELETE'].includes(method)){
        const spaceId=match[1];requirePermission(spaceId,userId,'manageRoles');const roleId=match[2];if(member(spaceId,userId).kind==='dm')fail(400,'Rôles fixes pour les conversations privées.');
        if(roleId&&!get('SELECT id FROM roles WHERE id=? AND space_id=?',roleId,spaceId))fail(404,'Rôle introuvable.');
        if(method==='DELETE'){if(!roleId)fail(400,'Rôle requis.');if(get('SELECT user_id FROM members WHERE role_id=?',roleId))fail(409,'Ce rôle est encore attribué.');run('DELETE FROM roles WHERE id=?',roleId);}else{
          const input=await body(request),perms=Object.fromEntries(permissions.map(key=>[key,!!input.permissions?.[key]]));const actor=member(spaceId,userId);
          if(actor.owner_id!==userId && Object.entries(perms).some(([key,value])=>value&&!can(spaceId,userId,key)))fail(403,'Vous ne pouvez pas accorder un droit que vous ne possédez pas.');
          if(roleId&&actor.owner_id!==userId&&all('SELECT user_id FROM members WHERE role_id=?',roleId).some(row=>row.user_id===actor.owner_id))fail(403,'Rôle du propriétaire protégé.');
          const color=/^#[0-9a-f]{6}$/i.test(input.color)?input.color:'#a5b4fc';if(roleId)run('UPDATE roles SET name=?,color=?,permissions=? WHERE id=?',text(input.name,30),color,json(perms),roleId);else run('INSERT INTO roles VALUES(?,?,?,?,?)',id(),spaceId,text(input.name,30),color,json(perms));
        }notifySpace(spaceId);reply(200,{ok:true});return;
      }
      if((match=path.match(/^\/api\/spaces\/([^/]+)\/members\/([^/]+)$/))&&['PATCH','DELETE'].includes(method)){
        const [spaceId,targetId]=match.slice(1);const actor=member(spaceId,userId),target=member(spaceId,targetId);if(actor.kind==='dm')fail(400,'Membres fixes pour les conversations privées.');
        if(targetId===actor.owner_id)fail(403,'Propriétaire protégé.');
        if(method==='DELETE'){requirePermission(spaceId,userId,'manageRoles');if(actor.owner_id!==userId&&parse(target.permissions).manageRoles)fail(403,'Seul le propriétaire peut retirer un administrateur.');run('DELETE FROM members WHERE space_id=? AND user_id=?',spaceId,targetId);cleanupVoice(spaceId);send(targetId,{type:'state'});}else{
          requirePermission(spaceId,userId,'manageRoles');const input=await body(request),role=get('SELECT * FROM roles WHERE id=? AND space_id=?',input.roleId,spaceId);if(!role)fail(400,'Rôle invalide.');
          if(actor.owner_id!==userId && (Object.entries(parse(role.permissions)).some(([key,value])=>value&&!can(spaceId,userId,key)) || parse(target.permissions).manageRoles))fail(403,'Attribution de rôle réservée au propriétaire.');
          run('UPDATE members SET role_id=? WHERE space_id=? AND user_id=?',role.id,spaceId,targetId);
        }notifySpace(spaceId);reply(200,{ok:true});return;
      }
      if((match=path.match(/^\/api\/channels\/([^/]+)\/recipients$/))&&method==='GET'){const channel=channelAccess(match[1],userId);reply(200,roster(channel));return;}
      if((match=path.match(/^\/api\/channels\/([^/]+)\/messages$/))&&['GET','POST'].includes(method)){
        const channel=channelAccess(match[1],userId);if(channel.kind!=='text')fail(400,'Utilisez un salon textuel.');
        if(method==='GET'){const before=Number(url.searchParams.get('before')||Number.MAX_SAFE_INTEGER);if(!Number.isSafeInteger(before)||before<1)fail(400,'Pagination invalide.');const rows=all('SELECT * FROM messages WHERE channel_id=? AND seq<? ORDER BY seq DESC LIMIT 51',channel.id,before);reply(200,{messages:rows.slice(0,50).reverse().map(row=>({...row,payload:parse(row.payload),author:publicUser(get('SELECT * FROM users WHERE id=?',row.author_id))})),hasMore:rows.length>50});return;}
        const input=await body(request);validatePayload(input.payload,userId,channel,input.rosterHash);if(get('SELECT id FROM messages WHERE id=?',input.payload.id))fail(409,'Message déjà envoyé.');run('INSERT INTO messages(id,channel_id,author_id,payload,created) VALUES(?,?,?,?,?)',input.payload.id,channel.id,userId,json(input.payload),now());notifyChannel(channel,{type:'messages',channelId:channel.id,action:'created',messageId:input.payload.id,authorId:userId});reply(201,{id:input.payload.id});return;
      }
      if((match=path.match(/^\/api\/messages\/([^/]+)$/))&&['PATCH','DELETE'].includes(method)){
        const message=get('SELECT * FROM messages WHERE id=?',match[1]);if(!message)fail(404,'Message introuvable.');const channel=channelAccess(message.channel_id,userId);
        if(method==='DELETE'){if(message.author_id!==userId)requirePermission(channel.space_id,userId,'moderateMessages');run('DELETE FROM messages WHERE id=?',message.id);}else{
          const input=await body(request);if('pinned' in input){requirePermission(channel.space_id,userId,'moderateMessages');run('UPDATE messages SET pinned=? WHERE id=?',input.pinned?1:0,message.id);}else{if(message.author_id!==userId)fail(403,'Seul l’auteur peut modifier ce message.');validatePayload(input.payload,userId,channel,input.rosterHash,message.id);run('UPDATE messages SET payload=?,edited=? WHERE id=?',json(input.payload),now(),message.id);}
        }notifyChannel(channel,{type:'messages',channelId:channel.id});reply(200,{ok:true});return;
      }
      if(path==='/api/voice/join'&&method==='POST'){
        const input=await body(request),channel=channelAccess(input.channelId,userId);if(channel.kind!=='voice')fail(400,'Salon vocal requis.');const users=voice.get(channel.id)||new Map();if(users.size>=6&&!users.has(userId))fail(409,'Ce salon vocal est complet (6 participants).');leaveVoice(userId);users.set(userId,{token:session.token});voice.set(channel.id,users);voiceState(channel.id);reply(200,{users:[...users.keys()],iceServers});return;
      }
      if(path==='/api/voice/leave'&&method==='POST'){leaveVoice(userId);reply(200,{ok:true});return;}
      if(path==='/api/voice/signal'&&method==='POST'){
        const input=await body(request),channel=channelAccess(input.channelId,userId),users=voice.get(channel.id);if(!users?.has(userId)||!users.has(input.to)||input.to===userId)fail(403,'Destinataire vocal non autorisé.');
        if(!input.signal||json(input.signal).length>24000||!['offer','answer','candidate'].includes(input.signal.type)||typeof input.signal.nonce!=='string'||input.signal.nonce.length!==36)fail(400,'Signal invalide.');
        const {signature,...signal}=input.signal;let valid=false;try{valid=verify('sha256',Buffer.from(canonical({channelId:channel.id,from:userId,to:input.to,signal})),{key:createPublicKey({key:parse(get('SELECT signing_key FROM users WHERE id=?',userId).signing_key),format:'jwk'}),dsaEncoding:'ieee-p1363'},Buffer.from(signature,'base64'));}catch{}
        if(!valid)fail(400,'Signature du signal invalide.');send(input.to,{type:'signal',channelId:channel.id,from:userId,signal:input.signal});reply(200,{ok:true});return;
      }
      if(path==='/api/voice/kick'&&method==='POST'){const input=await body(request),channel=channelAccess(input.channelId,userId);requirePermission(channel.space_id,userId,'moderateMessages');if(voice.get(channel.id)?.has(input.userId)){voice.get(channel.id).delete(input.userId);send(input.userId,{type:'voice-kick'});voiceState(channel.id);}reply(200,{ok:true});return;}
      fail(404,'Route introuvable.');
    }catch(error){if(!response.headersSent)reply(error.status||500,{error:error.status?error.message:'Erreur serveur.'});else response.end();if(!error.status)console.error(error);}
  });
  const maintenance=setInterval(()=>{run('DELETE FROM sessions WHERE expires<?',now());for(const [key,item] of attempts)if(now()-item.time>120000)attempts.delete(key);for(const [channelId,users]of voice)for(const[userId,entry]of users)if(!get('SELECT token FROM sessions WHERE token=? AND expires>?',entry.token,now())){users.delete(userId);send(userId,{type:'voice-kick'});voiceState(channelId);}},60000);maintenance.unref();
  return {server,db,close:async()=>{closing=true;clearInterval(maintenance);for(const entries of streams.values())for(const entry of entries)entry.response.end();await new Promise(resolve=>server.close(resolve));db.close();}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const port=Number(process.env.PORT||4180),host=process.env.HOST||'127.0.0.1',origin=process.env.ORIGIN||`http://localhost:${port}`;
  const app=createApp({origin,databasePath:process.env.DATA_FILE||resolve(ROOT,'data/vesper.sqlite'),iceServers:process.env.ICE_SERVERS?parse(process.env.ICE_SERVERS):[],sendVerificationEmail:resendMailer({apiKey:process.env.RESEND_API_KEY,from:process.env.MAIL_FROM}),github:{clientId:process.env.GITHUB_CLIENT_ID,clientSecret:process.env.GITHUB_CLIENT_SECRET},adminCode:process.env.ADMIN_PANEL_CODE||null,...(process.env.REQUIRE_EMAIL_VERIFICATION==='1'?{requireEmailVerification:true}:{})});
  app.server.listen(port,host,()=>console.log(`Vesper → ${origin}\nDonnées locales : ${resolve(ROOT,'data')}\nCtrl+C pour arrêter.`));
  let stopping=false;
  const stop=async()=>{if(stopping)return;stopping=true;const deadline=setTimeout(()=>process.exit(1),10000);deadline.unref();await app.close();process.exit(0);};
  process.on('SIGINT',stop);
  process.on('SIGTERM',stop);
}


