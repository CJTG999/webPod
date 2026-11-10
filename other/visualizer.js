// ============================================================================
// webPod visualizer engine
//
// Replaces the old always-running render loop. Differences:
//  * the loop only runs while audio is playing, a mode is selected and the
//    window is visible (the old one ran forever, even when paused/disabled)
//  * canvas is resized only when its size changes (not every frame)
//  * typed arrays are reused (the old one allocated a new one every frame)
//  * optional frame-rate cap
//  * 12 modes (the original "bar" and "wave" are drawn exactly as before)
//
// Relies on globals from main.js: state, analyserNode
// Public API (globals): visInit, visSync, applyVisualizerSettings,
//                        visInvalidateColor, visConfigureAnalyser, VIS_MODES
// ============================================================================
(function () {
    'use strict';

    const ACCENT = '#38bdf8';
    const TWO_PI = Math.PI * 2;

    const vis = {
        cfg: { mode: 'bar', color: 'lcd', custom: ACCENT, sens: 1, smooth: 0.8, height: 40, fps: 60 },
        minInterval: 1000 / 60,
        canvas: null, ctx: null, w: 300, h: 40, dpr: 1,
        raf: 0, last: 0,
        fill: null, lcdColor: null,
        freq: null, time: null, timeHalf: null,
        peaks: new Float32Array(32), level: 0, rot: 0,
        ro: null
    };

    // ---- helpers -----------------------------------------------------------
    const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
    const tilt = (i, n) => 1 + 0.9 * (i / n);               // boosts quiet highs a little

    function fftFor(mode) { return (mode === 'bar' || mode === 'wave') ? 64 : 256; }

    function ensureCanvas() {
        if (vis.canvas) return true;
        const c = document.getElementById('lcdVisualizer');
        if (!c) return false;
        vis.canvas = c;
        vis.ctx = c.getContext('2d');
        if (typeof ResizeObserver !== 'undefined') {
            vis.ro = new ResizeObserver(() => resize());
            vis.ro.observe(c);
        }
        window.addEventListener('resize', resize);
        resize();
        return true;
    }

    function resize() {
        const c = vis.canvas;
        if (!c) return;
        const cw = c.clientWidth || 300;
        const ch = c.clientHeight || vis.cfg.height || 40;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const pw = Math.round(cw * dpr), ph = Math.round(ch * dpr);
        if (c.width === pw && c.height === ph && vis.w === cw && vis.h === ch) return;
        vis.w = cw; vis.h = ch; vis.dpr = dpr;
        c.width = pw; c.height = ph;                           // (resets the context state)
        vis.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        vis.fill = null;                                       // gradients depend on width
        if (!vis.raf) drawIdle();
    }

    function getFill() {
        if (vis.fill) return vis.fill;
        const c = vis.cfg;
        let f;
        if (c.color === 'rainbow') {
            const g = vis.ctx.createLinearGradient(0, 0, vis.w, 0);
            for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, `hsl(${i * 55}, 90%, 60%)`);
            f = g;
        } else if (c.color === 'accent') {
            f = ACCENT;
        } else if (c.color === 'custom') {
            f = c.custom || ACCENT;
        } else {
            f = vis.lcdColor || (vis.lcdColor = getComputedStyle(vis.canvas).color || '#fff');
        }
        return (vis.fill = f);
    }

    // Called when the LCD theme changes (the LCD colour fades over 300ms, so re-read after it)
    function visInvalidateColor() {
        vis.fill = null; vis.lcdColor = null;
        setTimeout(() => { vis.fill = null; vis.lcdColor = null; if (!vis.raf) drawIdle(); }, 360);
    }

    // ---- idle line (same as the original paused / disabled look) -----------
    function drawIdle() {
        if (!vis.ctx || document.hidden) return;
        const { ctx, w, h } = vis;
        ctx.clearRect(0, 0, w, h);
        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
        ctx.fillRect(0, h / 2, w, 2);
    }

    // ---- drawing modes -------------------------------------------------------
    // f = frequency bytes, t = time-domain bytes, s = sensitivity, fr = elapsed frames
    const draw = {
        // ORIGINAL bar visualizer (only the first half of 32 bins fit, like before)
        bar(ctx, w, h, f, t, s) {
            const n = f.length, bw = (w / n) * 2;
            ctx.beginPath();
            for (let i = 0, x = 0; i < n && x < w; i++, x += bw) {
                const bh = Math.min(h, (f[i] / 255) * h * s);
                ctx.rect(x, h - bh, bw - 1, bh);
            }
            ctx.fill();
        },
        // ORIGINAL waveform
        wave(ctx, w, h, f, t, s) {
            const n = vis.timeHalf.length, sw = w / n;
            ctx.lineWidth = 2;
            ctx.beginPath();
            for (let i = 0, x = 0; i < n; i++, x += sw) {
                const y = (((vis.timeHalf[i] / 128 - 1) * s + 1) * h) / 2;
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.lineTo(w, h / 2);
            ctx.stroke();
        },
        // dense full-range bars
        fine(ctx, w, h, f, t, s) {
            const n = 96, bw = w / n;
            ctx.beginPath();
            for (let i = 0; i < n; i++) {
                const bh = Math.min(h, (f[i] / 255) * h * s * tilt(i, n));
                ctx.rect(i * bw, h - bh, Math.max(1, bw - 1), bh);
            }
            ctx.fill();
        },
        // bars growing up and down from the centre line
        mirror(ctx, w, h, f, t, s) {
            const n = 48, bw = w / n;
            ctx.beginPath();
            for (let i = 0; i < n; i++) {
                const bh = Math.max(1, Math.min(h, (f[i] / 255) * h * s * tilt(i, n)));
                ctx.rect(i * bw + 0.5, (h - bh) / 2, Math.max(1, bw - 1), bh);
            }
            ctx.fill();
        },
        // smooth filled spectrum curve
        spectrum(ctx, w, h, f, t, s) {
            const n = 64, step = w / (n - 1);
            const y = i => h - Math.min(1, (f[i] / 255) * s * tilt(i, n)) * (h - 2) - 1;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(0, y(0));
            for (let i = 1; i < n; i++) {
                const mx = (i - 0.5) * step, my = (y(i - 1) + y(i)) / 2;
                ctx.quadraticCurveTo((i - 1) * step, y(i - 1), mx, my);
            }
            ctx.lineTo(w, y(n - 1));
            ctx.stroke();
            ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
            ctx.globalAlpha = 0.3; ctx.fill(); ctx.globalAlpha = 1;
        },
        // oscilloscope with filled body
        scope(ctx, w, h, f, t, s) {
            const n = 128, step = w / (n - 1);
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            for (let i = 0; i < n; i++) {
                const y = clamp(((t[i * 2] / 128 - 1) * s + 1) * h / 2, 0, h);
                if (i === 0) ctx.moveTo(0, y); else ctx.lineTo(i * step, y);
            }
            ctx.stroke();
            ctx.lineTo(w, h / 2); ctx.lineTo(0, h / 2); ctx.closePath();
            ctx.globalAlpha = 0.25; ctx.fill(); ctx.globalAlpha = 1;
        },
        // retro segmented LED columns
        led(ctx, w, h, f, t, s) {
            const n = 16, bw = w / n, segs = Math.max(3, Math.floor(h / 4)), sh = h / segs;
            const lit = new Array(n);
            for (let c = 0; c < n; c++) {
                let m = 0;
                for (let k = 0; k < 6; k++) m = Math.max(m, f[c * 6 + k]);
                lit[c] = Math.round(Math.min(1, (m / 255) * s * tilt(c, n)) * segs);
            }
            ctx.globalAlpha = 0.12;
            ctx.beginPath();
            for (let c = 0; c < n; c++) for (let j = lit[c]; j < segs; j++) ctx.rect(c * bw + 1, h - (j + 1) * sh + 1, bw - 2, sh - 2);
            ctx.fill();
            ctx.globalAlpha = 1;
            ctx.beginPath();
            for (let c = 0; c < n; c++) for (let j = 0; j < lit[c]; j++) ctx.rect(c * bw + 1, h - (j + 1) * sh + 1, bw - 2, sh - 2);
            ctx.fill();
        },
        // pulsing circles
        dots(ctx, w, h, f, t, s) {
            const n = 24, cw = w / n, maxR = Math.max(1, Math.min(h / 2 - 1, cw / 2 - 0.5));
            ctx.beginPath();
            for (let i = 0; i < n; i++) {
                const a = Math.min(1, (f[i * 3] / 255) * s * tilt(i, n));
                const r = Math.max(0.8, a * maxR), x = (i + 0.5) * cw;
                ctx.moveTo(x + r, h / 2);
                ctx.arc(x, h / 2, r, 0, TWO_PI);
            }
            ctx.fill();
        },
        // bars with slowly falling peak caps
        peaks(ctx, w, h, f, t, s, fr) {
            const n = 24, bw = w / n, fall = 0.012 * fr, pk = vis.peaks;
            ctx.beginPath();
            for (let i = 0; i < n; i++) {
                let m = 0;
                for (let k = 0; k < 4; k++) m = Math.max(m, f[i * 4 + k]);
                const a = Math.min(1, (m / 255) * s * tilt(i, n));
                pk[i] = Math.max(a, pk[i] - fall);
                ctx.rect(i * bw + 1, h - a * h, bw - 2, a * h);
                ctx.rect(i * bw + 1, h - pk[i] * (h - 2) - 2, bw - 2, 2);
            }
            ctx.fill();
        },
        // circular spectrum (looks best with a taller visualizer)
        radial(ctx, w, h, f, t, s, fr) {
            const n = 40, cx = w / 2, cy = h / 2, r0 = h * 0.2, maxLen = Math.max(2, h / 2 - r0 - 1);
            vis.rot += 0.012 * fr;
            ctx.lineWidth = 2; ctx.lineCap = 'round';
            ctx.beginPath();
            for (let i = 0; i < n; i++) {
                const a = Math.min(1, (f[i * 2] / 255) * s * tilt(i, n));
                const ang = vis.rot + (i / n) * TWO_PI, cs = Math.cos(ang), sn = Math.sin(ang);
                const r1 = r0 + Math.max(1, a * maxLen);
                ctx.moveTo(cx + cs * r0, cy + sn * r0);
                ctx.lineTo(cx + cs * r1, cy + sn * r1);
            }
            ctx.stroke();
            ctx.globalAlpha = 0.4; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.arc(cx, cy, r0 - 2, 0, TWO_PI); ctx.stroke();
            ctx.globalAlpha = 1; ctx.lineCap = 'butt';
        },
        // horizontal VU meter (overall loudness)
        vu(ctx, w, h, f, t, s, fr) {
            let sum = 0;
            for (let i = 0; i < 128; i++) { const d = t[i] - 128; sum += d * d; }
            const raw = Math.min(1, (Math.sqrt(sum / 128) / 128) * 3.2 * s);
            vis.level = Math.max(raw, vis.level - 0.03 * fr);
            const n = 28, sw = w / n, bh = Math.max(4, h * 0.6), y = (h - bh) / 2, lit = Math.round(vis.level * n);
            ctx.globalAlpha = 0.12;
            ctx.beginPath();
            for (let i = lit; i < n; i++) ctx.rect(i * sw + 1, y, sw - 2, bh);
            ctx.fill();
            ctx.globalAlpha = 1;
            ctx.beginPath();
            for (let i = 0; i < lit; i++) ctx.rect(i * sw + 1, y, sw - 2, bh);
            ctx.fill();
        }
    };

    const VIS_MODES = ['bar', 'wave', 'fine', 'mirror', 'spectrum', 'scope', 'led', 'dots', 'peaks', 'radial', 'vu'];
    const TIME_MODES = { wave: 1, scope: 1, vu: 1 };

    // ---- the loop ---------------------------------------------------------------
    function tick(ts) {
        vis.raf = requestAnimationFrame(tick);
        const dt = ts - vis.last;
        if (vis.minInterval && dt < vis.minInterval - 1) return;
        vis.last = vis.minInterval ? ts - (dt % vis.minInterval) : ts;
        drawFrame(dt > 100 ? 1 : dt / 16.67);                  // elapsed frames (animation speed stays constant)
    }

    function drawFrame(frames) {
        const an = (typeof analyserNode !== 'undefined') ? analyserNode : null;
        if (!an || !vis.ctx) return;
        const mode = vis.cfg.mode, fn = draw[mode];
        if (!fn) return;
        if (!vis.freq || vis.freq.length !== an.frequencyBinCount) {
            vis.freq = new Uint8Array(an.frequencyBinCount);
            vis.time = new Uint8Array(an.fftSize);
            vis.timeHalf = vis.time.subarray(0, an.frequencyBinCount);
        }
        // modes that need more bins than the analyser has (e.g. mid-switch) just wait a frame
        if (an.fftSize !== fftFor(mode)) { configureAnalyser(); return; }
        if (TIME_MODES[mode]) an.getByteTimeDomainData(vis.time);
        else an.getByteFrequencyData(vis.freq);

        const { ctx, w, h } = vis;
        const fill = getFill();
        ctx.clearRect(0, 0, w, h);
        ctx.globalAlpha = 1;
        ctx.fillStyle = fill;
        ctx.strokeStyle = fill;
        fn(ctx, w, h, vis.freq, vis.time, vis.cfg.sens, frames);
    }

    function shouldRun() {
        return !!(typeof analyserNode !== 'undefined' && analyserNode &&
                  typeof state !== 'undefined' && state.isPlaying &&
                  vis.cfg.mode !== 'none' && !document.hidden);
    }

    // Start / stop the loop to match the current state. Safe to call any time.
    function visSync() {
        if (!ensureCanvas()) return;
        if (shouldRun()) {
            if (!vis.raf) { vis.last = 0; vis.raf = requestAnimationFrame(tick); }
        } else {
            if (vis.raf) { cancelAnimationFrame(vis.raf); vis.raf = 0; }
            drawIdle();
        }
    }

    function configureAnalyser() {
        const an = (typeof analyserNode !== 'undefined') ? analyserNode : null;
        if (!an) return;
        const fft = fftFor(vis.cfg.mode);
        if (an.fftSize !== fft) an.fftSize = fft;
        an.smoothingTimeConstant = vis.cfg.smooth;
        vis.freq = vis.time = vis.timeHalf = null;
    }

    // Accepts a settings object (live preview passes an unsaved copy)
    function applyVisualizerSettings(s) {
        ensureCanvas();
        const c = vis.cfg;
        c.mode = (s.visMode === 'none' || VIS_MODES.indexOf(s.visMode) !== -1) ? s.visMode : 'bar';
        c.color = s.visColor || 'lcd';
        c.custom = s.visCustomColor || ACCENT;
        c.sens = clamp(Number(s.visSensitivity) || 1, 0.3, 3);
        c.smooth = clamp(s.visSmoothing === undefined ? 0.8 : Number(s.visSmoothing), 0, 0.95);
        c.height = clamp(Number(s.visHeight) || 40, 20, 90);
        let fps = Number(s.visFps); if (isNaN(fps)) fps = 60;
        if (s.perfMode) fps = Math.min(fps || 60, 30);          // performance mode caps at 30fps
        c.fps = fps;
        vis.minInterval = fps ? 1000 / fps : 0;
        vis.peaks.fill(0); vis.level = 0;
        if (vis.canvas) {
            vis.canvas.style.height = c.height + 'px';
            vis.fill = null;
            resize();
        }
        configureAnalyser();
        visSync();
    }

    document.addEventListener('visibilitychange', visSync);

    window.visInit = ensureCanvas;
    window.visSync = visSync;
    window.applyVisualizerSettings = applyVisualizerSettings;
    window.visInvalidateColor = visInvalidateColor;
    window.visConfigureAnalyser = configureAnalyser;
    window.VIS_MODES = VIS_MODES;
})();
