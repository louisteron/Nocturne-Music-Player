const test=require('node:test'),assert=require('node:assert/strict');
const {refine}=require('../electron/audio-sync.cjs');
const {musicBoundary}=require('../src/crossfade.js');
test('Calage temporel : corriger le tempo et le décalage indépendamment de la hauteur',()=>{
 let seed=19761;const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296};
 const notes=Array.from({length:1000},random);const ref={step:.01,rms:Array.from({length:6000},(_,i)=>.1+.1*Math.sin(i*.12)**2+.15*notes[Math.floor(i/8)])};
 const speed=1.132,end=25.237;
 const sample=Array.from({length:800},(_,i)=>{const index=(end-(800-i)*.01*speed)/ref.step,k=Math.floor(index);return (ref.rms[k]+(ref.rms[k+1]-ref.rms[k])*(index-k))*(i>600?(800-i)/200:1)*.7});
 const result=refine(ref,sample,{positionSeconds:end+.17,speed:1.11});assert.ok(result);assert.ok(Math.abs(result.positionSeconds-end)<.025);assert.ok(Math.abs(result.speed-speed)<.002);
 const unrelated=Array.from({length:800},()=>.1+random()*.2);assert.equal(refine(ref,unrelated,{positionSeconds:end,speed:1}),null);
});
test('Outro : terminer au retour du jingle après le fade et avant la fin de la vidéo',()=>{
 const rms=Array.from({length:1100},(_,i)=>i<600?.2:i<800?.2*(800-i)/200:.09);
 const fade={startSeconds:6,endSeconds:9.5,baseline:.2};
 assert.ok(Math.abs(musicBoundary(rms,11,fade)-8)<.06);
 const silent=rms.map((v,i)=>i<800?v:0);assert.ok(musicBoundary(silent,11,fade)<8.2);
});
