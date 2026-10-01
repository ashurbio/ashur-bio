// GPU-drawn backdrop: a slow, domain-warped colour field in the brand palette, topographic contour lines traced
// from the same field (every fifth one heavier, like a survey map), a soft light that follows the pointer, a little
// scroll parallax and film grain (which also hides gradient banding). Colours are read from the --sg-* custom
// properties, so light and dark live in index.css. Without WebGL the CSS gradient under the canvas is the backdrop.

const VERT = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';

const FRAG = `
#ifdef GL_OES_standard_derivatives
#extension GL_OES_standard_derivatives : enable
#endif
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes;
uniform float uTime, uScroll, uLineA, uDark, uGrain;
uniform vec3 uMouse, uBase, uC1, uC2, uC3, uHi, uLine;

// 3D simplex noise, Ashima Arts / Stefan Gustavson (MIT)
vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;}
vec4 mod289(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 permute(vec4 x){return mod289(((x*34.)+1.)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1./6.,1./3.);const vec4 D=vec4(0.,.5,1.,2.);
  vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
  float n_=.142857142857;vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.*x_);
  vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.+1.;vec4 s1=floor(b1)*2.+1.;vec4 sh=-step(h,vec4(0.));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
  vec4 nm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=nm.x;p1*=nm.y;p2*=nm.z;p3*=nm.w;
  vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);m=m*m;
  return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float hash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}

void main(){
  vec2 uv=gl_FragCoord.xy/uRes;
  vec2 p=(gl_FragCoord.xy-.5*uRes)/uRes.y;
  vec2 sp=p-vec2(0.,uScroll);
  float t=uTime*.035;

  // the field: simplex noise bent by two more noise lookups (domain warp)
  vec2 w=vec2(snoise(vec3(sp*.7,t)),snoise(vec3(sp*.7+7.3,t+3.1)));
  float f=snoise(vec3(sp*.85+w*.55,t*1.4));
  float g=snoise(vec3(sp*1.5-w*.4+2.7,t*1.1));

  // colour: blue washes in from the top right, indigo from the bottom left, cyan threads through the middle
  float a1=smoothstep(.62,1.3,uv.y+uv.x*.38+f*.3);
  float a2=smoothstep(.66,1.28,(1.-uv.y)*.95+(1.-uv.x)*.45+g*.3);
  float a3=smoothstep(.25,.95,snoise(vec3(sp*1.1+11.,t*.9))*.5+.5+w.x*.2)*(1.-smoothstep(.1,.55,abs(uv.y-.48)));
  vec3 col=uBase;
  col=mix(col,uC1,a1);
  col=mix(col,uC2,a2*.92);
  col=mix(col,uC3,a3*.5);

  // pointer light
  float dm=length(p-uMouse.xy);
  float lamp=exp(-dm*dm*5.)*uMouse.z;
  col=mix(col,uHi,lamp*.42);

  // contour lines of the same field; quieter in the middle of the screen, brighter under the pointer
  float v=(f*.5+.5+g*.08)*15.;
#ifdef GL_OES_standard_derivatives
  float fw=max(fwidth(v),1e-4);
#else
  float fw=15.*1.6/uRes.y;
#endif
  float k=floor(v+.5);
  float major=1.-step(.5,mod(k,5.));
  float d=abs(fract(v+.5)-.5);
  float line=1.-smoothstep(fw*(.55+.5*major),fw*(1.35+.8*major),d);
  line*=1.-smoothstep(.22,.45,fw);
  float la=uLineA*(1.+.75*major)*(.55+.45*smoothstep(.15,.8,length(p)))*(1.+lamp*1.6);
  col=mix(col,uLine,clamp(line*la,0.,1.));

  // vignette, then grain
  float vig=smoothstep(.5,1.35,length(p*vec2(.85,1.)));
  col*=1.-vig*mix(.05,.38,uDark);
  col+=(hash(gl_FragCoord.xy+fract(uTime*7.)*91.)-.5)*uGrain/255.;
  gl_FragColor=vec4(col,1.);
}`;

const UNIFORMS = ['uRes', 'uTime', 'uScroll', 'uLineA', 'uDark', 'uGrain', 'uMouse', 'uBase', 'uC1', 'uC2', 'uC3', 'uHi', 'uLine'];
const STILL = 40; // the pose (in seconds of animation) shown first, and kept when motion is off
const MAX_PX = 1.6e6; // never shade more pixels than this per frame

const rgb = (s) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(s).trim());
  const n = m ? parseInt(m[1], 16) : 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

// Starts drawing into `canvas`. Returns a cleanup function, or null when WebGL is not available.
export function startBackdrop(canvas) {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
  if (!gl) return null;
  gl.getExtension('OES_standard_derivatives');
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
    return s;
  };
  const prog = gl.createProgram();
  try {
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link');
  } catch (e) {
    console.warn('backdrop: falling back to CSS', e);
    return null;
  }
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); // one triangle covers the screen
  const aPos = gl.getAttribLocation(prog, 'a');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  const U = Object.fromEntries(UNIFORMS.map((n) => [n, gl.getUniformLocation(prog, n)]));

  const root = document.documentElement;
  const dark = matchMedia('(prefers-color-scheme: dark)');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const fps = fine.matches ? 30 : 24; // touch screens only see the slow drift, so they get fewer frames

  const palette = () => {
    const cs = getComputedStyle(root);
    const v = (n) => cs.getPropertyValue(n);
    gl.uniform3fv(U.uBase, rgb(v('--sg-base')));
    gl.uniform3fv(U.uC1, rgb(v('--sg-1')));
    gl.uniform3fv(U.uC2, rgb(v('--sg-2')));
    gl.uniform3fv(U.uC3, rgb(v('--sg-3')));
    gl.uniform3fv(U.uHi, rgb(v('--sg-hi')));
    gl.uniform3fv(U.uLine, rgb(v('--sg-line')));
    gl.uniform1f(U.uLineA, parseFloat(v('--sg-line-a')) || 0.12);
    gl.uniform1f(U.uGrain, parseFloat(v('--sg-grain')) || 2);
    gl.uniform1f(U.uDark, dark.matches ? 1 : 0);
  };

  let scale = Math.min(window.devicePixelRatio || 1, 1.5);
  const resize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    const s = Math.min(scale, Math.sqrt(MAX_PX / (w * h)));
    canvas.width = Math.max(1, Math.round(w * s));
    canvas.height = Math.max(1, Math.round(h * s));
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
  };

  // eased inputs: pointer (x, y in the shader's aspect space; a = strength) and scroll parallax
  const ptr = { x: 0, y: 0, a: 0, tx: 0, ty: 0, ta: 0 };
  const scr = { v: 0, tv: 0 };
  const onMove = (e) => {
    if (!fine.matches || e.pointerType === 'touch') return;
    const h = window.innerHeight;
    ptr.tx = (e.clientX - window.innerWidth / 2) / h;
    ptr.ty = (h / 2 - e.clientY) / h;
    if (!ptr.ta) { ptr.x = ptr.tx; ptr.y = ptr.ty; }
    ptr.ta = 1;
  };
  const onLeave = () => { ptr.ta = 0; };
  const onOut = (e) => { if (!e.relatedTarget) onLeave(); }; // the pointer left the window
  const onScroll = () => { scr.tv = (window.scrollY / Math.max(1, window.innerHeight)) * 0.12; };

  let clock = STILL, raf = 0, last = 0, slow = 0, dirty = true;
  const animated = () => root.dataset.motion !== 'off' && !reduce.matches;
  const draw = () => {
    if (dirty) { resize(); dirty = false; }
    gl.uniform1f(U.uTime, clock);
    gl.uniform3f(U.uMouse, ptr.x, ptr.y, ptr.a);
    gl.uniform1f(U.uScroll, scr.v);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    canvas.classList.add('on');
  };
  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    if (last && now - last < 1000 / fps - 3) return;
    const dt = last ? Math.min(now - last, 100) : 0;
    // adaptive quality: when frames keep arriving late, shade fewer pixels (twice at most)
    if (dt > 55) { if (++slow > 24 && scale > 0.6) { scale *= 0.75; dirty = true; slow = 0; } } else if (slow) slow--;
    last = now;
    clock += dt / 1000;
    const e = 1 - Math.exp(-dt / 220);
    ptr.x += (ptr.tx - ptr.x) * e; ptr.y += (ptr.ty - ptr.y) * e; ptr.a += (ptr.ta - ptr.a) * (1 - Math.exp(-dt / 400));
    scr.v += (scr.tv - scr.v) * (1 - Math.exp(-dt / 300));
    draw();
  };
  // run while the tab is visible and motion is allowed; otherwise hold a single still frame
  const sync = () => {
    const run = animated() && !document.hidden;
    if (run && !raf) { last = 0; raf = requestAnimationFrame(frame); }
    if (!run) {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      ptr.a = ptr.ta = 0; scr.v = scr.tv;
      if (!document.hidden) draw();
    }
  };
  const onResize = () => { dirty = true; if (!raf) sync(); };
  const onTheme = () => { palette(); if (!raf) sync(); };
  const onLost = (e) => { e.preventDefault(); if (raf) cancelAnimationFrame(raf); raf = 0; canvas.classList.remove('on'); };

  const mo = new MutationObserver(sync);
  mo.observe(root, { attributes: true, attributeFilter: ['data-motion'] });
  window.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('mouseout', onOut);
  window.addEventListener('blur', onLeave);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', sync);
  dark.addEventListener('change', onTheme);
  reduce.addEventListener('change', sync);
  canvas.addEventListener('webglcontextlost', onLost);

  palette();
  onScroll(); scr.v = scr.tv;
  sync();

  return () => {
    if (raf) cancelAnimationFrame(raf);
    mo.disconnect();
    window.removeEventListener('pointermove', onMove);
    document.removeEventListener('mouseout', onOut);
    window.removeEventListener('blur', onLeave);
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('visibilitychange', sync);
    dark.removeEventListener('change', onTheme);
    reduce.removeEventListener('change', sync);
    canvas.removeEventListener('webglcontextlost', onLost);
    // the context is not lost on purpose: StrictMode remounts reuse this canvas, and the browser frees it with the element
  };
}
