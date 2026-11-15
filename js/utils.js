// Utility and math helpers

export const rnd = (a, b) => a + Math.random() * (b - a);

export function seeded(n) {
    return () => ((n = (n * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export const wrapA = a => a - Math.round(a / (Math.PI * 2)) * Math.PI * 2;

export const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

export const ease = t => t * t * (3 - 2 * t);

export const midiHz = m => 440 * Math.pow(2, (m - 69) / 12);

// Saved settings and best run (localStorage can throw in a sandboxed frame, so guard it)
export const store = {
    get(k, fallback) {
        try { return JSON.parse(localStorage.getItem('aah-' + k)) ?? fallback; } catch { return fallback; }
    },
    set(k, v) {
        try { localStorage.setItem('aah-' + k, JSON.stringify(v)); } catch { /* not persisted */ }
    },
};
