// --- OLTA INTEGRATION -------------------------------------------------------
const olta = Olta();

// Debounce helper for polite S3/AO writes
function debounce(fn, wait) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

// Scale+publish our control doc to AO via Olta (page/0)
const publish = debounce(() => {
  // NOTE: your schema uses bigint scalars. We send ints; olta.module will turn them into "n" strings.
  // captureScale: store as 1..100  (0.01..1.00 UI)   -> multiply by 100
  // threshold:    0..255                             -> as-is
  // strokeWeight: 1..200                             -> as-is
  // pd:           1..5                               -> as-is
  // orient:       0..100                             -> as-is
  // par1:         0..1000 (represents 0..10.00)     -> multiply by 100
  olta.update("page", {
    id: 0,
    motionControl: {
      captureScale: Math.round(captureScale * 100),
      threshold: Math.round(threshold),
      strokeWeightVal: Math.round(strokeWeightVal),
      pd: Math.round(pd),
      orient: Math.round(orient),
      par1: Math.round(par1 * 100),
    },
  });
  // console.log("olta.publish -> page/0 motionControl");
}, 300);

// put near your `publish` / Olta code
let _lastSent = null;
function snapshotControls() {
  return {
    captureScale: Math.round(captureScale * 100),
    threshold: Math.round(threshold),
    strokeWeightVal: Math.round(strokeWeightVal),
    pd: Math.round(pd),
    orient: Math.round(orient),
    par1: Math.round(par1 * 100),
  };
}
function shallowEqual(a, b) {
  if (!a || !b) return false;
  for (const k in a) if (a[k] !== b[k]) return false;
  for (const k in b) if (a[k] !== b[k]) return false;
  return true;
}
const publishIfChanged = (() => {
  const doPublish = () => {
    const next = snapshotControls();
    if (!_lastSent || !shallowEqual(_lastSent, next)) {
      _lastSent = next;
      olta.update("page", { id: 0, motionControl: next });
      // console.log("olta.update(page/0) – changed");
    }
  };
  // debounce for politeness
  let t;
  return () => { clearTimeout(t); t = setTimeout(doPublish, 200); };
})();

// call it after you apply incoming state in olta.onUpdate(...)
olta.onUpdate(({ projectState }) => {
  const coll = projectState?.collections?.page?.["0"];
  const mc = coll?.motionControl || {};

  // helper: parse "123n" -> 123 number
  const num = (v) =>
    typeof v === "string" && v.endsWith("n") ? Number(v.slice(0, -1)) : (typeof v === "number" ? v : undefined);

  // Use incoming values if present; otherwise keep current ones
  const nextCaptureScale = num(mc.captureScale);
  const nextThreshold = num(mc.threshold);
  const nextStroke = num(mc.strokeWeightVal);
  const nextPd = num(mc.pd);
  const nextOrient = num(mc.orient);
  const nextPar1 = num(mc.par1);

  // Remember: captureScale is stored 1..100 (UI 0.01..1.00), par1 is stored *100
  if (Number.isFinite(nextCaptureScale)) captureScale = nextCaptureScale / 100;
  if (Number.isFinite(nextThreshold)) threshold = nextThreshold;
  if (Number.isFinite(nextStroke)) strokeWeightVal = nextStroke;
  if (Number.isFinite(nextPd)) pd = nextPd;
  if (Number.isFinite(nextOrient)) orient = nextOrient;
  if (Number.isFinite(nextPar1)) par1 = nextPar1 / 100;

  // If video sampling depends on captureScale, propagate size
  updateVideoSize();
  publishIfChanged(); // echo back only if local snapshot differs (no ping-pong)
});

// --- YOUR SKETCH ------------------------------------------------------------
let video;
let prevFrame;
let trail = [];
let shaderEffect;
let captureScale = 0.2;   // UI 0.01..1.00 -> stored as 1..100
let threshold = 50;       // 0..255
let strokeWeightVal = 100;
let pd = 1;               // match schema (1..5). You were starting at 0.5; schema min is 1.
let orient = 50;          // 0..100
let par1 = 0.0;           // UI 0..10.00 -> stored as 0..1000
let oldWidth, oldHeight;

const aspectRatio = 5 / 4;
let canvas;
let M;

let pg; // WebGL buffer for shader
let trailBuffer; // 2D buffer for drawing trails

function setup() {
  canvas = calculateCanvasSize();
  M = canvas / 1000;

  createCanvas(canvas * aspectRatio, canvas);
  pd = getPixelDensity();
  pixelDensity(1);

  // Initialize video capture
  video = createCapture(VIDEO, { flipped: true });
  updateVideoSize();
  video.hide();
  prevFrame = createImage(video.width, video.height);

  // Create persistent buffers
  trailBuffer = createGraphics(width, height);
  pg = createGraphics(width, height, WEBGL);
  shaderEffect = pg.createShader(vs, fs);

  // Publish initial controls so AO has a baseline doc
  publishIfChanged(); // call this at the end of setup()
}

function draw() {
  background(0);

  let trackedPos = trackMotion();

  // Update trails
  if (trackedPos) {
    trail.push({
      pos: trackedPos,
      color: color(
        map(trackedPos.x, 0, width / M, 0, 255),
        map(trackedPos.y, 0, height / M, 255, 0),
        200,
        150
      ),
      weight: strokeWeightVal,
    });
  }
  if (trail.length > 30 * M) trail.shift();

  // Draw trails into buffer
  drawTrails();

  // Apply shader effect
  applyShaderEffect();

  // Display final result
  image(pg, 0, 0);
}

function drawTrails() {
  trailBuffer.clear();
  trailBuffer.noFill();
  for (let i = 1; i < trail.length; i++) {
    const prev = trail[i - 1];
    const current = trail[i];
    trailBuffer.stroke(current.color);
    trailBuffer.strokeWeight(current.weight * M);
    trailBuffer.line(prev.pos.x * M, prev.pos.y * M, current.pos.x * M, current.pos.y * M);
  }
}

function applyShaderEffect() {
  pg.shader(shaderEffect);
  shaderEffect.setUniform("texture", trailBuffer);
  shaderEffect.setUniform("iResolution", [width, height]);
  shaderEffect.setUniform("iTime", millis() / 1000.0);
  shaderEffect.setUniform("pd", pd);
  shaderEffect.setUniform("orient", orient);
  shaderEffect.setUniform("par1", par1);
  pg.rect(-width / 2, -height / 2, width, height);
}

function windowResized() {
  canvas = calculateCanvasSize();
  M = canvas / 1000;
  resizeCanvas(canvas * aspectRatio, canvas);

  // Resize buffers
  if (trailBuffer) trailBuffer.resizeCanvas(width, height);
  if (pg) pg.resizeCanvas(width, height);

  // Update video processing
  updateVideoSize();
  prevFrame = createImage(video.width, video.height);

  // Persist new controls (if captureScale affects anything)
  publishIfChanged();
}

function calculateCanvasSize() {
  return window.innerWidth / window.innerHeight < aspectRatio
    ? window.innerWidth / aspectRatio
    : window.innerHeight;
}

function updateVideoSize() {
  // guard against zero/NaN
  const cs = Math.max(0.01, Math.min(1, Number(captureScale) || 0.2));
  video.size((width * cs) / M, (height * cs) / M);
}

// Vertex shader
const vs = `precision mediump float;
attribute vec3 aPosition;
uniform mat4 uModelViewMatrix;
uniform mat4 uProjectionMatrix;

void main() {
  vec4 positionVec4 = vec4(aPosition, 1.0);
  gl_Position = uProjectionMatrix * uModelViewMatrix * positionVec4;
}`;

// Fragment shader
const fs = `precision mediump float;
uniform vec2 iResolution;
uniform float iTime;
uniform float pd;
uniform sampler2D texture;
uniform float orient;
uniform float par1;

float rand(vec2 n) { return fract(sin(dot(n, vec2(12.9898,4.1414))) * 43758.5453); }

float noise2(vec2 st) {
  vec2 i = floor(st);
  vec2 f = fract(st);
  float a = rand(i);
  float b = rand(i + vec2(0.0, 0.0));
  float c = rand(i + vec2(1.0, 1.0));
  float d = rand(i + vec2(1.0, 0.0));
  vec2 u = f*f*(3.0-2.0*f);
  return mix(a, b, u.x) + (c - a)* u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 1; i++) {
    value += amplitude * noise2(p);
    p *= 2.0;
    amplitude *= 0.05;
  }
  return value;
}

vec2 reactionDiffusion(vec2 uv) {
  vec2 newUV = uv;
  float n = noise2(uv * 5.0 + iTime * 0.5);
  float f = fbm(uv * 3.0 + n);
  newUV += vec2(f, -f) * 0.3;
  return newUV;
}

vec2 spiralDistortion(vec2 uv, float time) {
  vec2 center = vec2(0.5);
  vec2 toCenter = uv - center;
  float angle = length(toCenter) * 0.0;
  float s = sin(angle + time);
  float c = cos(angle + time);
  toCenter = mat2(c, -s, s, c) * toCenter;
  return center + toCenter;
}

vec4 oil(sampler2D texture, vec2 uv, vec2 resolution, float amount) {
  vec4 color = vec4(0.0);
  float total = 0.090;
  vec2 toCenter = vec2(0.5) - uv;
  float offset = rand(uv);
  for (float t = 0.0; t <= 4.0; t++) {
    float percent = (t + offset)/4.0;
    float weight = 4.0*(percent - percent*percent);
    color += texture2D(texture, uv + toCenter*percent*amount)*weight;
    total += weight;
  }
  return color-=total/2.;
}

void main() {
  vec2 uv = gl_FragCoord.xy/iResolution.xy;
  uv.y = 1.0 - uv.y;
  uv = spiralDistortion(uv, iTime*0.00005);
  uv = reactionDiffusion(uv);
  vec4 col = oil(texture, uv + orient*fbm(uv*par1), iResolution, fbm(uv*10.));
  col += noise2(uv/10.0 + fbm(uv*10.0))*0.05;
  gl_FragColor = col;
}`;

// Motion tracking
function trackMotion() {
  // Guard: capture may not be ready yet
  if (!video || !video.loadedmetadata) return null;

  video.loadPixels();
  prevFrame.loadPixels();

  let sumX = 0, sumY = 0, count = 0;

  for (let y = 0; y < video.height; y++) {
    for (let x = 0; x < video.width; x++) {
      const index = (x + y * video.width) * 4;
      const r = video.pixels[index];
      const g = video.pixels[index + 1];
      const b = video.pixels[index + 2];

      const prevR = prevFrame.pixels[index];
      const prevG = prevFrame.pixels[index + 1];
      const prevB = prevFrame.pixels[index + 2];

      const diff = dist(r, g, b, prevR, prevG, prevB);

      if (diff > threshold) {
        sumX += x;
        sumY += y;
        count++;
      }
    }
  }

  prevFrame.copy(video, 0, 0, video.width, video.height, 0, 0, video.width, video.height);

  if (count > 50) {
    return createVector(
      map((sumX / count) * (1 / captureScale), 0, width / M, -50 * M, width / M + 50 * M),
      map((sumY / count) * (1 / captureScale), 0, height / M, -50 * M, height / M + 50 * M)
    );
  }
  return null;
}

// Pixel density helper from your code
function getPixelDensity() {
  let v = window.location.hash.split("");
  v = v[v.length - 1];
  switch (v) {
    case "1": return 1;
    case "2": return 2;
    case "3": return 3;
    case "4": return 4;
    case "5": return 5;
    default:  return pixelDensity();
  }
}

// OPTIONAL: quick keyboard controls to test writes
function keyPressed() {
  // threshold up/down
  if (key === "Q") { threshold = Math.min(255, threshold + 1); publishIfChanged(); }
  if (key === "A") { threshold = Math.max(0, threshold - 1); publishIfChanged(); }

  // captureScale up/down (0.01..1.00)
  if (key === "W") { captureScale = Math.min(1.0, captureScale + 0.01); updateVideoSize(); publishIfChanged(); }
  if (key === "S") { captureScale = Math.max(0.01, captureScale - 0.01); updateVideoSize(); publishIfChanged(); }

  // strokeWeight up/down
  if (key === "E") { strokeWeightVal = Math.min(200, strokeWeightVal + 1); publishIfChanged(); }
  if (key === "D") { strokeWeightVal = Math.max(1, strokeWeightVal - 1); publishIfChanged(); }

  // par1 0..10.00
  if (key === "R") { par1 = Math.min(10.0, par1 + 0.01); publishIfChanged(); }
  if (key === "F") { par1 = Math.max(0.0,  par1 - 0.01); publishIfChanged(); }

  // orient 0..100
  if (key === "T") { orient = Math.min(100, orient + 1); publishIfChanged(); }
  if (key === "G") { orient = Math.max(0, orient - 1); publishIfChanged(); }

  // pd 1..5 (integer)
  if (key === "Y") { pd = Math.min(5, Math.round(pd + 1)); publishIfChanged(); }
  if (key === "H") { pd = Math.max(1, Math.round(pd - 1)); publishIfChanged(); }
}

// Keep your minimal windowResized (we also publish above)
function windowResized() {
  canvas =
    window.innerWidth / window.innerHeight < aspectRatio
      ? window.innerWidth / aspectRatio
      : window.innerHeight;
  M = canvas / 1000;
  resizeCanvas(canvas * aspectRatio, canvas);
}

// OPTIONAL: very light heartbeat – catch any parameter changes you may make programmatically
setInterval(publishIfChanged, 2000);  // every 2s, only publishes if different
