const programCache=new Map(),compilingPrograms=new Map(),parallelCompile=gl.getExtension('KHR_parallel_shader_compile');
const programKey=(vs,fs,attribs)=>vs+'\n/* fragment */\n'+fs+'\n'+JSON.stringify(attribs||['pos']);
function finishProgram(p,shaders){
 if(!gl.getProgramParameter(p,gl.LINK_STATUS)){const log=gl.getProgramInfoLog(p);gl.deleteProgram(p);shaders.forEach(s=>gl.deleteShader(s));throw new Error('Shader link failed: '+log);}
 const u={},n=gl.getProgramParameter(p,gl.ACTIVE_UNIFORMS);for(let i=0;i<n;i++){const info=gl.getActiveUniform(p,i);u[info.name]=gl.getUniformLocation(p,info.name);}
 for(const shader of shaders){gl.detachShader(p,shader);gl.deleteShader(shader);}return{p,u};
}
function submitProgram(vs,fs,attribs){
 const p=gl.createProgram(),shaders=[];
 for(const[type,source]of[[gl.VERTEX_SHADER,vs],[gl.FRAGMENT_SHADER,fs]]){const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);gl.attachShader(p,shader);shaders.push(shader);}
 (attribs||['pos']).forEach((name,i)=>gl.bindAttribLocation(p,i,name));gl.linkProgram(p);return{p,shaders};
}
function program(vs,fs,attribs){const key=programKey(vs,fs,attribs);if(programCache.has(key))return programCache.get(key);const{p,shaders}=submitProgram(vs,fs,attribs),value=finishProgram(p,shaders);programCache.set(key,value);return value;}
function programAsync(vs,fs,attribs){
 const key=programKey(vs,fs,attribs);if(programCache.has(key))return Promise.resolve(programCache.get(key));if(compilingPrograms.has(key))return compilingPrograms.get(key);
 const{p,shaders}=submitProgram(vs,fs,attribs);gl.flush();
 const pending=new Promise((resolve,reject)=>{function poll(){try{if(parallelCompile&&!gl.getProgramParameter(p,parallelCompile.COMPLETION_STATUS_KHR)){setTimeout(poll,8);return;}const value=finishProgram(p,shaders);programCache.set(key,value);resolve(value);}catch(error){reject(error);}}setTimeout(poll,0);}).finally(()=>compilingPrograms.delete(key));
 compilingPrograms.set(key,pending);return pending;
}
