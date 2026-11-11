// The Signal background. Tuned and rendered in a browser; edit the numbers with care.
export const VERTEX = `attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }`;

export const FRAGMENT = `
precision highp float;
uniform vec2  uRes;
uniform float uTime;
uniform vec2  uPointer;    // 0..1, smoothed
uniform float uIntensity;  // 1.0 on the login hero, 0.32 inside the app
uniform float uPulse;      // 0..1 progress of the ripple; 1.0 = no ripple
uniform vec2  uPulseAt;    // 0..1 origin of the ripple (y up)

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  mat2 m = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p * 2.02; a *= 0.5; }
  return v;
}
vec3 ramp(float t){
  vec3 a = vec3(1.00, 0.70, 0.28);   // amber
  vec3 b = vec3(1.00, 0.42, 0.37);   // coral
  vec3 c = vec3(0.90, 0.22, 0.61);   // magenta
  vec3 d = vec3(0.48, 0.36, 1.00);   // violet
  t = clamp(t, 0.0, 1.0);
  if (t < 0.33) return mix(a, b, t / 0.33);
  if (t < 0.66) return mix(b, c, (t - 0.33) / 0.33);
  return mix(c, d, (t - 0.66) / 0.34);
}
void main(){
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float t = uTime * 0.05;
  p += (uPointer - 0.5) * 0.10;

  vec2 q = vec2(fbm(p * 1.25 + vec2(0.0, t)), fbm(p * 1.25 + vec2(5.2, -t * 1.2)));
  vec2 r = vec2(fbm(p * 1.05 + 3.0 * q + vec2(1.7, 9.2) + t * 0.7),
                fbm(p * 1.05 + 3.0 * q + vec2(8.3, 2.8) - t * 0.5));
  float f = fbm(p * 1.15 + 3.2 * r);

  float body  = smoothstep(0.42, 0.92, f);
  float lines = pow(0.5 + 0.5 * sin(f * 44.0 + t * 9.0), 7.0);
  float hue = 2.1 * length(r) - 1.0 + 0.9 * (q.x - 0.5) + 0.08 * sin(t * 2.0);
  vec3 col = ramp(hue) * (body * 0.95 + lines * body * 0.75);

  vec2 pc = (uPulseAt * uRes - 0.5 * uRes) / uRes.y;
  float d = distance(p, pc);
  float ring = exp(-pow((d - uPulse * 1.7) * 22.0, 2.0)) * (1.0 - uPulse) * (1.0 - uPulse);
  col += ramp(0.05 + d * 0.45) * ring * 0.9;

  col *= 1.0 - 0.55 * smoothstep(0.35, 1.25, length(p));
  vec3 base = vec3(7.0, 7.0, 12.0) / 255.0;
  col = base + col * uIntensity;
  col += (hash(gl_FragCoord.xy + fract(uTime) * 100.0) - 0.5) * 0.022;
  gl_FragColor = vec4(col, 1.0);
}
`;
