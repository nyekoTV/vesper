import {DatabaseSync} from 'node:sqlite';
import {existsSync} from 'node:fs';
import {randomBytes,scryptSync} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export function grantAdministrator(db,username){
  const user=db.prepare('SELECT id,username,suspended FROM users WHERE username=?').get(username);
  if(!user)throw new Error('Compte introuvable : '+username+'. Aucun droit modifié.');
  if(user.suspended)throw new Error('Ce compte est suspendu. Aucun droit modifié.');
  let code=null;
  db.exec('BEGIN IMMEDIATE');
  try{
    if(!db.prepare('SELECT value FROM settings WHERE key=?').get('admin_code_hash')?.value){
      code=randomBytes(24).toString('base64url');const salt=randomBytes(16).toString('hex');
      const hash=scryptSync(code,salt,64,{N:32768,r:8,p:1,maxmem:67108864}).toString('hex');
      const put=db.prepare('INSERT OR REPLACE INTO settings VALUES(?,?)');put.run('admin_code_salt',salt);put.run('admin_code_hash',hash);
    }
    db.prepare('UPDATE users SET is_admin=1 WHERE id=?').run(user.id);
    db.prepare('UPDATE sessions SET admin_expires=0 WHERE user_id=?').run(user.id);
    db.prepare('INSERT INTO admin_audit(actor_id,action,target,details,created) VALUES(?,?,?,?,?)').run(user.id,'administrator_granted_console',user.id,JSON.stringify({username:user.username}),Date.now());
    db.exec('COMMIT');return {id:user.id,username:user.username,code};
  }catch(error){db.exec('ROLLBACK');throw error;}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const [action,username,...extra]=process.argv.slice(2);
    if(action!=='grant'||!username||extra.length)throw new Error('Usage : node scripts/admin-user.mjs grant nyeko');
    const path=process.env.DATA_FILE||'/data/vesper.sqlite';
    if(!existsSync(path))throw new Error('Base existante introuvable : '+path);
    const db=new DatabaseSync(path);db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON');
    try{const result=grantAdministrator(db,username);console.log('Administrateur : @'+result.username+' (id '+result.id+'). Reconnectez ce compte dans Vesper.');
      if(result.code)console.log('Nouveau code du panneau admin à conserver en privé : '+result.code);
      else console.log('Le code du panneau existant est conservé.');
    }finally{db.close();}
  }catch(error){console.error(error.message);process.exitCode=1;}
}
