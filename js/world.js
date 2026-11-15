import * as THREE from 'three';
import { scene, BOX, bevelBox, plainBox, BlockBatch, bakeBlocks } from './engine.js';
import { seeded, rnd } from './utils.js';
import { audio } from './audio.js';
import { debris } from './state.js';
import { weather } from './weather.js';

// ===================================================================
// WORLD: forest floor, plank floor, log walls (with gaps), yard, forest, lights
// ===================================================================
export const HALF = 10;            // interior half-extent (cabin is 20x20)
export const WALL_H = 2.4;
export const WALL_T = 0.7;

export const world = new THREE.Group();
scene.add(world);

// Everything static is baked from blocks into a few vertex-colored meshes
// (floor, walls, props) plus instanced trees and undergrowth, so the whole
// set is a couple of dozen draw calls.
export const worldMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
export const GROUND_Y = -0.06; // the forest floor sits just under the cabin boards
export function bakedMesh(batch, cast = true) {
    const m = new THREE.Mesh(batch.build(), worldMat);
    m.castShadow = cast; m.receiveShadow = true;
    world.add(m);
    return m;
}
// a matrix placing a prop at (x, z), turned ry
const _place = new THREE.Matrix4();
export const at = (x, z, ry = 0, y = 0) => _place.makeRotationY(ry).setPosition(x, y, z);

// --- forest floor: blocky flecks of moss, needles and dirt on a small repeating texture ---
export function groundTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d'), rng = seeded(5);
    g.fillStyle = '#1b1e15';
    g.fillRect(0, 0, 128, 128);
    const tones = ['#232b19', '#161812', '#2a2418', '#1e2716', '#121410', '#2c3320'];
    for (let i = 0; i < 2600; i++) {
        g.fillStyle = tones[(rng() * tones.length) | 0];
        const s = rng() < 0.85 ? 2 : 4;
        g.fillRect((rng() * 64 | 0) * 2, (rng() * 64 | 0) * 2, s, s);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(25, 25);
    t.magFilter = THREE.NearestFilter;
    t.anisotropy = 4;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}
export const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 1 }));
ground.position.y = GROUND_Y;
ground.receiveShadow = true;
scene.add(ground);

// --- cabin floor: staggered boards, each its own shade; the chamfers draw the seams ---
const floorBase = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2 + WALL_T, 0.4, HALF * 2 + WALL_T),
    new THREE.MeshStandardMaterial({ color: 0x150f0a, roughness: 1 }));
floorBase.position.y = -0.28;
floorBase.receiveShadow = true;
world.add(floorBase);

export const EDGE = HALF + WALL_T / 2;
const BOARD = 0.42;
const floorB = new BlockBatch(), frng = seeded(11);
const boardTones = [0x4d3825, 0x46321f, 0x533d28, 0x41301e];
for (let z = -EDGE + BOARD / 2; z < EDGE; z += BOARD) {
    for (let x = -EDGE - frng() * 2; x < EDGE;) {
        const len = 1.6 + frng() * 2.6, a = Math.max(x, -EDGE), b = Math.min(x + len, EDGE), r = frng();
        const tone = r < 0.05 ? 0x2e2115 : r < 0.1 ? 0x5e4730 : boardTones[(frng() * 4) | 0]; // the odd stained or newer board
        floorB.add([[b - a - 0.015, 0.08, BOARD - 0.015, (a + b) / 2, -0.04, z, tone, 0, 0, 0, 0.018]], frng);
        x += len;
    }
}
// a braided rug, stepped into an oval (each ring a little higher so they never z-fight)
[[3.8, 2.2, 3.2, 2.7, 0x55201c], [3.2, 1.6, 2.6, 2.1, 0x6a5432], [2.6, 1.0, 2.0, 1.5, 0x55201c], [1.7, 0.45, 1.3, 0.75, 0x3e2618]]
    .forEach(([w1, d1, w2, d2, c], i) => floorB.add([
        [w1, 0.012, d1, 0, 0.006 + i * 0.008, 0, c, 0, 0, 0, 0.004],
        [w2, 0.012, d2, 0, 0.009 + i * 0.008, 0, c, 0, 0, 0, 0.004],
    ], frng, at(3, -2.6, 0.08)));
// what was left behind: loose pages, a tin can, old blood dragged in from the door
for (const [x, z, ry] of [[-6.5, -7.8, 0.4], [-6.1, -7.4, 1.3], [7.2, 6.4, 2.2], [-8.2, 3.2, 0.9], [1.2, 7.9, 2.8]]) {
    floorB.add([[0.22, 0.006, 0.3, 0, 0.004, 0, 0xb5ab90, 0, 0, 0, 0.002]], frng, at(x, z, ry));
}
floorB.add([[0.13, 0.13, 0.17, 0, 0.065, 0, 0x8a8f96, 0, 0, 0, 0.02], [0.135, 0.07, 0.1, 0, 0.065, 0.02, 0x9a3a2a, 0, 0, 0, 0.01]], frng, at(-3.5, 6.2, 0.7));
for (const [x, z, w, ry] of [[0.4, 8.9, 0.9, 0.2], [-0.5, 8.1, 0.6, -0.4], [0.9, 7.3, 0.5, 0.6]]) {
    floorB.add([[w, 0.006, w * 0.45, 0, 0.004, 0, 0x2a0b09, 0, 0, 0, 0.002]], frng, at(x, z, ry));
}

// --- walls: stacked logs with chinking and overhanging corners, two doors and three windows ---
// The openings are where zombies get in: they break the doors down and smash and climb the windows.
export const openings = []; // the doors and windows (see makeOpening)
export const wallBoxes = []; // world-space {minX, maxX, minZ, maxZ} footprints for bullet collision
const wallB = new BlockBatch(), wrng = seeded(23);
const LOG_STEP = 0.4, LOG_H = 0.42, LOG_D = 0.62, OVERHANG = 0.42;
const LOG_TONES = [0x5a4430, 0x4d3926, 0x664e36, 0x45331f];
const END_GRAIN = 0x8d7150, CHINK = 0x9a9486, POST = 0x3a2b1d, WEATHERED = 0x6d6352;
const STONE_TONES = [0x3d3e40, 0x46464a, 0x353638];
// a block lying along a wall: `u0..u1` along it, centered `n` off the wall plane
export function wallBlock(axis, fixed, u0, u1, y, h, d, color, bevel, n = 0, tilt = 0) {
    const len = Math.abs(u1 - u0), c = (u0 + u1) / 2;
    return axis === 'x'
        ? [len, h, d, c, y, fixed + n, color, 0, 0, tilt, bevel]
        : [d, h, len, fixed + n, y, c, color, -tilt, 0, 0, bevel];
}

// builds a wall along an axis. `fixed` = the constant coord, `axis` = 'x' or 'z';
// `gaps` = [start, end, 'door' | 'window'] along the moving axis (world units)
const OPENING_INSET = 1.5; // how far in/out the entry waypoints sit from the wall plane
const SILL = { x: 0.85, z: 1.05 }, HEAD = { x: 1.63, z: 1.83 }; // window openings fall between log courses
const DOOR_TOP = 2.03, JAMB = 0.14;
const DOOR_HP = 12, WINDOW_HP = 2; // blows it takes to break one in
export function buildWall(axis, fixed, gaps) {
    const min = -EDGE, max = EDGE, mine = [];
    const segs = [];
    let cursor = min;
    for (const [gs, ge, kind] of gaps.slice().sort((a, b) => a[0] - b[0])) {
        if (gs > cursor) segs.push([cursor, gs]);
        cursor = Math.max(cursor, ge);
        mine.push(makeOpening(axis, fixed, gs, ge, kind));
    }
    if (cursor < max) segs.push([cursor, max]);
    const layer0 = axis === 'x' ? 0.24 : 0.44; // the two directions interleave at the corners
    for (const [a, b] of segs) {
        const hw = (axis === 'x' ? b - a : WALL_T) / 2, hd = (axis === 'x' ? WALL_T : b - a) / 2;
        const cx = axis === 'x' ? (a + b) / 2 : fixed, cz = axis === 'x' ? fixed : (a + b) / 2;
        wallBoxes.push({ minX: cx - hw, maxX: cx + hw, minZ: cz - hd, maxZ: cz + hd });
        logRun(axis, fixed, a, b, layer0, () => true, a > min + 0.01, b < max - 0.01, true);
    }
    // across each opening: a lintel over a door; logs under the sill and over the head of a window
    for (const o of mine) {
        const keep = o.kind === 'door'
            ? y => y - LOG_H / 2 >= DOOR_TOP - 0.01
            : y => y + LOG_H / 2 <= o.sill + 0.01 || y - LOG_H / 2 >= o.head - 0.01;
        logRun(axis, fixed, o.u0, o.u1, layer0, keep, true, true, o.kind === 'window');
        fitOpening(o);
        openings.push(o);
    }
}

// a run of stacked logs from a to b (only the courses `keep` allows). Ends that meet an
// opening are cut square for its frame; ends at a corner run on past the other wall
function logRun(axis, fixed, a, b, layer0, keep, cutA, cutB, footing) {
    for (let k = 0; k < 6; k++) {
        const y = layer0 + k * LOG_STEP;
        if (!keep(y)) continue;
        const u0 = cutA ? a : a - OVERHANG, u1 = cutB ? b : b + OVERHANG;
        wallB.add([wallBlock(axis, fixed, u0, u1, y, LOG_H, LOG_D, LOG_TONES[(wrng() * 4) | 0], 0.19)], wrng); // deep chamfer: round-ish logs
        if (k < 5 && keep(y + LOG_STEP)) wallB.add([wallBlock(axis, fixed, a, b, y + LOG_STEP / 2, 0.08, LOG_D * 0.72, CHINK, 0.02)], wrng);
        for (const [cut, u] of [[cutA, u0], [cutB, u1]]) {
            if (!cut) wallB.add([wallBlock(axis, fixed, u - 0.012, u + 0.012, y, LOG_H * 0.8, LOG_D * 0.8, END_GRAIN, 0.1)], wrng); // end grain
        }
    }
    if (!footing) return;
    if (axis === 'z') wallB.add([wallBlock(axis, fixed, a, b, 0.13, 0.24, LOG_D * 0.9, LOG_TONES[1], 0.06)], wrng); // sill log
    for (let u = a - (cutA ? 0 : 0.3); u < b + (cutB ? 0 : 0.3);) { // fieldstone footing
        const len = 0.45 + wrng() * 0.6;
        wallB.add([wallBlock(axis, fixed, u, Math.min(u + len, b + (cutB ? 0 : 0.3)) - 0.04, 0.02, 0.18, LOG_D + 0.16, STONE_TONES[(wrng() * 3) | 0], 0.05)], wrng);
        u += len;
    }
}

// An opening's geometry and waypoints. Zombies come in via the OUTER waypoint, stand at
// the FRONT to break it, then go through to the INNER one (or climb to the LANDING).
// Its parts are modeled in a local frame: x along the wall, +z out of the cabin.
export function makeOpening(axis, fixed, u0, u1, kind) {
    const c = (u0 + u1) / 2, s = Math.sign(fixed), ht = WALL_T / 2;
    const p = out => axis === 'x' ? [c, fixed + s * out] : [fixed + s * out, c]; // world x, z at `out` from the wall
    const [x, z] = p(0), [ox, oz] = p(OPENING_INSET), [ix, iz] = p(-OPENING_INSET), [fx, fz] = p(0.85), [lx, lz] = p(-0.95);
    return {
        kind, axis, u0, u1, w: u1 - u0, x, z, ox, oz, ix, iz, fx, fz, lx, lz,
        sill: SILL[axis], head: HEAD[axis],
        rotY: axis === 'x' ? (s > 0 ? 0 : Math.PI) : s * Math.PI / 2,
        box: axis === 'x' ? { minX: u0, maxX: u1, minZ: fixed - ht, maxZ: fixed + ht } : { minX: fixed - ht, maxX: fixed + ht, minZ: u0, maxZ: u1 },
        maxHp: kind === 'door' ? DOOR_HP : WINDOW_HP, hp: 0,
        climber: null, // the zombie clambering through a broken window (one at a time)
        jolt: 0, fallT: -1,
    };
}

const glassMat = new THREE.MeshStandardMaterial({ color: 0x9fb6c9, roughness: 0.08, metalness: 0.4, transparent: true, opacity: 0.3, depthWrite: false });
const glassCracked = new THREE.MeshStandardMaterial({ color: 0xd8e4ee, roughness: 0.45, metalness: 0.2, transparent: true, opacity: 0.55, depthWrite: false });
// frame it in the baked walls, and build the parts that move or break
export function fitOpening(o) {
    const place = at(o.x, o.z, o.rotY), hw = o.w / 2, frng = seeded(Math.round(o.x * 7 + o.z * 13) + 99);
    const root = new THREE.Group();
    root.position.set(o.x, 0, o.z); root.rotation.y = o.rotY;
    world.add(root);
    if (o.kind === 'door') {
        wallB.add([
            [JAMB, DOOR_TOP + 0.1, LOG_D + 0.1, -hw + JAMB / 2, (DOOR_TOP + 0.1) / 2, 0, POST, 0, 0, 0, 0.03],  // posts
            [JAMB, DOOR_TOP + 0.1, LOG_D + 0.1, hw - JAMB / 2, (DOOR_TOP + 0.1) / 2, 0, POST, 0, 0, 0, 0.03],
            [o.w + 0.1, 0.14, LOG_D + 0.12, 0, DOOR_TOP + 0.02, 0, POST, 0, 0, 0, 0.03],                     // header
            [o.w - 0.1, 0.05, LOG_D, 0, 0.0, 0, POST, 0, 0, 0, 0.02],                                       // threshold
        ], wrng, place);
        // a ledged-and-braced plank door, hinged at its left edge, braces on the inside face
        const lw = o.w - 2 * JAMB - 0.02, lh = 1.92, n = 4, pw = lw / n;
        const blocks = [];
        for (let i = 0; i < n; i++) blocks.push([pw - 0.012, lh, 0.06, pw * (i + 0.5), lh / 2, 0, i % 2 ? WEATHERED : 0x5f5646, 0, 0, 0, 0.012]);
        blocks.push([lw - 0.04, 0.14, 0.04, lw / 2, 0.35, -0.05, POST, 0, 0, 0, 0.012], [lw - 0.04, 0.14, 0.04, lw / 2, lh - 0.35, -0.05, POST, 0, 0, 0, 0.012]);
        const bl = Math.hypot(lw - 0.1, lh - 0.7);
        blocks.push([0.12, bl, 0.04, lw / 2, lh / 2, -0.05, POST, 0, 0, -Math.atan2(lw - 0.1, lh - 0.7), 0.012]);
        blocks.push([0.05, 0.05, 0.08, lw - 0.15, 1.0, 0.06, 0x2a2a2a, 0, 0, 0, 0.01]);                                     // handle
        for (const y of [0.35, lh - 0.35]) blocks.push([0.32, 0.05, 0.015, 0.16, y, 0.035, 0x2a2a2a, 0, 0, 0, 0.005]);     // strap hinges
        const leafMesh = new THREE.Mesh(bakeBlocks(blocks, frng), worldMat);
        leafMesh.castShadow = true; leafMesh.receiveShadow = true;
        o.fall = new THREE.Group(); o.fall.position.z = -0.02; root.add(o.fall);                   // pivot it falls in about
        o.leaf = new THREE.Group(); o.leaf.position.set(-hw + JAMB + 0.01, 0.02, 0); o.fall.add(o.leaf); // hinge line
        o.leaf.add(leafMesh);
    } else {
        const h = o.head - o.sill, mid = (o.sill + o.head) / 2, iw = o.w - 0.2;
        wallB.add([
            [0.1, h + 0.1, LOG_D + 0.06, -hw + 0.05, mid, 0, POST, 0, 0, 0, 0.02],              // jambs
            [0.1, h + 0.1, LOG_D + 0.06, hw - 0.05, mid, 0, POST, 0, 0, 0, 0.02],
            [o.w + 0.12, 0.08, LOG_D + 0.08, 0, o.head, 0, POST, 0, 0, 0, 0.02],              // head
            [o.w + 0.3, 0.07, LOG_D + 0.24, 0, o.sill, 0.05, WEATHERED, 0, 0, 0, 0.02],        // sill board, lipped outside
        ], wrng, place);
        o.pane = new THREE.Group(); o.pane.position.y = mid; root.add(o.pane);
        o.glass = new THREE.Mesh(new THREE.BoxGeometry(iw, h - 0.08, 0.02), glassMat);
        const bars = new THREE.Mesh(bakeBlocks([[0.05, h - 0.08, 0.05, 0, 0, 0, POST], [iw, 0.05, 0.05, 0, 0, 0, POST]], frng), worldMat);
        bars.castShadow = true;
        o.bars = bars;
        o.pane.add(o.glass, bars);
        // what's left in the frame once it's smashed: jagged teeth round the edges
        const teeth = [];
        for (let i = 0; i < 9; i++) {
            const side = i % 3, t = frng() - 0.5, len = 0.12 + frng() * 0.2;
            const [px, py] = side === 0 ? [t * iw, -(h - 0.1) / 2 + 0.05] : side === 1 ? [-iw / 2 + 0.05, t * (h - 0.1)] : [iw / 2 - 0.05, t * (h - 0.1)];
            teeth.push([0.03 + frng() * 0.06, len, 0.015, px, py, 0, 0xffffff, 0, 0, (frng() - 0.5) * 1.6, 0]);
        }
        for (let i = 0; i < 3; i++) teeth.push([0.04 + frng() * 0.05, 0.1 + frng() * 0.12, 0.015, (frng() - 0.5) * iw, (h - 0.1) / 2 - 0.04, 0, 0xffffff, 0, 0, Math.PI + (frng() - 0.5) * 1.2, 0]);
        o.shards = new THREE.Mesh(bakeBlocks(teeth, frng, true), glassMat);
        o.pane.add(o.shards);
    }
}

// south wall (+Z, nearest the camera): the back door
buildWall('x', HALF, [[-0.8, 0.8, 'door']]);
// north wall (-Z): the front door on the left, a window on the right
buildWall('x', -HALF, [[-5.8, -4.2, 'door'], [4, 6, 'window']]);
// west and east walls: a window each
buildWall('z', -HALF, [[-1.5, 0.5, 'window']]);
buildWall('z', HALF, [[1.5, 3.5, 'window']]);

// --- inside, on the walls the camera looks at: a pantry shelf, a trophy, a calendar, a coat ---
const IN_N = -HALF + LOG_D / 2, IN_W = -HALF + LOG_D / 2, IN_E = HALF - LOG_D / 2;
wallB.add([
    [1.9, 0.06, 0.3, -1.7, 1.6, IN_N + 0.15, 0x5e4730, 0, 0, 0, 0.015],          // shelf
    [0.05, 0.22, 0.26, -2.5, 1.48, IN_N + 0.13, POST], [0.05, 0.22, 0.26, -0.9, 1.48, IN_N + 0.13, POST],
    [0.14, 0.2, 0.14, -2.45, 1.73, IN_N + 0.15, 0x6e7f4a, 0, 0, 0, 0.03],         // jars and cans
    [0.14, 0.22, 0.14, -2.22, 1.74, IN_N + 0.15, 0xa05a2a, 0, 0, 0, 0.03],
    [0.12, 0.16, 0.12, -1.95, 1.71, IN_N + 0.15, 0x8a8f96, 0, 0, 0, 0.02],
    [0.12, 0.16, 0.12, -1.78, 1.71, IN_N + 0.13, 0x8a8f96, 0, 0, 0, 0.02],
    [0.32, 0.08, 0.22, -1.25, 1.67, IN_N + 0.14, 0x5a2a20, 0, 0.1, 0, 0.015],     // stacked books
    [0.3, 0.07, 0.2, -1.24, 1.745, IN_N + 0.14, 0x2a3a4a, 0, -0.15, 0, 0.015],
    [0.36, 0.44, 0.05, 1.4, 1.9, IN_N + 0.025, POST, 0, 0, 0, 0.02],             // trophy plaque
    [0.17, 0.2, 0.16, 1.4, 1.9, IN_N + 0.1, 0xcfc4a2, 0, 0, 0, 0.03],            // deer skull
    [0.04, 0.42, 0.04, 1.27, 2.13, IN_N + 0.1, 0xb8ab88, 0, 0, 0.55, 0.01],       // antlers
    [0.04, 0.42, 0.04, 1.53, 2.13, IN_N + 0.1, 0xb8ab88, 0, 0, -0.55, 0.01],
    [0.03, 0.18, 0.03, 1.15, 2.25, IN_N + 0.1, 0xb8ab88, 0, 0, -0.3, 0.008],
    [0.03, 0.18, 0.03, 1.65, 2.25, IN_N + 0.1, 0xb8ab88, 0, 0, 0.3, 0.008],
    [0.48, 0.62, 0.02, 2.75, 1.4, IN_N + 0.012, 0xb8a888, 0, 0, 0.04, 0.005],     // calendar
    [0.4, 0.2, 0.025, 2.75, 1.58, IN_N + 0.015, 0x7a2a22, 0, 0, 0.04, 0.005],
    [0.06, 0.06, 1.1, IN_W + 0.04, 1.75, 4.6, POST, 0, 0, 0, 0.015],             // coat hooks
    [0.16, 0.85, 0.5, IN_W + 0.1, 1.3, 4.3, 0x3e4a33, 0, 0, 0.04, 0.04],          // a coat
    [0.24, 0.12, 0.24, IN_W + 0.14, 1.76, 4.95, 0x6b5232, 0, 0, 0, 0.04],         // hat
    [0.03, 0.5, 0.42, IN_E - 0.015, 1.6, -5, POST, 0, 0, 0, 0.01],               // mirror
    [0.035, 0.42, 0.34, IN_E - 0.02, 1.6, -5, 0x55606a, 0, 0, 0, 0.005],
], wrng);
bakedMesh(floorB, false);
bakedMesh(wallB);

// --- the yard: woodpile, chopping block, a dead pickup, a porch lantern, a broken fence ---
const yard = new BlockBatch(), yrng = seeded(41);
const CLEARINGS = []; // props trees and brush keep out of: [x, z, radius]
for (let k = 0; k < 4; k++) for (let i = 0; i < 10; i++) {                     // split firewood
    const x = 3.75 + i * 0.37 + (k % 2) * 0.18, y = 0.17 + k * 0.3;
    if (x > 7.5) continue;
    yard.add([[0.33, 0.3, 0.62, x, y, 10.9, LOG_TONES[(yrng() * 4) | 0], 0, 0, (yrng() - 0.5) * 0.2, 0.1],
    [0.27, 0.24, 0.02, x, y, 11.22, END_GRAIN, 0, 0, 0, 0.06]], yrng);
}
yard.add([[0.12, 1.4, 0.12, 3.45, 0.7, 10.9, POST], [0.12, 1.4, 0.12, 7.75, 0.7, 10.9, POST]], yrng);
CLEARINGS.push([5.6, 11, 2.4]);
yard.add([
    [0.62, 0.5, 0.62, 0, 0.25, 0, LOG_TONES[2], 0, 0, 0, 0.18],                  // chopping block
    [0.5, 0.02, 0.5, 0, 0.505, 0, END_GRAIN, 0, 0, 0, 0.12],
    [0.06, 0.06, 0.78, 0.06, 0.82, -0.2, 0x6b4a2a, -0.75, 0, 0, 0.02],            // axe handle
    [0.06, 0.2, 0.28, 0.06, 0.56, 0.06, 0x5a5e66, -0.75, 0, 0, 0.02],             // axe head, bitten in
], yrng, at(-4.3, 12.5, 0.6));
CLEARINGS.push([-4.3, 12.5, 1.5]);
// rusted pickup, one tire flat, one headlight out
const RUST = 0x46524c, RUST2 = 0x6a4a2c, CHROME = 0x7a7a72, GLASS = 0x182027;
yard.add([
    [1.92, 0.62, 4.6, 0, 0.78, 0, RUST, 0, 0, 0, 0.12],                          // body
    [1.8, 0.74, 1.5, 0, 1.45, 0.45, RUST, 0, 0, 0, 0.1],                          // cab
    [1.6, 0.4, 0.05, 0, 1.52, 1.21, GLASS, -0.25, 0, 0, 0.01],                    // windshield
    [1.82, 0.36, 1.2, 0, 1.55, 0.4, GLASS, 0, 0, 0, 0.02],                        // side windows
    [1.86, 0.2, 1.4, 0, 1.18, 1.55, RUST, 0, 0, 0, 0.08],                         // hood
    [0.1, 0.42, 2.0, 0.92, 1.28, -1.2, RUST, 0, 0, 0, 0.03], [0.1, 0.42, 2.0, -0.92, 1.28, -1.2, RUST, 0, 0, 0, 0.03],
    [1.94, 0.42, 0.1, 0, 1.28, -2.25, RUST, 0, 0, 0.06, 0.03],                    // tailgate, sprung
    [1.7, 0.06, 1.9, 0, 1.1, -1.2, 0x2a2a28, 0, 0, 0, 0.01],                      // bed floor
    [2.02, 0.2, 0.16, 0, 0.6, 2.33, CHROME, 0, 0, 0, 0.05], [2.02, 0.2, 0.16, 0, 0.6, -2.33, CHROME, 0, 0, 0, 0.05],
    [0.32, 0.2, 0.05, 0.62, 0.95, 2.31, 0xe8e2b0, 0, 0, 0, 0.02], [0.32, 0.2, 0.05, -0.62, 0.95, 2.31, 0x1a1a18, 0, 0, 0, 0.02],
    [0.6, 0.34, 0.03, 0.97, 0.85, 0.9, RUST2, 0, 0, 0, 0.01], [0.5, 0.3, 0.03, -0.97, 0.75, -1.6, RUST2, 0, 0, 0, 0.01],
    [0.9, 0.04, 0.7, 0.2, 1.33, -1.5, 0x4a3a2a, 0, 0.3, 0, 0.01],                 // tarp in the bed
    [0.36, 0.7, 0.7, 0.98, 0.35, 1.45, 0x141414, 0, 0, 0, 0.2], [0.36, 0.7, 0.7, -0.98, 0.35, 1.45, 0x141414, 0, 0, 0, 0.2],
    [0.36, 0.7, 0.7, 0.98, 0.35, -1.45, 0x141414, 0, 0, 0, 0.2], [0.36, 0.56, 0.78, -0.98, 0.26, -1.45, 0x141414, 0, 0, 0, 0.16],
], yrng, at(-7.6, 15.2, 0.55));
CLEARINGS.push([-7.6, 15.2, 3.4]);
// props zombies have to walk around: oriented boxes, half extents in the prop's own frame
export const SOLIDS = [];
export function addSolid(x, z, ry, hx, hz) { SOLIDS.push({ x, z, hx, hz, c: Math.cos(ry), s: Math.sin(ry) }); }
addSolid(-7.6, 15.2, 0.55, 1.05, 2.45); // the pickup, bumper to bumper
CLEARINGS.push([2, 23.5, 4.5], [1, 17.5, 3.5], [7.5, 20, 3.5]); // the title screen's camera and its view of the door
// porch lantern on a post by the door
yard.add([[0.16, 2.3, 0.16, 2.7, 1.15, 11.3, POST], [0.56, 0.08, 0.08, 2.48, 2.22, 11.3, POST], [0.24, 0.06, 0.24, 2.26, 2.0, 11.3, 0x2a2a2a]], yrng);
// a fence that gave up
for (const [x0, z0, x1, z1, broken] of [[8.6, 12.6, 10.8, 12.0, 0], [10.8, 12.0, 12.6, 10.6, 1], [-12.5, -9.5, -12.2, -12, 0]]) {
    const len = Math.hypot(x1 - x0, z1 - z0), ry = Math.atan2(x1 - x0, z1 - z0);
    yard.add([[0.14, 1.2, 0.14, 0, 0.6, 0, POST]], yrng, at(x0, z0, ry));
    yard.add([[0.14, 1.2, 0.14, 0, 0.6, 0, POST]], yrng, at(x1, z1, ry));
    yard.add(broken
        ? [[0.08, 0.14, len, 0, 0.5, len / 2, WEATHERED, 0.35, 0, 0, 0.02]]          // rail down at one end
        : [[0.08, 0.14, len, 0, 0.95, len / 2, WEATHERED, 0, 0, 0, 0.02], [0.08, 0.14, len, 0, 0.5, len / 2, WEATHERED, 0, 0, 0, 0.02]], yrng, at(x0, z0, ry));
}
// stumps and a fallen trunk at the treeline
for (const [x, z, s] of [[11.6, -4, 1], [-11.4, 7.5, 0.8], [6, -12, 1.1], [-12.6, -2.5, 0.9], [12.8, 7.5, 0.85], [-2.5, -12.4, 1]]) {
    yard.add([[0.55 * s, 0.4 * s, 0.55 * s, 0, 0.2 * s, 0, 0x3a2b1d, 0, yrng(), 0, 0.15], [0.46 * s, 0.02, 0.46 * s, 0, 0.4 * s + 0.01, 0, END_GRAIN, 0, yrng(), 0, 0.12]], yrng, at(x, z));
}
yard.add([[0.6, 0.55, 5.5, 0, 0.27, 0, 0x3a2f24, 0, 0, 0, 0.18], [0.5, 0.45, 0.02, 0, 0.27, 2.76, END_GRAIN, 0, 0, 0, 0.12],
[0.14, 0.9, 0.14, 0.3, 0.6, -1.2, 0x3a2f24, 0, 0, -0.7, 0.03]], yrng, at(-13.5, 4, 0.3));
CLEARINGS.push([-13.5, 4, 3]);
bakedMesh(yard);

const lanternGlass = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.26, 0.2),
    new THREE.MeshStandardMaterial({ color: 0x2a1a08, emissive: 0xffb050, emissiveIntensity: 1.6 }));
lanternGlass.position.set(2.26, 1.84, 11.3);
world.add(lanternGlass);
const lanternLight = new THREE.PointLight(0xffa64a, 7, 9, 2);
lanternLight.position.set(2.26, 1.7, 11.3);
world.add(lanternLight);
// a guttering flame: two slow wobbles and the odd dip, worse in the wind
export function updateWorld(dt) {
    const t = performance.now() / 1000;
    const f = 0.85 + 0.08 * Math.sin(t * 7.3) + 0.06 * Math.sin(t * 13.1 + 1) - (Math.sin(t * 0.9) > 0.97 ? 0.35 : 0);
    - weather.level * 0.2 * (0.5 + 0.5 * Math.sin(t * 5.3) * Math.sin(t * 2.1)); // and gutters in the storm
    lanternLight.intensity = 7 * f;
    lanternGlass.material.emissiveIntensity = 1.6 * f;
}

// --- forest: instanced pines, spruces, oaks and dead snags, plus brush on the floor ---
// Filled from just outside the walls out to well beyond the fog far plane,
// so the tree line never visibly ends — it just fades into black.
const FOREST_COUNT = 900;
const R_MIN = 13, R_MAX = 70; // R_MAX is far past fog.far (62) so no visible edge
const SHADOW_R = 24;          // trees nearer than this cast shadows (the rest are lost in the dark)
const TRUNK = 0x2b2018, NEEDLES = 0x1a2b1a, NEEDLE_TIPS = 0x2a4229;
function pineTree(rng, tiers, w0, tierH, trunkH) {
    const b = [[0.32, trunkH, 0.32, 0, trunkH / 2, 0, TRUNK, 0, 0, 0, 0.06]];
    let y = trunkH * 0.6;
    for (let i = 0; i < tiers; i++) {
        const w = w0 * (1 - (i / tiers) * 0.75), ry = (i % 2) * Math.PI / 4; // each tier turned 45°: a star from above
        b.push([w, tierH * 0.62, w, 0, y, 0, NEEDLES, 0, ry, 0, 0.14],
            [w * 0.6, tierH * 0.42, w * 0.6, 0, y + tierH * 0.36, 0, NEEDLE_TIPS, 0, ry, 0, 0.09]); // moonlit top of the bough
        y += tierH * 0.78;
    }
    b.push([0.3, tierH * 0.7, 0.3, 0, y, 0, NEEDLE_TIPS, 0, 0, 0, 0.08]);
    return b;
}
function oakTree(rng) {
    const b = [[0.46, 2.4, 0.46, 0, 1.2, 0, TRUNK, 0, 0, 0, 0.08]];
    for (let i = 0; i < 6; i++) {
        const s = 1.3 + rng() * 0.9, a = i * 1.05;
        b.push([s, s * 0.85, s, Math.cos(a) * 0.75 * (i ? 1 : 0), 2.6 + rng() * 1.1 + (i ? 0 : 0.8), Math.sin(a) * 0.75 * (i ? 1 : 0), i % 2 ? 0x24311c : 0x2e3d22, 0, rng(), 0, 0.2]);
    }
    return b;
}
function deadTree(rng) {
    const b = [[0.34, 4.4, 0.34, 0, 2.2, 0, 0x3d362e, 0, 0, 0, 0.06]];
    for (let i = 0; i < 6; i++) {
        const len = 0.9 + rng() * 0.8, y0 = 1.8 + i * 0.42, phi = 0.7 + rng() * 0.4, side = i % 2 ? 1 : -1;
        b.push(i % 3 === 2
            ? [0.11, len, 0.11, 0, y0 + Math.cos(phi) * len / 2, side * Math.sin(phi) * len / 2, 0x3d362e, side * phi, 0, 0, 0.03]
            : [0.11, len, 0.11, -side * Math.sin(phi) * len / 2, y0 + Math.cos(phi) * len / 2, 0, 0x3d362e, 0, 0, side * phi, 0.03]);
    }
    return b;
}
const trng = seeded(77);
// near trees are bevelled and cast shadows; far ones (lost in the fog) are flat boxes
const treeKind = (blocks, weight) => ({ geo: bakeBlocks(blocks, seeded(1)), far: bakeBlocks(blocks, seeded(1), true), weight });
const TREE_KINDS = [
    treeKind(pineTree(trng, 4, 3.0, 1.05, 1.6), 38),  // pine
    treeKind(pineTree(trng, 3, 2.6, 0.95, 1.2), 18),  // young pine
    treeKind(pineTree(trng, 6, 1.8, 0.75, 1.3), 22),  // spruce
    treeKind(oakTree(trng), 13),
    treeKind(deadTree(trng), 9),
];
const inClearing = (x, z, pad = 0) => (Math.abs(x) < EDGE + 0.6 + pad && Math.abs(z) < EDGE + 0.6 + pad)
    || CLEARINGS.some(([cx, cz, r]) => (x - cx) ** 2 + (z - cz) ** 2 < (r + pad) ** 2);
// scatter instances of each kind across the forest; near ones (within SHADOW_R) cast shadows
function scatter(kinds, count, rMin, rMax, pad, scale, tint) {
    // near instances go in four quadrant meshes, so the camera and each face of the muzzle
    // light's shadow can cull the ones it can't see; everything far is one mesh
    const lists = kinds.map(() => [[], [], [], [], []]);
    const total = kinds.reduce((s, k) => s + k.weight, 0);
    const _o = new THREE.Object3D(), _col = new THREE.Color();
    for (let i = 0; i < count; i++) {
        // sqrt() keeps density roughly uniform across the annulus area
        const rad = Math.sqrt(rMin * rMin + Math.random() * (rMax * rMax - rMin * rMin));
        const ang = Math.random() * Math.PI * 2;
        const x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;
        if (inClearing(x, z, pad)) continue;
        let r = Math.random() * total, k = 0;
        while ((r -= kinds[k].weight) > 0) k++;
        const s = scale[0] + Math.random() * (scale[1] - scale[0]);
        _o.position.set(x, GROUND_Y, z);
        _o.rotation.set(0, Math.random() * Math.PI * 2, 0);
        _o.scale.set(s, s * (0.9 + Math.random() * 0.3), s);
        _o.updateMatrix();
        lists[k][rad < SHADOW_R ? (x > 0 ? 1 : 0) + (z > 0 ? 2 : 0) : 4].push([_o.matrix.clone(), _col.setScalar(tint[0] + Math.random() * (tint[1] - tint[0])).clone()]);
    }
    kinds.forEach((kind, k) => lists[k].forEach((items, slot) => {
        if (!items.length) return;
        const far = slot === 4;
        const m = new THREE.InstancedMesh(far && kind.far ? kind.far : kind.geo, worldMat, items.length);
        items.forEach(([mat, col], i) => { m.setMatrixAt(i, mat); m.setColorAt(i, col); });
        m.computeBoundingSphere();
        m.castShadow = kind.shadow !== false && !far;
        m.receiveShadow = true;
        world.add(m);
    }));
}
scatter(TREE_KINDS, FOREST_COUNT, R_MIN, R_MAX, 0.8, [0.85, 1.3], [0.8, 1.1]);

// brush: grass tufts, ferns and rocks between the walls and the trees
const brng = seeded(91);
const tuft = [];
for (let i = 0; i < 6; i++) {
    const a = i * 1.05 + brng(), h = 0.25 + brng() * 0.25;
    tuft.push([0.05, h, 0.05, Math.cos(a) * 0.07, h / 2, Math.sin(a) * 0.07, brng() < 0.5 ? 0x2d3b1e : 0x3a4826, Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35, 0]);
}
const fern = [];
for (let i = 0; i < 7; i++) {
    const a = i * 0.9;
    fern.push([0.11, 0.03, 0.6, Math.sin(a) * 0.28, 0.12, Math.cos(a) * 0.28, 0x2c4a22, -0.35, a, 0, 0]);
}
const rock = [[0.5, 0.32, 0.42, 0, 0.12, 0, 0x3a3834, 0, 0.3, 0.1, 0.1], [0.3, 0.22, 0.3, 0.24, 0.08, 0.14, 0x33312d, 0, 0.9, 0, 0.08]];
const BRUSH = [
    { geo: bakeBlocks(tuft, brng), weight: 60, shadow: false },
    { geo: bakeBlocks(fern, brng), weight: 25, shadow: false },
    { geo: bakeBlocks(rock, brng), weight: 15 },
];
scatter(BRUSH, 1000, 10.6, 28, 0, [0.7, 1.4], [0.75, 1.15]); // out to where the dark swallows it

// --- lights ---
export const ambient = new THREE.AmbientLight(0x4a5b80, 3.0);
scene.add(ambient);
export const moon = new THREE.DirectionalLight(0xc4d4f2, 2.8);
moon.position.set(-18, 34, -10);
moon.castShadow = true;
moon.shadow.mapSize.set(1024, 1024);
moon.shadow.camera.left = -28; moon.shadow.camera.right = 28;
moon.shadow.camera.top = 28; moon.shadow.camera.bottom = -28;
moon.shadow.camera.near = 1; moon.shadow.camera.far = 80;
scene.add(moon);

// --- night sky: only the low title shot ever sees it (the gameplay camera looks down
// too steeply). A faint glow at the horizon cuts the treeline out in silhouette ---
export const sky = new THREE.Mesh(new THREE.SphereGeometry(150, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vDir;
void main() {
  float h = clamp(vDir.y, 0.0, 1.0);
  vec3 c = mix(vec3(0.075, 0.095, 0.15), vec3(0.02, 0.024, 0.04), pow(h, 0.45));
  c = mix(c, vec3(0.02, 0.024, 0.04), smoothstep(0.0, -0.04, vDir.y)); // below the horizon: the fog's dark
  gl_FragColor = vec4(c, 1.0);
}`,
}));
sky.renderOrder = -1;
scene.add(sky);
function moonTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const halo = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    halo.addColorStop(0, 'rgba(200,214,240,.55)');
    halo.addColorStop(0.2, 'rgba(160,180,220,.16)');
    halo.addColorStop(1, 'rgba(160,180,220,0)');
    g.fillStyle = halo; g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#e4e9f2';
    g.beginPath(); g.arc(128, 128, 22, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(150,160,180,.35)'; // a few maria
    for (const [x, y, r] of [[121, 122, 7], [134, 131, 5], [126, 137, 4]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}
export const moonDisc = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTexture(), transparent: true, depthWrite: false, fog: false }));
moonDisc.position.set(-26, 27, -116); // rides on the sky dome, low over the trees behind the cabin
moonDisc.scale.setScalar(30);
sky.add(moonDisc);

// ===================================================================

// debris imported from state.js
export const casingGeo = bevelBox(0.05, 0.05, 0.12, 0.012);
const smokeMats = Array.from({ length: 24 }, () =>
    new THREE.MeshStandardMaterial({ color: 0x8d8f94, roughness: 1, transparent: true, opacity: 0, depthWrite: false }));
let smokeI = 0;
export function spawnDebris(mesh, vel, o) {
    mesh.userData = { vel, spin: o.spin || new THREE.Vector3(), life: o.life, max: o.life, bounce: o.bounce, smoke: o.smoke, size: mesh.scale.clone() };
    scene.add(mesh);
    debris.push(mesh);
}
export function updateDebris(dt) {
    for (let i = debris.length - 1; i >= 0; i--) {
        const d = debris[i], u = d.userData;
        u.life -= dt;
        if (u.smoke) {
            // puffs swell, rise and thin out
            const k = 1 - u.life / u.max;
            d.scale.setScalar(u.smoke * (1 + k * 2.5));
            d.material.opacity = 0.32 * (1 - k) * (1 - k);
            u.vel.multiplyScalar(Math.exp(-3 * dt));
            d.position.addScaledVector(u.vel, dt);
            d.position.y += 0.5 * dt;
        } else {
            u.vel.y -= 16 * dt;
            d.position.addScaledVector(u.vel, dt);
            d.rotation.x += u.spin.x * dt; d.rotation.y += u.spin.y * dt; d.rotation.z += u.spin.z * dt;
            if (d.position.y < u.bounce) {
                // clatter on the boards, then lie flat
                d.position.y = u.bounce;
                u.vel.set(u.vel.x * 0.45, Math.abs(u.vel.y) > 1.5 ? -u.vel.y * 0.35 : 0, u.vel.z * 0.45);
                u.spin.multiplyScalar(0.4);
                if (u.vel.y === 0) { u.spin.set(0, 0, 0); d.rotation.x = 0; d.rotation.z = Math.round(d.rotation.z / Math.PI) * Math.PI; }
            }
            if (u.life < 0.4) d.scale.copy(u.size).multiplyScalar(Math.max(0.01, u.life / 0.4)); // shrink away
        }
        if (u.life <= 0) { scene.remove(d); debris.splice(i, 1); }
    }
}


export function nearestOpening(pos, skip) {
    let best = null, bd = Infinity;
    for (const o of openings) {
        if (o === skip) continue;
        const d = (o.x - pos.x) ** 2 + (o.z - pos.z) ** 2;
        if (d < bd) { bd = d; best = o; }
    }
    return best;
}

export function inside(pos) {
    return Math.abs(pos.x) < HALF - 0.3 && Math.abs(pos.z) < HALF - 0.3;
}


// --- doors and windows: shut at the start of a run, and stay broken once broken ---
export const CLIMB_TIME = 1.1; // seconds to clamber in over a sill
export const woodChip = new THREE.MeshStandardMaterial({ color: 0x6d6352, roughness: 0.9 });
export function resetOpenings() {
    for (const o of openings) {
        Object.assign(o, { hp: o.maxHp, climber: null, jolt: 0, fallT: -1 });
        if (o.kind === 'door') {
            o.leaf.rotation.y = 0;
            o.fall.rotation.x = 0; o.fall.position.set(0, 0, -0.02);
        } else {
            o.glass.visible = true; o.glass.material = glassMat;
            o.bars.visible = true;
            o.shards.visible = false;
        }
    }
}
// bits flying off a door or window, into the cabin
export function burst(o, n, mat, size, speed) {
    const sx = o.ix - o.x, sz = o.iz - o.z, l = Math.hypot(sx, sz);
    for (let i = 0; i < n; i++) {
        const m = new THREE.Mesh(BOX, mat);
        m.scale.set(size * rnd(0.4, 1), size * rnd(0.2, 0.6), size * rnd(1, 2.5));
        const along = rnd(-0.5, 0.5) * (o.w - 0.3);
        m.position.set(o.x + (o.axis === 'x' ? along : 0), o.kind === 'door' ? rnd(0.3, 1.8) : rnd(o.sill + 0.05, o.head - 0.05), o.z + (o.axis === 'z' ? along : 0));
        m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
        const v = speed * rnd(0.5, 1.2);
        spawnDebris(m, new THREE.Vector3(sx / l * v + rnd(-1, 1), rnd(0.5, 2.5), sz / l * v + rnd(-1, 1)),
            { life: rnd(2, 3.5), bounce: 0.02, spin: new THREE.Vector3(rnd(-12, 12), rnd(-12, 12), rnd(-12, 12)) });
    }
}
// a zombie's blow (or the survivor's bullet, for glass) lands on a door or window
export function hitOpening(o) {
    if (o.hp <= 0) return;
    o.hp--;
    o.jolt = 1;
    if (o.kind === 'door') {
        audio.bash(o);
        burst(o, 2, woodChip, 0.12, 2);
    } else if (o.hp > 0) {
        audio.crack(o);
        o.glass.material = glassCracked;
    }
    if (o.hp <= 0) breakOpening(o);
}
export function breakOpening(o) {
    o.hp = 0;
    if (o.kind === 'door') {
        // off its hinges and down onto the floor
        o.fallT = 0;
        o.leaf.rotation.y = 0;
        audio.doorBreak(o);
        burst(o, 9, woodChip, 0.16, 3.5);
    } else {
        o.glass.visible = false;
        o.bars.visible = false;
        o.shards.visible = true;
        audio.shatter(o);
        burst(o, 16, glassMat, 0.09, 4);
    }
}
// does an unbroken door or window stand at (x, z)? (they stop bullets and blows)
export function shutAt(x, z) {
    for (const o of openings) {
        if (o.hp > 0 && x >= o.box.minX && x <= o.box.maxX && z >= o.box.minZ && z <= o.box.maxZ) return o;
    }
    return null;
}
export function updateOpenings(dt) {
    for (const o of openings) {
        o.jolt *= Math.exp(-9 * dt);
        if (o.kind === 'window') { o.pane.position.z = -0.03 * o.jolt; continue; }
        if (o.fallT >= 0) {
            // topples in like a slab: speeds up, slaps flat with a little bounce
            o.fallT += dt;
            const k = Math.min(1, o.fallT / 0.5), slap = k >= 1 ? 0.05 * Math.exp(-(o.fallT - 0.5) * 10) * Math.sin((o.fallT - 0.5) * 30) : 0;
            o.fall.rotation.x = -(Math.PI / 2 - 0.02) * k * k + slap;
            o.fall.position.set(0, 0.08 * k, -0.02 - 0.35 * k);
            continue;
        }
        if (o.hp <= 0) continue;
        // kicked inward on each blow
        o.leaf.rotation.y = o.jolt * 0.07;
    }
}

// --- solid props (see SOLIDS): zombies are shoved out of them and plan a way round them ---
export const Z_RADIUS = 0.4;   // a zombie's footprint
export const ROUND_PAD = 0.35; // how wide of a corner they swing
const _local = { x: 0, z: 0 };
function toLocal(b, x, z) {
    const dx = x - b.x, dz = z - b.z;
    _local.x = dx * b.c - dz * b.s; _local.z = dx * b.s + dz * b.c;
    return _local;
}
export function pushOutOfSolids(pos) {
    for (const b of SOLIDS) {
        const { x: lx, z: lz } = toLocal(b, pos.x, pos.z);
        const ex = b.hx + Z_RADIUS, ez = b.hz + Z_RADIUS;
        const px = ex - Math.abs(lx), pz = ez - Math.abs(lz);
        if (px <= 0 || pz <= 0) continue;
        // out through the nearest face, a hair clear of it so it doesn't read as still touching
        const nx = px < pz ? Math.sign(lx) * (ex + 0.01) : lx, nz = px < pz ? lz : Math.sign(lz) * (ez + 0.01);
        pos.x = b.x + nx * b.c + nz * b.s;
        pos.z = b.z - nx * b.s + nz * b.c;
    }
}
// does the segment a→b (prop-local) cross the box ±hx, ±hz? (slab test)
export function segHitsBox(ax, az, bx, bz, hx, hz) {
    let t0 = 0, t1 = 1;
    const dx = bx - ax, dz = bz - az;
    if (Math.abs(dx) < 1e-9) { if (Math.abs(ax) >= hx) return false; }
    else {
        const ta = (-hx - ax) / dx, tb = (hx - ax) / dx;
        t0 = Math.max(t0, Math.min(ta, tb)); t1 = Math.min(t1, Math.max(ta, tb));
    }
    if (Math.abs(dz) < 1e-9) { if (Math.abs(az) >= hz) return false; }
    else {
        const ta = (-hz - az) / dz, tb = (hz - az) / dz;
        t0 = Math.max(t0, Math.min(ta, tb)); t1 = Math.min(t1, Math.max(ta, tb));
    }
    return t0 < t1;
}
// --- finding a way round the props: a shortest path over their corners (padded out so a
// zombie clears them), searched whenever a prop blocks the straight line to the target ---
const SEE_SLOP = 0.05; // a zombie pressed against a prop can still see along its side
export const ROUND_NODES = SOLIDS.flatMap(b => [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([sx, sz]) => {
    const kx = sx * (b.hx + Z_RADIUS + ROUND_PAD), kz = sz * (b.hz + Z_RADIUS + ROUND_PAD);
    return { x: b.x + kx * b.c + kz * b.s, z: b.z - kx * b.s + kz * b.c };
}));
// can a zombie walk straight from a to b without going through a prop?
export function clearPath(ax, az, bx, bz) {
    for (const b of SOLIDS) {
        const p = toLocal(b, ax, az), px = p.x, pz = p.z, q = toLocal(b, bx, bz);
        if (segHitsBox(px, pz, q.x, q.z, b.hx + Z_RADIUS - SEE_SLOP, b.hz + Z_RADIUS - SEE_SLOP)) return false;
    }
    return true;
}
// which corners can see each other, and how far apart they are (props don't move)
const NODE_LINKS = ROUND_NODES.map(a => ROUND_NODES.map(b =>
    a !== b && clearPath(a.x, a.z, b.x, b.z) ? Math.hypot(a.x - b.x, a.z - b.z) : Infinity));
const _goal = { x: 0, z: 0 }, _from = { x: 0, z: 0 }, _toGoal = [], _done = [];
// Where a zombie should head to get to (tx, tz): straight there if nothing's in the way,
// otherwise the corner in sight that starts the shortest way round. It doesn't count a
// corner it's already standing at, and stays loyal to its last pick (ud.via) unless another
// way is clearly shorter, so it doesn't dither between two even routes.
export function routeAround(z, tx, tz) {
    const ud = z.userData;
    _goal.x = tx; _goal.z = tz;
    _from.x = z.position.x; _from.z = z.position.z;
    pushOutOfSolids(_from); // plan from where it'll be once it's been shoved clear
    const { x, z: fz } = _from;
    if (clearPath(x, fz, tx, tz)) { ud.via = -1; return _goal; }
    // how far each corner is from the goal, going round (Dijkstra out from the goal)
    const n = ROUND_NODES.length, dist = _toGoal;
    for (let i = 0; i < n; i++) {
        const k = ROUND_NODES[i];
        dist[i] = clearPath(k.x, k.z, tx, tz) ? Math.hypot(tx - k.x, tz - k.z) : Infinity;
        _done[i] = false;
    }
    for (let r = 0; r < n; r++) {
        let u = -1;
        for (let i = 0; i < n; i++) if (!_done[i] && (u < 0 || dist[i] < dist[u])) u = i;
        if (dist[u] === Infinity) break;
        _done[u] = true;
        for (let i = 0; i < n; i++) dist[i] = Math.min(dist[i], dist[u] + NODE_LINKS[u][i]);
    }
    let best = -1, bestCost = Infinity, near = -1, nearD = Infinity;
    for (let i = 0; i < n; i++) {
        const k = ROUND_NODES[i], d = Math.hypot(k.x - x, k.z - fz);
        if (d < 0.45 || !clearPath(x, fz, k.x, k.z)) continue;
        if (d < nearD) { nearD = d; near = i; }
        const cost = d + dist[i] - (ud.via === i ? 1 : 0);
        if (cost < bestCost) { bestCost = cost; best = i; }
    }
    if (best < 0) best = near; // no way through from here: at least get round the nearest corner
    if (best < 0) return _goal;
    ud.via = best;
    _goal.x = ROUND_NODES[best].x; _goal.z = ROUND_NODES[best].z;
    return _goal;
}

