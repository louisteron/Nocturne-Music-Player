// Affinage temporel indépendant de la hauteur : enveloppes RMS à 10 ms.
function correlation(reference, sample, end, speed, startIndex = 0) {
  const step = reference.step, values = reference.rms;
  let sx=0, sy=0, xx=0, yy=0, xy=0, n=0;
  for(let i=startIndex;i<sample.length;i+=2){
    const x=sample[i], index=(end-(sample.length-i)*.01*speed)/step;
    if(index<0||index>=values.length-1) return -1;
    const k=Math.floor(index), y=values[k]+(values[k+1]-values[k])*(index-k);
    sx+=x;sy+=y;xx+=x*x;yy+=y*y;xy+=x*y;n++;
  }
  const denominator=Math.sqrt(Math.max(0,n*xx-sx*sx)*Math.max(0,n*yy-sy*sy));
  return denominator>1e-9?(n*xy-sx*sy)/denominator:-1;
}
function features(values) {
  const log = values.map(value=>Math.log(Math.max(.0001,value)));
  const sums=[0];for(const value of log)sums.push(sums[sums.length-1]+value);
  return log.map((value,i)=>{const a=Math.max(0,i-30),b=Math.min(log.length,i+31);return value-(sums[b]-sums[a])/(b-a)});
}
function refine(reference, sample, coarse){
  if(!reference?.rms?.length || reference.step>.021 || sample.length<300)return null;
  reference={...reference,rms:features(reference.rms)}; sample=features(sample);
  let best={score:-1};
  // Le tempo d’un remix peut différer de sa hauteur ; ne pas déduire le
  // tempo de la seule vitesse qui a donné la meilleure empreinte.
  for(let speed=Math.max(.6,coarse.speed-.07);speed<=Math.min(1.6,coarse.speed+.07);speed+=.004){
    for(let end=coarse.positionSeconds-.7;end<=coarse.positionSeconds+.7;end+=.02){
      const score=correlation(reference,sample,end,speed);
      if(score>best.score)best={score,speed,positionSeconds:end};
    }
  }
  if(best.score<0)return null;
  const initial=best;
  for(let speed=initial.speed-.004;speed<=initial.speed+.004;speed+=.0005)
    for(let end=initial.positionSeconds-.025;end<=initial.positionSeconds+.025;end+=.005){
      const score=correlation(reference,sample,end,speed);
      if(score>best.score)best={score,speed,positionSeconds:end};
    }
  const ending=correlation(reference,sample,best.positionSeconds,best.speed,Math.max(0,sample.length-200));
  return best.score>=.55 && ending>=.35 ? {...best,endingScore:ending}:null;
}
function relativeLevels(reference, values, duration, step, alignment) {
  const origin=duration-values.length*step;
  return values.map((value,i)=>{
    const center=alignment.positionSeconds+(origin+(i+.5)*step-alignment.anchorSeconds)*alignment.speed;
    const half=step*alignment.speed/2;
    const from=Math.max(0,Math.floor((center-half)/reference.step)),to=Math.min(reference.rms.length,Math.ceil((center+half)/reference.step));
    let sum=0;for(let k=from;k<to;k++)sum+=reference.rms[k]*reference.rms[k];
    const rms=Math.sqrt(sum/Math.max(1,to-from));
    return rms>.0001?Math.min(8,value/rms):value>.001?8:0;
  });
}
module.exports={refine,correlation,relativeLevels};
