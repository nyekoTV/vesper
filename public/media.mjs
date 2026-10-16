export const GIF_LIMIT=512*1024;
export const gifCatalog=[['hello','Coucou','salut bonjour hello wave'],['love','Love','amour coeur love'],['party','Fiesta','fete bravo anniversaire party'],['gg','Bien joué','gg jeu victoire bravo'],['thinking','Hmm…','penser reflechir thinking'],['laugh','MDR','rire lol mdr laugh'],['coffee','Pause café','cafe pause coffee'],['sleep','Bonne nuit','nuit dormir sleep'],['wow','Wow !','surprise wow'],['thanks','Merci','merci thanks coeur']].map(([id,label,tags])=>({id,label,tags,url:'/gifs/'+id+'.gif'}));
export function validGif(value){
  if(!value||typeof value.data!=='string'||value.data.length>Math.ceil(GIF_LIMIT/3)*4||!/^R0lGOD[dl]h[A-Za-z0-9+/]*={0,2}$/.test(value.data))return false;
  try{const header=atob(value.data.slice(0,12));return header.startsWith('GIF87a')||header.startsWith('GIF89a');}catch{return false;}
}
export function gifDataUrl(value){if(!validGif(value))throw new Error('GIF invalide ou supérieur à 512 Ko.');return 'data:image/gif;base64,'+value.data;}
