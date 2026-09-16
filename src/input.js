// Touch, mouse and keyboard input for the game screen.
import { W, H } from './game.js';

export function installInput(app) {
  const canvas = app.canvas;
  const controls = document.getElementById('controls');
  const holdTimers = new Map();

  const stopHold = (btn) => {
    const t = holdTimers.get(btn);
    if (t) {
      clearTimeout(t.timer);
      holdTimers.delete(btn);
    }
  };

  const act = (btn, held) => {
    const a = btn.dataset.act;
    switch (a) {
      case 'angle':
        app.adjust('angle', Number(btn.dataset.d) * (held > 30 ? 3 : 1));
        break;
      case 'power':
        app.adjust('power', Number(btn.dataset.d) * (held > 30 ? 5 : held > 12 ? 2 : 1));
        break;
      case 'weapon':
        app.openWeapons();
        break;
      case 'items':
        app.openItems();
        break;
      case 'fire':
        app.fire();
        break;
      case 'menu':
        app.openMenu();
        break;
      case 'speed':
        app.toggleSpeed();
        break;
      case 'chat':
        app.openChat();
        break;
      case 'zoomreset':
        app.resetView();
        break;
    }
  };

  // hold-to-repeat buttons act on pointerdown; everything else on click, so
  // that the tap's click never lands on whatever the action just opened.
  controls.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled || !btn.classList.contains('hold')) return;
    app.sound.unlock();
    e.preventDefault();
    btn.setPointerCapture && btn.setPointerCapture(e.pointerId);
    let count = 0;
    act(btn, count);
    const rep = () => {
      count++;
      act(btn, count);
      const st = holdTimers.get(btn);
      if (st) st.timer = setTimeout(rep, count > 30 ? 35 : count > 8 ? 55 : 90);
    };
    holdTimers.set(btn, { timer: setTimeout(rep, 380) });
  });
  controls.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled || btn.classList.contains('hold')) return;
    app.sound.unlock();
    act(btn, 0);
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave', 'lostpointercapture']) {
    controls.addEventListener(ev, (e) => {
      const btn = e.target.closest && e.target.closest('[data-act]');
      if (btn) stopHold(btn);
      else for (const b of [...holdTimers.keys()]) stopHold(b);
    });
  }
  window.addEventListener('blur', () => { for (const b of [...holdTimers.keys()]) stopHold(b); });

  // ---- battlefield gestures: one finger aims (relative: x = angle, y = power),
  // two fingers pinch-zoom and pan, double-tap resets the zoom, wheel zooms on desktop
  const stage = document.getElementById('stage');
  // Block the browser's own pinch-zoom / scroll / double-tap on the battlefield so
  // two-finger gestures reach the pointer handlers below (iOS Safari ignores the
  // viewport's user-scalable=no; only preventDefault on touch events stops it).
  const inOverlay = (e) => e.target && e.target.closest && e.target.closest('#stage-overlay');
  for (const ev of ['touchstart', 'touchmove', 'touchend']) {
    stage.addEventListener(ev, (e) => { if (app.game && !inOverlay(e)) e.preventDefault(); }, { passive: false });
  }
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
    stage.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  }
  const pointers = new Map(); // pointerId -> {x, y} in stage coordinates
  let drag = null;
  let pinch = null;
  let waitForLift = false; // after a pinch, ignore the remaining finger until it lifts
  let lastTap = 0;
  const toWorld = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  const toStage = (e) => {
    const r = stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const pinchGeometry = () => {
    const [a, b] = [...pointers.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  };
  stage.addEventListener('pointerdown', (e) => {
    app.sound.unlock();
    if (!app.game || (e.target.closest && e.target.closest('#stage-overlay'))) return;
    e.preventDefault();
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, toStage(e));
    if (pointers.size === 2) {
      // second finger: the first finger's aiming is undone and a pinch begins
      if (drag) {
        if (drag.moved) app.setAim(drag.angle0, drag.power0);
        drag = null;
      }
      const g = pinchGeometry();
      pinch = { dist0: g.dist, zoom0: app.view.zoom, mx: g.mx, my: g.my };
      waitForLift = true;
      return;
    }
    if (pointers.size > 2) return;
    if (waitForLift) return;
    const now = performance.now();
    if (now - lastTap < 320) {
      lastTap = 0;
      app.resetView();
      return;
    }
    lastTap = now;
    if (!app.canAct() || !app.prefs.dragAim) return;
    const t = app.game.tanks[app.game.current];
    const w = toWorld(e);
    drag = { id: e.pointerId, x0: w.x, y0: w.y, angle0: t.angle, power0: t.power, moved: false };
    app.showAim();
  });
  stage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, toStage(e));
    if (pinch && pointers.size >= 2) {
      const g = pinchGeometry();
      app.setZoom(pinch.zoom0 * (g.dist / pinch.dist0), g.mx, g.my);
      app.panBy(g.mx - pinch.mx, g.my - pinch.my);
      pinch.mx = g.mx;
      pinch.my = g.my;
      return;
    }
    if (!drag || e.pointerId !== drag.id || !app.canAct()) return;
    const w = toWorld(e);
    const dx = w.x - drag.x0, dy = w.y - drag.y0;
    if (!drag.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
    drag.moved = true;
    lastTap = 0;
    const angle = Math.round(drag.angle0 + dx / 3.2);
    const power = Math.round(drag.power0 - dy * 3);
    app.setAim(angle, power);
    app.showAim();
  });
  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) waitForLift = false;
    if (drag && e.pointerId === drag.id) {
      drag = null;
      app.showAim(900);
    }
  };
  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);
  stage.addEventListener('wheel', (e) => {
    if (!app.game) return;
    e.preventDefault();
    const p = toStage(e);
    app.setZoom(app.view.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), p.x, p.y);
  }, { passive: false });

  // ---- keyboard
  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;
    if (document.getElementById('screen-game').hidden) return;
    const big = e.shiftKey;
    let handled = true;
    switch (e.key) {
      case 'ArrowLeft': app.adjust('angle', big ? 5 : 1); break;
      case 'ArrowRight': app.adjust('angle', big ? -5 : -1); break;
      case 'ArrowUp': app.adjust('power', big ? 50 : 10); break;
      case 'ArrowDown': app.adjust('power', big ? -50 : -10); break;
      case 'PageUp': app.adjust('power', 100); break;
      case 'PageDown': app.adjust('power', -100); break;
      case 'Tab': app.cycleWeapon(e.shiftKey ? -1 : 1); break;
      case ' ':
      case 'Enter': app.fire(); break;
      case 'w': case 'W': app.openWeapons(); break;
      case 'i': case 'I': app.openItems(); break;
      case 'f': case 'F': app.toggleSpeed(); break;
      case 'Escape': app.openMenu(); break;
      default: handled = false;
    }
    if (handled) e.preventDefault();
  });
}
