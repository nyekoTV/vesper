import {mkdir,copyFile} from 'node:fs/promises';
const target=new URL('../public/vendor/',import.meta.url);await mkdir(target,{recursive:true});await copyFile(new URL('../node_modules/qrcode-generator/dist/qrcode.mjs',import.meta.url),new URL('qrcode.mjs',target));
console.log('QR code local prêt.');
