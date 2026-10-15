import {test} from 'node:test';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import {authenticatorQr,authenticatorQrImage} from '../public/mfa-qrcode.mjs';
test('Authenticator QR decodes to the exact local enrollment URI',()=>{
  const uri='otpauth://totp/Vesper%3Anyeko?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Vesper&algorithm=SHA1&digits=6&period=30';
  const qr=authenticatorQr(uri),quiet=4,scale=6,size=(qr.getModuleCount()+quiet*2)*scale,data=new Uint8ClampedArray(size*size*4).fill(255);
  for(let y=0;y<qr.getModuleCount();y++)for(let x=0;x<qr.getModuleCount();x++)if(qr.isDark(y,x))for(let dy=0;dy<scale;dy++)for(let dx=0;dx<scale;dx++){const offset=(((y+quiet)*scale+dy)*size+(x+quiet)*scale+dx)*4;data[offset]=data[offset+1]=data[offset+2]=0;}
  assert.equal(jsQR(data,size,size).data,uri);assert.match(authenticatorQrImage(uri),/^data:image\/gif;base64,/);assert.throws(()=>authenticatorQr('https://example.com'));assert.throws(()=>authenticatorQr('otpauth://totp/Vesper?secret=bad'));
});
