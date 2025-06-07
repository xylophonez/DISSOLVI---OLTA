let video;
let prevFrame;
let trail = [];
let shaderEffect;
let captureScale = 0.2;
let threshold = 50;
let strokeWeightVal = 100;
let pd = 0.5;
let orient = 50;
let par1 = 0.0;
let oldWidth, oldHeight;

const aspectRatio = 5/4;
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
}

function draw() {
  background(0);
  let trackedPos = trackMotion();

  // Update trails
  if (trackedPos) {
    trail.push({
      pos: trackedPos,
      color: color(
        map(trackedPos.x, 0, width/M, 0, 255),
        map(trackedPos.y, 0, height/M, 255, 0),
        200,
        150
      ),
      weight: strokeWeightVal
    });
  }
  if (trail.length > 30*M) trail.shift();

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
    const prev = trail[i-1];
    const current = trail[i];
    trailBuffer.stroke(current.color);
    trailBuffer.strokeWeight(current.weight * M);
    trailBuffer.line(prev.pos.x*M, prev.pos.y*M, current.pos.x*M, current.pos.y*M);
  }
}

function applyShaderEffect() {
  pg.shader(shaderEffect);
  shaderEffect.setUniform('texture', trailBuffer);
  shaderEffect.setUniform('iResolution', [width, height]);
  shaderEffect.setUniform('iTime', millis() / 1000.0);
  shaderEffect.setUniform('pd', pd);
  shaderEffect.setUniform('orient', orient);
  shaderEffect.setUniform('par1', par1);
  pg.rect(-width/2, -height/2, width, height);
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
}

function calculateCanvasSize() {
  return window.innerWidth / window.innerHeight < aspectRatio
    ? window.innerWidth / aspectRatio
    : window.innerHeight;
}

function updateVideoSize() {
  video.size(width * captureScale / M, height * captureScale / M);
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

// function windowResized() {
//   randomSeed(seed)
//   noiseSeed(seed)

//   canvas =
//     window.innerWidth / window.innerHeight < aspectRatio
//       ? window.innerWidth / aspectRatio
//       : window.innerHeight
//   M = canvas/1000
//   resizeCanvas(canvas * aspectRatio, canvas)

// }

// function keyPressed() {
//   // Save a 4K PNG when pressing the S key
//   if (keyCode == 83) {

//     print("Saving image in 2K...")
//     canvas = 2000
//     M = canvas / 1000

//     resizeCanvas(canvas * aspectRatio, canvas)
//     save("Memento-2K")
//     canvas =
//       window.innerWidth / window.innerHeight < aspectRatio
//         ? window.innerWidth / aspectRatio
//         : window.innerHeight
//     M = canvas / 1000
//     resizeCanvas(canvas * aspectRatio, canvas)

//   }
//   if (keyCode == 85) {
//     print("Saving image in 4K...")
//     canvas = 4000
//     M = canvas / 1000
//     resizeCanvas(canvas * aspectRatio, canvas)
//     save("Memento-4K")
//     canvas =
//       window.innerWidth / window.innerHeight < aspectRatio
//         ? window.innerWidth / aspectRatio
//         : window.innerHeight
//     M = canvas / 1000
//     resizeCanvas(canvas * aspectRatio, canvas)
//   }
//   if (keyCode == 80) {
//     print("Saving image in 8K...")
//     canvas = 6000
//     M = canvas / 1000
//     resizeCanvas(canvas * aspectRatio, canvas)
//     save("Memento-8K")
//     canvas =
//       window.innerWidth / window.innerHeight < aspectRatio
//         ? window.innerWidth / aspectRatio
//         : window.innerHeight
//     M = canvas / 1000
//     resizeCanvas(canvas * aspectRatio, canvas)
//   }
// }

function trackMotion() {
  video.loadPixels();
  prevFrame.loadPixels();
  
  let sumX = 0, sumY = 0, count = 0;
  
  for (let y = 0; y < video.height; y++) {
    for (let x = 0; x < video.width; x++) {
      let index = (x + y * video.width) * 4;
      let r = video.pixels[index];
      let g = video.pixels[index + 1];
      let b = video.pixels[index + 2];
      
      let prevR = prevFrame.pixels[index];
      let prevG = prevFrame.pixels[index + 1];
      let prevB = prevFrame.pixels[index + 2];
      
      let diff = dist(r, g, b, prevR, prevG, prevB);
      
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
      map(sumX / count * (1/captureScale), 0, width/M, -50*M, width/M + 50*M),
      map(sumY / count * (1/captureScale), 0, height/M, -50*M, height/M + 50*M)
    );
  }
  return null;
}



function getPixelDensity() {
	let v = window.location.hash.split('');
	v=v[v.length-1];
	switch (v){
		case '1':
			return 1;
			break;
		case '2':
			return 2;
			break;
		case '3':
			return 3;
			break;
		case '4':
			return 4;
			break;
		case '5':
			return 5;
			break;
		
		default:
			return pixelDensity();
			break;
	}
}

function windowResized() {
  // randomSeed(seed)
  // noiseSeed(seed)

  canvas =
    window.innerWidth / window.innerHeight < aspectRatio
      ? window.innerWidth / aspectRatio
      : window.innerHeight;
  M = canvas / 1000;
  resizeCanvas(canvas * aspectRatio, canvas);
}