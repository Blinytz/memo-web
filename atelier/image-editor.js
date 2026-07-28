export const IMAGE_FORMAT = Object.freeze({ full:[800,600], thumb:[213,160], ratio:4/3 });

export class ImageEditor {
  constructor(frame, image, preview, onChange = () => {}) {
    this.frame=frame; this.image=image; this.preview=preview; this.onChange=onChange;
    this.points=new Map(); this.undo=[]; this.scale=1; this.stretchX=1; this.stretchY=1; this.x=0; this.y=0;
    this.bind();
  }
  get fw(){ return this.frame.clientWidth } get fh(){ return this.frame.clientHeight }
  get minCover(){ return Math.max(this.fw/this.iw,this.fh/this.ih) }
  get minContain(){ return Math.min(this.fw/this.iw,this.fh/this.ih) }
  get minStretchedCover(){return Math.max(this.fw/(this.iw*this.stretchX),this.fh/(this.ih*this.stretchY))}
  async load(source){ const im=new Image(); im.crossOrigin='anonymous'; await new Promise((ok,no)=>{im.onload=ok;im.onerror=no;im.src=source}); this.source=im;this.iw=im.naturalWidth;this.ih=im.naturalHeight;this.image.src=source;this.fill(); }
  remember(){ this.undo.push({scale:this.scale,stretchX:this.stretchX,stretchY:this.stretchY,x:this.x,y:this.y}); if(this.undo.length>30)this.undo.shift(); }
  back(){ const s=this.undo.pop();if(s){Object.assign(this,s);this.render()} }
  get sx(){return this.scale*this.stretchX} get sy(){return this.scale*this.stretchY}
  fill(){ this.remember();this.stretchX=1;this.stretchY=1;this.scale=this.minCover;this.center(); }
  contain(){ this.remember();this.stretchX=1;this.stretchY=1;this.scale=this.minContain;this.center(false); }
  center(clamp=true){this.x=(this.fw-this.iw*this.sx)/2;this.y=(this.fh-this.ih*this.sy)/2;this.render(clamp)}
  crop(){return {cx:(-this.x/this.sx+this.fw/this.sx/2)/this.iw,cy:(-this.y/this.sy+this.fh/this.sy/2)/this.ih,w:this.fw/this.sx/this.iw,h:this.fh/this.sy/this.ih,stretchX:this.stretchX,stretchY:this.stretchY}}
  setCrop(c){if(!c?.w)return this.fill();this.stretchX=c.stretchX||1;this.stretchY=c.stretchY||1;this.scale=Math.max(this.minCover/Math.min(this.stretchX,this.stretchY),this.fw/(c.w*this.iw*this.stretchX));this.x=-(c.cx*this.iw-this.fw/this.sx/2)*this.sx;this.y=-(c.cy*this.ih-this.fh/this.sy/2)*this.sy;this.render()}
  clamp(){this.x=Math.min(0,Math.max(this.fw-this.iw*this.sx,this.x));this.y=Math.min(0,Math.max(this.fh-this.ih*this.sy,this.y))}
  render(clamp=true){if(clamp)this.clamp();this.image.style.transform=`translate(${this.x}px,${this.y}px) scale(${this.sx},${this.sy})`;this.draw(this.preview,[213,160]);this.onChange(this.crop())}
  zoom(f,cx=this.fw/2,cy=this.fh/2){this.remember();const old=this.scale;this.scale=Math.max(this.minStretchedCover,Math.min(this.minStretchedCover*12,this.scale*f));const real=this.scale/old;this.x=cx-(cx-this.x)*real;this.y=cy-(cy-this.y)*real;this.render()}
  setZoom(percent){const target=this.minStretchedCover*Math.max(1,percent/100),factor=target/this.scale;this.zoom(factor)}
  setPan(px,py){if(px!=null)this.x=(this.fw-this.iw*this.sx)*(px/100);if(py!=null)this.y=(this.fh-this.ih*this.sy)*(py/100);this.render()}
  setStretch(x,y){const cx=this.fw/2,cy=this.fh/2,oldSx=this.sx,oldSy=this.sy;if(x!=null)this.stretchX=x;if(y!=null)this.stretchY=y;this.scale=Math.max(this.scale,this.minStretchedCover);this.x=cx-(cx-this.x)*(this.sx/oldSx);this.y=cy-(cy-this.y)*(this.sy/oldSy);this.render()}
  controls(){return {zoom:Math.round(this.scale/this.minStretchedCover*100),x:this.fw===this.iw*this.sx?50:Math.round(this.x/(this.fw-this.iw*this.sx)*100),y:this.fh===this.ih*this.sy?50:Math.round(this.y/(this.fh-this.ih*this.sy)*100),stretchX:Math.round(this.stretchX*100),stretchY:Math.round(this.stretchY*100)}}
  draw(canvas,[w,h]){if(!this.source)return;const r={x:-this.x/this.sx,y:-this.y/this.sy,w:this.fw/this.sx,h:this.fh/this.sy};canvas.width=w;canvas.height=h;const c=canvas.getContext('2d');c.imageSmoothingQuality='high';c.clearRect(0,0,w,h);c.drawImage(this.source,r.x,r.y,r.w,r.h,0,0,w,h)}
  copyBlob(){const canvas=document.createElement('canvas');this.draw(canvas,[800,600]);return new Promise(ok=>canvas.toBlob(ok,'image/png'))}
  blob(size,quality){const c=document.createElement('canvas');this.draw(c,size);return new Promise(ok=>c.toBlob(ok,'image/webp',quality))}
  async exports(){return {full:await this.blob(IMAGE_FORMAT.full,.9),thumb:await this.blob(IMAGE_FORMAT.thumb,.84),original:await this.original()}}
  original(){const c=document.createElement('canvas'),k=Math.min(1,2400/Math.max(this.iw,this.ih));c.width=Math.round(this.iw*k);c.height=Math.round(this.ih*k);c.getContext('2d').drawImage(this.source,0,0,c.width,c.height);return new Promise(ok=>c.toBlob(ok,'image/webp',.92))}
  bind(){const f=this.frame;f.addEventListener('pointerdown',e=>{f.setPointerCapture(e.pointerId);this.points.set(e.pointerId,{x:e.clientX,y:e.clientY});this.remember();e.preventDefault()});f.addEventListener('pointermove',e=>{const p=this.points.get(e.pointerId);if(!p)return;const other=[...this.points.entries()].find(([id])=>id!==e.pointerId);if(other){const q=other[1],before=Math.hypot(p.x-q.x,p.y-q.y),after=Math.hypot(e.clientX-q.x,e.clientY-q.y),r=f.getBoundingClientRect();if(before)this.zoom(after/before,(e.clientX+q.x)/2-r.left,(e.clientY+q.y)/2-r.top)}else{this.x+=e.clientX-p.x;this.y+=e.clientY-p.y;this.render()}p.x=e.clientX;p.y=e.clientY;e.preventDefault()});const end=e=>this.points.delete(e.pointerId);f.addEventListener('pointerup',end);f.addEventListener('pointercancel',end);f.addEventListener('wheel',e=>{e.preventDefault();const r=f.getBoundingClientRect();this.zoom(e.deltaY<0?1.1:1/1.1,e.clientX-r.left,e.clientY-r.top)},{passive:false})}
}
