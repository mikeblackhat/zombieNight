import { midiHz, rnd, store } from './utils.js';
import { player } from './player.js';

export const settings = Object.assign({ master: 8, music: 8, shake: true }, store.get('settings', {})); // volumes are 0..10

export const audio = {
    ctx: null, muted: false, waves: {}, bufs: {}, lastHit: 0, lastHover: 0, stepAlt: false,
    ensure() {
        if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.buildVoices();
        this.buildMix();
        this.applyVolume();
        this.startWind();
        music.start();
    },
    ok() { return this.ctx && !this.muted; },
    t() { return this.ctx.currentTime; },

    // --- chip voices: band-limited pulse/triangle tables + LFSR noise buffers ---
    buildVoices() {
        const c = this.ctx;
        // DFT one cycle of samples into a PeriodicWave (band-limited, so no aliasing fizz)
        const table = s => {
            const N = s.length, H = 64, re = new Float32Array(H), im = new Float32Array(H);
            for (let n = 1; n < H; n++) for (let k = 0; k < N; k++) {
                const ph = 2 * Math.PI * n * k / N;
                re[n] += s[k] * Math.cos(ph); im[n] += s[k] * Math.sin(ph);
            }
            return c.createPeriodicWave(re, im);
        };
        const cycle = fn => Array.from({ length: 256 }, (_, k) => fn(k / 256));
        this.waves.pulse12 = table(cycle(p => p < 0.125 ? 1 : -1));
        this.waves.pulse25 = table(cycle(p => p < 0.25 ? 1 : -1));
        this.waves.pulse50 = table(cycle(p => p < 0.5 ? 1 : -1));
        // the NES triangle is a 32-step, 4-bit staircase — that grit is the "classic" bass
        this.waves.tri = table(cycle(p => { const s = Math.floor(p * 32); return (s < 16 ? 15 - s : s - 16) / 7.5 - 1; }));

        // 15-bit LFSR noise: long mode = hiss, short mode (93-step loop) = metallic buzz
        const lfsr = (short, len) => {
            const b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
            let r = 1;
            for (let i = 0; i < len; i++) {
                const fb = (r & 1) ^ ((r >> (short ? 6 : 1)) & 1);
                r = (r >> 1) | (fb << 14);
                d[i] = r & 1 ? 0.8 : -0.8;
            }
            return b;
        };
        this.bufs.noise = lfsr(false, c.sampleRate * 2);
        this.bufs.metal = lfsr(true, 93 * 64);
        const w = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), wd = w.getChannelData(0);
        for (let i = 0; i < wd.length; i++) wd[i] = Math.random() * 2 - 1;
        this.bufs.white = w;
    },

    // --- mix: sfx/music/reverb buses → master → muffle → post → mute → compressor ---
    buildMix() {
        const c = this.ctx;
        const gain = (v, to) => { const g = c.createGain(); g.gain.value = v; if (to) g.connect(to); return g; };
        const filt = (type, f, to) => { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; if (to) b.connect(to); return b; };
        this.comp = c.createDynamicsCompressor();
        this.comp.threshold.value = -12; this.comp.knee.value = 8; this.comp.ratio.value = 5;
        this.comp.attack.value = 0.002; this.comp.release.value = 0.2;
        // brickwall limiter after the glue compressor so stacked impacts never clip
        this.limiter = c.createDynamicsCompressor();
        this.limiter.threshold.value = -2; this.limiter.knee.value = 0; this.limiter.ratio.value = 20;
        this.limiter.attack.value = 0.001; this.limiter.release.value = 0.08;
        this.comp.connect(this.limiter); this.limiter.connect(c.destination);
        this.mute = gain(this.level(), this.comp);
        this.post = gain(1, this.mute);                 // after the muffle: impacts that should stay crisp
        this.muffle = filt('lowpass', 20000, this.post); // swept down when you get hit
        this.master = gain(0.8, this.muffle);
        this.sfx = gain(1, this.master);
        this.verb = c.createConvolver(); this.verb.buffer = this.impulse(2.8);
        this.verb.connect(gain(0.45, this.master));
        // music: in → [echo] → lowpass → duck → volume → master, with a reverb send
        this.musicVol = gain(1, this.master);
        this.duck = gain(1, this.musicVol);
        this.musicLP = filt('lowpass', 18000, this.duck);
        this.musicIn = gain(0.5, this.musicLP);
        this.musicVerb = gain(1, this.verb);
        this.musicIn.connect(gain(0.22, this.musicVerb));
        this.echo = c.createDelay(1); this.echo.delayTime.value = 0.34;
        const fb = gain(0.36), damp = filt('lowpass', 2600);
        this.echo.connect(damp); damp.connect(fb); fb.connect(this.echo); damp.connect(this.musicLP);
        this.echoIn = gain(0.5, this.echo);
        this.musicWet = gain(1, this.musicIn); // dry + echo send in one
        this.musicWet.connect(this.echoIn);
    },
    // stereo noise tail with a darkening exponential decay — a big, dark room
    impulse(dur) {
        const c = this.ctx, n = Math.floor(c.sampleRate * dur), b = c.createBuffer(2, n, c.sampleRate);
        for (let ch = 0; ch < 2; ch++) {
            const d = b.getChannelData(ch); let lp = 0;
            for (let i = 0; i < n; i++) {
                const t = i / n, k = 0.6 - t * 0.5; // smoothing grows with time: highs die first
                lp += (Math.random() * 2 - 1 - lp) * k;
                d[i] = i < c.sampleRate * 0.012 ? 0 : lp * Math.pow(1 - t, 3.2);
            }
        }
        return b;
    },
    // ambient night wind: filtered noise with slowly wandering pitch and level
    startWind() {
        const c = this.ctx, src = c.createBufferSource(); src.buffer = this.bufs.white; src.loop = true;
        const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 1.1;
        const g = c.createGain(); g.gain.value = 0;
        g.gain.linearRampToValueAtTime(0.06, c.currentTime + 5);
        const lfo = (f, depth, param) => {
            const o = c.createOscillator(); o.frequency.value = f;
            const d = c.createGain(); d.gain.value = depth; o.connect(d); d.connect(param); o.start();
        };
        lfo(0.07, 220, bp.frequency);
        lfo(0.13, 0.025, g.gain);
        src.connect(bp); bp.connect(g); g.connect(this.master); src.start();
        this.windGain = g;
    },
    // storm level 0..1 and the current gust (around 1)
    weather(level, gust) {
        if (!this.ctx) return;
        this.windGain.gain.setTargetAtTime(0.06 + 0.2 * level * level * gust, this.t(), 0.4);
    },
    // thunder: a long roll, louder the closer the strike (near: 0 far .. 1 overhead)
    thunder(near) {
        if (!this.ok()) return;
        const t = this.t(), o = this.out(0.45 + 0.45 * near, rnd(-0.4, 0.4), 0.5);
        for (let i = 0; i < 4; i++) // overlapping rumbles, so it rolls rather than booms
            this.nz(o, t + i * rnd(0.2, 0.6), { rate: 0.08, f: rnd(140, 320), dur: rnd(1.8, 4.2), v: rnd(0.5, 0.9), a: rnd(0.05, 0.3) });
        this.duckMusic(0.55, 1.8);
    },

    // --- building blocks ---
    // a per-sound output: gain → stereo pan → bus, plus a reverb send
    out(v, pan = 0, wet = 0.15, bus = this.sfx) {
        const c = this.ctx, g = c.createGain(); g.gain.value = v;
        let n = g;
        if (pan && c.createStereoPanner) {
            const p = c.createStereoPanner(); p.pan.value = Math.max(-0.9, Math.min(0.9, pan));
            g.connect(p); n = p;
        }
        n.connect(bus);
        if (wet) { const s = c.createGain(); s.gain.value = wet; n.connect(s); s.connect(this.verb); }
        return g;
    },
    // oscillator note. w: chip table name or native type. Percussive decay by default;
    // pass `hold` (s) for a gated, sustained note. `vib` = vibrato depth in semitones.
    osc(dest, at, { w = 'pulse50', f, f2, dur = 0.2, v = 1, a = 0.002, hold, vib = 0 }) {
        const c = this.ctx, o = c.createOscillator(), g = c.createGain();
        if (this.waves[w]) o.setPeriodicWave(this.waves[w]); else o.type = w;
        o.frequency.setValueAtTime(f, at);
        if (f2) o.frequency.exponentialRampToValueAtTime(f2, at + (hold || dur));
        if (vib) {
            const l = c.createOscillator(), d = c.createGain();
            l.frequency.value = 5.5; d.gain.setValueAtTime(0, at);
            d.gain.linearRampToValueAtTime(f * (Math.pow(2, vib / 12) - 1), at + Math.min(0.25, (hold || dur) * 0.6));
            l.connect(d); d.connect(o.frequency); l.start(at); l.stop(at + (hold || dur) + 0.1);
        }
        g.gain.setValueAtTime(0, at);
        g.gain.linearRampToValueAtTime(v, at + a);
        let end;
        if (hold) {
            g.gain.setTargetAtTime(v * 0.6, at + a, hold * 0.4);
            g.gain.setValueAtTime(v * 0.6, at + hold);   // anchor the release
            g.gain.linearRampToValueAtTime(0, at + hold + 0.05);
            end = at + hold + 0.06;
        } else {
            g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
            end = at + dur + 0.02;
        }
        o.connect(g); g.connect(dest); o.start(at); o.stop(end);
    },
    // filtered noise burst. buf: noise | metal | white; rate < 1 pitches the LFSR down (crunchier)
    nz(dest, at, { buf = 'noise', rate = 1, type = 'lowpass', f = 2000, f2, q = 0.7, dur = 0.2, v = 1, a = 0.001 }) {
        const c = this.ctx, s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
        s.buffer = this.bufs[buf]; s.loop = true; s.playbackRate.value = rate;
        fl.type = type; fl.Q.value = q;
        fl.frequency.setValueAtTime(f, at);
        if (f2) fl.frequency.exponentialRampToValueAtTime(f2, at + dur);
        g.gain.setValueAtTime(0, at);
        g.gain.linearRampToValueAtTime(v, at + a);
        g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
        s.connect(fl); fl.connect(g); g.connect(dest);
        s.start(at, Math.random() * s.buffer.duration * 0.9); s.stop(at + dur + 0.02);
    },
    // throaty zombie voice: two detuned saws through vowel formants, wobbling and sagging
    growl(dest, at, { f, f2, dur, v, formant = 600, a = 0.08 }) {
        const c = this.ctx, g = c.createGain(), f1 = c.createBiquadFilter(), fm = c.createBiquadFilter();
        f1.type = 'bandpass'; f1.frequency.value = formant; f1.Q.value = 2.5;
        fm.type = 'bandpass'; fm.frequency.value = formant * 1.8; fm.Q.value = 4;
        const lfo = c.createOscillator(), ld = c.createGain();
        lfo.frequency.value = rnd(5, 9); ld.gain.value = f * 0.06; lfo.connect(ld);
        for (const det of [0, 9]) {
            const o = c.createOscillator(); o.type = 'sawtooth'; o.detune.value = det;
            o.frequency.setValueAtTime(f, at); o.frequency.exponentialRampToValueAtTime(f2, at + dur);
            ld.connect(o.frequency); o.connect(f1); o.connect(fm);
            o.start(at); o.stop(at + dur + 0.05);
        }
        lfo.start(at); lfo.stop(at + dur + 0.05);
        g.gain.setValueAtTime(0, at);
        g.gain.linearRampToValueAtTime(v, at + a);
        g.gain.setTargetAtTime(v * 0.7, at + a, dur * 0.3);
        g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
        f1.connect(g); fm.connect(g); g.connect(dest);
    },
    // stereo position + distance falloff for something at world (x, z), relative to the player
    place(pos) {
        const dx = pos.x - player.position.x, dz = pos.z - player.position.z;
        return { pan: dx / 12, near: 1 / (1 + Math.hypot(dx, dz) / 7) };
    },
    // pull the music down for a moment (impacts, stingers)
    duckMusic(depth, dur) {
        const g = this.duck.gain, t = this.t();
        g.cancelScheduledValues(t); g.setValueAtTime(g.value, t);
        g.linearRampToValueAtTime(depth, t + 0.03);
        g.setTargetAtTime(1, t + dur, dur * 0.4);
    },
    // muffle the whole mix (concussion) — sounds on the `post` bus cut through
    muffleFor(dur, freq) {
        const f = this.muffle.frequency, t = this.t();
        f.cancelScheduledValues(t); f.setValueAtTime(freq, t);
        f.setTargetAtTime(20000, t + dur * 0.4, dur * 0.35);
    },

    // pause: sink the whole mix under a low muffle so the score keeps breathing quietly
    pause(on) {
        if (!this.ctx) return;
        const t = this.t();
        this.muffle.frequency.cancelScheduledValues(t);
        this.muffle.frequency.setTargetAtTime(on ? 500 : 20000, t, on ? 0.08 : 0.15);
        this.master.gain.setTargetAtTime(on ? 0.45 : 0.8, t, 0.1);
    },

    // --- SFX ---
    shot(hot, spread) {
        if (!this.ok()) return;
        const t = this.t(), p = rnd(0.94, 1.06), o = this.out(0.8, 0, 0.12);
        this.nz(o, t, { buf: 'white', type: 'highpass', f: 3500, dur: 0.025, v: 0.45 });            // crack
        this.osc(o, t, { w: 'pulse25', f: 270 * p, f2: 55 * p, dur: 0.09, v: 0.3 });                  // chip body
        this.osc(o, t, { w: 'sine', f: 140 * p, f2: 45, dur: 0.1, v: 0.55 });                          // punch
        this.nz(o, t, { rate: 0.32 * p, f: 3400, f2: 260, dur: spread ? 0.3 : 0.2, v: 0.5 + spread * 0.06 }); // crunchy tail
        if (hot) this.osc(o, t, { w: 'pulse12', f: 1100 * p, f2: 240, dur: 0.08, v: 0.13 });         // DOUBLE DAMAGE sizzle
    },
    hit(pos) {
        if (!this.ok() || this.t() - this.lastHit < 0.03) return; // pierce/buckshot can hit many in one frame
        const t = this.lastHit = this.t(), { pan, near } = this.place(pos), o = this.out(0.55 + near * 0.4, pan, 0.08);
        this.nz(o, t, { rate: rnd(0.18, 0.28), type: 'bandpass', f: 1300, q: 1.3, dur: 0.07, v: 0.9 }); // wet slap
        this.osc(o, t, { w: 'tri', f: rnd(190, 230), f2: 70, dur: 0.08, v: 0.6 });
    },
    zdeath(pos) {
        if (!this.ok()) return;
        const t = this.t(), p = rnd(0.85, 1.15), { pan, near } = this.place(pos), o = this.out(0.6 + near * 0.4, pan, 0.2);
        this.growl(o, t, { f: 160 * p, f2: 48 * p, dur: 0.55, v: 0.5, formant: rnd(550, 800), a: 0.01 });
        this.nz(o, t, { rate: 0.14, f: 1400, f2: 140, dur: 0.38, v: 0.7 });                            // splat
        this.osc(o, t, { w: 'pulse12', f: 340 * p, f2: 85, dur: 0.12, v: 0.16 });                      // retro blip
    },
    groan(pos) {
        if (!this.ok()) return;
        const t = this.t(), { pan, near } = this.place(pos), f = rnd(70, 125), o = this.out(0.25 + near * 0.6, pan, 0.35);
        this.growl(o, t, { f, f2: f * rnd(0.6, 0.85), dur: rnd(0.7, 1.4), v: 0.35, formant: 300 + near * 500, a: 0.15 });
    },
    swipe(pos) { // a zombie's blow catching only air
        if (!this.ok()) return;
        const t = this.t(), { pan, near } = this.place(pos), o = this.out(0.3 + near * 0.4, pan, 0.05);
        this.nz(o, t, { buf: 'white', type: 'bandpass', f: 700, f2: 2400, q: 1.2, dur: 0.16, v: 0.5, a: 0.04 });
    },
    // doors and windows (pos = the opening)
    bash(pos, v = 1) { // a blow on a plank door
        if (!this.ok()) return;
        const t = this.t(), { pan, near } = this.place(pos), o = this.out((0.4 + near * 0.5) * v, pan, 0.25);
        this.osc(o, t, { w: 'sine', f: rnd(85, 100), f2: 45, dur: 0.2, v: 0.9 });
        this.nz(o, t, { rate: 0.3, f: 900, f2: 250, dur: 0.14, v: 0.8 });
        this.nz(o, t + 0.01, { buf: 'white', type: 'bandpass', f: rnd(1600, 2200), q: 3, dur: 0.05, v: 0.3 }); // split wood
    },
    crack(pos) { // the glass gives a little
        if (!this.ok()) return;
        const t = this.t(), { pan, near } = this.place(pos), o = this.out(0.3 + near * 0.4, pan, 0.2);
        this.osc(o, t, { w: 'sine', f: 90, f2: 50, dur: 0.1, v: 0.5 });
        this.nz(o, t, { buf: 'metal', type: 'highpass', f: 3500, dur: 0.07, v: 0.5 });
        this.osc(o, t, { w: 'tri', f: 2400, f2: 1700, dur: 0.05, v: 0.15 });
    },
    shatter(pos) {
        if (!this.ok()) return;
        const t = this.t(), { pan, near } = this.place(pos), o = this.out(0.4 + near * 0.5, pan, 0.3);
        this.nz(o, t, { buf: 'white', type: 'highpass', f: 2500, dur: 0.45, v: 0.6 });
        this.nz(o, t, { buf: 'metal', type: 'bandpass', f: 6000, q: 1, dur: 0.3, v: 0.4 });
        for (let i = 0; i < 9; i++) // shards tinkling down
            this.osc(o, t + 0.05 + Math.random() * 0.5, { w: 'pulse12', f: rnd(2500, 5000), dur: 0.04, v: rnd(0.04, 0.09) });
    },
    doorBreak(pos) {
        if (!this.ok()) return;
        const t = this.t(), { pan, near } = this.place(pos), o = this.out(0.5 + near * 0.5, pan, 0.35);
        this.nz(o, t, { buf: 'white', type: 'highpass', f: 1800, dur: 0.08, v: 0.5 });   // the crack
        this.osc(o, t, { w: 'sine', f: 75, f2: 35, dur: 0.35, v: 0.9 });
        this.nz(o, t, { rate: 0.25, f: 1500, f2: 180, dur: 0.45, v: 0.8 });
        this.osc(o, t + 0.5, { w: 'sine', f: 62, f2: 30, dur: 0.28, v: 0.8 });           // ...and it slaps the floor
        this.nz(o, t + 0.5, { rate: 0.2, f: 600, f2: 150, dur: 0.25, v: 0.7 });
    },
    hurt() {
        if (!this.ok()) return;
        const t = this.t(), o = this.out(1, 0, 0.1, this.post);
        this.osc(o, t, { w: 'sine', f: 95, f2: 28, dur: 0.45, v: 1 });                               // body blow
        this.osc(o, t, { w: 'pulse50', f: 150, f2: 40, dur: 0.25, v: 0.3 });
        this.nz(o, t, { rate: 0.1, f: 2600, f2: 180, dur: 0.35, v: 0.8 });
        this.duckMusic(0.3, 0.6);
        this.muffleFor(0.8, 650);
    },
    step() {
        if (!this.ok()) return;
        const t = this.t(), o = this.out(0.22, 0, 0.05);
        this.stepAlt = !this.stepAlt;
        this.nz(o, t, { rate: 0.22, f: 520, dur: 0.05, v: 0.9 });                                       // boot on boards
        this.osc(o, t, { w: 'tri', f: this.stepAlt ? 105 : 92, f2: 58, dur: 0.06, v: 0.7 });
    },
    reloadOut() {
        if (!this.ok()) return;
        const t = this.t(), o = this.out(0.6, 0.15, 0.08);
        this.nz(o, t, { buf: 'metal', rate: 0.6, type: 'highpass', f: 2200, dur: 0.035, v: 0.7 });   // release click
        this.osc(o, t, { w: 'pulse12', f: 1300, f2: 820, dur: 0.025, v: 0.15 });
        this.nz(o, t + 0.05, { type: 'bandpass', f: 900, f2: 600, q: 2, dur: 0.1, v: 0.4 });          // mag slides out
    },
    reloadIn() {
        if (!this.ok()) return;
        const t = this.t(), o = this.out(0.65, 0.15, 0.1);
        this.nz(o, t, { buf: 'metal', rate: 0.4, type: 'bandpass', f: 1500, q: 1.5, dur: 0.045, v: 0.9 }); // seat
        this.osc(o, t, { w: 'tri', f: 320, f2: 150, dur: 0.05, v: 0.5 });
        this.nz(o, t + 0.1, { buf: 'metal', rate: 0.8, type: 'highpass', f: 2800, dur: 0.03, v: 0.6 });   // rack
        this.nz(o, t + 0.15, { buf: 'metal', rate: 0.55, type: 'highpass', f: 1800, dur: 0.04, v: 0.7 });
        this.osc(o, t + 0.16, { w: 'pulse25', f: midiHz(86), dur: 0.06, v: 0.12 });                    // "ready" ping
    },
    pickup(id) {
        if (!this.ok()) return;
        const t = this.t(), o = this.out(0.6, 0, 0.3);
        const arps = { med: [62, 66, 69, 74, 78], dmg: [50, 57, 62, 69, 74], ammo: [69, 74, 78, 81, 86] };
        (arps[id] || arps.med).forEach((m, i) => {
            this.osc(o, t + i * 0.055, { w: id === 'dmg' ? 'pulse12' : 'pulse25', f: midiHz(m), dur: 0.18, v: 0.3 });
            this.osc(o, t + i * 0.055, { w: 'tri', f: midiHz(m - 12), dur: 0.12, v: 0.25 });
        });
        this.nz(o, t, { buf: 'metal', rate: 1, type: 'highpass', f: 6000, dur: 0.4, v: 0.08 });       // shimmer
    },

    waveStart(n) {
        music.setMode('combat');
        if (!this.ok()) return;
        const t = this.t(), o = this.out(0.6, 0, 0.6);
        // tolling bell: inharmonic partials with slow beating
        [[1, 1], [2.01, 0.5], [2.76, 0.4], [5.4, 0.2], [8.93, 0.1]].forEach(([r, v]) =>
            this.osc(o, t, { w: 'sine', f: midiHz(50) * r, dur: 3.2 / Math.sqrt(r), v: v * 0.5, a: 0.005 }));
        this.osc(o, t, { w: 'tri', f: midiHz(38), dur: 1.6, v: 0.5 });
        // the classic horror semitone: A – Bb – A
        if (n > 1) [57, 58, 57].forEach((m, i) => this.osc(o, t + 0.12 + i * 0.22, { w: 'pulse25', f: midiHz(m), hold: 0.18, v: 0.18 }));
        this.duckMusic(0.35, 1.2);
    },
    waveClear() {
        music.setMode('calm');
        if (!this.ok()) return;
        const t = this.t(), o = this.out(0.55, 0, 0.35);
        // chip fanfare that resolves to D major — a moment of hope
        [62, 66, 69, 74].forEach((m, i) => this.osc(o, t + i * 0.09, { w: 'pulse25', f: midiHz(m), hold: 0.08, v: 0.3 }));
        this.osc(o, t + 0.36, { w: 'pulse25', f: midiHz(78), hold: 0.7, v: 0.3, vib: 0.3 });
        this.osc(o, t + 0.36, { w: 'pulse12', f: midiHz(74), hold: 0.7, v: 0.15 });
        this.osc(o, t, { w: 'tri', f: midiHz(50), hold: 1, v: 0.5 });
        this.nz(o, t + 0.36, { buf: 'metal', type: 'highpass', f: 5000, dur: 1, v: 0.12 });
        this.duckMusic(0, 1.4);
    },
    deal(count) {
        if (!this.ok()) return;
        const t = this.t();
        for (let i = 0; i < count; i++) {
            const o = this.out(0.4, (i - (count - 1) / 2) * 0.5, 0.1);
            this.nz(o, t + 0.05 + i * 0.09, { buf: 'white', type: 'bandpass', f: 3200, f2: 1400, q: 1.5, dur: 0.07, v: 0.7 });
            this.osc(o, t + 0.05 + i * 0.09, { w: 'pulse12', f: midiHz(74 + i * 5), dur: 0.05, v: 0.12 });
        }
    },
    hover(i) {
        if (!this.ok() || this.t() - this.lastHover < 0.05) return;
        const t = this.lastHover = this.t();
        this.osc(this.out(0.3, (i - 1) * 0.4, 0.1), t, { w: 'pulse12', f: midiHz(81 + i * 2), dur: 0.04, v: 0.25 });
    },
    upgrade(cat) {
        if (!this.ok()) return;
        const t = this.t(), o = this.out(0.55, 0, 0.35), up = { firepower: 0, handling: 2, survival: 5, fortune: 7 }[cat] || 0;
        this.osc(o, t, { w: 'pulse12', f: 180, f2: 1700, dur: 0.3, v: 0.12 });                       // power-up sweep
        [62, 69, 74, 78, 81].forEach((m, i) => this.osc(o, t + i * 0.05, { w: 'pulse25', f: midiHz(m + up), dur: 0.2, v: 0.25 }));
    },
    death() {
        music.setMode('dead');
        if (!this.ok()) return;
        const t = this.t() + 0.35, o = this.out(0.6, 0, 0.45, this.post);
        // the band sags into the floor, then the classic sad-trombone chromatic fall
        [69, 68, 67].forEach((m, i) => this.osc(o, t + i * 0.32, { w: 'pulse25', f: midiHz(m), hold: 0.26, v: 0.28 }));
        this.osc(o, t + 0.96, { w: 'pulse25', f: midiHz(66), f2: midiHz(61), hold: 1.3, v: 0.28, vib: 0.5 });
        [57, 56, 55, 50].forEach((m, i) => this.osc(o, t + i * 0.32, { w: 'tri', f: midiHz(m - 12), hold: i < 3 ? 0.26 : 1.6, v: 0.5 }));
        [[1, 1], [2.76, 0.4], [5.4, 0.2]].forEach(([r, v]) =>
            this.osc(o, t + 0.96, { w: 'sine', f: midiHz(38) * r, dur: 3, v: v * 0.35, a: 0.005 }));
    },
    toggleMute() {
        this.muted = !this.muted;
        this.applyVolume();
        return this.muted;
    },
    // the settings sliders run 0..10, where 8 is the mix as designed (10 is +4 dB, and the
    // limiter catches it); squared so each step sounds like an even step
    level() { return this.muted ? 0 : (settings.master / 8) ** 2; },
    applyVolume() {
        if (!this.ctx) return;
        const t = this.t(), m = (settings.music / 8) ** 2;
        this.mute.gain.setTargetAtTime(this.level(), t, 0.03);
        this.musicVol.gain.setTargetAtTime(m, t, 0.03);
        this.musicVerb.gain.setTargetAtTime(m, t, 0.03);
    },
    // menu blips: quiet and short
    ui(kind) {
        if (!this.ok() || this.t() - this.lastHover < 0.04) return;
        const t = this.lastHover = this.t(), o = this.out(0.3, 0, 0.12);
        if (kind === 'move') this.osc(o, t, { w: 'pulse12', f: midiHz(81), dur: 0.035, v: 0.2 });
        else if (kind === 'back') this.osc(o, t, { w: 'pulse12', f: midiHz(74), f2: midiHz(69), dur: 0.07, v: 0.18 });
        else[76, 83].forEach((m, i) => this.osc(o, t + i * 0.05, { w: 'pulse12', f: midiHz(m), dur: 0.06, v: 0.18 }));
    },
};

// ===================================================================
// MUSIC — an adaptive score in D minor for the chip voices, arranged like a modern
// game soundtrack: extended chords voiced for smooth voice leading, one theme that
// comes back in every mode (music box on the title, full band in the fight, major
// key in the safe room), song forms that branch on how the fight is going, a
// sidechained stereo pad, twin-lead harmony and drum fills. Sequenced in 16ths
// with lookahead on the audio clock; mode changes land on the next beat.
//   title   the theme on music-box bells over a slow pad, then harmonized, then an interlude
//   combat  every 8 bars picks A (theme) / B (climax) / C (half-time breakdown) from the
//           heat (wave + zombies alive), and layers 1-3 within each section
//   calm    between waves: swung electric-piano comping, walking bass, the theme in F major
//   dead    the band sags out, then the sting (audio.death)
// ===================================================================
// chords: [bass, ...pad voicing]. Mostly rootless voicings (the bass has the root),
// picked so each voice moves a step or less into the next chord
const CH = {
    Dm9: [38, 53, 57, 60, 64],  // F A C E
    Dmadd9: [38, 53, 57, 62, 64],  // F A D E
    Bbmaj9: [34, 53, 57, 60, 62],  // F A C D
    Bbmaj7: [34, 53, 58, 62, 69],  // F Bb D A
    Bbmaj7s11: [34, 52, 57, 62, 65],  // E A D F
    Gm9: [43, 53, 58, 62, 69],  // F Bb D A
    Gm7: [43, 53, 58, 62, 67],  // F Bb D G
    Eo7: [40, 52, 55, 58, 62],  // E G Bb D
    A7: [45, 55, 61, 64, 69],  // G C# E A
    A7b9: [45, 55, 61, 64, 70],  // G C# E Bb — the b9 pulls hard back to D minor
    Fmaj7: [41, 53, 57, 60, 64],  // F A C E
    Fmaj9: [41, 55, 57, 60, 64],  // G A C E
    Cadd9: [36, 55, 60, 62, 64],  // G C D E
    C69: [36, 55, 57, 62, 64],  // G A D E
    C7sus: [36, 53, 55, 58, 60],  // F G Bb C
    C7: [36, 52, 55, 58, 60],  // E G Bb C
    Am7: [45, 55, 60, 64, 69],  // G C E A
    Ebmaj7s11: [39, 55, 58, 62, 69],  // G Bb D A — Neapolitan, the darkest turn in the score
};
// melodies: [16th step in the 8-bar section, midi note, length in 16ths]
const tune = notes => new Map(notes.map(([s, m, l]) => [s, { m, l }]));
const THEME = tune([ // the main theme, everywhere in D minor
    [0, 69, 4], [4, 74, 2], [6, 77, 2], [8, 76, 6], [14, 74, 2],
    [16, 77, 4], [20, 74, 4], [24, 70, 8],
    [32, 67, 2], [34, 70, 2], [36, 74, 4], [40, 79, 6], [46, 77, 2],
    [48, 76, 4], [52, 73, 4], [56, 69, 8],
    [64, 69, 4], [68, 74, 2], [70, 77, 2], [72, 81, 6], [78, 79, 2],
    [80, 77, 4], [84, 81, 4], [88, 84, 4], [92, 81, 4],
    [96, 79, 4], [100, 77, 2], [102, 74, 2], [104, 70, 4], [108, 74, 4],
    [112, 73, 4], [116, 76, 4], [120, 81, 4], [124, 73, 4],
]);
const SOAR = tune([ // the climax: long lines climbing to the b9 over the dominant
    [0, 74, 6], [6, 72, 2], [8, 74, 4], [12, 77, 4],
    [16, 76, 8], [24, 74, 4], [28, 72, 4],
    [32, 72, 4], [36, 76, 4], [40, 81, 8],
    [48, 79, 4], [52, 77, 4], [56, 76, 4], [60, 74, 4],
    [64, 74, 6], [70, 72, 2], [72, 74, 4], [76, 81, 4],
    [80, 79, 8], [88, 76, 4], [92, 79, 4],
    [96, 82, 8], [104, 81, 4], [108, 79, 4],
    [112, 82, 4], [116, 81, 12],
]);
const OMEN = tune([ // the breakdown: the wave bell's A–Bb–A, then a climb back into the fight
    [0, 81, 12], [12, 82, 4], [16, 81, 16],
    [32, 79, 6], [38, 77, 2], [40, 74, 8], [48, 76, 16],
    [64, 81, 12], [76, 82, 4], [80, 81, 16],
    [96, 82, 8], [104, 81, 4], [108, 79, 4],
    [112, 73, 4], [116, 76, 4], [120, 79, 4], [124, 82, 4],
]);
const HAVEN = tune([ // the theme's shape in F major for the safe room, left hanging on the b9
    [0, 76, 6], [6, 74, 2], [8, 72, 8],
    [16, 72, 4], [20, 76, 4], [24, 79, 8],
    [32, 77, 6], [38, 76, 2], [40, 74, 8],
    [48, 72, 4], [52, 77, 4], [56, 76, 8],
    [64, 81, 6], [70, 79, 2], [72, 77, 8],
    [80, 76, 4], [84, 77, 4], [88, 81, 8],
    [96, 82, 6], [102, 81, 2], [104, 79, 4], [108, 77, 4],
    [112, 76, 4], [116, 73, 4], [120, 70, 8],
]);
// 8-bar sections: one or two chords a bar (two = a change at the half bar)
const SECTIONS = {
    A: { bars: [['Dm9'], ['Bbmaj9'], ['Gm9'], ['A7', 'A7b9'], ['Dmadd9'], ['Fmaj7'], ['Gm7', 'Eo7'], ['A7b9']], mel: THEME },
    B: { bars: [['Bbmaj7'], ['Cadd9'], ['Am7'], ['Dm9'], ['Bbmaj7'], ['C69'], ['Ebmaj7s11'], ['A7b9']], mel: SOAR },
    C: { bars: [['Dmadd9'], ['Bbmaj7s11'], ['Gm9'], ['Dm9'], ['Dmadd9'], ['Ebmaj7s11'], ['Gm7'], ['A7b9']], mel: OMEN, pedal: 38 },
    I: { bars: [['Bbmaj7'], ['Gm9'], ['Ebmaj7s11'], ['Dmadd9'], ['Bbmaj7s11'], ['Gm9'], ['Eo7'], ['A7b9']] }, // title interlude
    F: { bars: [['Fmaj9'], ['Am7'], ['Bbmaj7'], ['C7sus', 'C7'], ['Fmaj9'], ['Dm9'], ['Gm9'], ['A7b9']], mel: HAVEN },
};
// a second voice under a melody note: the nearest chord tone at least a minor third below
function harmonyUnder(m, chord) {
    for (let t = m - 3; t >= m - 9; t--) if (chord.some(c => (c - t) % 12 === 0)) return t;
    return null;
}
const ARP_UPDOWN = [0, 1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1, 2, 3];
const hum = v => v * (0.9 + Math.random() * 0.2); // a little velocity life

export const music = {
    mode: 'off', pending: null, step: 0, next: 0, timer: null, layer: 1, lowHp: false,
    sec: 'A', secN: 0, vary: false, // current section, sections played in this mode, second-pass variation
    lead: null,                      // last lead note { m, end }, for legato glides
    wave: 0, alive: 0,               // fed by the game loop
    start() {
        const c = audio.ctx;
        // persistent voice buses, each panned into the music chain
        const bus = (pan, to, v = 1) => {
            const g = c.createGain(); g.gain.value = v;
            if (pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(to); }
            else g.connect(to);
            return g;
        };
        // sidechain: pads and arps duck under every kick, so the low end breathes
        this.pump = bus(0, audio.musicIn);
        this.pumpWet = bus(0, audio.musicWet);
        this.padLP = [-0.55, 0.55].map(pan => {
            const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900; f.Q.value = 0.9;
            f.connect(bus(pan, this.pump));
            return f;
        });
        this.arp = [bus(-0.35, this.pumpWet), bus(0.35, this.pumpWet)];
        this.leadBus = bus(0.08, audio.musicWet);
        this.harmBus = bus(-0.22, audio.musicWet);
        this.bellBus = bus(0.15, audio.musicWet);
        this.keysBus = bus(-0.1, audio.musicWet);
        this.bassBus = bus(0, audio.musicIn);
        this.kit = bus(0, audio.musicIn);
        this.hatBus = bus(0.25, audio.musicIn);
        this.crashBus = bus(-0.3, audio.musicIn);
        this.next = audio.t() + 0.1;
        this.timer = setInterval(() => this.tick(), 25);
        this.setMode('title');
    },
    setMode(m) {
        if (!audio.ctx || m === (this.pending || this.mode)) return;
        if (m !== 'dead') { this.pending = m; return; } // lands on the next beat (see advance)
        this.pending = null;
        this.mode = 'dead';
        const t = audio.t();
        audio.musicLP.frequency.cancelScheduledValues(t);
        audio.musicLP.frequency.setTargetAtTime(120, t, 0.25);
        audio.duck.gain.cancelScheduledValues(t);
        audio.duck.gain.setTargetAtTime(0, t, 0.3);
        clearTimeout(this.reviveT);
        this.reviveT = setTimeout(() => this.setMode('title'), 4200);
    },
    // switch modes on a beat, starting the new mode's score from the top
    enter(m) {
        this.pending = null;
        if (m === this.mode) return;
        const prev = this.mode;
        this.mode = m;
        this.step = 0; this.secN = 0; this.lead = null;
        clearTimeout(this.reviveT);
        if (prev === 'dead') audio.duck.gain.setTargetAtTime(1, audio.t(), 0.8);
        this.filter();
    },
    // music lowpass: wide open, darker between waves, choked while you're on your last heart
    filter() {
        const f = this.mode === 'dead' ? 120 : this.lowHp ? 900 : this.mode === 'calm' ? 6000 : 18000;
        audio.musicLP.frequency.setTargetAtTime(f, audio.t(), 0.4);
    },
    heat() { return 0.1 + this.wave * 0.06 + this.alive / 30 * 0.6; },
    bpm() {
        if (this.mode === 'combat') return Math.min(156, 126 + this.wave * 2);
        return this.mode === 'calm' ? 92 : 76;
    },
    swing() { return this.mode === 'calm' ? 0.16 : this.mode === 'title' ? 0.06 : 0; },
    sixteenth() { return 60 / this.bpm() / 4; },
    dur(steps) { return steps * this.sixteenth(); },
    tick() {
        const c = audio.ctx;
        if (!c || c.state !== 'running') return;
        const lowHp = this.mode === 'combat' && this.lowHp;
        if (lowHp !== this._lowHp) { this._lowHp = lowHp; this.filter(); }
        audio.echo.delayTime.setTargetAtTime(this.sixteenth() * 3, c.currentTime, 0.1); // dotted-8th echo
        if (this.next < c.currentTime) this.next = c.currentTime + 0.02; // fell behind (tab was hidden)
        while (this.next < c.currentTime + 0.12) this.advance();
    },
    advance() {
        if (this.pending && this.step % 4 === 0) this.enter(this.pending);
        const swing = this.step % 2 ? this.swing() * this.sixteenth() : 0; // late off-beats
        if (!audio.muted && this.mode !== 'dead' && this.mode !== 'off') this.play(this.step, this.next + swing);
        this.next += this.sixteenth();
        this.step++;
    },
    // which 8-bar section comes next. The fight goes A → B → A' → (C, or B' when it's hot)
    pickSection() {
        const n = this.secN++;
        if (this.mode === 'title') { this.sec = n % 3 === 2 ? 'I' : 'A'; this.vary = n % 3 === 1; return; }
        if (this.mode === 'calm') { this.sec = 'F'; this.vary = n % 2 === 1; return; }
        const k = n % 4;
        this.sec = k === 1 ? 'B' : k === 3 ? (this.heat() >= 0.55 ? 'B' : 'C') : 'A';
        this.vary = k >= 2;
    },

    // --- instruments ---
    // one enveloped oscillator: attack `a`, optional decay toward decay[0]×v (time constant
    // decay[1]), held for `len`, released over ~r. `from` glides in from another note.
    voice(dest, at, { w = 'pulse25', m, len, v, a = 0.005, r = 0.08, vib = 0, from, det = 0, decay }) {
        const c = audio.ctx, o = c.createOscillator(), g = c.createGain(), f = midiHz(m);
        if (audio.waves[w]) o.setPeriodicWave(audio.waves[w]); else o.type = w;
        o.detune.value = det;
        if (from !== undefined) { o.frequency.setValueAtTime(midiHz(from), at); o.frequency.exponentialRampToValueAtTime(f, at + 0.05); }
        else o.frequency.setValueAtTime(f, at);
        if (vib && len > 0.3) { // delayed vibrato, like a held note on a real instrument
            const l = c.createOscillator(), d = c.createGain();
            l.frequency.value = 5.2; d.gain.setValueAtTime(0, at + 0.18);
            d.gain.linearRampToValueAtTime(f * (Math.pow(2, vib / 12) - 1), at + Math.min(len, 0.5));
            l.connect(d); d.connect(o.frequency); l.start(at); l.stop(at + len + r * 2);
        }
        const end = at + Math.max(len, a);
        g.gain.setValueAtTime(0, at);
        g.gain.linearRampToValueAtTime(v, at + a);
        if (decay) g.gain.setTargetAtTime(v * decay[0], at + a, decay[1]);
        g.gain.setTargetAtTime(0, end, r / 3);
        o.connect(g); g.connect(dest); o.start(at); o.stop(end + r * 2);
    },
    // stereo pad: a 25% and a 50% pulse per note, detuned apart and split left/right
    pad(at, notes, steps, v, a) {
        for (const m of notes) [0, 1].forEach(k =>
            this.voice(this.padLP[k], at, { w: k ? 'pulse50' : 'pulse25', m, len: this.dur(steps), v, a, r: 0.7, det: k ? 8 : -8 }));
    },
    padTone(at, f) { for (const lp of this.padLP) lp.frequency.setTargetAtTime(f, at, 0.4); },
    bass(at, m, steps, v) {
        const len = this.dur(steps) * 0.85;
        this.voice(this.bassBus, at, { w: 'tri', m, len, v, a: 0.004, r: 0.05 });
        this.voice(this.bassBus, at, { w: 'sine', m, len, v: v * 0.5, a: 0.004, r: 0.05 }); // body under the 4-bit grit
    },
    leadNote(at, m, steps, v, { bus = this.leadBus, w = 'pulse25', vib = 0.22 } = {}) {
        // long legato notes slide in from the last one
        const l = this.lead, glide = l && steps >= 4 && Math.abs(at - l.end) < 0.04 && Math.abs(m - l.m) <= 5 ? l.m : undefined;
        this.voice(bus, at, { w, m, len: this.dur(steps) * 0.92, v, a: 0.01, r: 0.12, vib: steps >= 4 ? vib : 0, from: glide });
        if (bus === this.leadBus) this.lead = { m, end: at + this.dur(steps) };
    },
    // music-box tine: a bright strike that rings down, with a quick metallic overtone
    bell(at, m, v) {
        this.voice(this.bellBus, at, { w: 'sine', m, len: 0.01, v, a: 0.002, r: 1.8 });
        this.voice(this.bellBus, at, { w: 'sine', m: m + 12, len: 0.01, v: v * 0.3, a: 0.002, r: 0.5 });
        this.voice(this.bellBus, at, { w: 'tri', m: m + 24, len: 0.01, v: v * 0.1, a: 0.001, r: 0.12 });
    },
    // electric piano: a sine that blooms and settles, with a little tine bark on top
    keys(at, m, steps, v) {
        this.voice(this.keysBus, at, { w: 'sine', m, len: this.dur(steps), v, a: 0.004, r: 0.5, decay: [0.45, 0.4] });
        this.voice(this.keysBus, at, { w: 'tri', m: m + 12, len: 0.04, v: v * 0.16, a: 0.002, r: 0.2 });
    },
    kick(at, v = 0.9) {
        audio.osc(this.kit, at, { w: 'sine', f: 160, f2: 44, dur: 0.18, v });
        audio.nz(this.kit, at, { buf: 'white', type: 'highpass', f: 2500, dur: 0.012, v: v * 0.22 }); // beater click
        for (const p of [this.pump, this.pumpWet]) { p.gain.setValueAtTime(0.3, at); p.gain.setTargetAtTime(1, at + 0.03, 0.09); }
    },
    snare(at, v = 0.5) {
        audio.nz(this.kit, at, { rate: 0.55, type: 'bandpass', f: 2200, q: 0.8, dur: 0.16, v });
        audio.osc(this.kit, at, { w: 'tri', f: 230, f2: 150, dur: 0.07, v: v * 0.6 });
    },
    hat(at, v = 0.12, open = false) {
        audio.nz(this.hatBus, at + (Math.random() - 0.5) * 0.004, { buf: 'metal', type: 'highpass', f: 7000, dur: open ? 0.2 : 0.035, v: hum(v) });
    },
    brush(at, v) { audio.nz(this.hatBus, at, { buf: 'white', type: 'bandpass', f: 3500, q: 0.7, dur: 0.14, v: hum(v), a: 0.03 }); },
    crash(at, v = 0.22) {
        audio.nz(this.crashBus, at, { buf: 'white', type: 'highpass', f: 4500, dur: 1.8, v });
        audio.nz(this.crashBus, at, { buf: 'metal', type: 'highpass', f: 8000, dur: 1.1, v: v * 0.4 });
    },
    tom(at, f, v = 0.6) { audio.osc(this.kit, at, { w: 'sine', f, f2: f * 0.55, dur: 0.22, v }); },
    // filtered noise swelling into the next downbeat
    riser(at, len, v) {
        const c = audio.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
        s.buffer = audio.bufs.white; s.loop = true;
        f.type = 'bandpass'; f.Q.value = 1.4;
        f.frequency.setValueAtTime(300, at); f.frequency.exponentialRampToValueAtTime(6000, at + len);
        g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(v, at + len);
        g.gain.linearRampToValueAtTime(0, at + len + 0.03);
        s.connect(f); f.connect(g); g.connect(this.crashBus); s.start(at); s.stop(at + len + 0.05);
    },
    heart(at) {
        const o = audio.out(0.9, 0, 0, audio.post);
        audio.osc(o, at, { w: 'sine', f: 62, f2: 40, dur: 0.14, v: 1 });
        audio.osc(o, at + 0.16, { w: 'sine', f: 55, f2: 38, dur: 0.12, v: 0.7 });
    },

    play(step, at) {
        if (step % 128 === 0) this.pickSection();
        const s = step % 16, bar = (step >> 4) % 8, sec = SECTIONS[this.sec];
        const chords = sec.bars[bar], ch = CH[chords[s < 8 ? 0 : chords.length - 1]];
        const bassOf = b => sec.pedal && b < 7 ? sec.pedal : CH[sec.bars[b][0]][0];
        const g = {
            s, bar, sec, ch, pad: ch.slice(1), root: bassOf(bar), bassOf,
            change: s === 0 || (s === 8 && chords.length === 2), // a chord lands here
            span: chords.length === 2 ? 8 : 16,                   // ...and lasts this many 16ths
            mel: sec.mel?.get(step % 128),
        };
        if (this.mode === 'title') this.playTitle(at, g);
        else if (this.mode === 'calm') this.playCalm(at, g);
        else this.playCombat(at, g);
    },

    playTitle(at, { s, ch, pad, root, change, span, mel }) {
        // a slow pad and a held low root under everything
        if (change) { this.pad(at, pad, span, 0.026, 0.9); this.padTone(at, 1100); }
        if (s === 0) this.voice(this.bassBus, at, { w: 'tri', m: root, len: this.dur(15), v: 0.28, a: 0.3, r: 0.8 });
        if (this.sec === 'I') {
            // interlude: stray chimes picked from the chord, high and far apart
            if (s % 6 === 3 && Math.random() < 0.6) this.bell(at, pad[(Math.random() * 4) | 0] + 12, 0.08);
            return;
        }
        if (mel) {
            this.bell(at, mel.m, 0.27);
            if (this.vary) { const h = harmonyUnder(mel.m, ch); if (h) this.bell(at + 0.012, h, 0.12); } // second pass: in harmony
        }
        if (this.vary && s % 4 === 2) this.voice(this.arp[(s >> 2) & 1], at, { w: 'pulse12', m: pad[(s >> 2) % 4] + 12, len: this.dur(2), v: 0.035 });
    },

    playCalm(at, { s, bar, ch, pad, root, bassOf, change, span, mel }) {
        // electric piano comping: a rolled chord on the change, a short stab on the "and" of 3
        if (change) pad.forEach((m, i) => this.keys(at + i * 0.018, m, span, hum(0.05)));
        else if (s === 10 && span === 16) pad.forEach((m, i) => this.keys(at + i * 0.012, m, 2, hum(0.032)));
        if (change) this.pad(at, pad, span, 0.008, 0.4);
        if (s === 0) this.padTone(at, 1400);
        // walking bass: root, fifth, octave, then a half step into the next bar's root
        if (s % 4 === 0) {
            const next = bassOf((bar + 1) % 8);
            this.bass(at, [root, root + 7, root + 12, next > root ? next - 1 : next + 1][s >> 2], 4, hum(0.24));
        }
        // brushes: swept backbeat, ticking quarters
        if (s === 4 || s === 12) this.brush(at, 0.05);
        if (s % 4 === 0) this.hat(at, 0.035);
        else if (s % 2 === 0) this.hat(at, 0.02);
        // the theme in F major on the first pass; the second leaves room for the keys
        if (mel && !this.vary) this.leadNote(at, mel.m, mel.l, 0.13, { w: 'tri', vib: 0.15 });
    },

    playCombat(at, { s, bar, ch, pad, root, bassOf, change, span, mel }) {
        // pick the arrangement layer at each bar line so changes land on the beat
        if (s === 0) { const h = this.heat(); this.layer = h < 0.35 ? 1 : h < 0.7 ? 2 : 3; }
        const L = this.layer, half = this.sec === 'C', last = bar === 7;
        // pad: opens up with the layer; the breakdown sweeps it open across its 8 bars
        if (change) this.pad(at, pad, span, 0.014 + 0.007 * L, 0.06);
        if (s === 0) this.padTone(at, half ? 500 + bar * 320 : 650 + L * 650);
        if (s === 0 && bar === 0 && this.secN > 1 && L >= 2) this.crash(at);

        if (half) {
            // --- breakdown: half time, a pedal in the bass, the omen on the bells ---
            if (s === 0) this.bass(at, root, 16, 0.42);
            if (last && s % 2 === 0) this.bass(at, root + 12 * ((s >> 1) & 1), 2, 0.35); // pumps back up into the fight
            if (s === 0 || (L >= 2 && s === 11)) this.kick(at, 0.85);
            if (s === 8 && !last) this.snare(at, 0.55);
            if (s % 4 === 2) this.hat(at, 0.07);
            if (last) {
                if (s === 0) this.riser(at, this.dur(16), 0.18);
                if (s >= 8 || s % 2 === 0) this.snare(at, 0.12 + s * 0.02); // roll, building
            }
            if (mel) this.bell(at, mel.m, 0.2);
            if (this.lowHp && s % 4 === 0) this.heart(at);
            return;
        }

        // --- bass: octave-jumping 8ths, galloping 16ths at full intensity, and a
        // chromatic step into the next bar's root on the last 8th ---
        const gallop = [1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1];
        if (L < 3 ? s % 2 === 0 : gallop[s]) {
            let m = root + (s % 4 === 2 ? 12 : 0);
            if (s === 14 && !last) { const nb = bassOf(bar + 1); if (nb !== root) m = nb + (nb > root ? -1 : 1); }
            this.bass(at, m, L < 3 ? 2 : 1, hum(0.3 + 0.03 * L));
        }

        // --- drums, with a tom fill into each new section ---
        const fill = last && s >= 12 && L >= 2;
        if (fill) this.tom(at, [200, 165, 135, 105][s - 12]);
        else {
            if (s === 0 || s === 8 || (L >= 2 && s === 10) || (L >= 3 && s === 3)) this.kick(at);
            if (L >= 2 && (s === 4 || s === 12)) this.snare(at, hum(0.5));
            if (L >= 3 && (s === 7 || s === 15)) this.snare(at, hum(0.1)); // ghost notes
            const open = this.sec === 'B' && L >= 2 && s % 4 === 2;
            if (L >= 3 || s % 2 === 0) this.hat(at, open ? 0.1 : s % 4 === 2 ? 0.16 : 0.08, open);
        }

        // --- arpeggio over the pad voicing, ping-ponging across the stereo field ---
        const arp = [...pad, ...pad.map(n => n + 12)];
        if (L === 1 ? s % 4 === 2 : L === 2 ? s % 2 === 0 : true) {
            const i = L === 1 ? 4 + ((s >> 2) & 3) : L === 2 ? (s >> 1) : ARP_UPDOWN[s];
            this.voice(this.arp[s & 2 ? 1 : 0], at + (Math.random() - 0.5) * 0.004, { w: 'pulse12', m: arp[i], len: this.dur(L === 3 ? 1 : 2) * 0.8, v: hum(0.042), r: 0.05 });
        }

        // --- the tune: soft triangle at layer 1, the pulse lead from 2, doubled an octave
        // down at 3, and a twin-lead harmony on second passes and in the climax ---
        if (mel) {
            if (L === 1) this.leadNote(at, mel.m, mel.l, 0.12, { w: 'tri' });
            else this.leadNote(at, mel.m, mel.l, 0.18);
            if (L >= 3) this.voice(this.leadBus, at, { w: 'pulse50', m: mel.m - 12, len: this.dur(mel.l) * 0.9, v: 0.06, r: 0.1 });
            if (L >= 2 && (this.vary || this.sec === 'B')) {
                const h = harmonyUnder(mel.m, ch);
                if (h) this.leadNote(at, h, mel.l, 0.09, { bus: this.harmBus, w: 'pulse50', vib: 0.15 });
            }
        }
        if (this.lowHp && s % 4 === 0) this.heart(at);
    },
};

// Start the title music as soon as the page loads. Browsers block audio until the
// first click or keypress, which is what the title's PRESS ANY KEY splash collects.
audio.ensure();
function initAudio() {
    audio.ensure();
    ['click', 'keydown', 'touchstart'].forEach(e => document.removeEventListener(e, initAudio));
}
['click', 'keydown', 'touchstart'].forEach(e => document.addEventListener(e, initAudio));
// park the audio clock while the tab is hidden so the score doesn't stutter
document.addEventListener('visibilitychange', () => {
    if (!audio.ctx) return;
    if (document.hidden) audio.ctx.suspend(); else audio.ctx.resume();
});

