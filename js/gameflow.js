import { scene } from './engine.js';
import { bullets, zombies, particles, drops, debris, state, BASE_STATS } from './state.js';
import { player } from './player.js';
import { removeCorpses } from './zombies.js';
import { resetOpenings } from './world.js';
import { weather, stormFor } from './weather.js';
import { audio, music } from './audio.js';
import { hud, updateHUD, showBanner } from './hud.js';
import { title, menuEl, SWOOP_TIME, enterTitle } from './menu.js';
import { keys, setFiring } from './input.js';
import { wvUnlock, wvSubmitScore } from './wavedash.js';
import { store } from './utils.js';

// WAVES
// ===================================================================
export function startWave(n) {
    state.wave = n;
    if (n >= 5) wvUnlock("WAVE_5");
    if (n >= 10) wvUnlock("WAVE_10");
    if (n >= 15) wvUnlock("WAVE_15");
    // Zombies toughen steadily but slower than upgrades let the player scale, so
    // runs can go long; speed caps below the player's so kiting always works.
    state.zombieSpeed = Math.min(5.2, 2.3 + n * 0.18);
    state.zombieHp = 2 + (n - 1) * 0.4;
    // anything already up counts toward the wave (the yard's shamblers when you leave the title)
    state.toSpawn = Math.max(0, 5 + n * 3 - zombies.length);
    for (const z of zombies) { z.userData.speed = state.zombieSpeed * z.userData.pace; z.userData.hp = state.zombieHp; }
    state.spawnTimer = 0;
    state.intermission = 0;
    weather.target = stormFor(n);
    const omens = { 1: 'they are already here', 5: 'it starts to rain', 8: 'the rain sets in', 12: 'the storm breaks', 15: 'god help you' };
    showBanner('WAVE ' + n, omens[n] || 'it gets worse');
    audio.waveStart(n);
}

// ===================================================================

// GAME FLOW
// ===================================================================
// clear everything a run leaves lying around
export function clearRun() {
    for (const b of bullets) scene.remove(b);
    for (const z of zombies) scene.remove(z);
    for (const p of particles) scene.remove(p);
    for (const d of drops) scene.remove(d);
    for (const d of debris) scene.remove(d);
    removeCorpses();
    bullets.length = 0; zombies.length = 0; particles.length = 0; drops.length = 0; debris.length = 0;
    hud.picker.classList.add('hidden');
}

// the survivor's stats before any upgrades
// BASE_STATS imported from state.js

// `keep` carries over what's on the field (coming from the title: the survivor stays where
// they are and the yard's zombies join wave 1, which starts once the camera is down)
export function resetGame(keep = false) {
    if (!keep) { clearRun(); resetOpenings(); }
    weather.set(0);
    Object.assign(state, {
        ...BASE_STATS, running: true, hp: BASE_STATS.maxHp, kills: 0, shots: 0, wave: 0,
        mag: BASE_STATS.magSize, reloading: false, reloadT: 0,
        fireCd: 0, dmgCd: 0, toSpawn: 0, spawnTimer: 0,
        intermission: 0, choosing: false, shake: 0, upgrades: {},
        pDamage: 0, pAmmo: 0, sinceDrop: 0,
    });
    if (keep) {
        state.intermission = SWOOP_TIME * 0.85;
        for (const z of zombies) Object.assign(z.userData, { cross: null, idle: 0, via: -1 });
    } else {
        player.position.set(0, 0, 0);
        startWave(1);
    }
    updateHUD();
}

export function startGame(fromTitle = false) {
    audio.ensure(); // create/resume AudioContext within the click gesture
    document.getElementById('death').classList.add('hidden');
    title.active = false;
    document.body.classList.remove('titling');
    menuEl.classList.add('gone');
    resetGame(fromTitle);
}

export function setPaused(on) {
    if (on && !state.running) return; // only a live run can pause
    if (on === state.paused) return;
    state.paused = on;
    setFiring(false);
    for (const k in keys) keys[k] = false; // keyups are missed while the menu is up
    document.getElementById('pauseStat').textContent = `WAVE ${state.wave} · ${state.kills} KILLS`;
    document.getElementById('pause').classList.toggle('hidden', !on);
    audio.pause(on);
}

export function quitToTitle() {
    setPaused(false);
    state.running = false;
    document.getElementById('death').classList.add('hidden');
    enterTitle(false);
    music.setMode('title');
}

export function die() {
    state.running = false;
    setFiring(false);
    document.getElementById('deathStat').textContent =
        `YOU REACHED WAVE ${state.wave} · ${state.kills} KILLS`;
    // best night is ranked by kills, like the leaderboard
    const best = store.get('best', null), record = state.kills > 0 && (!best || state.kills > best.kills);
    if (record) store.set('best', { wave: state.wave, kills: state.kills });
    const db = document.getElementById('deathBest');
    db.textContent = record ? 'NEW BEST NIGHT' : best ? `BEST: WAVE ${best.wave} · ${best.kills} KILLS` : '';
    db.classList.toggle('record', record);
    document.getElementById('death').classList.remove('hidden');
    audio.death();
    if (state.wave === 1 && state.shots === 0) wvUnlock("PACIFIST");
    wvSubmitScore(state.kills);
}

// ===================================================================
