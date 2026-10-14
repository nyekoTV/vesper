import qrcode from './vendor/qrcode.mjs';
export function authenticatorQr(uri){const parsed=new URL(uri);if(parsed.protocol!=='otpauth:'||parsed.hostname!=='totp'||!/^[A-Z2-7]{16,128}$/.test(parsed.searchParams.get('secret')||''))throw new Error('Configuration Authenticator invalide.');const qr=qrcode(0,'M');qr.addData(uri);qr.make();return qr;}
export function authenticatorQrImage(uri){return authenticatorQr(uri).createDataURL(5,20);}
