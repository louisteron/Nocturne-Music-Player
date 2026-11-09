const test=require('node:test'),assert=require('node:assert/strict');
const {createCommandQueue}=require('../electron/playback-commands.cjs');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('Une ancienne pause ne peut pas arrêter le morceau démarré ensuite',async()=>{
 let playing=false,release;const q=createCommandQueue(()=>{playing=false;release?.()});
 const first=q.run('mix',async()=>{await new Promise(resolve=>release=resolve);playing=true});
 await wait(1);
 const obsolete=q.run('mix',()=>{throw Error('Ancien fondu à ignorer')});
 const pause=q.run('pause',async()=>{await wait(30);playing=false});
 const resume=q.run('play',()=>{playing=true});
 await Promise.all([first,obsolete,pause,resume]);assert.equal(playing,true);assert.deepEqual(await obsolete,{cancelled:true});
});
