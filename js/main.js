import { renderer, scene, camera } from './engine.js';
import { state } from './state.js';
import { update } from './update.js';
import { enterTitle, updateCamera } from './menu.js';
import { Wavedash } from './wavedash.js';
import './input.js';

let last = performance.now();
function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!state.paused) update(dt);
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
}

enterTitle(true);
updateCamera(0);
requestAnimationFrame(loop);

// Everything above is set up synchronously and there are no async assets to
// wait on, so signal readiness immediately. This dismisses the Wavedash loading
// screen and reveals the Abandon All Hope start overlay. (No-op when running standalone,
// where there is no loading screen to dismiss.)
if (Wavedash) Wavedash.init({ debug: true });

