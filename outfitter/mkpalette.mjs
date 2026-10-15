// Search for an 8-slot categorical palette anchored on a brand colour that
// passes every dataviz check. Even hue spacing does NOT work: CVD collapses
// hues onto one axis, so distance has to be measured in simulated space, over
// every pair, rather than assumed from the hue wheel.
const V = "/tmp/claude-1000/bundled-skills/2.1.300/193161ad7c5bca64b9590fc288d76b46/dataviz/scripts/validate_palette.js";
const { contrast } = await import(V);

const lin2s = c => { c = Math.max(0,Math.min(1,c)); return c <= 0.0031308 ? 12.92*c : 1.055*c**(1/2.4) - 0.055; };
const s2lin = c => c <= 0.04045 ? c/12.92 : ((c+0.055)/1.055)**2.4;
const hex2lin = h => [0,2,4].map(i => s2lin(parseInt(h.slice(1+i,3+i),16)/255));
function oklabFromLin([r,g,b]) {
  const l = Math.cbrt(0.4122214708*r + 0.5363325363*g + 0.0514459929*b);
  const m = Math.cbrt(0.2119034982*r + 0.6806995451*g + 0.1073969566*b);
  const s = Math.cbrt(0.0883024619*r + 0.2817188376*g + 0.6299787005*b);
  return [0.2104542553*l + 0.7936177850*m - 0.0040720468*s,
          1.9779984951*l - 2.4285922050*m + 0.4505937099*s,
          0.0259040371*l + 0.7827717662*m - 0.8086757660*s];
}
const MACHADO = {
  protan: [[0.152286,1.052583,-0.204868],[0.114503,0.786281,0.099216],[-0.003882,-0.048116,1.051998]],
  deutan: [[0.367322,0.860646,-0.227968],[0.280085,0.672501,0.047413],[-0.011820,0.042940,0.968881]],
  tritan: [[1.255528,-0.076749,-0.178779],[-0.078411,0.930809,0.147602],[0.004733,0.691367,0.303900]],
};
function oklch2hex(L,C,hDeg) {
  const h = hDeg*Math.PI/180, a = C*Math.cos(h), b = C*Math.sin(h);
  const l = (L+0.3963377774*a+0.2158037573*b)**3;
  const m = (L-0.1055613458*a-0.0638541728*b)**3;
  const s = (L-0.0894841775*a-1.2914855480*b)**3;
  const rgb = [ 4.0767416621*l - 3.3077115913*m + 0.2309699292*s,
               -1.2684380046*l + 2.6097574011*m - 0.3413193965*s,
               -0.0041960863*l - 0.7034186147*m + 1.7076147010*s].map(lin2s);
  if (rgb.some(v => v < -0.002 || v > 1.002)) return null;
  return "#" + rgb.map(v => Math.round(Math.max(0,Math.min(1,v))*255).toString(16).padStart(2,"0")).join("");
}
// Every colour is converted ONCE into the four spaces the checks live in;
// the search then only subtracts. Doing it per comparison is ~100x slower.
function describe(hex) {
  const v = hex2lin(hex);
  const labs = [oklabFromLin(v)];
  for (const k of ["protan","deutan","tritan"])
    labs.push(oklabFromLin(MACHADO[k].map(r => r[0]*v[0] + r[1]*v[1] + r[2]*v[2])));
  return { hex, labs };
}
const dist = (a,b,i) => {
  const A = a.labs[i], B = b.labs[i];
  return Math.hypot(A[0]-B[0], A[1]-B[1], A[2]-B[2]) * 100;
};
const cvd = (a,b) => Math.min(dist(a,b,1), dist(a,b,2), dist(a,b,3));

const [,, brandHex, surface, modeArg] = process.argv;
const BAND = (modeArg || "light") === "dark" ? [0.48,0.67] : [0.43,0.77];

const pool = [];
for (let L = BAND[0]; L <= BAND[1]+1e-9; L += 0.03)
  for (let C = 0.11; C <= (Number(process.env.CMAX) || 0.30); C += 0.015)
    for (let h = 0; h < 360; h += 6) {
      const hex = oklch2hex(L,C,h);
      if (!hex) continue;
      const d = describe(hex);
      if (d.labs[0][0] < BAND[0] || d.labs[0][0] > BAND[1]) continue;
      if (contrast(hex, surface) < 3.05) continue;
      pool.push(d);
    }

const N = 8, NORMAL_FLOOR = 15.0;
const brand = describe(brandHex);
let best = null;
for (let trial = 0; trial < 600; trial++) {
  const chosen = [brand];
  for (let k = 1; k < N; k++) {
    let pick = null, pickScore = -1;
    for (const c of pool) {
      let worstCvd = Infinity, worstNormal = Infinity;
      for (const p of chosen) {
        const n = dist(c,p,0);
        if (n < worstNormal) worstNormal = n;
        const v = cvd(c,p);
        if (v < worstCvd) worstCvd = v;
      }
      if (worstNormal < NORMAL_FLOOR) continue;
      const score = worstCvd + (trial ? Math.random() * 3 : 0);
      if (score > pickScore) { pickScore = score; pick = c; }
    }
    if (!pick) break;
    chosen.push(pick);
  }
  if (chosen.length < N) continue;
  let worst = Infinity;
  for (let i = 0; i < N; i++) for (let j = i+1; j < N; j++) worst = Math.min(worst, cvd(chosen[i], chosen[j]));
  if (!best || worst > best.worst) best = { worst, chosen };
}
if (!best) { console.error("no palette found"); process.exit(1); }
console.log(best.chosen.map(c => c.hex).join(","));
console.error(`pool=${pool.length} worst all-pairs CVD ΔE=${best.worst.toFixed(1)}`);
