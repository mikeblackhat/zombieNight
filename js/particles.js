import * as THREE from 'three';
import { scene, BOX } from './engine.js';
import { particles, bloodMat } from './state.js';

export function spawnBlood(pos) {
    for (let i = 0; i < 12; i++) {
        const p = new THREE.Mesh(BOX, bloodMat);
        const s = 0.12 + Math.random() * 0.18;
        p.scale.set(s, s, s);
        p.position.set(pos.x, 0.8, pos.z);
        p.userData = {
            v: new THREE.Vector3((Math.random() - 0.5) * 5, 3 + Math.random() * 4, (Math.random() - 0.5) * 5),
            life: 0.6 + Math.random() * 0.4,
        };
        scene.add(p);
        particles.push(p);
    }
}

