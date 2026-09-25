/**
 * Raw WebGL1 helper and ripple shaders for the first-run splash (first-run
 * visuals spec §4.3). Shaders are verbatim from the approved prototype
 * (docs/specs/first-run-visuals-prototype.html), except the splash
 * fragment: images are sampled with no UV offset, so no face is ever
 * displaced, and the transition dips the outgoing face fully into a colour
 * wash before the incoming one appears, so two faces never overlap. The
 * ripple rings are light only (glint over the wash), never distortion.
 */

export const VERT = `attribute vec2 p;varying vec2 vUv;void main(){vUv=vec2(p.x*.5+.5,.5-p.y*.5);gl_Position=vec4(p,0.,1.);}`;

export const RIPPLE_FN = `
precision highp float;
varying vec2 vUv;
uniform vec2 uRes;
const vec2 IMG = vec2(540.,960.);
vec2 coverBox(vec2 uv, vec2 b0, vec2 b1, float z){
  vec2 bs = (b1-b0)*uRes; float ca = bs.x/max(bs.y,1.), ia = IMG.x/IMG.y;
  vec2 s = ca>ia ? vec2(1., ia/ca) : vec2(ca/ia, 1.);
  vec2 f = vec2(.5,.33);
  vec2 l = (uv-b0)/(b1-b0); l = (l-f)/z+f;
  return (1.-s)*f + l*s;
}
`;

export const A_WELCOME_FRAG =
  RIPPLE_FN +
  `
uniform sampler2D uA,uB; uniform float uP,uZa,uZb,uMax,uAmp; uniform vec2 uC; uniform vec3 uTint;
void main(){
  vec2 uv=vUv; float asp=uRes.x/uRes.y;
  vec2 d2=(uv-uC)*vec2(asp,1.); float d=length(d2);
  float R=uP*uMax; float x=d-R;
  vec3 a=texture2D(uA,coverBox(uv,vec2(0.),vec2(1.),uZa)).rgb;
  vec3 b=texture2D(uB,coverBox(uv,vec2(0.),vec2(1.),uZb)).rgb;
  vec3 k=mix(vec3(.039,.035,.063),uTint,.38);
  float o=smoothstep(.06,.46,uP), i=smoothstep(.5,.9,uP);
  vec3 col = uP<.48 ? mix(a,k,o*.94) : mix(k,b,i);
  float fade=1.-smoothstep(.55,1.,uP);
  float band=exp(-x*x*160.)*(.55+.45*sin(x*64.));
  float trail=step(x,0.)*exp(x*4.)*(.5+.5*sin(x*38.));
  float g=(band+trail*.45)*fade*uAmp;
  col+=uTint*g*.45+vec3(g*.22);
  gl_FragColor=vec4(col,1.);
}`;

export interface RippleGl {
  gl: WebGLRenderingContext;
  u: (name: string) => WebGLUniformLocation | null;
  tex: (key: string, im?: TexImageSource) => WebGLTexture | null;
  drop: (key: string) => void;
  has: (key: string) => boolean;
  keys: () => string[];
  bind: (unit: number, name: string, t: WebGLTexture) => void;
  resize: () => void;
  draw: () => void;
  destroy: () => void;
}

/** Returns null when WebGL1 or the shaders are unavailable; the caller falls back. */
export function glInit(canvas: HTMLCanvasElement, frag: string): RippleGl | null {
  let gl: WebGLRenderingContext | null = null;
  try {
    gl = canvas.getContext("webgl", {
      antialias: false,
      alpha: false,
      premultipliedAlpha: false,
      powerPreference: "high-performance",
    });
  } catch {
    return null;
  }
  if (!gl) return null;
  const g = gl;
  const sh = (type: number, src: string) => {
    const s = g.createShader(type);
    if (!s) return null;
    g.shaderSource(s, src);
    g.compileShader(s);
    return g.getShaderParameter(s, g.COMPILE_STATUS) ? s : null;
  };
  const vs = sh(g.VERTEX_SHADER, VERT);
  const fs = sh(g.FRAGMENT_SHADER, frag);
  if (!vs || !fs) return null;
  const pr = g.createProgram();
  if (!pr) return null;
  g.attachShader(pr, vs);
  g.attachShader(pr, fs);
  g.linkProgram(pr);
  if (!g.getProgramParameter(pr, g.LINK_STATUS)) return null;
  g.useProgram(pr);
  const buf = g.createBuffer();
  g.bindBuffer(g.ARRAY_BUFFER, buf);
  g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), g.STATIC_DRAW);
  const loc = g.getAttribLocation(pr, "p");
  g.enableVertexAttribArray(loc);
  g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0);

  const U: Record<string, WebGLUniformLocation | null> = {};
  const u = (n: string) => (n in U ? U[n] : (U[n] = g.getUniformLocation(pr, n)));
  const texs: Record<string, WebGLTexture> = {};

  function tex(key: string, im?: TexImageSource) {
    if (texs[key]) return texs[key];
    if (!im) return null;
    const t = g.createTexture();
    if (!t) return null;
    g.bindTexture(g.TEXTURE_2D, t);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGB, g.RGB, g.UNSIGNED_BYTE, im);
    return (texs[key] = t);
  }
  function drop(key: string) {
    if (texs[key]) {
      g.deleteTexture(texs[key]);
      delete texs[key];
    }
  }
  function bind(unit: number, name: string, t: WebGLTexture) {
    g.activeTexture(g.TEXTURE0 + unit);
    g.bindTexture(g.TEXTURE_2D, t);
    g.uniform1i(u(name), unit);
  }
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    g.viewport(0, 0, w, h);
    g.uniform2f(u("uRes"), w, h);
  }
  function draw() {
    g.drawArrays(g.TRIANGLES, 0, 6);
  }
  function destroy() {
    if (!g.isContextLost()) Object.keys(texs).forEach(drop);
    const ext = g.getExtension("WEBGL_lose_context");
    if (ext && !g.isContextLost()) ext.loseContext();
  }
  return { gl: g, u, tex, drop, has: (k) => !!texs[k], keys: () => Object.keys(texs), bind, resize, draw, destroy };
}

/** "#RRGGBB" to [r, g, b] in 0..1. */
export function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
