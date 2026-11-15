import * as THREE from 'three';
import { scene, camera } from './engine.js';
import { rnd, damp } from './utils.js';
import { state, bullets, zombies, particles, PLAYER_SPEED } from './state.js';
import { keys, mouse, firing, aimPoint, aimPlane, raycaster } from './input.js';
import { player, animatePlayer } from './player.js';
import { fire, finishReload } from './weapon.js';
import { updateDrops } from './drops.js';
import { startWave, die } from './gameflow.js';
import { openPicker } from './upgrades.js';
import { hud, updateHUD, damageFlash, updateFlash } from './hud.js';
import { audio, music } from './audio.js';
import { title, updateTitle, updateCamera, wanderZombie } from './menu.js';
import {
    HALF, WALL_T, wallBoxes, shutAt, burst, woodChip, breakOpening,
    pushOutOfSolids, inside, nearestOpening, routeAround, updateOpenings,
    updateWorld, updateDebris, hitOpening
} from './world.js';
import { updateWeather } from './weather.js';
import {
    zombieSkin, hitZombie, killZombie, Z_REACH, Z_LET_GO, Z_CLOSE, Z_SPACE, Z_SWING, Z_STRIKE, Z_HIT_RANGE, Z_TRACK, updateCorpses, animateZombie,
    climbStep, startClimb, faceToward, walkToward, wallBetween, spawnZombie
} from './zombies.js';
import { wvUnlock } from './wavedash.js';

export // UPDATE
// ===================================================================
// PLAYER_SPEED imported from state.js
const MAX_ALIVE = 30;     // spawning pauses while this many zombies are up
const tmp = new THREE.Vector3();
let groanT = 1;

// --- zombie melee: walk up, stop at arm's length, rear back and swing. The blow lands
// partway through, and only if you're still in range, so a step back dodges it ---
// Z_* combat constants imported from zombies.js
// rad/s a zombie turns to keep facing you while it stands and swings
const HURT_IFRAMES = 1.5; // after a hit, the survivor can't be hit again for this long (and flickers)

// wallBetween, faceToward, walkToward imported from zombies.js

function hurtPlayer() {
    if (state.dmgCd > 0) return false;
    state.hp--;
    state.dmgCd = HURT_IFRAMES;
    damageFlash();
    audio.hurt();
    if (state.hp <= 0) die();
    return true;
}

function chaseZombie(z, dt) {
    const ud = z.userData, p = player.position;
    const pdx = p.x - z.position.x, pdz = p.z - z.position.z, pd = Math.hypot(pdx, pdz);
    let walking = false;
    if (ud.climb >= 0) {
        climbStep(z, dt);
    } else if (ud.swing >= 0) {
        // committed to the blow: feet planted, tracking its target through the wind-up
        const o = ud.swingAt;
        ud.swing += dt;
        if (ud.swing < Z_STRIKE) faceToward(z, o ? o.x - z.position.x : pdx, o ? o.z - z.position.z : pdz, Z_TRACK, dt);
        if (!ud.struck && ud.swing >= Z_STRIKE) {
            ud.struck = true;
            if (o) hitOpening(o);
            else if (!(pd < Z_HIT_RANGE && !wallBetween(z.position, p) && hurtPlayer())) audio.swipe(z.position);
        }
        if (ud.swing >= Z_SWING) { ud.swing = -1; ud.swingCd = rnd(0.25, 0.6); }
    } else if (pd < (ud.standing ? Z_LET_GO : Z_REACH) && !wallBetween(z.position, p)) {
        // at arm's length: stand, square up, and swing as soon as it's facing you (no
        // cooldown left over from battering its way in)
        if (!ud.standing) ud.swingCd = 0;
        ud.standing = true;
        const off = faceToward(z, pdx, pdz, Z_TRACK, dt);
        ud.swingCd -= dt;
        if (ud.swingCd <= 0 && off < 0.5) { ud.swing = 0; ud.struck = false; ud.swingAt = null; }
    } else {
        ud.standing = false;
        // steer toward nearest opening if outside, else toward player
        let tx = p.x, tz = p.z;
        if (inside(z.position)) {
            ud.opening = null; ud.stage = 0; // through the wall — re-pick if knocked back out
        } else {
            // Commit to one opening (no per-frame re-pick): walk up via its outer waypoint so
            // it comes at the door or window square-on, then break it and go through
            if (!ud.opening) { ud.opening = nearestOpening(z.position); ud.stage = 0; }
            const o = ud.opening;
            if (ud.stage === 0) {
                tx = o.ox; tz = o.oz;
                if ((o.ox - z.position.x) ** 2 + (o.oz - z.position.z) ** 2 < 1.4) ud.stage = 1;
            }
            if (ud.stage === 1) {
                if (o.kind === 'door' && o.hp <= 0) { tx = o.ix; tz = o.iz; } // broken down: straight through
                else if ((o.x - z.position.x) ** 2 + (o.z - z.position.z) ** 2 > 1.45 ** 2) { tx = o.fx; tz = o.fz; }
                else {
                    // at it: batter it in, or take a turn climbing through the broken window
                    tx = null;
                    const off = faceToward(z, o.x - z.position.x, o.z - z.position.z, Z_TRACK, dt);
                    ud.swingCd -= dt;
                    if (o.hp > 0) { if (ud.swingCd <= 0 && off < 0.5) { ud.swing = 0; ud.struck = false; ud.swingAt = o; } }
                    else if (!o.climber) startClimb(z, o);
                }
            }
        }
        if (tx !== null) {
            const g = routeAround(z, tx, tz);
            // turn harder up close so the last few steps home in on you
            walkToward(z, g.x - z.position.x, g.z - z.position.z, ud.speed, ud.turn * (pd < 4 ? 2.5 : 1), dt);
            walking = true;
        }
    }
    // progress check: a zombie that's been trying to walk for 2s but has barely moved (jammed
    // in a crowd at a door, say) forgets its plan and makes for the next-nearest way in
    if (walking && (ud.stuckT += dt) > 2) {
        if (Math.hypot(z.position.x - ud.stuckX, z.position.z - ud.stuckZ) < 0.6 && ud.opening && !inside(z.position)) {
            ud.opening = nearestOpening(z.position, ud.opening);
            ud.stage = 0; ud.via = -1;
        }
        ud.stuckT = 0;
    }
    if (!walking || ud.stuckT === 0) { ud.stuckX = z.position.x; ud.stuckZ = z.position.z; if (!walking) ud.stuckT = 0; }
    ud.gait = damp(ud.gait, walking ? 1 : 0, 8, dt);
    animateZombie(z, dt, pd);
}

// keep the crowd from stacking into one body, out of the survivor, and out of the props
function separateZombies() {
    for (let i = 0; i < zombies.length; i++) {
        const a = zombies[i].position;
        for (let k = i + 1; k < zombies.length; k++) {
            const b = zombies[k].position, dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz;
            if (d2 >= Z_SPACE * Z_SPACE || d2 < 1e-6) continue;
            const d = Math.sqrt(d2), push = (Z_SPACE - d) / 2 / d;
            a.x -= dx * push; a.z -= dz * push;
            b.x += dx * push; b.z += dz * push;
        }
    }
    for (const z of zombies) {
        if (z.userData.climb >= 0) continue; // on the sill: the climb places it
        if (state.running) {
            const dx = z.position.x - player.position.x, dz = z.position.z - player.position.z, d = Math.hypot(dx, dz);
            if (d < Z_CLOSE && d > 1e-6) { z.position.x += dx / d * (Z_CLOSE - d); z.position.z += dz / d * (Z_CLOSE - d); }
        }
        pushOutOfSolids(z.position);
    }
}

export function update(dt) {
    const px = player.position.x, pz = player.position.z;
    if (state.running) {
        // --- movement ---
        let mx = 0, mz = 0;
        if (keys['KeyW'] || keys['ArrowUp']) mz -= 1;
        if (keys['KeyS'] || keys['ArrowDown']) mz += 1;
        if (keys['KeyA'] || keys['ArrowLeft']) mx -= 1;
        if (keys['KeyD'] || keys['ArrowRight']) mx += 1;
        const moving = !!(mx || mz);
        if (moving) {
            const l = Math.hypot(mx, mz);
            player.position.x += (mx / l) * state.speed * dt;
            player.position.z += (mz / l) * state.speed * dt;
        }
        // clamp inside cabin
        const lim = HALF - 0.7;
        player.position.x = Math.max(-lim, Math.min(lim, player.position.x));
        player.position.z = Math.max(-lim, Math.min(lim, player.position.z));
        // --- aim ---
        raycaster.setFromCamera(mouse, camera);
        if (raycaster.ray.intersectPlane(aimPlane, aimPoint)) {
            const a = Math.atan2(aimPoint.x - player.position.x, aimPoint.z - player.position.z);
            player.rotation.y = a;
        }

        // --- weapon ---
        state.fireCd -= dt;
        if (firing && !state.choosing) fire();
        if (state.reloading) {
            state.reloadT += dt;
            if (state.reloadT >= state.reloadTime) finishReload();
        }
        state.pDamage = Math.max(0, state.pDamage - dt);
        state.pAmmo = Math.max(0, state.pAmmo - dt);
        updateDrops(dt);

        // --- waves ---
        if (state.choosing) {
            // wave cleared — waiting on the upgrade pick
        } else if (state.intermission > 0) {
            state.intermission -= dt;
            if (state.intermission <= 0) startWave(state.wave + 1);
        } else {
            if (state.toSpawn > 0) {
                state.spawnTimer -= dt;
                if (state.spawnTimer <= 0 && zombies.length < MAX_ALIVE) {
                    // spawn 1-2 at a time, faster on higher waves
                    const spawnBurst = 1 + (Math.random() < Math.min(0.6, state.wave * 0.08) ? 1 : 0);
                    for (let i = 0; i < spawnBurst && state.toSpawn > 0; i++) { spawnZombie(); state.toSpawn--; }
                    state.spawnTimer = Math.max(0.35, 1.4 - state.wave * 0.08);
                }
            } else if (zombies.length === 0) {
                // wave cleared
                if (state.wave === 1) wvUnlock("WAVE_1"); // survived your first wave
                const healed = state.hp < state.maxHp;
                state.hp = Math.min(state.maxHp, state.hp + 1);
                audio.waveClear();
                openPicker(healed);
            }
        }

        state.dmgCd -= dt;

        // --- zombie groans: more of them up = a busier, closer chorus ---
        if (zombies.length) {
            groanT -= dt;
            if (groanT <= 0) {
                const gz = zombies[(Math.random() * zombies.length) | 0];
                audio.groan(gz.position);
                gz.userData.groan = 1; // its jaw drops with the groan
                groanT = rnd(0.5, 1.6) * 4 / Math.min(8, 2 + zombies.length * 0.5);
            }
        }
    }
    if (title.active) updateTitle(dt);
    music.wave = state.wave;
    music.alive = zombies.length;
    music.lowHp = state.running && state.hp === 1;

    // --- bullets ---
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        const px = b.position.x, pz = b.position.z;
        b.position.addScaledVector(b.userData.dir, 38 * dt);
        b.userData.life -= dt;
        let hit = false;
        // wall collision: sample the path traveled this frame so fast bullets
        // can't tunnel through the thin walls (openings have no wall box; shut ones are checked below)
        const steps = Math.max(1, Math.ceil(Math.hypot(b.position.x - px, b.position.z - pz) / (WALL_T * 0.5)));
        for (let s = 1; s <= steps && !hit; s++) {
            const t = s / steps;
            const sx = px + (b.position.x - px) * t, sz = pz + (b.position.z - pz) * t;
            for (const w of wallBoxes) {
                if (sx >= w.minX && sx <= w.maxX && sz >= w.minZ && sz <= w.maxZ) { hit = true; break; }
            }
            // a shut door stops the round; glass shatters and lets it through
            const o = !hit && shutAt(sx, sz);
            if (o?.kind === 'door') { hit = true; o.jolt = 0.4; burst(o, 1, woodChip, 0.08, 1.5); audio.bash(o, 0.4); }
            else if (o) breakOpening(o);
        }
        for (let j = zombies.length - 1; j >= 0 && !hit; j--) {
            const z = zombies[j];
            if (b.userData.hits.has(z)) continue; // a piercing bullet already went through this one
            // distance from the zombie to the path traveled this frame (not just the
            // end point), so bullets can't skip past zombies at low frame rates
            const sx = b.position.x - px, sz = b.position.z - pz;
            const t = Math.max(0, Math.min(1, ((z.position.x - px) * sx + (z.position.z - pz) * sz) / (sx * sx + sz * sz || 1)));
            const dx = z.position.x - (px + sx * t), dz = z.position.z - (pz + sz * t);
            if (dx * dx + dz * dz < 0.55) {
                z.userData.hp -= state.damage * (state.pDamage > 0 ? 2 : 1);
                hitZombie(z);
                // small knockback
                z.position.addScaledVector(b.userData.dir, 0.25);
                if (z.userData.hp <= 0) { audio.zdeath(z.position); killZombie(z, j, b.userData.dir); }
                else audio.hit(z.position);
                b.userData.hits.add(z);
                if (b.userData.pierce > 0) b.userData.pierce--;
                else hit = true; // ends the loop; a piercing bullet keeps checking the rest
            }
        }
        if (hit || b.userData.life <= 0) { scene.remove(b); bullets.splice(i, 1); }
    }

    // --- zombies ---
    for (let j = zombies.length - 1; j >= 0; j--) {
        const z = zombies[j];
        const ud = z.userData;
        // hurt flash recover
        if (ud.hurt > 0) {
            ud.hurt -= dt;
            if (ud.hurt <= 0) for (const m of ud.body) m.material = zombieSkin;
        }
        if (state.running) chaseZombie(z, dt);
        else if (title.active) wanderZombie(z, dt);
    }
    if (state.running || title.active) separateZombies();

    // --- particles ---
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.userData.life -= dt;
        p.userData.v.y -= 16 * dt;
        p.position.addScaledVector(p.userData.v, dt);
        if (p.position.y < 0.05) { p.position.y = 0.05; p.userData.v.set(0, 0, 0); }
        if (p.userData.life <= 0) { scene.remove(p); particles.splice(i, 1); }
    }

    updateCorpses(dt);
    updateOpenings(dt);
    updateWeather(dt);
    updateWorld(dt);

    // --- survivor rig, driven by how far the survivor actually moved (so pushing into a
    // wall doesn't run in place). Runs on the title and death screens too, so the pose settles ---
    const inv = dt > 0 ? 1 / dt : 0;
    animatePlayer(dt, (player.position.x - px) * inv, (player.position.z - pz) * inv);
    // flicker while the post-hit grace period lasts
    player.visible = !state.running || state.dmgCd <= 0 || Math.floor(state.dmgCd * 12) % 2 === 0;
    updateDebris(dt);

    updateFlash(dt);

    updateCamera(dt);

    updateHUD();
}

// ===================================================================
