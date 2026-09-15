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

  // ---- drag on the battlefield to aim (relative: x = angle, y = power)
  let drag = null;
  const toWorld = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  canvas.addEventListener('pointerdown', (e) => {
    app.sound.unlock();
    if (!app.canAct() || !app.prefs.dragAim) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const t = app.game.tanks[app.game.current];
    const w = toWorld(e);
    drag = { id: e.pointerId, x0: w.x, y0: w.y, angle0: t.angle, power0: t.power, moved: false };
    app.showAim();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id || !app.canAct()) return;
    const w = toWorld(e);
    const dx = w.x - drag.x0, dy = w.y - drag.y0;
    if (!drag.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
    drag.moved = true;
    const angle = Math.round(drag.angle0 + dx / 3.2);
    const power = Math.round(drag.power0 - dy * 3);
    app.setAim(angle, power);
    app.showAim();
  });
  const endDrag = (e) => {
    if (drag && e.pointerId === drag.id) {
      drag = null;
      app.showAim(900);
    }
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

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
