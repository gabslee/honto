/** Bounds-checked ISO BMFF metadata reader. Never trusts client-supplied duration or dimensions. */
export function inspectDailyVideo(bytes: Uint8Array): { durationMs:number; width:number; height:number } | null {
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let durationMs = 0; const tracks: {width:number;height:number}[]=[]; let mp4=false;
  const tag=(p:number)=>String.fromCharCode(...bytes.subarray(p,p+4));
  function boxes(start:number,end:number,depth:number) {
    if(depth>4) throw new Error('Nested MP4');
    for(let p=start;p<end;) {
      if(p+8>end) throw new Error('Short box');
      let size=view.getUint32(p), header=8;
      if(size===1) {if(p+16>end)throw new Error('Short box'); const n=view.getBigUint64(p+8);if(n>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Large box');size=Number(n);header=16;}
      if(size===0)size=end-p;
      if(size<header||p+size>end)throw new Error('Invalid box');
      const type=tag(p+4), s=p+header, e=p+size;
      if(type==='ftyp') {if(e-s<8)throw new Error('Short ftyp');mp4=true;}
      if(type==='moov'||type==='trak')boxes(s,e,depth+1);
      if(type==='mvhd') {
        const v=bytes[s]; if(v!==0&&v!==1)throw new Error('Version');
        const offset=v===1?20:12, length=v===1?8:4;
        if(s+offset+4+length>e)throw new Error('Short mvhd');
        const scale=view.getUint32(s+offset);
        const duration=v===1?Number(view.getBigUint64(s+offset+4)):view.getUint32(s+offset+4);
        if(!scale||!Number.isSafeInteger(duration))throw new Error('Duration');
        durationMs=duration/scale*1000;
      }
      if(type==='tkhd') {
        if(e-s<84)throw new Error('Short tkhd');
        const width=view.getUint32(e-8)/65536,height=view.getUint32(e-4)/65536;
        if(width&&height)tracks.push({width,height});
      }
      p=e;
    }
  }
  try{boxes(0,bytes.length,0);}catch{return null;}
  if(!mp4||durationMs<=0||durationMs>15000||tracks.length!==1)return null;
  const {width,height}=tracks[0];
  if(!Number.isInteger(width)||!Number.isInteger(height)||Math.max(width,height)>1280||Math.min(width,height)>720)return null;
  return {durationMs:Math.ceil(durationMs),width,height};
}
