// Rocket: trigger-based launch + constant-speed flight with smooth steering and coverage
// Starts parked above the H1. Click to launch, or auto-launch after 5s.

document.addEventListener('DOMContentLoaded', () => {
  const rocket = document.querySelector('.rocket');
  const hero = document.querySelector('header#home') || document.querySelector('header.fullpage') || document.querySelector('header');
  const title = hero ? hero.querySelector('h1') : null;
  if (!rocket || !hero) return;

  // Ensure rocket is above overlays
  rocket.style.zIndex = '3000';

  // Measurements
  let width = 0, height = 0;
  function measure() {
    const r = hero.getBoundingClientRect();
    width = r.width;
    height = r.height;
  }
  measure();

  // Rocket size (for center-based positioning)
    let halfW = 0, halfH = 0;
    function measureRocket() {
    // offsetWidth/Height are not affected by CSS transforms
    const w = rocket.offsetWidth || 0;
    const h = rocket.offsetHeight || 0;
    halfW = w / 2;
    halfH = h / 2;
    }
    measureRocket();

  // --- Tunables ---
  const SPEED = 160;                      // px/s constant cruise
  const BASE_MAX_TURN = Math.PI * 1.1;    // rad/s
  const AVOID_MARGIN = 140;               // px
  const AVOID_GAIN = 2.0;                 // strength of edge repulsion

  // Wander (frequent course changes)
  const WANDER_MAX = Math.PI / 5;         // +/- ~36°
  const WANDER_JITTER = Math.PI / 24;     // ~7.5° per update
  const WANDER_UPDATE_MS = 400;           // ms
  const WANDER_SMOOTH_RATE = 5.0;         // per second

  // Waypoint guidance to improve coverage
  const WAYPOINT_GAIN = 0.35;
  const WAYPOINT_MARGIN = 100;
  const WAYPOINT_REACH_DIST = 90;         // px
  const WAYPOINT_TIMEOUT_MS = 10000;      // ms

  // Launch behavior
  const AUTO_LAUNCH_DELAY = 5000;         // ms until auto launch
  const LAUNCH_ACCEL_DURATION = 1000;     // ms to accelerate to SPEED
  const EASE_IN_OUT = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

  // --- State ---
  let mode = 'idle';                      // 'idle' | 'launching' | 'flight'
  let currentSpeed = 0;
  let x = 0, y = 0;
  let heading = -Math.PI / 6;             // slight up-right angle

  // Wander/waypoint state
  let wanderOffset = 0;
  let wanderTarget = 0;
  let waypoint = { x: width * 0.75, y: height * 0.35 };
  let waypointDeadline = performance.now() + WAYPOINT_TIMEOUT_MS;

  // Utils
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const normalizeAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const smoothStep01 = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

  function applyTransform() {
    const deg = (heading * 180 / Math.PI) + 45;
    // Position the element so that its center is at (x, y)
    rocket.style.transform = `translate(${x - halfW}px, ${y - halfH}px) rotate(${deg}deg)`;
  }

  function seatAtTitle() {
    const hb = hero.getBoundingClientRect();
  
    // Default to hero center
    let cx = width * 0.5;
    let cy = height * 0.5;
  
    if (title) {
      const tb = title.getBoundingClientRect();
      // Center of the H1 in hero-local coordinates
      cx = ((tb.left + tb.right) / 2) - hb.left;
      cy = ((tb.top  + tb.bottom) / 2) - hb.top;
    }
  
    cy -= 80;

    // Clamp using half sizes so the rocket never clips at edges
    x = clamp(cx, halfW + 2, width  - halfW - 2);
    y = clamp(cy, halfH + 2, height - halfH - 2);
  
    applyTransform();
  }

  // Initial seat; re-seat after fonts and load settle
  seatAtTitle();
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { measure(); seatAtTitle(); });
  }
  window.addEventListener('load', () => { measure(); seatAtTitle(); });

  function resize() {
    measure();
    measureRocket();
    // keep center inside on resize, accounting for rocket size
    x = clamp(x, halfW + 8, width  - halfW - 8);
    y = clamp(y, halfH + 8, height - halfH - 8);
    // keep waypoint valid
    waypoint.x = clamp(waypoint.x, WAYPOINT_MARGIN, width  - WAYPOINT_MARGIN);
    waypoint.y = clamp(waypoint.y, WAYPOINT_MARGIN, height - WAYPOINT_MARGIN);
    if (mode === 'idle') seatAtTitle();
    }
  window.addEventListener('resize', resize);

  function nudgeWander() {
    wanderTarget = clamp(
      wanderTarget + (Math.random() * 2 - 1) * WANDER_JITTER,
      -WANDER_MAX,
      WANDER_MAX
    );
  }
  nudgeWander();
  setInterval(nudgeWander, WANDER_UPDATE_MS);

  function pickWaypoint() {
    const now = performance.now();
    const minDX = width * 0.25;
    const minDY = height * 0.25;
    let tx, ty, tries = 0;
    do {
      tx = WAYPOINT_MARGIN + Math.random() * (width - 2 * WAYPOINT_MARGIN);
      ty = WAYPOINT_MARGIN + Math.random() * (height - 2 * WAYPOINT_MARGIN);
      tries++;
    } while (tries < 10 && Math.abs(tx - x) < minDX && Math.abs(ty - y) < minDY);
    waypoint = { x: tx, y: ty };
    waypointDeadline = now + WAYPOINT_TIMEOUT_MS * (0.7 + Math.random() * 0.8); // 7–18s
  }

  function edgeRepulsion(px, py) {
    let fx = 0, fy = 0;
    const leftT   = (AVOID_MARGIN - px) / AVOID_MARGIN;
    const rightT  = (AVOID_MARGIN - (width  - px)) / AVOID_MARGIN;
    const topT    = (AVOID_MARGIN - py) / AVOID_MARGIN;
    const bottomT = (AVOID_MARGIN - (height - py)) / AVOID_MARGIN;
    if (leftT   > 0) fx += smoothStep01(leftT);
    if (rightT  > 0) fx -= smoothStep01(rightT);
    if (topT    > 0) fy += smoothStep01(topT);
    if (bottomT > 0) fy -= smoothStep01(bottomT);
    return { fx: fx * AVOID_GAIN, fy: fy * AVOID_GAIN };
  }

  // --- Trigger: click or 5s auto ---
  rocket.style.pointerEvents = 'auto';
  rocket.style.cursor = 'pointer';
  let launchStart = 0;
  const autoTimer = setTimeout(() => launch(), AUTO_LAUNCH_DELAY);
  rocket.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    clearTimeout(autoTimer);
    launch();
  });

  function launch() {
    if (mode !== 'idle') return;
    mode = 'launching';
    rocket.style.pointerEvents = 'none';
    rocket.style.cursor = 'default';
    rocket.classList.add('launched'); // optional CSS hook
    currentSpeed = 0;
    launchStart = performance.now();
  }

  // While idle, keep the rocket seated over the title in case layout shifts
  const idleSeatTimer = setInterval(() => {
    if (mode === 'idle') seatAtTitle(); else clearInterval(idleSeatTimer);
  }, 250);

  let last = performance.now();
  function step(now) {
    let dt = (now - last) / 1000;
    last = now;
    dt = Math.min(dt, 0.06);

    if (mode === 'idle') {
      // stay parked
      return requestAnimationFrame(step);
    }

    if (mode === 'launching') {
      const t = clamp((now - launchStart) / LAUNCH_ACCEL_DURATION, 0, 1);
      currentSpeed = SPEED * EASE_IN_OUT(t);
      if (t >= 1) { mode = 'flight'; currentSpeed = SPEED; }
    }

    // Ease wander offset toward its target
    const alpha = clamp(dt * WANDER_SMOOTH_RATE, 0, 1);
    wanderOffset = wanderOffset + (wanderTarget - wanderOffset) * alpha;

    // Directions
    const dirX = Math.cos(heading), dirY = Math.sin(heading);
    const wanderX = Math.cos(heading + wanderOffset), wanderY = Math.sin(heading + wanderOffset);
    const { fx, fy } = edgeRepulsion(x, y);

    // Waypoint vector
    const wvx = waypoint.x - x;
    const wvy = waypoint.y - y;
    const wlen = Math.hypot(wvx, wvy) || 1;
    let wx = wvx / wlen, wy = wvy / wlen;
    if (wlen < WAYPOINT_REACH_DIST || now > waypointDeadline) pickWaypoint();

    // Combine influences
    let desX = dirX + 0.55 * wanderX + fx + WAYPOINT_GAIN * wx;
    let desY = dirY + 0.55 * wanderY + fy + WAYPOINT_GAIN * wy;
    const len = Math.hypot(desX, desY) || 1;
    desX /= len; desY /= len;

    // Dynamic turning
    const desiredHeading = Math.atan2(desY, desX);
    const repulseMag = clamp(Math.hypot(fx, fy), 0, 1);
    const angleDelta = Math.abs(normalizeAngle(desiredHeading - heading));
    const angleFactor = clamp(angleDelta / (Math.PI / 2), 0, 1.6);
    const dynamicFactor = clamp(0.85 + 0.9 * repulseMag + 0.6 * angleFactor, 0.85, 2.1);
    const maxTurnThisFrame = BASE_MAX_TURN * dynamicFactor * dt;
    const delta = normalizeAngle(desiredHeading - heading);
    const turn = clamp(delta, -maxTurnThisFrame, maxTurnThisFrame);
    heading = normalizeAngle(heading + turn);

    // Integrate motion (constant speed once launched)
    x += Math.cos(heading) * currentSpeed * dt;
    y += Math.sin(heading) * currentSpeed * dt;
    x = clamp(x, 2, width - 2);
    y = clamp(y, 2, height - 2);

    applyTransform();
    requestAnimationFrame(step);
  }

  // Always animate (ignore prefers-reduced-motion for this interactive element)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) last = performance.now();
  });
  requestAnimationFrame((t) => { last = t; step(t); });
});

document.addEventListener('DOMContentLoaded', () => {
    const observer = new IntersectionObserver((entries, observer) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const el = entry.target;
          const text = el.dataset.text;
          if (!el.dataset.typed) {
            el.dataset.typed = 'true';
            let i = 0;
            const interval = setInterval(() => {
              el.textContent = text.slice(0, i + 1);
              i++;
              if (i >= text.length) {
                clearInterval(interval);
                el.style.borderRight = 'none';
              }
            }, 70);
          }
          observer.unobserve(el);
        }
      });
    }, { threshold: 0.6 });
  
    document.querySelectorAll('.typewriter').forEach(el => {
      observer.observe(el);
    });
  });