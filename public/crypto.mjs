const subtle = globalThis.crypto.subtle;
const encoder = new TextEncoder(), decoder = new TextDecoder();
export const bytes = value => encoder.encode(value);
export function b64(value) { const array=new Uint8Array(value);let result='';for(let offset=0;offset<array.length;offset+=8192)result+=String.fromCharCode(...array.subarray(offset,offset+8192));return btoa(result); }
export function unb64(value) { return Uint8Array.from(atob(value), character => character.charCodeAt(0)); }
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
async function vaultKey(password, salt) {
  const key = await subtle.importKey('raw', bytes(password), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(salt), iterations: 600000 }, key, { name: 'AES-GCM', length: 256 }, false, ['encrypt','decrypt']);
}
export async function authenticationSecret(password, username, domain='vesper-local') {
  const key=await subtle.importKey('raw',bytes(password),'PBKDF2',false,['deriveBits']);
  return b64(await subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:bytes('vesper-auth-v1:'+domain+':'+username),iterations:310000},key,256));
}
export async function signStatement(value, identity) {return b64(await subtle.sign({name:'ECDSA',hash:'SHA-256'},identity.signing,bytes(canonical(value))));}
export async function verifyStatement(value,signature,jwk) {const key=await subtle.importKey('jwk',jwk,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);return subtle.verify({name:'ECDSA',hash:'SHA-256'},key,unb64(signature),bytes(canonical(value)));}
export async function createIdentity(password, username) {
  const encryption = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const signing = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign','verify']);
  const salt = b64(crypto.getRandomValues(new Uint8Array(16))), iv = b64(crypto.getRandomValues(new Uint8Array(12)));
  const secret = { encryption: await subtle.exportKey('jwk', encryption.privateKey), signing: await subtle.exportKey('jwk', signing.privateKey) };
  const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: bytes('vesper-vault-v1:' + username) }, await vaultKey(password,salt), bytes(JSON.stringify(secret)));
  return { publicKey: await subtle.exportKey('jwk', encryption.publicKey), signingKey: await subtle.exportKey('jwk', signing.publicKey), vault: { v: 1, salt, iv, ciphertext: b64(ciphertext) } };
}
export async function unlockIdentity(password, username, vault) {
  const secret = JSON.parse(decoder.decode(await subtle.decrypt({ name: 'AES-GCM', iv: unb64(vault.iv), additionalData: bytes('vesper-vault-v1:' + username) }, await vaultKey(password,vault.salt), unb64(vault.ciphertext))));
  return {
    encryption: await subtle.importKey('jwk', secret.encryption, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']),
    signing: await subtle.importKey('jwk', secret.signing, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  };
}
async function wrappingKey(privateKey, publicJwk, messageId, recipientId) {
  const publicKey = await subtle.importKey('jwk', publicJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = await subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
  const key = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: bytes(messageId), info: bytes('vesper-wrap-v1:' + recipientId) }, key, { name: 'AES-GCM', length: 256 }, false, ['encrypt','decrypt']);
}
function context(payload) { return canonical({ v: payload.v, id: payload.id, channelId: payload.channelId, authorId: payload.authorId }); }
export async function sealMessage(content, { id, channelId, authorId }, recipients, identity) {
  const key = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt','decrypt']);
  const rawKey = await subtle.exportKey('raw', key);
  const ephemeral = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const payload = { v: 1, id, channelId, authorId, ephemeral: await subtle.exportKey('jwk', ephemeral.publicKey), iv: b64(crypto.getRandomValues(new Uint8Array(12))), envelopes: {} };
  const aad = context(payload);
  payload.ciphertext = b64(await subtle.encrypt({ name: 'AES-GCM', iv: unb64(payload.iv), additionalData: bytes(aad) }, key, bytes(JSON.stringify(content))));
  for (const recipient of recipients) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: bytes(aad + ':' + recipient.id) }, await wrappingKey(ephemeral.privateKey, recipient.publicKey, id, recipient.id), rawKey);
    payload.envelopes[recipient.id] = { iv: b64(iv), ciphertext: b64(encrypted) };
  }
  payload.signature = b64(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, identity.signing, bytes(canonical(payload))));
  return payload;
}
export async function openMessage(payload, recipientId, identity, authorSigningKey) {
  const { signature, ...signed } = payload;
  const publicKey = await subtle.importKey('jwk', authorSigningKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  if (!await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, unb64(signature), bytes(canonical(signed)))) throw new Error('Signature invalide.');
  const envelope = payload.envelopes[recipientId];
  if (!envelope) throw new Error('Ce message précède votre accès au salon.');
  const aad = context(payload);
  const rawKey = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(envelope.iv), additionalData: bytes(aad + ':' + recipientId) }, await wrappingKey(identity.encryption, payload.ephemeral, payload.id, recipientId), unb64(envelope.ciphertext));
  const key = await subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
  return JSON.parse(decoder.decode(await subtle.decrypt({ name: 'AES-GCM', iv: unb64(payload.iv), additionalData: bytes(aad) }, key, unb64(payload.ciphertext))));
}
export async function fingerprint(user) {
  const digest = await subtle.digest('SHA-256', bytes(canonical({ publicKey: user.publicKey, signingKey: user.signingKey })));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2,'0')).join('').match(/.{1,8}/g).join(' ');
}
