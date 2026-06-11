// Simple universe simulation: big-bang radial burst, two particle types:
// positive (attractive) pulls other particles inward toward itself (+1)
// negative (repulsive) pushes other particles away (-1)
// Touch to pan, pinch to zoom. Desktop: drag to pan, wheel to zoom.

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d', { alpha: false });

let DPR = devicePixelRatio || 1;

function resize(){
  const w = innerWidth;
  const h = innerHeight;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  canvas.width = Math.round(w * DPR);
  canvas.height = Math.round(h * DPR);
}
addEventListener('resize', () => { DPR = devicePixelRatio || 1; resize(); });
resize();

// World / camera
let cam = { x:0, y:0, scale:1 };
let targetCam = { ...cam };

// Pan/zoom interaction
let isPanning = false;
let lastX=0, lastY=0;
let lastTouchDist = 0;

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  if (e.isPrimary) {
    isPanning = true;
    lastX = e.clientX;
    lastY = e.clientY;
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (!isPanning) return;
  const dx = (e.clientX - lastX) / cam.scale;
  const dy = (e.clientY - lastY) / cam.scale;
  cam.x -= dx;
  cam.y -= dy;
  lastX = e.clientX; lastY = e.clientY;
});

canvas.addEventListener('pointerup', (e) => {
  canvas.releasePointerCapture?.(e.pointerId);
  isPanning = false;
});

// Wheel zoom (desktop)
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const zoomFactor = Math.exp(-e.deltaY * 0.0015);
  const rect = canvas.getBoundingClientRect();
  const cx = (e.clientX - rect.left) * DPR;
  const cy = (e.clientY - rect.top) * DPR;
  zoomAt(cx, cy, zoomFactor);
}, { passive: false });

// Touch pinch handling (fallback to pointer events for single finger)
// For better pinch on some browsers use touch events:
canvas.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) {
    lastTouchDist = touchDist(e.touches[0], e.touches[1]);
  } else if (e.touches.length === 1) {
    lastX = e.touches[0].clientX;
    lastY = e.touches[0].clientY;
  }
}, { passive: true });

canvas.addEventListener('touchmove', (e) => {
  if (e.touches.length === 2) {
    const d = touchDist(e.touches[0], e.touches[1]);
    if (lastTouchDist > 0) {
      const z = d / lastTouchDist;
      const mid = touchMid(e.touches[0], e.touches[1]);
      const rect = canvas.getBoundingClientRect();
      const cx = (mid.x - rect.left) * DPR;
      const cy = (mid.y - rect.top) * DPR;
      zoomAt(cx, cy, z);
    }
    lastTouchDist = d;
  } else if (e.touches.length === 1) {
    const dx = (e.touches[0].clientX - lastX) / cam.scale;
    const dy = (e.touches[0].clientY - lastY) / cam.scale;
    cam.x -= dx;
    cam.y -= dy;
    lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
  }
  e.preventDefault();
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
  if (e.touches.length < 2) lastTouchDist = 0;
}, { passive: true });

function touchDist(a,b){
  const dx=a.clientX-b.clientX, dy=a.clientY-b.clientY;
  return Math.hypot(dx,dy);
}
function touchMid(a,b){
  return { x: (a.clientX + b.clientX)/2, y: (a.clientY + b.clientY)/2 };
}

function zoomAt(cx, cy, factor){
  // cx,cy are pixels relative to canvas multiplied by DPR
  const worldX = (cx / DPR) / cam.scale + cam.x;
  const worldY = (cy / DPR) / cam.scale + cam.y;
  cam.scale *= factor;
  // clamp scale
  cam.scale = Math.min(Math.max(cam.scale, 0.08), 6);
  // keep the zoom focus stable
  cam.x = worldX - (cx / DPR) / cam.scale;
  cam.y = worldY - (cy / DPR) / cam.scale;
}

// Simulation parameters (made configurable)
let PARTICLE_COUNT = 350; // default
let BIGBANG_SPEED = 600;  // default speedScale used in init
let SIM_SPEED = 1.0;      // new: simulation speed multiplier (affects timestep immediately)
let PAUSED = false;       // pause flag controlled from settings

const G = 1200;             // gravitational-ish constant (tweak)
const SOFTENING = 8;        // to avoid singularities
const DT = 0.016;           // fixed time step
const DAMPING = 0.999;      // small damping
const MAX_V = 200;          // clamp velocity

// how many attractor particles to spawn at big bang
const ATTRACTOR_COUNT = 8;
// how many deflector particles to spawn at big bang
const DEFLECTOR_COUNT = 6;

// Particles array
let particles = [];

// --- New: attractor behavior flag and helper ---
// Attractor is a special particle that attracts other particles toward itself,
// but is itself pushed away by them (asymmetric interaction).
// We'll mark it with `isAttractor: true`.
function makeAttractor(x=0, y=0){
  return {
    x, y,
    vx: 0, vy: 0,
    ax: 0, ay: 0,
    mass: 6,
    type: 0,
    isAttractor: true
  };
}
// New: deflector is the opposite of attractor:
// deflector is pulled toward normal particles, but it pushes those particles away.
function makeDeflector(x=0, y=0){
  return {
    x, y,
    vx: 0, vy: 0,
    ax: 0, ay: 0,
    mass: 6,
    type: 0,
    isDeflector: true
  };
}

// Initialize big bang
function init(){
  particles = [];
  // use the camera's current center so the big bang happens at the center of your screen
  const center = { x: cam.x, y: cam.y };
  // use BIGBANG_SPEED and PARTICLE_COUNT from UI/state
  const speedScale = BIGBANG_SPEED;
  for (let i=0;i<PARTICLE_COUNT;i++){
    const theta = Math.random() * Math.PI * 2;
    const r = Math.pow(Math.random(), 0.8) * 60;
    const x = center.x + r * Math.cos(theta);
    const y = center.y + r * Math.sin(theta);

    const type = Math.random() < 0.5 ? 1 : -1;

    const speed = (0.8 + Math.random() * 1.6) * speedScale;
    const vx = Math.cos(theta) * speed;
    const vy = Math.sin(theta) * speed;

    const mass = 1 + Math.random() * 2;

    particles.push({
      x, y, vx, vy, ax:0, ay:0, mass, type
    });
  }

  // add multiple attractors near center (green) with slightly larger mass
  for (let a = 0; a < ATTRACTOR_COUNT; a++) {
    const offset = 30;
    const ax = center.x + (Math.random() - 0.5) * offset * 2;
    const ay = center.y + (Math.random() - 0.5) * offset * 2;
    const at = makeAttractor(ax, ay);
    // give attractors a bit of variety in mass/initial velocity
    at.mass = 4 + Math.random() * 6;
    at.vx = (Math.random() - 0.5) * 20;
    at.vy = (Math.random() - 0.5) * 20;
    particles.push(at);
  }
  
  // add multiple deflectors near center (red) with slightly larger mass
  for (let d = 0; d < DEFLECTOR_COUNT; d++) {
    const offset = 40;
    const dx = center.x + (Math.random() - 0.5) * offset * 2;
    const dy = center.y + (Math.random() - 0.5) * offset * 2;
    const def = makeDeflector(dx, dy);
    def.mass = 3 + Math.random() * 5;
    def.vx = (Math.random() - 0.5) * 20;
    def.vy = (Math.random() - 0.5) * 20;
    particles.push(def);
  }
  
  // removed forced camera recentering so the big bang stays at current view center
}
init();

// Simulation update: O(n^2)
function step(){
  const n = particles.length;

  // reset accelerations
  for (let i=0;i<n;i++){
    particles[i].ax = 0;
    particles[i].ay = 0;
  }

  // pairwise forces
  for (let i=0;i<n;i++){
    const pi = particles[i];
    for (let j=i+1;j<n;j++){
      const pj = particles[j];
      let dx = pi.x - pj.x;
      let dy = pi.y - pj.y;
      let r2 = dx*dx + dy*dy + SOFTENING;
      let r = Math.sqrt(r2);
      const ux = dx / r;
      const uy = dy / r;

      // New: support asymmetric interaction with deflector (handle first)
      if (pi.isDeflector && !pj.isDeflector){
        // deflector pi is pulled toward pj, while pj is pushed away from pi
        const mag = G * (pi.mass * pj.mass) / r2;
        // ux points from pj -> pi; vector from pi -> pj is -ux
        const fx_on_pi_x = -mag * ux;
        const fx_on_pi_y = -mag * uy;
        pi.ax += fx_on_pi_x / pi.mass;
        pi.ay += fx_on_pi_y / pi.mass;
        // pj is pushed away from pi (opposite of force on pi)
        pj.ax -= fx_on_pi_x / pj.mass;
        pj.ay -= fx_on_pi_y / pj.mass;
      } else if (pj.isDeflector && !pi.isDeflector){
        const mag = G * (pi.mass * pj.mass) / r2;
        // ux points from pj -> pi; vector from pj -> pi is ux, but we want force on pj toward pi => ux
        const fx_on_pj_x = mag * ux;
        const fx_on_pj_y = mag * uy;
        pj.ax += fx_on_pj_x / pj.mass;
        pj.ay += fx_on_pj_y / pj.mass;
        // pi is pushed away from pj
        pi.ax -= fx_on_pj_x / pi.mass;
        pi.ay -= fx_on_pj_y / pi.mass;
      }
      // New: support asymmetric interaction with attractor
      else if (pi.isAttractor && !pj.isAttractor){
        // attractor pi pulls pj toward itself, and pi is pushed away from pj
        const mag = G * (pi.mass * pj.mass) / r2;
        const fx = mag * ux;
        const fy = mag * uy;
        pj.ax += fx / pj.mass;
        pj.ay += fy / pj.mass;
        // push attractor away: same direction (so it moves away from pj)
        pi.ax += fx / pi.mass;
        pi.ay += fy / pi.mass;
      } else if (pj.isAttractor && !pi.isAttractor){
        // attractor pj pulls pi toward itself, and pj is pushed away from pi
        const mag = G * (pi.mass * pj.mass) / r2;
        // note ux points from pj to pi; for forces we want vector from i to j when using same formula
        // compute unit from i to j:
        const ux_ji = -ux;
        const uy_ji = -uy;
        const fx = mag * ux_ji;
        const fy = mag * uy_ji;
        pi.ax += fx / pi.mass;
        pi.ay += fy / pi.mass;
        pj.ax += fx / pj.mass;
        pj.ay += fy / pj.mass;
      } else {
        // default symmetric interaction using particle type (positive/negative behavior)
        const mag = G * (pi.type) * (pi.mass * pj.mass) / r2;
        const fx_on_j = mag * ux;
        const fy_on_j = mag * uy;
        pj.ax += fx_on_j / pj.mass;
        pj.ay += fy_on_j / pj.mass;
        pi.ax -= fx_on_j / pi.mass;
        pi.ay -= fy_on_j / pi.mass;
      }
    }
  }

  // integrate velocities & positions
  const dt = DT * SIM_SPEED; // <-- use simulation speed multiplier
  for (let i=0;i<n;i++){
    const p = particles[i];
    p.vx += p.ax * dt;
    p.vy += p.ay * dt;
    const vmag = Math.hypot(p.vx, p.vy);
    if (vmag > MAX_V){
      p.vx = p.vx / vmag * MAX_V;
      p.vy = p.vy / vmag * MAX_V;
    }
    p.vx *= Math.pow(DAMPING, SIM_SPEED); // small tweak so damping scales reasonably
    p.vy *= Math.pow(DAMPING, SIM_SPEED);
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }

  // simple collision resolution: prevent overlaps and apply small elastic impulse
  const restitution = 0.6;
  for (let i=0;i<n;i++){
    const pi = particles[i];
    const ri = 4 + Math.log(1 + pi.mass) * 2;
    for (let j=i+1;j<n;j++){
      const pj = particles[j];
      const rj = 4 + Math.log(1 + pj.mass) * 2;
      let dx = pj.x - pi.x;
      let dy = pj.y - pi.y;
      let dist = Math.hypot(dx, dy);
      const minDist = ri + rj;
      if (dist === 0) {
        dx = (Math.random() - 0.5) * 1e-3;
        dy = (Math.random() - 0.5) * 1e-3;
        dist = Math.hypot(dx, dy) || 1e-3;
      }
      if (dist < minDist) {
        const overlap = minDist - dist;
        const nx = dx / dist;
        const ny = dy / dist;
        const invMassI = 1 / pi.mass;
        const invMassJ = 1 / pj.mass;
        const invMassSum = invMassI + invMassJ;
        const correctionI = (overlap * (invMassI / invMassSum));
        const correctionJ = (overlap * (invMassJ / invMassSum));
        pi.x -= nx * correctionI;
        pi.y -= ny * correctionI;
        pj.x += nx * correctionJ;
        pj.y += ny * correctionJ;
        const rvx = pj.vx - pi.vx;
        const rvy = pj.vy - pi.vy;
        const relVelAlongNormal = rvx * nx + rvy * ny;
        if (relVelAlongNormal < 0) {
          const jImpulse = -(1 + restitution) * relVelAlongNormal / invMassSum;
          const ix = jImpulse * nx;
          const iy = jImpulse * ny;
          pi.vx -= ix * invMassI;
          pi.vy -= iy * invMassI;
          pj.vx += ix * invMassJ;
          pj.vy += iy * invMassJ;
        }
      }
    }
  }
}

// Rendering
function worldToScreen(x,y){
  return {
    x: (x - cam.x) * cam.scale * DPR + canvas.width / 2,
    y: (y - cam.y) * cam.scale * DPR + canvas.height / 2
  };
}

function render(){
  // background
  ctx.fillStyle = '#070708';
  ctx.fillRect(0,0,canvas.width,canvas.height);

  // draw subtle grid for orientation
  const gridSize = 200;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1 * DPR;
  ctx.beginPath();
  const ox = ( -cam.x) * cam.scale * DPR + canvas.width / 2;
  const oy = ( -cam.y) * cam.scale * DPR + canvas.height / 2;
  for (let gx = ((ox % (gridSize*cam.scale*DPR)) - gridSize*cam.scale*DPR); gx < canvas.width; gx += gridSize*cam.scale*DPR){
    ctx.moveTo(gx,0);
    ctx.lineTo(gx,canvas.height);
  }
  for (let gy = ((oy % (gridSize*cam.scale*DPR)) - gridSize*cam.scale*DPR); gy < canvas.height; gy += gridSize*cam.scale*DPR){
    ctx.moveTo(0,gy);
    ctx.lineTo(canvas.width,gy);
  }
  ctx.stroke();
  ctx.restore();

  // draw particles
  // compute a small margin (in pixels) so particles near edge still render properly
  const margin = 32 * DPR;
  const leftBound = -margin;
  const rightBound = canvas.width + margin;
  const topBound = -margin;
  const bottomBound = canvas.height + margin;

  for (let p of particles){
    // compute screen position and scaled radius once
    const s = worldToScreen(p.x, p.y);
    const radiusWorld = 4 + Math.log(1 + p.mass) * 2;
    const r = radiusWorld * cam.scale * DPR;

    // offscreen-frustum check with margin: skip all drawing work if fully outside
    if (s.x + r < leftBound || s.x - r > rightBound || s.y + r < topBound || s.y - r > bottomBound) {
      continue;
    }

    if (p.isAttractor){
      // green attractor rendering
      const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, Math.max(1, r*3));
      grad.addColorStop(0, 'rgba(120,255,140,0.95)');
      grad.addColorStop(0.5, 'rgba(60,220,120,0.6)');
      grad.addColorStop(1, 'rgba(60,220,120,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r*3, 0, Math.PI*2);
      ctx.fill();

      ctx.fillStyle = 'rgb(120,240,140)';
    } else if (p.isDeflector){
      // red deflector rendering
      const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, Math.max(1, r*3));
      grad.addColorStop(0, 'rgba(255,100,100,0.95)');
      grad.addColorStop(0.5, 'rgba(220,60,60,0.6)');
      grad.addColorStop(1, 'rgba(220,60,60,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r*3, 0, Math.PI*2);
      ctx.fill();

      ctx.fillStyle = 'rgb(255,140,130)';
    } else if (p.type === 1){
      const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, Math.max(1, r*2.5));
      grad.addColorStop(0, 'rgba(255,150,60,0.95)');
      grad.addColorStop(0.5, 'rgba(255,120,40,0.6)');
      grad.addColorStop(1, 'rgba(255,120,40,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r*2.5, 0, Math.PI*2);
      ctx.fill();

      ctx.fillStyle = 'rgb(255,180,80)';
    } else {
      const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, Math.max(1, r*2.5));
      grad.addColorStop(0, 'rgba(80,220,255,0.95)');
      grad.addColorStop(0.5, 'rgba(40,160,255,0.6)');
      grad.addColorStop(1, 'rgba(40,160,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r*2.5, 0, Math.PI*2);
      ctx.fill();

      ctx.fillStyle = 'rgb(120,230,255)';
    }

    ctx.beginPath();
    ctx.arc(s.x, s.y, Math.max(1, r), 0, Math.PI*2);
    ctx.fill();

    ctx.lineWidth = Math.max(0.5, 0.6 * DPR);
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.stroke();
  }

  // optional HUD hint in tiny text (kept unobtrusive for mobile)
  ctx.save();
  ctx.scale(DPR, DPR);
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.font = '11px system-ui, -apple-system, "Segoe UI", Roboto';
  ctx.fillText('Touch drag to pan • Pinch to zoom', 8, 20);
  ctx.restore();
}

// Animation loop
let last = performance.now();
function loop(t){
  if (!PAUSED) step();
  render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Attach restart button; remove double-click/double-tap handlers in favor of explicit UI
const possibleRestart = document.getElementById('restart');
if (possibleRestart) {
  possibleRestart.addEventListener('click', init);
}

// --- Settings UI wiring ---
const settingsBtn = document.getElementById('settingsBtn');
const settings = document.getElementById('settings');
const particlesInput = document.getElementById('particlesInput');
const velocityInput = document.getElementById('velocityInput');
const simSpeedInput = document.getElementById('simSpeedInput');
const fullscreenToggle = document.getElementById('fullscreenToggle');
const pauseToggle = document.getElementById('pauseToggle');
const particlesVal = document.getElementById('particlesVal');
const velocityVal = document.getElementById('velocityVal');
const simSpeedVal = document.getElementById('simSpeedVal');
const applyBtn = document.getElementById('apply');
const applyNoRestartBtn = document.getElementById('applyNoRestart');
const cancelBtn = document.getElementById('cancel');
const restartInside = document.getElementById('restartInside');

// initialize input values from current state
particlesInput.value = PARTICLE_COUNT;
velocityInput.value = BIGBANG_SPEED;
simSpeedInput.value = SIM_SPEED;
particlesVal.textContent = PARTICLE_COUNT;
velocityVal.textContent = BIGBANG_SPEED;
simSpeedVal.textContent = SIM_SPEED.toFixed(1) + 'x';

// set fullscreen & pause checkbox initial states
fullscreenToggle.checked = !!document.fullscreenElement;
pauseToggle.checked = PAUSED;

// open/close handlers
settingsBtn.addEventListener('click', () => {
  settings.setAttribute('aria-hidden', 'false');
});
cancelBtn.addEventListener('click', () => {
  // restore inputs to current values
  particlesInput.value = PARTICLE_COUNT;
  velocityInput.value = BIGBANG_SPEED;
  simSpeedInput.value = SIM_SPEED;
  particlesVal.textContent = PARTICLE_COUNT;
  velocityVal.textContent = BIGBANG_SPEED;
  simSpeedVal.textContent = SIM_SPEED.toFixed(1) + 'x';
  fullscreenToggle.checked = !!document.fullscreenElement;
  settings.setAttribute('aria-hidden', 'true');
});

// live update of displayed values
particlesInput.addEventListener('input', () => {
  particlesVal.textContent = particlesInput.value;
});
velocityInput.addEventListener('input', () => {
  velocityVal.textContent = velocityInput.value;
});
simSpeedInput.addEventListener('input', () => {
  SIM_SPEED = parseFloat(simSpeedInput.value);
  simSpeedVal.textContent = SIM_SPEED.toFixed(1) + 'x';
  // immediate effect: no restart required
});
fullscreenToggle.addEventListener('change', async () => {
  try {
    if (fullscreenToggle.checked) {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    } else {
      if (document.fullscreenElement) await document.exitFullscreen();
    }
  } catch (err) {
    // ignore fullscreen errors
    fullscreenToggle.checked = !!document.fullscreenElement;
  }
});
pauseToggle.addEventListener('change', () => {
  PAUSED = !!pauseToggle.checked;
});

// apply and restart (applies particle count & big bang speed and restarts)
applyBtn.addEventListener('click', () => {
  PARTICLE_COUNT = parseInt(particlesInput.value, 10);
  BIGBANG_SPEED = parseFloat(velocityInput.value);
  // SIM_SPEED and fullscreen are already applied immediately on input/change
  settings.setAttribute('aria-hidden', 'true');
  init();
});

// Apply without restart: keep changes that don't require restart (SIM_SPEED, fullscreen) and just close
applyNoRestartBtn.addEventListener('click', () => {
  // Ensure non-restartable settings are applied (they already are on change)
  SIM_SPEED = parseFloat(simSpeedInput.value);
  // fullscreen state is handled by toggle change listener
  settings.setAttribute('aria-hidden', 'true');
});

// Restart current simulation (without changing settings)
restartInside.addEventListener('click', () => {
  init();
  settings.setAttribute('aria-hidden', 'true');
});

// close settings when tapping outside sheet (accessibility)
settings.addEventListener('click', (e) => {
  if (e.target === settings) settings.setAttribute('aria-hidden', 'true');
});
