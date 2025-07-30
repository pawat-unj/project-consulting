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
  const AUTO_LAUNCH_DELAY = 2000;         // ms until auto launch
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

  // Reveal #who chat bubbles in sequence the first time they enter the viewport
document.addEventListener('DOMContentLoaded', () => {
  const whoSection = document.querySelector('#who');
  if (!whoSection) return;

  const bubbles = whoSection.querySelectorAll('.imessages .bubble');
  if (!bubbles.length) return;

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Hide initially (no layout shift; just opacity/transform)
  bubbles.forEach(b => b.classList.add('is-hidden'));

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      if (whoSection.dataset.animated === 'true') break; // run once only
      whoSection.dataset.animated = 'true';

      if (prefersReduced) {
        bubbles.forEach(b => b.classList.remove('is-hidden'));
      } else {
        bubbles.forEach((b, i) => {
          setTimeout(() => b.classList.remove('is-hidden'), i * 1200 + 500); // stagger
        });
      }

      observer.disconnect();
      break;
    }
  }, { threshold: 0.35 });

  observer.observe(whoSection);
});
// Email chip: single-click/tap copies email; double-click/tap opens default mail app
// Works for both desktop and touch (mobile). Add CSS for .email-chip.copied if you want a toast.
document.addEventListener('DOMContentLoaded', () => {
  const DBL_CLICK_MS = 300;  // desktop double-click window
  const DBL_TAP_MS   = 320;  // mobile double-tap window
  const isTouchPrimary = window.matchMedia('(hover: none)').matches;

  function emailFromHref(href) {
    return href.replace(/^mailto:/, '').split('?')[0];
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for older browsers
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
  }

  document.querySelectorAll('.email-chip[href^="mailto:"]').forEach(chip => {
    let singleTimer = null;
    let lastTapTime = 0;
    const href = chip.getAttribute('href');
    // On touch-primary devices, neutralize native mailto navigation so single tap won't open Mail
    const mailtoHref = href;
    if (isTouchPrimary) {
      chip.dataset.mailto = href;
      chip.removeAttribute('href');        // prevent default anchor navigation on tap
      chip.setAttribute('role', 'button'); // keep accessible semantics
    }
    const email = emailFromHref(href);

    // Desktop: single-click copies (delayed), double-click opens mail
    chip.addEventListener('click', (e) => {
      // Always block native navigation; we control both desktop & touch behavior
      e.preventDefault();
      e.stopPropagation();
      if (isTouchPrimary) return; // touch handled in pointer events

      if (singleTimer) return; // debounce double-click
      singleTimer = setTimeout(async () => {
        await copyToClipboard(email);
        chip.classList.add('copied');
        setTimeout(() => chip.classList.remove('copied'), 1000);
        singleTimer = null;
      }, DBL_CLICK_MS);
    });

    chip.addEventListener('dblclick', (e) => {
      if (isTouchPrimary) return;
      e.preventDefault();
      if (singleTimer) { clearTimeout(singleTimer); singleTimer = null; }
      // Open default mail client
      window.location.href = mailtoHref;
    });

    // Mobile/tablet: detect double-tap manually on pointerup
    chip.addEventListener('pointerup', (e) => {
      if (!isTouchPrimary || (e.pointerType !== 'touch' && e.pointerType !== 'pen')) return;
      // Prevent synthesized click from firing mailto and stop bubbling
      e.preventDefault();
      e.stopPropagation();
      // Cancel any pending desktop single-click timer just in case
      if (singleTimer) { clearTimeout(singleTimer); singleTimer = null; }

      const now = e.timeStamp;
      const delta = now - lastTapTime;
      const isDoubleTap = lastTapTime && delta > 0 && delta <= DBL_TAP_MS;
      lastTapTime = now;

      if (isDoubleTap) {
        // Double-tap: open Mail
        window.location.href = mailtoHref;
      } else {
        // Single-tap: copy + start persistent glow (kept until refresh)
        copyToClipboard(email).then(() => {
          chip.classList.add('copied');
          setTimeout(() => chip.classList.remove('copied'), 1000);
        });
        chip.classList.add('touch-glow');
      }
    }, { passive: false });
  });
});

// ---- Overlay loader (testimonial.html & sample.html) ----
document.addEventListener('DOMContentLoaded', () => {
  const overlay  = document.getElementById('overlay');
  if (!overlay) return; // overlay not present on this page

  const panel    = overlay.querySelector('.overlay__panel');
  const iframe   = overlay.querySelector('.overlay__frame');
  const closeBtn = overlay.querySelector('.overlay__close');

  let lastFocused = null;

  // WebKit detection: Safari on macOS/iOS and iOS Chrome/Firefox use WebKit
  const isWebKit = /AppleWebKit/i.test(navigator.userAgent) && !/Edg/i.test(navigator.userAgent);
  if (isWebKit) overlay.classList.add('no-blur');

  function isOverlayLink(a) {
    if (!a || a.tagName !== 'A') return false;
    if (a.hasAttribute('data-overlay')) return true;
    const href = (a.getAttribute('href') || '').replace(/^\.\//, '').toLowerCase();
    return href === 'testimonial.html' || href === 'sample.html';
  }

  function labelForUrl(url) {
    const u = (url || '').toLowerCase();
    if (u.includes('testimonial')) return 'Testimonials';
    if (u.includes('sample')) return 'Samples';
    return 'Overlay';
  }

  function hashForUrl(url) {
    const u = (url || '').toLowerCase();
    if (u.includes('testimonial')) return '#testimonials';
    if (u.includes('sample')) return '#samples';
    return '#overlay';
  }

  function lockScroll(lock) {
    document.documentElement.style.overflow = lock ? 'hidden' : '';
    document.body.style.overflow = lock ? 'hidden' : '';
  }

  function openOverlay(url) {
    lastFocused = document.activeElement;
    const label = labelForUrl(url);
    if (panel) panel.setAttribute('aria-label', label);
    if (iframe) {
      iframe.setAttribute('title', label);
      iframe.src = url; // set before opening to avoid paint flash
      // Force layer promotion for safety
      iframe.style.transform = 'translateZ(0)';
    }
    lockScroll(true);
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
    setTimeout(() => { try { closeBtn && closeBtn.focus(); } catch {} }, 0);
    try { history.pushState({ overlay: label }, '', hashForUrl(url)); } catch {}
  }

  function closeOverlay() {
    if (!overlay.classList.contains('is-open')) return;
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
    // Clear iframe after the transition to stop media and free resources
    setTimeout(() => { if (iframe) iframe.src = 'about:blank'; }, 280);
    lockScroll(false);
    if (lastFocused && typeof lastFocused.focus === 'function') {
      setTimeout(() => lastFocused.focus(), 0);
    }
    if (location.hash === '#testimonials' || location.hash === '#samples' || location.hash === '#overlay') {
      try { history.back(); } catch {}
    }
  }

  // Intercept clicks on overlay-trigger links anywhere in the document
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!isOverlayLink(a)) return;
    if (e.metaKey || e.ctrlKey) return; // allow new-tab/window
    e.preventDefault();
    e.stopPropagation();
    openOverlay(a.getAttribute('href'));
  });

  // Close interactions
  closeBtn && closeBtn.addEventListener('click', (e) => { e.preventDefault(); closeOverlay(); });
  overlay.addEventListener('click', (e) => {
    // Click outside the panel closes
    if (e.target === overlay) closeOverlay();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeOverlay(); });

  // Close on browser back
  window.addEventListener('popstate', () => {
    if (overlay.classList.contains('is-open')) closeOverlay();
  });
});

// =======================
// Testimonials page logic
// =======================
document.addEventListener('DOMContentLoaded', () => {
  if (document.body.dataset.page !== 'testimonials') return;

  const stream = document.getElementById('t-stream');
  if (!stream) return;

  // Sample dataset — edit/expand with real quotes
  const testimonials = [
    {
  
      semester: "Spring '25",
      color: 'blue',
      side: 'left',
      avatar: 'assets/test1.png',   // ← add this
      text: `I really like how he always has great examples that make even the toughest concepts easy to get. And he’s great at asking just the right questions to guide you to the answer step by step.`
    },
    {
      semester: "Spring '25",
      color: 'emerald',
      side: 'right',
      avatar: 'assets/test2.png',  
      text: `Ice is very aware when students are struggling, and he helps out a lot for people who are in tough situations.`
    },
    {
      semester: "Fall '24",
      color: 'amber',
      side: 'left',
      avatar: 'assets/test3.png', 
      text: `Very friendly and always welcoming for questions.`
    },
    {
      semester: "Spring '25",
      color: 'violet',
      side: 'right',
      avatar: 'assets/test4.png', 
      text: `..The explanations were very clear, and I was able to clarify the things that I did not fully understand from lecture during Ice's discussion.`
    },
    {
      semester: "Fall '24",
      color: 'rose',
      side: 'left',
      avatar: 'assets/test5.png', 
      text: `..super engaging discussion sections and always well prepared to answer any questions..`
    },
    {
      semester: "Spring '24",
      color: 'blue',
      side: 'right',
      avatar: 'assets/test6.png', 
      text: `Ice is great at teaching. He's the reason I won't fail this class :)`
    },
    {
      semester: "Spring '24",
      color: 'blue',
      side: 'left',
      avatar: 'assets/test7.png', 
      text: `He knows the subject well and is helpful during and after discussions. Great lecturing and really helpful during office hours.`
    },
    {
      semester: "Fall '24",
      color: 'blue',
      side: 'right',
      avatar: 'assets/test8.png', 
      text: `..Always a packed class because he was the best at articularing and summarizing the content that was applicable..`
    }

  ];

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }

  function makeItem(t) {
    const item = el('article', `t-item t-${t.side || 'left'} t-reveal`);
  
    const avatar = el('div', 't-avatar');
avatar.dataset.color = t.color || 'blue';

if (t.avatar) {
  const img = document.createElement('img');
  img.className = 't-avatar-img';
  img.src = t.avatar;
  img.alt = 'Student avatar';
  img.loading = 'lazy';
  img.decoding = 'async';
  // Fallback: if image fails, remove it so the colored circle shows
  img.addEventListener('error', () => img.remove(), { once: true });
  avatar.appendChild(img);
} else {
  avatar.textContent = ''; // anonymous, color-only avatar
}
  
    const bubble = el('div', 't-bubble');
  
    const text = el('div');
    // Preserve line breaks in testimonial text
    (t.text || '').split('\n').forEach((line, i, arr) => {
      text.appendChild(document.createTextNode(line));
      if (i < arr.length - 1) text.appendChild(document.createElement('br'));
    });
  
    const semester = el('div', 't-semester', t.semester || '');
  
    bubble.appendChild(text);
    if (t.semester) bubble.appendChild(semester);
  
    item.appendChild(avatar);
    item.appendChild(bubble);
    return item;
  }

  // Render
  testimonials.forEach(t => stream.appendChild(makeItem(t)));

  // Reveal on scroll (staggered: one at a time, top→bottom, each delayed 1000ms)
  const REVEAL_DELAY_MS = 700;
  const items = Array.from(stream.querySelectorAll('.t-reveal'));
  const inView = new Array(items.length).fill(false);
  let nextIdx = 0;        // next item index to reveal (DOM order)
  let busyIdx = -1;       // index currently scheduled (or -1 if none)
  let timerId = null;     // pending timer for the scheduled reveal

  function clearTimer() {
    if (timerId) { clearTimeout(timerId); timerId = null; }
  }

  function schedule(i) {
    busyIdx = i;
    timerId = setTimeout(() => {
      items[i].classList.add('is-in'); // trigger CSS transition
      io.unobserve(items[i]);          // no longer need to observe
      busyIdx = -1;
      timerId = null;
      nextIdx = i + 1;                 // move to the next item in DOM order
      tryRevealQueue();
    }, REVEAL_DELAY_MS);
  }

  function tryRevealQueue() {
    // Skip over any already-revealed items
    while (nextIdx < items.length && items[nextIdx].classList.contains('is-in')) {
      nextIdx++;
    }
    if (busyIdx !== -1) return;               // already scheduling one
    if (nextIdx >= items.length) return;      // done
    if (inView[nextIdx]) schedule(nextIdx);   // only schedule when the next item is in view
  }

  const io = new IntersectionObserver((entries) => {
    entries.forEach(en => {
      const idx = items.indexOf(en.target);
      if (idx === -1) return;
      inView[idx] = en.isIntersecting;

      // If the currently scheduled item leaves view, cancel its timer
      if (!en.isIntersecting && idx === busyIdx) {
        clearTimer();
        busyIdx = -1;
      }
    });
    tryRevealQueue();
  }, { root: null, rootMargin: '0px 0px -10% 0px', threshold: 0.05 });

  items.forEach(n => io.observe(n));
});

// ===== Mobile help-grid: WebKit drag-to-scroll fallback =====
(function () {
  const grid = document.querySelector('.help-grid');
  if (!grid) return;

  const isWebKit = /AppleWebKit/i.test(navigator.userAgent) && !/Edg/i.test(navigator.userAgent);
  const isSmall  = window.matchMedia('(max-width: 900px)').matches;
  if (!(isWebKit && isSmall)) return;

  let isDown = false;
  let startX = 0;
  let startY = 0;
  let startScroll = 0;

  function onDown(e) {
    const p = e.touches ? e.touches[0] : e;
    isDown = true;
    startX = p.pageX;
    startY = p.pageY;
    startScroll = grid.scrollLeft;
    grid.classList.add('is-dragging');
  }

  function onMove(e) {
    if (!isDown) return;
    const p = e.touches ? e.touches[0] : e;
    const dx = p.pageX - startX;
    const dy = Math.abs(p.pageY - startY);
    if (e.cancelable && Math.abs(dx) > dy) e.preventDefault(); // assert horizontal intent
    grid.scrollLeft = startScroll - dx;
  }

  function onUp() {
    isDown = false;
    grid.classList.remove('is-dragging');
  }

  // Mouse support (desktop Safari small windows)
  grid.addEventListener('mousedown', onDown);
  grid.addEventListener('mousemove', onMove);
  grid.addEventListener('mouseleave', onUp);
  grid.addEventListener('mouseup', onUp);

  // Touch support (iOS Safari/Chrome)
  grid.addEventListener('touchstart', onDown, { passive: true });
  grid.addEventListener('touchmove', onMove, { passive: false });
  grid.addEventListener('touchend', onUp);
})();