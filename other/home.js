/* ===== webPod Home ===== */

// ---- Edit these paths to match where your pages live ----
const LINKS = {
    player:   './index.html',          // main webPod player (use ./webpod.html if that's your player file)
    captions: './tools/captions.html', // Caption Studio (Lyric Maker)
    sync:     './tools/captionsync.html', // SyncMaster
    manager:  './other/manager.html'   // Backup / ZIP manager
};

// ---- Content ----
const FEATURES = [
    { cat: 'player',  icon: 'fa-circle-dot',      title: 'Click Wheel Controls', text: 'A tactile wheel with play, skip, rewind, and a synthesized click sound for that authentic feel.' },
    { cat: 'player',  icon: 'fa-palette',         title: '5 LCD & Case Themes',  text: 'Classic grey, Matrix green, Ice blue, Amber glow, and Cyberpunk pink. The case recolors to match.' },
    { cat: 'player',  icon: 'fa-shuffle',         title: 'Shuffle & Loop',       text: 'Play all, shuffle the queue, or loop a single track or the entire library.' },
    { cat: 'player',  icon: 'fa-mobile-screen',   title: 'Installable Mobile PWA', text: 'A dedicated full-screen mobile layout with a slide-out menu. Add it to your home screen.' },
    { cat: 'lyrics',  icon: 'fa-quote-left',      title: 'Synced Lyrics',        text: 'Fetch time-synced lyrics from LRCLIB and watch the active line highlight in real time.' },
    { cat: 'lyrics',  icon: 'fa-tv',              title: 'Live LCD Caption Preview', text: 'Flip to Preview mode to show the current line big on a retro LCD stage.' },
    { cat: 'lyrics',  icon: 'fa-file-lines',      title: 'SRT & LRC Support',    text: 'Upload or paste your own caption files, with auto-detection of the format.' },
    { cat: 'lyrics',  icon: 'fa-clock-rotate-left', title: 'Offset & Rate Sliders', text: 'Nudge lyrics up to ±30s or stretch their timing from 0.5x to 2x. Saved per track.' },
    { cat: 'lyrics',  icon: 'fa-filter',          title: 'Profanity Filter',     text: 'Lyrics are censored using a word list so playback stays family friendly.' },
    { cat: 'audio',   icon: 'fa-sliders',         title: '5-Band Equalizer',     text: 'Flat, Bass Heavy, Vocal Booster, Treble Boost, and Rock presets powered by Web Audio.' },
    { cat: 'audio',   icon: 'fa-volume-high',     title: 'Bass Boost',           text: 'One toggle adds a punchy +12 dB low-shelf for deeper bass.' },
    { cat: 'audio',   icon: 'fa-gauge-high',      title: 'Variable Speed',       text: 'Slow it down to learn a song or speed it up, from 0.5x to 2.0x.' },
    { cat: 'audio',   icon: 'fa-chart-simple',    title: 'Live Visualizer',      text: 'Bar or waveform visualizer drawn on the LCD, or turn it off for best performance.' },
    { cat: 'library', icon: 'fa-database',        title: 'Saved in Your Browser', text: 'Songs are stored in IndexedDB, so they are still there next time you visit.' },
    { cat: 'library', icon: 'fa-tags',            title: 'Auto Metadata',        text: 'Title and artist are read from ID3 tags, or guessed from the file name.' },
    { cat: 'library', icon: 'fa-file-zipper',     title: 'ZIP Backup & Restore', text: 'Export audio, lyrics, offsets, and IDs in one ZIP. Import it on any device.' }
];

const APPS = [
    { key: 'player',   color: '#22d3ee', icon: 'fa-podcast',           title: 'webPod Player', text: 'The main event: your retro music player with lyrics, EQ, and library.', bullets: ['Click wheel & hotkeys', 'Synced lyrics panel', 'Audio DSP controls'], cta: 'Open player' },
    { key: 'captions', color: '#f472b6', icon: 'fa-closed-captioning', title: 'Caption Studio', text: 'Create SRT captions from scratch while the song plays, with multi-track audio.', bullets: ['3 audio tracks (inst + voices)', 'Hotkeys to mark start / end', 'Live FNF-style preview'], cta: 'Start captioning' },
    { key: 'sync',     color: '#4ade80', icon: 'fa-sliders',           title: 'SyncMaster', text: 'Already have lyrics? Tap along to stamp timestamps and export .SRT or .LRC.', bullets: ['Continuous or tap-range mode', 'Karaoke monitor', 'Edit lines & timings inline'], cta: 'Sync lyrics' },
    { key: 'manager',  color: '#fbbf24', icon: 'fa-file-zipper',       title: 'Backup Manager', text: 'See what is in your library and move it between browsers and devices.', bullets: ['Export full library to ZIP', 'Import and merge by ID', 'Library stats at a glance'], cta: 'Manage library' }
];

// ---- Wire up links ----
document.querySelectorAll('[data-link]').forEach(a => { a.href = LINKS[a.dataset.link] || '#'; });

// ---- Render features ----
const grid = document.getElementById('featureGrid');
function renderFeatures(filter = 'all') {
    grid.innerHTML = '';
    FEATURES.filter(f => filter === 'all' || f.cat === filter).forEach((f, i) => {
        const el = document.createElement('article');
        el.className = 'card';
        el.style.animationDelay = (i * 40) + 'ms';
        el.innerHTML = `<span class="tag">${f.cat}</span>
            <div class="ico"><i class="fa-solid ${f.icon}"></i></div>
            <h4>${f.title}</h4><p>${f.text}</p>`;
        el.addEventListener('pointermove', e => {
            const r = el.getBoundingClientRect();
            el.style.setProperty('--mx', (e.clientX - r.left) + 'px');
            el.style.setProperty('--my', (e.clientY - r.top) + 'px');
        });
        grid.appendChild(el);
    });
}
renderFeatures();
document.getElementById('featureFilters').addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    renderFeatures(chip.dataset.filter);
});

// ---- Render apps ----
document.getElementById('appGrid').innerHTML = APPS.map(a => `
    <a class="app reveal" href="${LINKS[a.key]}" style="--a:${a.color}">
        <div class="ico"><i class="fa-solid ${a.icon}"></i></div>
        <h3>${a.title}</h3>
        <p>${a.text}</p>
        <ul>${a.bullets.map(b => `<li>${b}</li>`).join('')}</ul>
        <span class="go">${a.cta} <i class="fa-solid fa-arrow-right"></i></span>
    </a>`).join('');

// ---- Scroll reveal ----
const io = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
}, { threshold: 0.12 });
document.querySelectorAll('.reveal').forEach(el => io.observe(el));

// ---- Count-up stats ----
document.querySelectorAll('[data-count]').forEach(el => {
    const target = +el.dataset.count;
    let n = 0;
    if (target === 0) return;
    const t = setInterval(() => { el.textContent = ++n; if (n >= target) clearInterval(t); }, 120);
});

/* ===== Interactive demo iPod ===== */
const DEMO = [
    { title: 'Welcome',      artist: 'webPod',        len: 180, lines: ['Your music', 'Retro style', 'Synced lyrics', 'Right on the LCD'] },
    { title: 'Neon Drive',   artist: 'Demo Artist',   len: 205, lines: ['Hit the wheel', 'Feel the click', 'Lights on the road', 'Never stop'] },
    { title: 'Pocket Sunrise', artist: 'Sample Band', len: 168, lines: ['Morning glow', 'Press play', 'Turn it up', 'Hello again'] }
];
let cur = 0, playing = true, t = 0, lineIdx = 0, lastLineAt = 0;

const $ = id => document.getElementById(id);
const ipod = $('ipod'), lcd = $('lcd');
const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// click sound (same idea as the real player)
let actx = null;
function click() {
    try {
        actx = actx || new (window.AudioContext || window.webkitAudioContext)();
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = 'triangle';
        o.frequency.setValueAtTime(1200, actx.currentTime);
        o.frequency.exponentialRampToValueAtTime(300, actx.currentTime + .03);
        g.gain.setValueAtTime(.12, actx.currentTime);
        g.gain.exponentialRampToValueAtTime(.01, actx.currentTime + .03);
        o.connect(g); g.connect(actx.destination);
        o.start(); o.stop(actx.currentTime + .03);
    } catch (e) {}
}

function loadTrack(i) {
    cur = (i + DEMO.length) % DEMO.length;
    t = 0; lineIdx = 0; lastLineAt = 0;
    $('lcdTitle').textContent = DEMO[cur].title;
    $('lcdArtist').textContent = DEMO[cur].artist;
    $('tDur').textContent = fmt(DEMO[cur].len);
    $('lcdCaption').textContent = DEMO[cur].lines[0];
}
function setPlaying(p) {
    playing = p;
    $('lcdPlay').className = p ? 'fa-solid fa-pause' : 'fa-solid fa-play';
    $('lcdArtist').textContent = p ? DEMO[cur].artist : 'Paused';
}

function act(a) {
    click();
    if (a === 'next') loadTrack(cur + 1);
    else if (a === 'prev') (t > 3 ? loadTrack(cur) : loadTrack(cur - 1));
    else if (a === 'play' || a === 'center') setPlaying(!playing);
    else if (a === 'menu') document.getElementById('features').scrollIntoView({ behavior: 'smooth' });
    if (a === 'next' || a === 'prev') setPlaying(true);
}
document.querySelectorAll('.wheel [data-act]').forEach(b => b.addEventListener('click', () => act(b.dataset.act)));

// Keyboard (mirrors the real app) + key-card highlights
const KEYMAP = { ArrowUp: 'menu', ArrowDown: 'play', ArrowLeft: 'prev', ArrowRight: 'next', ' ': 'center' };
const KEYCARD = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', ' ': 'Space' };
window.addEventListener('keydown', e => {
    if (!KEYMAP[e.key]) return;
    if (e.key !== 'ArrowUp' || window.scrollY < 200) e.preventDefault();
    if (e.repeat) return;
    if (e.key === 'ArrowUp') { click(); return; }   // keep ↑ from hijacking page scroll
    act(KEYMAP[e.key]);
    document.querySelectorAll('kbd').forEach(k => { if (k.textContent === KEYCARD[e.key]) { k.classList.add('pressed'); setTimeout(() => k.classList.remove('pressed'), 150); } });
});

// Progress bar seek
$('bar').addEventListener('click', e => {
    const r = e.currentTarget.getBoundingClientRect();
    t = ((e.clientX - r.left) / r.width) * DEMO[cur].len;
    lineIdx = Math.floor((t / DEMO[cur].len) * DEMO[cur].lines.length);
    $('lcdCaption').textContent = DEMO[cur].lines[lineIdx] || '';
});

// Tick: time, progress, caption
setInterval(() => {
    if (!playing) return;
    t += 0.25;
    const d = DEMO[cur];
    if (t >= d.len) { loadTrack(cur + 1); return; }
    $('tCur').textContent = fmt(t);
    $('barFill').style.width = (t / d.len * 100) + '%';
    if (t - lastLineAt >= 2.5) {
        lastLineAt = t;
        lineIdx = (lineIdx + 1) % d.lines.length;
        $('lcdCaption').textContent = d.lines[lineIdx];
    }
}, 250);

// Fake visualizer
const cv = $('vis'), cx = cv.getContext('2d');
let phase = 0;
function draw() {
    const w = cv.width = cv.clientWidth || 280, h = cv.height = cv.clientHeight || 38;
    cx.clearRect(0, 0, w, h);
    cx.fillStyle = getComputedStyle(lcd).color;
    const bars = 32, bw = w / bars;
    for (let i = 0; i < bars; i++) {
        const base = playing ? (Math.sin(phase + i * .5) * .5 + .5) * (Math.sin(phase * .7 + i * .21) * .4 + .6) : .04;
        const bh = Math.max(2, base * h);
        cx.fillRect(i * bw, h - bh, bw - 2, bh);
    }
    if (playing) phase += 0.12;
    requestAnimationFrame(draw);
}
draw();

// Theme picker (remembers choice)
function setTheme(name) {
    [ipod, lcd].forEach(el => { el.className = el.className.replace(/theme-\w+/g, '').trim() + ' ' + name; });
    document.querySelectorAll('.dot').forEach(d => d.classList.toggle('active', d.dataset.theme === name));
    try { localStorage.setItem('webpodHomeTheme', name); } catch (e) {}
}
document.querySelectorAll('.dot').forEach(d => d.addEventListener('click', () => { click(); setTheme(d.dataset.theme); }));
let saved = 'theme-classic';
try { saved = localStorage.getItem('webpodHomeTheme') || saved; } catch (e) {}
setTheme(saved);

loadTrack(0);
