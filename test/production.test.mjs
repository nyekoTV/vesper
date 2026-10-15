import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {validateProduction} from '../scripts/start-production.mjs';

const valid={ORIGIN:'https://vesper.example.com',DATA_FILE:resolve('test-data/vesper.sqlite'),RESEND_API_KEY:'synthetic-test-key',MAIL_FROM:'Vesper <test@example.com>'};
test('production requires HTTPS, persistent data and verification mail',()=>{
  assert.doesNotThrow(()=>validateProduction(valid));
  assert.doesNotThrow(()=>validateProduction({...valid,RESEND_API_KEY:'',MAIL_FROM:'',GITHUB_CLIENT_ID:'synthetic-id',GITHUB_CLIENT_SECRET:'synthetic-secret'}));
  assert.throws(()=>validateProduction({...valid,RESEND_API_KEY:'',GITHUB_CLIENT_ID:'synthetic-id'}));
  for(const patch of [{ORIGIN:''},{ORIGIN:'http://vesper.example.com'},{ORIGIN:valid.ORIGIN+'/'},{DATA_FILE:'data/vesper.sqlite'},{RESEND_API_KEY:''},{MAIL_FROM:''}])assert.throws(()=>validateProduction({...valid,...patch}));
});
test('Railway startup rejects an absent or incorrect volume',()=>{
  const env={...valid,RAILWAY_ENVIRONMENT_ID:'synthetic-environment'};
  assert.throws(()=>validateProduction(env),/volume Railway/);
  assert.throws(()=>validateProduction({...env,RAILWAY_VOLUME_MOUNT_PATH:'/data'}),/DATA_FILE/);
  assert.doesNotThrow(()=>validateProduction({...env,RAILWAY_VOLUME_MOUNT_PATH:'/data',DATA_FILE:'/data/vesper.sqlite'}));
});
