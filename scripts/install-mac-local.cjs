// Met à jour uniquement les ressources applicatives de l’installation locale existante.
const asar=require('@electron/asar'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
(async()=>{
 const root=path.resolve(__dirname,'..'),contents='/Applications/Nocturne.app/Contents',archive=path.join(contents,'Resources/app.asar'),plist=path.join(contents,'Info.plist');
 const project=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')),installed=JSON.parse(asar.extractFile(archive,'package.json'));
 if(project.name!==installed.name)throw new Error('L’application installée ne correspond pas au projet.');
 const space=fs.statfsSync(os.tmpdir());if(space.bavail*space.bsize<100*1024*1024)throw new Error('Au moins 100 Mo libres sont nécessaires pour préparer la mise à jour.');
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'nocturne-update-')),originalPlist=fs.readFileSync(plist);let replaced=false;
 try{
  fs.copyFileSync(archive,path.join(temp,'previous.asar'));const app=path.join(temp,'app');asar.extractAll(archive,app);
  for(const directory of ['src','electron']){fs.rmSync(path.join(app,directory),{recursive:true,force:true});fs.cpSync(path.join(root,directory),path.join(app,directory),{recursive:true});}
  installed.version=project.version;fs.writeFileSync(path.join(app,'package.json'),JSON.stringify(installed,null,2)+'\n');
  const next=path.join(temp,'app.asar'),output=await asar.createPackage(app,next);
  // Cette version d'asar retourne le flux après end(), avant son événement finish.
  if(output?.on)await require('node:stream/promises').finished(output);
  const files=[];
  function collect(directory){for(const entry of fs.readdirSync(path.join(root,directory),{withFileTypes:true})){const name=directory+'/'+entry.name;if(entry.isDirectory())collect(name);else if(entry.isFile())files.push(name);}}
  collect('src');collect('electron');
  function verify(archivePath){asar.uncacheAll();for(const name of files)if(!asar.extractFile(archivePath,name).equals(fs.readFileSync(path.join(root,name))))throw new Error('Archive incorrecte : '+name);}
  verify(next);
  const hash=crypto.createHash('sha256').update(asar.getRawHeader(next).headerString).digest('hex');
  fs.copyFileSync(next,archive+'.new');fs.renameSync(archive+'.new',archive);asar.uncacheAll();replaced=true;
  for(const command of ['Set :CFBundleShortVersionString '+project.version,'Set :CFBundleVersion '+project.version,'Set :ElectronAsarIntegrity:Resources/app.asar:hash '+hash])cp.execFileSync('/usr/libexec/PlistBuddy',['-c',command,plist]);
  verify(archive);
  console.log('Nocturne '+project.version+' installé et vérifié.');
 }catch(error){if(replaced){fs.copyFileSync(path.join(temp,'previous.asar'),archive);fs.writeFileSync(plist,originalPlist);}throw error;}
 finally{fs.rmSync(archive+'.new',{force:true});fs.rmSync(temp,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
