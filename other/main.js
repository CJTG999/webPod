// Application Global State
const state = {
    playlist: [],          // List of track metadata objects
    currentIndex: -1,      // Current active track index
    isPlaying: false,      // Playback status
    isShuffle: false,      // Shuffle state
    loopMode: 'off',       // 'off', 'all', 'one'
    lyricOffset: 0.0,      // Caption delay/offset in seconds (loaded from current track)
    captionSpeed: 1.0,     // Caption playback rate speed multiplier (independent of audio speed)
    currentLyrics: [],     // Time-synced lyrics array [{ time: float, text: string }]
    activeLyricIndex: -1,  // Currently active lyric line
    lyricsViewMode: 'list', // 'list' | 'preview' (retro LCD live stage)
    badwords: [],          // Profanity word filter list
    
    // Preferences & Settings
    settings: {
        lyricsApi: 'lrclib',      // 'lrclib' or 'musixmatch'
        musixmatchKey: '',
        lcdTheme: 'theme-classic',
        visMode: 'bar',           // 'bar', 'wave', 'none'
        showLyrics: true,
        showUpload: true,
        showDsp: true,
        audioVolume: 100,        // 1 - 200 (%)
        clickSound: true,
        lowLatencyLyrics: true,   // rAF-driven lyric updates for minimal lag
        disableProfanityFilter: false, // requires passcode to enable

        // ---- Visualizer (see other/visualizer.js) ----
        visColor: 'lcd',          // 'lcd' | 'accent' | 'rainbow' | 'custom'
        visCustomColor: '#38bdf8',
        visSensitivity: 1,        // 0.5 - 2
        visSmoothing: 0.8,        // analyser smoothing 0 - 0.95
        visHeight: 40,            // canvas height in px
        visFps: 60,               // frame cap (0 = display rate)

        // ---- Appearance ----
        customLcdBg: '#1b1f2a',   // "Custom" theme colours
        customLcdFg: '#7df9ff',
        customCaseA: '#2b2f3a',
        customCaseB: '#10131a',
        wheelStyle: 'white',      // 'white' | 'graphite' | 'black'
        appBg: 'default',         // 'default' | 'black' | 'gradient' | 'custom'
        appBgColor: '#0b1020',
        scanlines: 40,            // 0 - 100 (%)
        lcdGlow: false,
        playerScale: 100,         // 70 - 130 (%), desktop layout only
        lyricSize: 100,           // 80 - 160 (%)
        lyricActiveColor: '#38bdf8',
        clickVolume: 100,         // 0 - 100 (%)
        perfMode: false           // no blur effects, visualizer capped at 30fps
    }
};

// Passcode required to disable the profanity filter (change this to your own)
const PROFANITY_PASSCODE = 'gagglesuckslol';
const SETTINGS_STORAGE_KEY = 'webPodSettings_v1';

// Persist / restore user settings so they survive reloads (esp. PWA on mobile)
function saveSettingsToStorage() {
    try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(state.settings));
    } catch (e) {
        console.warn('Could not save settings:', e);
    }
}

function loadSettingsFromStorage() {
    try {
        const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw);
        if (saved && typeof saved === 'object') {
            Object.keys(state.settings).forEach(k => {
                if (k in saved && typeof saved[k] === typeof state.settings[k]) {
                    state.settings[k] = saved[k];
                }
            });
        }
    } catch (e) {
        console.warn('Could not load settings:', e);
    }
}
loadSettingsFromStorage();

// Platform Detection Logic
const urlParams = new URLSearchParams(window.location.search);
const isForcedMobile = urlParams.has('mobile');
const isForcedPc = urlParams.has('pc');
const isMobilePlatform = isForcedMobile || (!isForcedPc && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent));

// Debounce handle for persisting lyric metadata to IndexedDB
let offsetSaveTimer = null;
// Low-latency lyric rAF handle
let lyricRafId = null;
// Web Audio API DSP Nodes
let audioCtx = null;
let audioElement = null;
let sourceNode = null;
let biquadFilters = [];    // 5-band Equalizer filters
let bassFilter = null;     // Lowshelf Bass Boost filter
let volumeGain = null;     // Master gain (supports amplification above 100%)
let analyserNode = null;   // Visualizer analyser
let isBassBoosted = false;
let currentObjectUrl = null; // active blob URL for the loaded track
// IndexedDB Storage Database Handle
let db = null;
const DB_NAME = 'webPodMemoryDB';
const DB_VERSION = 1;

// Setup layout based on platform
if (isMobilePlatform) {
    document.documentElement.classList.add('is-mobile');
    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('btnHamburger').classList.remove('hidden');
        document.getElementById('btnHamburger').classList.add('flex');
        document.getElementById('btnOpenSettings').classList.add('hidden');
        
        const dash = document.getElementById('panelDashboard');
        if (dash) {
            document.getElementById('mobileDashboardContainer').appendChild(dash);
            dash.classList.remove('min-w-[300px]', 'lg:max-w-md');
        }

        // The lyrics panel is hidden on mobile, so move the timing sliders into the menu
        const timingBox = document.getElementById('mobileLyricControls');
        ['lyricOffsetControl', 'lyricRateControl'].forEach(id => {
            const el = document.getElementById(id);
            if (el && timingBox) timingBox.appendChild(el);
        });

        // Mobile beta disclaimer (once per app launch)
        let seen = false;
        try { seen = sessionStorage.getItem('webPodBetaSeen') === '1'; } catch (e) {}
        if (!seen) {
            document.getElementById('modalMobileBeta')?.classList.remove('hidden');
        }
        document.getElementById('btnCloseMobileBeta')?.addEventListener('click', () => {
            document.getElementById('modalMobileBeta').classList.add('hidden');
            try { sessionStorage.setItem('webPodBetaSeen', '1'); } catch (e) {}
        });
    });
} else {
    document.documentElement.classList.add('is-pc');
}

// Generate PWA manifest dynamically
const manifestObj = {
    name: "webPod", short_name: "webPod", display: "standalone",
    start_url: window.location.href.split('?')[0], background_color: "#0f172a", theme_color: "#0f172a",
    icons: [{ src: "https://codehs.com/uploads/dd0e0dfb0e66f976a74ea5d1dac6e8eb", sizes: "192x192", type: "image/png" }]
};
window.addEventListener('DOMContentLoaded', () => {
    document.getElementById('manifestLink').href = 'data:application/manifest+json;charset=utf-8,' + encodeURIComponent(JSON.stringify(manifestObj));
});

// Load badwords.txt file for profanity filtering
async function loadBadWords() {
    try {
        // relative path so it also works when the app is not served from the site root
        const res = await fetch('./other/badwords.txt');
        if (res.ok) {
            const text = await res.text();
            state.badwords = text
                .split(',')
                .map(w => w.trim().toLowerCase())
                .filter(Boolean);
            buildBadwordRegex();
        }
    } catch (e) {
        console.warn('Could not load badwords.txt:', e);
    }
}

// One precompiled regex for the whole word list (the old code built a new RegExp
// for every word on every lyric line). Longest words first; results are cached.
let badwordRegex = null;
const profanityCache = new Map();
function buildBadwordRegex() {
    profanityCache.clear();
    const words = Array.from(new Set(state.badwords.filter(Boolean)))
        .sort((a, b) => b.length - a.length)
        .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    badwordRegex = words.length ? new RegExp(`\\b(?:${words.join('|')})\\b`, 'gi') : null;
}

// Censor a given text string using loaded badwords
function filterProfanity(text) {
    if (!text || !badwordRegex || state.settings.disableProfanityFilter) return text;
    const hit = profanityCache.get(text);
    if (hit !== undefined) return hit;
    const filtered = text.replace(badwordRegex, (match) => match.charAt(0) + '*'.repeat(match.length - 1));
    if (profanityCache.size > 3000) profanityCache.clear();
    profanityCache.set(text, filtered);
    return filtered;
}

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (e) => {
            const database = e.target.result;
            if (!database.objectStoreNames.contains('tracks')) {
                database.createObjectStore('tracks', { keyPath: 'id' });
            }
        };
        request.onsuccess = (e) => {
            db = e.target.result;
            resolve(db);
        };
        request.onerror = (e) => reject('IndexedDB error: ' + e.target.error);
    });
}

// Database helper functions
// Audio data (fileBuffer) lives only in IndexedDB; the in-memory playlist keeps
// metadata only, so RAM use no longer grows with the size of the library.
// The DB record format is unchanged (manager.html reads the same records).
async function saveTrackToDB(trackObj) {
    if (!db) return;
    return new Promise((resolve, reject) => {
        const tx = db.transaction('tracks', 'readwrite');
        const store = tx.objectStore('tracks');
        const hasBuffer = !!trackObj.fileBuffer;
        if (hasBuffer) {
            store.put(trackObj);
        } else {
            // metadata-only save: keep the audio that is already stored
            const getReq = store.get(trackObj.id);
            getReq.onsuccess = () => {
                const existing = getReq.result;
                store.put(existing && existing.fileBuffer ? { ...trackObj, fileBuffer: existing.fileBuffer } : trackObj);
            };
        }
        tx.oncomplete = () => {
            if (hasBuffer) trackObj.fileBuffer = null;   // free the copy held in memory
            resolve();
        };
        tx.onerror = () => reject(tx.error);
    });
}

// Reads every track but keeps only its metadata (one record in memory at a time)
async function loadTracksFromDB() {
    if (!db) return [];
    return new Promise((resolve) => {
        const out = [];
        const tx = db.transaction('tracks', 'readonly');
        const req = tx.objectStore('tracks').openCursor();
        req.onsuccess = () => {
            const cursor = req.result;
            if (!cursor) { resolve(out); return; }
            const { fileBuffer, ...meta } = cursor.value;
            if (!meta.size && fileBuffer) meta.size = fileBuffer.byteLength || 0;
            out.push(meta);
            cursor.continue();
        };
        req.onerror = () => resolve(out);
    });
}

// Fetch one track's audio data on demand
function getTrackBuffer(id) {
    if (!db) return Promise.resolve(null);
    return new Promise((resolve) => {
        const req = db.transaction('tracks', 'readonly').objectStore('tracks').get(id);
        req.onsuccess = () => resolve(req.result ? req.result.fileBuffer || null : null);
        req.onerror = () => resolve(null);
    });
}

async function clearTracksFromDB() {
    if (!db) return;
    const tx = db.transaction('tracks', 'readwrite');
    tx.objectStore('tracks').clear();
}

async function removeTrackFromDB(id) {
    if (!db) return;
    const tx = db.transaction('tracks', 'readwrite');
    tx.objectStore('tracks').delete(id);
}

function attachAudioElementEvents() {
    audioElement.addEventListener('timeupdate', onTimeUpdate);
    audioElement.addEventListener('ended', onTrackEnded);
    audioElement.addEventListener('play', () => {
        state.isPlaying = true;
        updateLcdUI();
        startLowLatencyLyricLoop();
        visSync();
    });
    audioElement.addEventListener('pause', () => {
        state.isPlaying = false;
        updateLcdUI();
        stopLowLatencyLyricLoop();
        visSync();
    });
    // Re-apply the chosen playback rate once media is ready (src changes reset it)
    audioElement.addEventListener('loadedmetadata', applyPlaybackRate);
}

function applyPlaybackRate() {
    if (!audioElement) return;
    const slider = document.getElementById('sliderSpeed');
    const rate = parseFloat(slider && slider.value) || 1.0;
    audioElement.defaultPlaybackRate = rate;
    audioElement.playbackRate = rate;
    audioElement.preservesPitch = true;
    audioElement.webkitPreservesPitch = true;
}

function initAudioEngine() {
    if (audioElement) return;
    // Create HTML audio element
    audioElement = new Audio();
    audioElement.crossOrigin = "anonymous";
    audioElement.preload = 'auto';
    applyAudioVolume();

    // MOBILE: play straight through the <audio> element. Routing through Web Audio
    // gets silenced when the app is backgrounded and breaks with playbackRate changes.
    if (isMobilePlatform) {
        attachAudioElementEvents();
        setupMediaSession();
        return;
    }

    // Create Web Audio Context
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContext();
    // Create Source Node
    sourceNode = audioCtx.createMediaElementSource(audioElement);
    // Create 5-band Equalizer
    const freqs = [60, 250, 1000, 4000, 12000];
    biquadFilters = freqs.map((f, index) => {
        const filter = audioCtx.createBiquadFilter();
        if (index === 0) filter.type = 'lowshelf';
        else if (index === freqs.length - 1) filter.type = 'highshelf';
        else filter.type = 'peaking';
        filter.frequency.value = f;
        filter.gain.value = 0;
        return filter;
    });
    // Create Dedicated Bass Boost Filter
    bassFilter = audioCtx.createBiquadFilter();
    bassFilter.type = 'lowshelf';
    bassFilter.frequency.value = 100;
    bassFilter.gain.value = 0;
    // Create Analyser Node for Visualizer
    analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 64;
    // Connect Web Audio Nodes Pipeline
    let previousNode = sourceNode;
    biquadFilters.forEach(filter => {
        previousNode.connect(filter);
        previousNode = filter;
    });
    previousNode.connect(bassFilter);
    bassFilter.connect(analyserNode);
    volumeGain = audioCtx.createGain();
    volumeGain.gain.value = Math.max(0.01, Math.min(2, (state.settings.audioVolume || 100) / 100));
    analyserNode.connect(volumeGain);
    volumeGain.connect(audioCtx.destination);
    visConfigureAnalyser();   // apply the chosen visualizer's fft size / smoothing
    // Audio Event Handlers
    attachAudioElementEvents();
    setupMediaSession();      // hardware media keys on desktop too
}

function applyAudioVolume() {
    const volume = Math.max(1, Math.min(200, Number(state.settings.audioVolume) || 100));
    state.settings.audioVolume = volume;
    if (volumeGain) volumeGain.gain.value = volume / 100;
    // The mobile direct playback path uses the native media volume (limited to 100%).
    if (audioElement && isMobilePlatform) audioElement.volume = Math.min(1, volume / 100);
}

// Lock-screen / notification controls so playback keeps going in the background
function setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    try {
        navigator.mediaSession.setActionHandler('play', () => { if (audioElement) audioElement.play().catch(console.error); });
        navigator.mediaSession.setActionHandler('pause', () => { if (audioElement) audioElement.pause(); });
        navigator.mediaSession.setActionHandler('previoustrack', () => playPrevTrack());
        navigator.mediaSession.setActionHandler('nexttrack', () => playNextTrack());
    } catch (e) {}
}

function updateMediaSessionMetadata(track) {
    if (!track || !('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    try {
        navigator.mediaSession.metadata = new MediaMetadata({ title: track.title || 'Unknown', artist: track.artist || '' });
    } catch (e) {}
}

// Keep UI in sync with the real audio state when returning from the background
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !audioElement) return;
    if (audioCtx && audioCtx.state === 'suspended' && !audioElement.paused) audioCtx.resume();
    state.isPlaying = !audioElement.paused;
    updateLcdUI();
    renderPlaylist();
    if (state.isPlaying) startLowLatencyLyricLoop();
    onTimeUpdate();
});

// Synthesizer click sound for tactile wheel feedback
let clickCtx = null; // one shared context for clicks made before the audio engine exists
function playWheelClickSound() {
    if (!state.settings.clickSound) return;
    // Mobile: a separate AudioContext can interrupt/mute media playback, so skip it
    if (isMobilePlatform) return;
    const vol = Math.max(0, Math.min(1, (state.settings.clickVolume ?? 100) / 100));
    if (vol === 0) return;
    try {
        // (the old code created a brand-new AudioContext on every click before first play)
        const ctx = audioCtx || clickCtx || (clickCtx = new (window.AudioContext || window.webkitAudioContext)());
        if (ctx.state === 'suspended') ctx.resume();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1200, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.03);
        gain.gain.setValueAtTime(0.15 * vol, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, 0.01 * vol), ctx.currentTime + 0.03);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.03);
    } catch (e) {
        // AudioContext silent fail
    }
}

// Keyboard Arrow Key Mapping to Click Wheel Dial
function setupKeyboardControls() {
    window.addEventListener('keydown', (e) => {
        // Skip hotkeys if focused in text inputs
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'SELECT' || activeEl.tagName === 'TEXTAREA')) {
            return;
        }
        switch (e.key) {
            case 'ArrowUp':
                e.preventDefault();
                playWheelClickSound();
                handleWheelAction('menu');
                break;
            case 'ArrowDown':
                e.preventDefault();
                playWheelClickSound();
                handleWheelAction('playpause');
                break;
            case 'ArrowLeft':
                e.preventDefault();
                playWheelClickSound();
                handleWheelAction('prev');
                break;
            case 'ArrowRight':
                e.preventDefault();
                playWheelClickSound();
                handleWheelAction('next');
                break;
            case ' ':
            case 'Enter':
                e.preventDefault();
                playWheelClickSound();
                handleWheelAction('center');
                break;
        }
    });
}

// Click Wheel Action Dispatcher
function handleWheelAction(action) {
    switch (action) {
        case 'menu':
            // Scroll to playlist panel or toggle UI focus
            if (isMobilePlatform) {
                document.getElementById('mobileMenuOverlay').classList.remove('hidden');
            } else {
                const playlistEl = document.getElementById('playlistContainer');
                if (playlistEl) playlistEl.scrollIntoView({ behavior: 'smooth' });
            }
            break;
        case 'playpause':
            togglePlayPause();
            break;
        case 'next':
            playNextTrack();
            break;
        case 'prev':
            // Rewind to track start if played for > 3s, else go to previous track
            if (audioElement && audioElement.currentTime > 3) {
                audioElement.currentTime = 0;
            } else {
                playPrevTrack();
            }
            break;
        case 'center':
            if (state.playlist.length === 0) return;
            if (state.currentIndex === -1) {
                loadAndPlayTrack(0);
            } else {
                togglePlayPause();
            }
            break;
    }
}

function togglePlayPause() {
    if (state.playlist.length === 0) return;
    if (state.currentIndex === -1) {
        loadAndPlayTrack(0);
        return;
    }
    if (!audioElement) initAudioEngine();
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    if (audioElement.paused) {
        audioElement.play().catch(console.error);
    } else {
        audioElement.pause();
    }
}

function playNextTrack() {
    if (state.playlist.length === 0) return;
    let nextIndex;
    if (state.isShuffle) {
        nextIndex = Math.floor(Math.random() * state.playlist.length);
    } else {
        nextIndex = (state.currentIndex + 1) % state.playlist.length;
    }
    loadAndPlayTrack(nextIndex);
}

function playPrevTrack() {
    if (state.playlist.length === 0) return;
    let prevIndex = state.currentIndex - 1;
    if (prevIndex < 0) prevIndex = state.playlist.length - 1;
    loadAndPlayTrack(prevIndex);
}

function onTrackEnded() {
    if (state.loopMode === 'one') {
        audioElement.currentTime = 0;
        audioElement.play();
    } else if (state.loopMode === 'all' || state.currentIndex < state.playlist.length - 1) {
        playNextTrack();
    } else {
        state.isPlaying = false;
        stopLowLatencyLyricLoop();
        updateLcdUI();
        visSync();
    }
}

let playRequestId = 0; // guards against rapid track switches while audio is read from the DB
async function loadAndPlayTrack(index) {
    if (index < 0 || index >= state.playlist.length) return;
    const requestId = ++playRequestId;

    if (!audioElement) initAudioEngine();
    if (audioCtx && audioCtx.state === 'suspended') await audioCtx.resume();
    if (requestId !== playRequestId) return;
    state.currentIndex = index;
    const track = state.playlist[index];

    // Restore per-track lyric offset and caption speed rate
    state.lyricOffset = typeof track.lyricOffset === 'number' ? track.lyricOffset : 0.0;
    state.captionSpeed = typeof track.captionSpeed === 'number' ? track.captionSpeed : 1.0;
    
    const sliderOffset = document.getElementById('sliderLyricOffset');
    const txtOffset = document.getElementById('txtLyricOffsetVal');
    if (sliderOffset) sliderOffset.value = String(state.lyricOffset);
    if (txtOffset) {
        const val = state.lyricOffset;
        txtOffset.textContent = (val > 0 ? `+${val.toFixed(1)}s` : `${val.toFixed(1)}s`);
    }

    const sliderCaptionSpeed = document.getElementById('sliderCaptionSpeed');
    const txtCaptionSpeed = document.getElementById('txtCaptionSpeedVal');
    if (sliderCaptionSpeed) sliderCaptionSpeed.value = String(state.captionSpeed);
    if (txtCaptionSpeed) txtCaptionSpeed.textContent = `${state.captionSpeed.toFixed(2)}x`;

    // Convert stored ArrayBuffer back into an Object URL. The audio data is read from
    // IndexedDB only now, for this one track (it is not kept in memory for the whole library).
    let srcUrl = track.url;
    let buffer = track.fileBuffer || null;
    if (!buffer && !track.url) {
        updateLcdUI();   // show the title immediately while the file is read
        buffer = await getTrackBuffer(track.id);
        if (requestId !== playRequestId) return;
    }
    if (buffer) {
        const blob = new Blob([buffer], { type: track.mimeType || 'audio/mp3' });
        srcUrl = URL.createObjectURL(blob);
    }
    const prevObjectUrl = currentObjectUrl;
    currentObjectUrl = buffer ? srcUrl : null;
    audioElement.src = srcUrl;
    if (prevObjectUrl) setTimeout(() => URL.revokeObjectURL(prevObjectUrl), 2000);
    applyPlaybackRate();
    updateMediaSessionMetadata(track);
    
    try {
        await audioElement.play();
        state.isPlaying = true;
        startLowLatencyLyricLoop();
    } catch (err) {
        console.error("Playback start error:", err);
    }
    visSync();
    updateLcdUI();
    renderPlaylist();
    // Fetch or load captions/lyrics for new track
    if (track.customLyrics && track.customLyrics.length > 0) {
        state.currentLyrics = track.customLyrics;
        state.activeLyricIndex = -1;
        renderLyrics();
        const srcLabel = track.lyricsSource === 'lrclib'
            ? (track.lrclibId != null ? `LRCLIB #${track.lrclibId}` : 'LRCLIB')
            : (track.lyricsSource === 'custom' ? 'Attached File' : 'Synced');
        setLyricStatus(srcLabel, 'emerald');
        const trackNameTag = document.getElementById('lyricCurrentTrackName');
        if (trackNameTag) trackNameTag.textContent = `${track.title} - ${track.artist || 'Unknown'}`;
        updateLcdUI();
    } else {
        fetchOnlineLyrics(track.title, track.artist);
    }
}

/** Persist lyricOffset and captionSpeed for current track to IndexedDB */
async function persistCurrentTrackMeta() {
    if (state.currentIndex < 0 || state.currentIndex >= state.playlist.length) return;
    const track = state.playlist[state.currentIndex];
    track.lyricOffset = state.lyricOffset;
    track.captionSpeed = state.captionSpeed;
    await saveTrackToDB(track);
}

async function fetchOnlineLyrics(title, artist) {
    state.currentLyrics = [];
    state.activeLyricIndex = -1;
    
    const lyricsContainer = document.getElementById('lyricsContainer');
    const syncTag = document.getElementById('lyricSyncStatus');
    const trackNameTag = document.getElementById('lyricCurrentTrackName');
    
    if (trackNameTag) trackNameTag.textContent = `${title} - ${artist || 'Unknown'}`;
    if (syncTag) {
        syncTag.textContent = 'Searching...';
        syncTag.className = 'text-[10px] text-amber-400 bg-amber-950/80 px-2 py-0.5 rounded border border-amber-800/60';
    }
    if (lyricsContainer) {
        lyricsContainer.innerHTML = `
            <div class="m-auto text-center space-y-2 text-slate-500 animate-pulse">
                <i class="fa-solid fa-spinner fa-spin text-2xl text-cyan-400"></i>
                <p class="text-xs">Fetching synchronized lyrics...</p>
            </div>
        `;
    }
    // Provider Choice
    if (state.settings.lyricsApi === 'musixmatch') {
        await fetchMusixmatchLyrics(title, artist);
    } else {
        await fetchLrclibLyrics(title, artist);
    }
}

// Fetch from LRCLIB API
async function fetchLrclibLyrics(title, artist) {
    try {
        const query = encodeURIComponent(`${title} ${artist !== 'Unknown Artist' ? artist : ''}`.trim());
        const res = await fetch(`https://lrclib.net/api/search?q=${query}`, {
            headers: { 'User-Agent': 'webPod/1.0 (https://example.com)' }
        });
        if (!res.ok) throw new Error('Network response not ok');
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
            // Find best matching record with synced lyrics
            const match = data.find(item => item.hasWordSync && item.lyricsfile) || data.find(item => item.lyricsfile) || data.find(item => item.syncedLyrics) || data[0];
            if (match && match.lyricsfile) {
                const lyricsFileLines = parseLyricsFile(match.lyricsfile);
                if (lyricsFileLines.length) {
                    state.currentLyrics = lyricsFileLines;
                    renderLyrics();
                    setLyricStatus(match.hasWordSync ? 'LRCLIB Word Sync' : 'LRCLIB Lyricsfile', 'emerald');
                    if (state.currentIndex >= 0 && state.currentIndex < state.playlist.length) {
                        const track = state.playlist[state.currentIndex];
                        track.customLyrics = state.currentLyrics;
                        track.lyricsSource = 'lrclib';
                        track.lrclibId = match.id != null ? match.id : null;
                        track.lyricOffset = state.lyricOffset;
                        track.captionSpeed = state.captionSpeed;
                        await saveTrackToDB(track);
                    }
                    updateLcdUI();
                    return;
                }
            }
            if (match && match.syncedLyrics) {
                state.currentLyrics = parseLrcLyrics(match.syncedLyrics);
                renderLyrics();
                setLyricStatus(match.id != null ? `LRCLIB #${match.id}` : 'Synced', 'emerald');
                if (state.currentIndex >= 0 && state.currentIndex < state.playlist.length) {
                    const track = state.playlist[state.currentIndex];
                    track.customLyrics = state.currentLyrics;
                    track.lyricsSource = 'lrclib';
                    track.lrclibId = match.id != null ? match.id : null;
                    track.lyricOffset = state.lyricOffset;
                    track.captionSpeed = state.captionSpeed;
                    await saveTrackToDB(track);
                }
                updateLcdUI();
                return;
            } else if (match && match.plainLyrics) {
                state.currentLyrics = match.plainLyrics.split('\n').filter(l => l.trim()).map(line => ({ time: 0, text: line.trim() }));
                renderLyrics();
                setLyricStatus('Unsynced', 'amber');
                if (state.currentIndex >= 0 && state.currentIndex < state.playlist.length) {
                    const track = state.playlist[state.currentIndex];
                    track.customLyrics = state.currentLyrics;
                    track.lyricsSource = 'lrclib';
                    track.lrclibId = match.id != null ? match.id : null;
                    track.lyricOffset = state.lyricOffset;
                    track.captionSpeed = state.captionSpeed;
                    await saveTrackToDB(track);
                }
                updateLcdUI();
                return;
            }
        }
    } catch (e) {
        console.warn('LRCLIB fetch error:', e);
    }
    setLyricNotFound();
}

// Fetch from Musixmatch API
async function fetchMusixmatchLyrics(title, artist) {
    const apiKey = state.settings.musixmatchKey || '2d83080e77d20a0305a49704041d8e57';
    const corsProxy = 'https://corsproxy.io/?';
    const apiUrl = `https://api.musixmatch.com/ws/1.1/matcher.lyrics.get?q_track=${encodeURIComponent(title)}&q_artist=${encodeURIComponent(artist)}&apikey=${apiKey}`;
    try {
        const res = await fetch(corsProxy + encodeURIComponent(apiUrl));
        const data = await res.json();
        
        if (data.message && data.message.body && data.message.body.lyrics) {
            const body = data.message.body.lyrics.lyrics_body;
            state.currentLyrics = body.split('\n').filter(l => l.trim() && !l.includes('*******')).map(line => ({ time: 0, text: line.trim() }));
            renderLyrics();
            setLyricStatus('Plain Lyrics', 'amber');
            if (state.currentIndex >= 0 && state.currentIndex < state.playlist.length) {
                const track = state.playlist[state.currentIndex];
                track.customLyrics = state.currentLyrics;
                track.lyricsSource = 'musixmatch';
                track.lrclibId = null;
                track.lyricOffset = state.lyricOffset;
                track.captionSpeed = state.captionSpeed;
                await saveTrackToDB(track);
            }
            updateLcdUI();
            return;
        }
    } catch (e) {
        console.warn('Musixmatch fetch error:', e);
    }
    setLyricNotFound();
}

function setLyricStatus(text, color) {
    const syncTag = document.getElementById('lyricSyncStatus');
    if (!syncTag) return;
    syncTag.textContent = text;
    if (color === 'emerald') {
        syncTag.className = 'text-[10px] text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800/60';
    } else {
        syncTag.className = 'text-[10px] text-amber-400 bg-amber-950/80 px-2 py-0.5 rounded border border-amber-800/60';
    }
}

function setLyricNotFound() {
    const lyricsContainer = document.getElementById('lyricsContainer');
    const syncTag = document.getElementById('lyricSyncStatus');
    if (syncTag) {
        syncTag.textContent = 'No Lyrics';
        syncTag.className = 'text-[10px] text-slate-400 bg-slate-800 px-2 py-0.5 rounded border border-slate-700';
    }
    if (lyricsContainer) {
        lyricsContainer.className = 'flex-1 p-6 overflow-y-auto space-y-4 text-center text-sm sm:text-base text-slate-400 scroll-smooth flex flex-col items-center';
        lyricsContainer.innerHTML = `
            <div class="m-auto text-center space-y-2 text-slate-500">
                <i class="fa-solid fa-face-frown text-2xl text-slate-600"></i>
                <p class="text-xs">No online lyrics found.</p>
                <div class="flex gap-2 justify-center mt-2">
                    <button onclick="triggerCaptionUpload()" class="text-[11px] text-cyan-400 hover:underline">Upload .SRT / .LRC</button>
                    <button onclick="openLyricPasteModal()" class="text-[11px] text-cyan-400 hover:underline">Paste lyrics</button>
                </div>
            </div>
        `;
    }
    updateLcdUI();
}

// Parse LRCLIB Lyricsfile YAML (v1.0), including line and word timestamps.
function parseYamlScalar(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    if (raw.startsWith('"')) {
        try { return JSON.parse(raw); } catch (e) { return raw.slice(1, raw.endsWith('"') ? -1 : undefined); }
    }
    if (raw.startsWith("'")) return raw.slice(1, raw.endsWith("'") ? -1 : undefined).replace(/''/g, "'");
    return raw.replace(/\s+#.*$/, '').trim();
}

function parseLyricsFile(yamlText) {
    const source = String(yamlText || '').replace(/\r/g, '').split('\n');
    const result = [];
    let currentLine = null, currentWord = null, inLines = false, inWords = false;

    const finishWord = () => {
        if (!currentLine || !currentWord || !currentWord.text) { currentWord = null; return; }
        const start = Number(currentWord.start_ms);
        if (Number.isFinite(start)) currentLine.words.push({
            text: currentWord.text, time: start / 1000,
            endTime: Number.isFinite(Number(currentWord.end_ms)) ? Number(currentWord.end_ms) / 1000 : null
        });
        currentWord = null;
    };
    const finishLine = () => {
        finishWord();
        if (!currentLine) return;
        const start = Number(currentLine.start_ms), end = Number(currentLine.end_ms);
        const words = currentLine.words || [];
        const text = currentLine.text || words.map(w => w.text).join('');
        if (text && Number.isFinite(start)) result.push({
            time: start / 1000, endTime: Number.isFinite(end) ? end / 1000 : null,
            text, words: words.length ? words : null
        });
        currentLine = null;
    };

    for (const rawLine of source) {
        if (/^lines:\s*$/.test(rawLine)) { inLines = true; continue; }
        if (!inLines) continue;
        if (/^\S/.test(rawLine) && rawLine.trim() && !rawLine.startsWith('lines:')) break;

        let match;
        if ((match = rawLine.match(/^  -\s+text:\s*(.*)$/))) {
            finishLine();
            currentLine = { text: parseYamlScalar(match[1]), words: [] };
            inWords = false;
            continue;
        }
        if (!currentLine) continue;
        if ((match = rawLine.match(/^\s{4}start_ms:\s*(.+?)\s*$/))) {
            currentLine.start_ms = Number(parseYamlScalar(match[1])); continue;
        }
        if ((match = rawLine.match(/^\s{4}end_ms:\s*(.+?)\s*$/))) {
            currentLine.end_ms = Number(parseYamlScalar(match[1])); continue;
        }
        if (/^\s{4}words:\s*$/.test(rawLine)) { inWords = true; continue; }
        if (inWords && (match = rawLine.match(/^\s{6}-\s+text:\s*(.*)$/))) {
            finishWord(); currentWord = { text: parseYamlScalar(match[1]) }; continue;
        }
        if (inWords && currentWord && (match = rawLine.match(/^\s{8}start_ms:\s*(.+?)\s*$/))) {
            currentWord.start_ms = Number(parseYamlScalar(match[1])); continue;
        }
        if (inWords && currentWord && (match = rawLine.match(/^\s{8}end_ms:\s*(.+?)\s*$/))) {
            currentWord.end_ms = Number(parseYamlScalar(match[1]));
        }
    }
    finishLine();

    if (!result.length) {
        const plainIndex = source.findIndex(line => /^plain:\s*\|\s*$/.test(line));
        if (plainIndex >= 0) {
            const plainLines = [];
            for (let i = plainIndex + 1; i < source.length; i++) {
                if (/^\S/.test(source[i]) && source[i].trim()) break;
                const value = source[i].replace(/^\s{2}/, '');
                if (value.trim()) plainLines.push(value);
            }
            return plainLines.map(text => ({ time: 0, text: text.trim(), words: null }));
        }
    }
    return result.sort((a, b) => a.time - b.time);
}

// Parse LRC and SRT timecode formats
function parseLrcLyrics(lrcText) {
    const lines = lrcText.split(/\r?\n/);
    const result = [];
    const lrcRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;
    lines.forEach(line => {
        const text = line.replace(lrcRegex, '').trim();
        if (!text) return;
        let match;
        const times = [];
        while ((match = lrcRegex.exec(line)) !== null) {
            const minutes = parseInt(match[1], 10);
            const seconds = parseInt(match[2], 10);
            let millis = 0;
            if (match[3]) {
                millis = parseInt(match[3].padEnd(3, '0').slice(0, 3), 10);
            }
            const time = minutes * 60 + seconds + millis / 1000;
            times.push(time);
        }
        lrcRegex.lastIndex = 0;
        times.forEach(t => {
            result.push({ time: t, text });
        });
    });
    return result.sort((a, b) => a.time - b.time);
}

function parseSrtCaptions(srtText) {
    const normalized = srtText.trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const blocks = normalized.split(/\n\s*\n/);
    const result = [];
    const srtRegex = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;
    blocks.forEach(block => {
        const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length < 2) return;
        let timeLine = lines[0];
        let textStart = 1;
        if (/^\d+$/.test(lines[0]) && lines.length >= 3) {
            timeLine = lines[1];
            textStart = 2;
        }
        const timeMatch = srtRegex.exec(timeLine);
        if (timeMatch) {
            const hours = parseInt(timeMatch[1], 10);
            const minutes = parseInt(timeMatch[2], 10);
            const seconds = parseInt(timeMatch[3], 10);
            const millis = parseInt(timeMatch[4].padEnd(3, '0').slice(0, 3), 10);
            const time = hours * 3600 + minutes * 60 + seconds + millis / 1000;
            const text = lines.slice(textStart).join(' ').trim();
            if (text) result.push({ time, text });
        }
    });
    return result.sort((a, b) => a.time - b.time);
}

function detectAndParseLyrics(text, preferredFormat) {
    const trimmed = (text || '').trim();
    if (!trimmed) return [];
    if (preferredFormat === 'lrc') return parseLrcLyrics(trimmed);
    if (preferredFormat === 'srt') return parseSrtCaptions(trimmed);
    if (preferredFormat === 'yml' || preferredFormat === 'yaml') return parseLyricsFile(trimmed);
    if (/^version:\s*['"]?1\.0/m.test(trimmed) && /^lines:\s*$/m.test(trimmed)) {
        return parseLyricsFile(trimmed);
    }
    if (/\[\d{1,2}:\d{2}/.test(trimmed)) {
        return parseLrcLyrics(trimmed);
    }
    if (/\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->/.test(trimmed)) {
        return parseSrtCaptions(trimmed);
    }
    return trimmed.split(/\r?\n/).filter(l => l.trim()).map(line => ({ time: 0, text: line.trim() }));
}

function setLyricsViewMode(mode) {
    if (mode !== 'list' && mode !== 'preview') return;
    state.lyricsViewMode = mode;
    const btnList = document.getElementById('btnViewList');
    const btnPrev = document.getElementById('btnViewPreview');
    if (btnList && btnPrev) {
        if (mode === 'list') {
            btnList.classList.add('active');
            btnPrev.classList.remove('active');
        } else {
            btnPrev.classList.add('active');
            btnList.classList.remove('active');
        }
    }
    if (state.currentLyrics.length > 0) {
        renderLyrics();
        state.activeLyricIndex = -1;
        if (audioElement) onTimeUpdate();
    } else {
        setLyricNotFound();
    }
}

function renderLyrics() {
    const lyricsContainer = document.getElementById('lyricsContainer');
    if (!lyricsContainer) return;
    if (state.currentLyrics.length === 0) {
        setLyricNotFound();
        return;
    }
    state.activeLyricIndex = -1;

    if (state.lyricsViewMode === 'preview') {
        const lcd = document.getElementById('lcdDisplay');
        const themeClass = lcd
            ? (Array.from(lcd.classList).find(c => c.startsWith('theme-')) || 'theme-classic')
            : 'theme-classic';
        lyricsContainer.className = 'flex-1 p-3 overflow-hidden flex flex-col items-stretch';
        lyricsContainer.innerHTML = `
            <div class="lcd-preview-stage ${themeClass} flex-1">
                <div class="scanlines absolute inset-0 pointer-events-none opacity-40"></div>
                <div class="lcd-preview-caption" id="fnfPreviewText"></div>
            </div>
            <p class="text-[10px] text-slate-500 text-center mt-2 font-lcd tracking-wide">Live LCD Caption — syncs with playback</p>
        `;
        return;
    }

    lyricsContainer.className = 'flex-1 p-6 overflow-y-auto space-y-4 text-center text-sm sm:text-base text-slate-400 scroll-smooth flex flex-col items-center';
    lyricsContainer.innerHTML = '';
    lyricLineEls = null;
    const lyricFrag = document.createDocumentFragment(); // single DOM insertion instead of one per line
    state.currentLyrics.forEach((lyric, idx) => {
        const lineEl = document.createElement('div');
        lineEl.className = 'lyric-line transition-all duration-200 cursor-pointer py-1.5 px-3 rounded-lg text-slate-400 hover:text-slate-200';
        lineEl.dataset.index = idx;
        if (Array.isArray(lyric.words) && lyric.words.length) {
            lyric.words.forEach(word => {
                const span = document.createElement('span');
                span.className = 'lyric-word';
                span.textContent = filterProfanity(word.text);
                lineEl.appendChild(span);
            });
        } else {
            lineEl.textContent = filterProfanity(lyric.text);
        }
        lineEl.onclick = () => {
            if (audioElement && lyric.time > 0) {
                audioElement.currentTime = Math.max(0, (lyric.time / state.captionSpeed) - state.lyricOffset);
            }
        };
        lyricFrag.appendChild(lineEl);
    });
    lyricsContainer.appendChild(lyricFrag);
    lyricLineEls = Array.from(lyricsContainer.children);
}

function getVisibleWordText(lyric, effectiveTime) {
    if (!lyric || !Array.isArray(lyric.words) || !lyric.words.length) return lyric ? lyric.text : '';
    return lyric.words.filter(word => effectiveTime >= word.time).map(word => word.text).join('');
}

function updatePreviewCaption(activeIdx, effectiveTime = 0) {
    const el = document.getElementById('fnfPreviewText');
    const mobEl = document.getElementById('mobileFnfPreviewText');
    const lyric = activeIdx >= 0 ? state.currentLyrics[activeIdx] : null;
    const filteredText = filterProfanity(lyric ? getVisibleWordText(lyric, effectiveTime) : '');
    if (el && el.textContent !== filteredText) el.textContent = filteredText;
    if (mobEl && mobEl.textContent !== filteredText) {
        mobEl.textContent = filteredText;
        fitMobilePreviewText();
    }
}

function updateActiveWord(activeIdx, effectiveTime) {
    if (activeIdx < 0) return;
    const lyric = state.currentLyrics[activeIdx];
    if (!lyric || !Array.isArray(lyric.words) || !lyric.words.length) return;
    const container = document.getElementById('lyricsContainer');
    const line = container && container.querySelector(`.lyric-line[data-index="${activeIdx}"]`);
    if (!line) return;
    const wordIndex = lyric.words.reduce((found, word, index) => effectiveTime >= word.time ? index : found, -1);
    line.querySelectorAll('.lyric-word').forEach((span, index) => {
        span.classList.toggle('word-active', index === wordIndex);
        span.classList.toggle('word-past', index < wordIndex);
    });
}

// Size the mobile LCD caption so the lyrics strip is only as tall as its text needs,
// shrinking the font if the text would take more than ~22% of the screen height.
function fitMobilePreviewText() {
    const el = document.getElementById('mobileFnfPreviewText');
    if (!el) return;
    const box = el.parentElement;
    if (!box || !box.clientWidth) return;
    const maxH = Math.max(48, Math.floor(window.innerHeight * 0.22));
    let size = Math.max(14, Math.min(30, Math.round(window.innerHeight * 0.04)));
    el.style.fontSize = size + 'px';
    el.style.lineHeight = '1.1';
    while (size > 11 && (el.scrollHeight > maxH || el.scrollWidth > box.clientWidth)) {
        size -= 1;
        el.style.fontSize = size + 'px';
    }
}
window.addEventListener('resize', () => { if (isMobilePlatform) fitMobilePreviewText(); });
window.addEventListener('orientationchange', () => { if (isMobilePlatform) setTimeout(fitMobilePreviewText, 250); });

// Index of the last lyric whose time is <= t (lyrics are always sorted by time).
// Checks the current line / next line first, which is the common case while playing,
// and falls back to a binary search after seeks.
let lyricLineEls = null; // cached .lyric-line elements for the list view
function findActiveLyricIndex(t) {
    const L = state.currentLyrics, n = L.length;
    const i = state.activeLyricIndex;
    if (i >= -1 && i < n) {
        const curOk = i === -1 ? L[0].time > t : L[i].time <= t;
        if (curOk && (i + 1 >= n || L[i + 1].time > t)) return i;
    }
    let lo = 0, hi = n - 1, ans = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (L[mid].time <= t) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    return ans;
}

// Fast lyric-only update using offset and independent captionSpeed multiplier
function updateLyricsOnly() {
    if (!audioElement || state.currentLyrics.length === 0) return;
    const effectiveTime = (audioElement.currentTime + state.lyricOffset) * state.captionSpeed;
    const activeIdx = findActiveLyricIndex(effectiveTime);
    if (activeIdx === state.activeLyricIndex) {
        if (state.lyricsViewMode === 'preview' || isMobilePlatform) updatePreviewCaption(activeIdx, effectiveTime);
        else updateActiveWord(activeIdx, effectiveTime);
        return;
    }
    const prevIdx = state.activeLyricIndex;
    state.activeLyricIndex = activeIdx;

    if (state.lyricsViewMode === 'preview' || isMobilePlatform) {
        updatePreviewCaption(activeIdx, effectiveTime);
    } else {
        updateActiveWord(activeIdx, effectiveTime);
    }
    if (state.lyricsViewMode === 'preview' && !isMobilePlatform) return;
    // Mobile: the list panel is hidden; skip list scrolling/zooming entirely
    if (isMobilePlatform) return;

    const container = document.getElementById('lyricsContainer');
    if (!container) return;
    // reuse the cached line elements (rebuilt if the DOM was replaced)
    let lines = lyricLineEls;
    if (!lines || lines.length !== state.currentLyrics.length || !(lines[0] && lines[0].isConnected)) {
        lines = lyricLineEls = Array.from(container.querySelectorAll('.lyric-line'));
    }
    if (prevIdx >= 0 && lines[prevIdx]) {
        lines[prevIdx].classList.remove('active');
    }
    if (activeIdx >= 0 && lines[activeIdx]) {
        lines[activeIdx].classList.add('active');
        const behavior = state.settings.lowLatencyLyrics ? 'auto' : 'smooth';
        lines[activeIdx].scrollIntoView({ behavior, block: 'center' });
    }
}

function startLowLatencyLyricLoop() {
    if (lyricRafId !== null || !state.settings.lowLatencyLyrics) return;
    const tick = () => {
        if (!state.settings.lowLatencyLyrics || !state.isPlaying || !audioElement) {
            lyricRafId = null;
            return;
        }
        updateLyricsOnly();
        lyricRafId = requestAnimationFrame(tick);
    };
    lyricRafId = requestAnimationFrame(tick);
}

function stopLowLatencyLyricLoop() {
    if (lyricRafId !== null) {
        cancelAnimationFrame(lyricRafId);
        lyricRafId = null;
    }
}

function onTimeUpdate() {
    if (!audioElement) return;
    const currentTime = audioElement.currentTime;
    const duration = audioElement.duration || 0;
    const progressFill = document.getElementById('lcdProgressFill');
    const txtCurrentTime = document.getElementById('lcdCurrentTime');
    const txtDuration = document.getElementById('lcdDuration');
    if (progressFill && duration > 0) {
        const pct = (currentTime / duration) * 100;
        progressFill.style.width = `${pct}%`;
    }
    if (txtCurrentTime) txtCurrentTime.textContent = formatTime(currentTime);
    if (txtDuration) txtDuration.textContent = formatTime(duration);
    if (!state.settings.lowLatencyLyrics) {
        updateLyricsOnly();
    }
}

// (visualizer drawing now lives in other/visualizer.js)

function updateLcdUI() {
    const track = state.playlist[state.currentIndex];
    const titleEl = document.getElementById('lcdTrackTitle');
    const artistEl = document.getElementById('lcdArtistName');
    const playIcon = document.getElementById('lcdPlayIcon');
    const repeatIcon = document.getElementById('lcdRepeatIcon');
    const shuffleIcon = document.getElementById('lcdShuffleIcon');
    if (titleEl) titleEl.textContent = track ? track.title : 'No Song Loaded';
    if (artistEl) artistEl.textContent = track ? track.artist : 'Select or Upload Music';
    if (playIcon) {
        playIcon.className = state.isPlaying ? 'fa-solid fa-pause text-[10px]' : 'fa-solid fa-play text-[10px]';
    }
    if (repeatIcon) {
        repeatIcon.style.opacity = state.loopMode !== 'off' ? '1' : '0.3';
    }
    if (shuffleIcon) {
        shuffleIcon.style.opacity = state.isShuffle ? '1' : '0.3';
    }
    
    // Handle Mobile dynamic lyrics split screen
    if (isMobilePlatform) {
        const bottomHalf = document.getElementById('lcdBottomHalf');
        const topHalf = document.getElementById('lcdTopHalf');
        if (bottomHalf && topHalf) {
            if (state.settings.showLyrics && state.currentLyrics && state.currentLyrics.length > 0) {
                bottomHalf.classList.remove('hidden');
                bottomHalf.classList.add('flex');
                topHalf.classList.remove('h-full');
                topHalf.classList.add('h-1/2');
                fitMobilePreviewText();
            } else {
                bottomHalf.classList.add('hidden');
                bottomHalf.classList.remove('flex');
                topHalf.classList.add('h-full');
                topHalf.classList.remove('h-1/2');
            }
        }
    }
}

function renderPlaylist() {
    const container = document.getElementById('playlistContainer');
    if (!container) return;
    if (state.playlist.length === 0) {
        container.innerHTML = `
            <div class="h-full flex flex-col items-center justify-center text-slate-500 text-xs py-8">
                <i class="fa-solid fa-folder-open text-2xl mb-2"></i>
                <p>Your library is empty.</p>
                <p class="text-[10px] text-slate-600">Upload audio files below to save to webPod memory.</p>
            </div>
        `;
        return;
    }
    container.innerHTML = '';
    state.playlist.forEach((track, index) => {
        const item = document.createElement('div');
        const isActive = index === state.currentIndex;
        item.className = `flex items-center justify-between p-2.5 rounded-xl border text-xs transition cursor-pointer ${
            isActive 
                ? 'bg-cyan-950/60 border-cyan-500/80 text-white font-semibold shadow-md' 
                : 'bg-slate-950/40 border-slate-800/80 text-slate-300 hover:bg-slate-800/50'
        }`;
        item.innerHTML = `
            <div class="flex items-center gap-2.5 truncate flex-1 mr-2" onclick="loadAndPlayTrack(${index}); if(isMobilePlatform) document.getElementById('mobileMenuOverlay').classList.add('hidden');">
                <i class="${isActive && state.isPlaying ? 'fa-solid fa-volume-high text-cyan-400 animate-pulse' : 'fa-solid fa-music text-slate-500'} text-xs"></i>
                <div class="truncate">
                    <p class="truncate font-medium">${escapeHtml(track.title)}</p>
                    <p class="text-[10px] text-slate-500 truncate">${escapeHtml(track.artist)}</p>
                </div>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
                <button title="Attach custom .srt / .lrc captions" onclick="event.stopPropagation(); attachSrtToTrack(${index})" class="text-slate-400 hover:text-cyan-400 p-1 text-xs hidden-on-mobile">
                    <i class="fa-solid fa-file-lines"></i>
                </button>
                <button title="Remove track" onclick="event.stopPropagation(); deleteTrack(${index})" class="text-slate-500 hover:text-rose-400 p-1 text-xs">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
        `;
        container.appendChild(item);
    });
    updateStorageStats();
}

// Manager ZIP Import Logic for Main App
async function importZipToMain(file) {
    if (!file || typeof JSZip === 'undefined') {
        alert("JSZip not loaded or no file provided");
        return;
    }
    try {
        const zip = await JSZip.loadAsync(file);
        const manifestFile = zip.file('manifest.json');
        if (!manifestFile) throw new Error('manifest.json not found in ZIP');

        const manifest = JSON.parse(await manifestFile.async('string'));
        if (!manifest || !Array.isArray(manifest.tracks)) throw new Error('Invalid manifest');

        const list = manifest.tracks;
        let imported = 0;

        for (let i = 0; i < list.length; i++) {
            const meta = list[i];
            if (!meta.id) continue;

            let fileBuffer = null;
            let audioEntry = zip.file(meta.audioFile || `audio/${meta.id}`);
            if (!audioEntry) {
                const sanitizeFileName = (name) => String(name || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
                const candidates = Object.keys(zip.files).filter(p => p.startsWith('audio/') && p.includes(sanitizeFileName(meta.id)));
                if (candidates.length) audioEntry = zip.file(candidates[0]);
            }
            if (audioEntry) fileBuffer = await audioEntry.async('arraybuffer');
            if (!fileBuffer) continue;

            const trackObj = {
                id: meta.id,
                title: meta.title || 'Unknown',
                artist: meta.artist || 'Unknown Artist',
                fileName: meta.fileName || 'audio.mp3',
                mimeType: meta.mimeType || 'audio/mpeg',
                size: meta.size || fileBuffer.byteLength,
                fileBuffer: fileBuffer,
                customLyrics: Array.isArray(meta.customLyrics) ? meta.customLyrics : [],
                lyricOffset: typeof meta.lyricOffset === 'number' ? meta.lyricOffset : 0.0,
                lyricsSource: meta.lyricsSource || (meta.customLyrics && meta.customLyrics.length ? 'custom' : 'none'),
                lrclibId: meta.lrclibId != null ? meta.lrclibId : null
            };

            await saveTrackToDB(trackObj);
            
            // Overwrite existing in state or push new
            const exIdx = state.playlist.findIndex(t => t.id === trackObj.id);
            if(exIdx !== -1) {
                state.playlist[exIdx] = trackObj;
            } else {
                state.playlist.push(trackObj);
            }
            imported++;
        }

        alert(`Imported ${imported} tracks successfully.`);
        renderPlaylist();
        if (state.currentIndex === -1 && state.playlist.length > 0) loadAndPlayTrack(0);
    } catch (err) {
        console.error(err);
        alert("Import failed: " + err.message);
    } finally {
        document.getElementById('fileZipInput').value = '';
        const ovl = document.getElementById('mobileMenuOverlay');
        if(ovl) ovl.classList.add('hidden');
    }
}

function setupEventListeners() {
    const sliderVolume = document.getElementById('sliderVolume');
    const txtVolumeVal = document.getElementById('txtVolumeVal');
    state.settings.audioVolume = Math.max(1, Math.min(200, Number(state.settings.audioVolume) || 100));
    if (sliderVolume) sliderVolume.value = state.settings.audioVolume;
    if (txtVolumeVal) txtVolumeVal.textContent = `${state.settings.audioVolume}%`;
    // Click Wheel Button Action Routing
    const wheelButtons = [
        { id: 'btnWheelMenu', action: 'menu' },
        { id: 'btnWheelNext', action: 'next' },
        { id: 'btnWheelPlayPause', action: 'playpause' },
        { id: 'btnWheelPrev', action: 'prev' },
        { id: 'btnWheelCenter', action: 'center' }
    ];
    wheelButtons.forEach(btn => {
        const el = document.getElementById(btn.id);
        if (el) {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                playWheelClickSound();
                handleWheelAction(btn.action);
            });
        }
    });
    // Top Action Buttons above Song List
    document.getElementById('btnPlayAll')?.addEventListener('click', () => {
        if (state.playlist.length > 0) loadAndPlayTrack(0);
        if (isMobilePlatform) document.getElementById('mobileMenuOverlay').classList.add('hidden');
    });
    document.getElementById('btnToggleShuffle')?.addEventListener('click', () => {
        state.isShuffle = !state.isShuffle;
        const lbl = document.getElementById('lblShuffle');
        if (lbl) lbl.textContent = state.isShuffle ? 'Shuffle: On' : 'Shuffle';
        updateLcdUI();
    });
    document.getElementById('btnToggleLoop')?.addEventListener('click', () => {
        if (state.loopMode === 'off') state.loopMode = 'all';
        else if (state.loopMode === 'all') state.loopMode = 'one';
        else state.loopMode = 'off';
        const lbl = document.getElementById('lblLoop');
        if (lbl) {
            if (state.loopMode === 'off') lbl.textContent = 'Loop: Off';
            else if (state.loopMode === 'all') lbl.textContent = 'Loop: All';
            else lbl.textContent = 'Loop: Single';
        }
        updateLcdUI();
    });
    document.getElementById('btnClearLibrary')?.addEventListener('click', async () => {
        if (confirm('Clear all saved songs from webPod memory?')) {
            state.playlist = [];
            state.currentIndex = -1;
            if (audioElement) audioElement.pause();
            await clearTracksFromDB();
            renderPlaylist();
            updateLcdUI();
            state.currentLyrics = [];
            setLyricNotFound();
        }
    });
    // Lyric Search Form
    document.getElementById('lyricSearchForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const query = document.getElementById('inputLyricSearch').value.trim();
        if (query) {
            fetchOnlineLyrics(query, '');
        }
    });
    // Caption Upload button (file)
    document.getElementById('btnUploadCaption')?.addEventListener('click', () => {
        triggerCaptionUpload();
    });
    // Paste Captions button
    document.getElementById('btnPasteCaption')?.addEventListener('click', () => {
        openLyricPasteModal();
    });
    // Lyrics view mode toggle (List ↔ Retro LCD Live Preview)
    document.getElementById('btnViewList')?.addEventListener('click', () => setLyricsViewMode('list'));
    document.getElementById('btnViewPreview')?.addEventListener('click', () => setLyricsViewMode('preview'));
    
    // Lyric Offset Slider Control
    const sliderOffset = document.getElementById('sliderLyricOffset');
    const txtOffset = document.getElementById('txtLyricOffsetVal');
    const btnResetOffset = document.getElementById('btnResetLyricOffset');
    if (sliderOffset) {
        sliderOffset.addEventListener('input', (e) => {
            state.lyricOffset = parseFloat(e.target.value);
            if (txtOffset) {
                const val = state.lyricOffset;
                txtOffset.textContent = (val > 0 ? `+${val.toFixed(1)}s` : `${val.toFixed(1)}s`);
            }
            if (offsetSaveTimer) clearTimeout(offsetSaveTimer);
            offsetSaveTimer = setTimeout(() => persistCurrentTrackMeta(), 400);
        });
    }
    if (btnResetOffset) {
        btnResetOffset.addEventListener('click', () => {
            state.lyricOffset = 0.0;
            if (sliderOffset) sliderOffset.value = '0.0';
            if (txtOffset) txtOffset.textContent = '0.0s';
            persistCurrentTrackMeta();
        });
    }

    // Caption Speed Rate Slider Control
    const sliderCaptionSpeed = document.getElementById('sliderCaptionSpeed');
    const txtCaptionSpeed = document.getElementById('txtCaptionSpeedVal');
    const btnResetCaptionSpeed = document.getElementById('btnResetCaptionSpeed');
    if (sliderCaptionSpeed) {
        sliderCaptionSpeed.addEventListener('input', (e) => {
            state.captionSpeed = parseFloat(e.target.value);
            if (txtCaptionSpeed) {
                txtCaptionSpeed.textContent = `${state.captionSpeed.toFixed(2)}x`;
            }
            if (offsetSaveTimer) clearTimeout(offsetSaveTimer);
            offsetSaveTimer = setTimeout(() => persistCurrentTrackMeta(), 400);
        });
    }
    if (btnResetCaptionSpeed) {
        btnResetCaptionSpeed.addEventListener('click', () => {
            state.captionSpeed = 1.0;
            if (sliderCaptionSpeed) sliderCaptionSpeed.value = '1.0';
            if (txtCaptionSpeed) txtCaptionSpeed.textContent = '1.00x';
            persistCurrentTrackMeta();
        });
    }

    // Audio DSP Speed Slider
    document.getElementById('sliderSpeed')?.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        document.getElementById('txtSpeedVal').textContent = `${val.toFixed(1)}x`;
        applyPlaybackRate();
    });
    // Master volume slider
    document.getElementById('sliderVolume')?.addEventListener('input', (e) => {
        state.settings.audioVolume = Number(e.target.value);
        document.getElementById('txtVolumeVal').textContent = `${state.settings.audioVolume}%`;
        applyAudioVolume();
        saveSettingsToStorage();
    });
    // Bass Boost Toggle
    document.getElementById('btnToggleBass')?.addEventListener('click', () => {
        isBassBoosted = !isBassBoosted;
        const dot = document.getElementById('dotBass');
        if (bassFilter) {
            bassFilter.gain.value = isBassBoosted ? 12 : 0;
        }
        if (dot) {
            dot.className = isBassBoosted 
                ? 'w-4 h-4 bg-cyan-400 rounded-full transition transform translate-x-5' 
                : 'w-4 h-4 bg-white rounded-full transition transform translate-x-0';
        }
    });
    // Equalizer Preset Selector
    document.getElementById('selectEqPreset')?.addEventListener('change', (e) => {
        applyEqPreset(e.target.value);
    });
    // DSP Reset Button
    document.getElementById('btnResetDsp')?.addEventListener('click', () => {
        state.settings.audioVolume = 100;
        document.getElementById('sliderVolume').value = 100;
        document.getElementById('txtVolumeVal').textContent = '100%';
        applyAudioVolume();
        saveSettingsToStorage();
        document.getElementById('sliderSpeed').value = 1.0;
        document.getElementById('txtSpeedVal').textContent = '1.0x';
        applyPlaybackRate();
        isBassBoosted = false;
        if (bassFilter) bassFilter.gain.value = 0;
        const dot = document.getElementById('dotBass');
        if (dot) dot.className = 'w-4 h-4 bg-white rounded-full transition transform translate-x-0';
        document.getElementById('selectEqPreset').value = 'flat';
        applyEqPreset('flat');
    });
    // File Upload Handler (audio)
    document.getElementById('fileAudioInput')?.addEventListener('change', handleAudioFileUpload);
    // Click LCD Progress Bar to Seek
    document.getElementById('lcdProgressBar')?.addEventListener('click', (e) => {
        if (!audioElement || !audioElement.duration) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const pct = clickX / rect.width;
        audioElement.currentTime = pct * audioElement.duration;
    });
    
    // Settings Modal Open/Close
    document.getElementById('btnOpenSettings')?.addEventListener('click', () => {
        document.getElementById('modalSettings').classList.remove('hidden');
    });
    document.getElementById('btnCloseSettings')?.addEventListener('click', () => {
        document.getElementById('modalSettings').classList.add('hidden');
        revertSettingsPreview(); // discard unsaved live-preview changes
    });
    document.getElementById('btnSaveSettings')?.addEventListener('click', savePreferencesUI);

    // Paste modal controls
    document.getElementById('btnCloseLyricInput')?.addEventListener('click', () => {
        document.getElementById('modalLyricInput').classList.add('hidden');
    });
    document.getElementById('btnApplyLyricText')?.addEventListener('click', applyPastedLyrics);

    // Hidden SRT/LRC file input
    document.getElementById('fileSrtInput')?.addEventListener('change', handleSrtFileUpload);
    
    // Settings Enable Lyrics sync updateLcdUI
    document.getElementById('chkShowLyrics')?.addEventListener('change', (e) => {
        state.settings.showLyrics = e.target.checked;
        updateLcdUI();
    });

    // Mobile Hamburger Actions
    document.getElementById('btnHamburger')?.addEventListener('click', () => {
        document.getElementById('mobileMenuOverlay').classList.remove('hidden');
    });
    document.getElementById('btnCloseMobileMenu')?.addEventListener('click', () => {
        document.getElementById('mobileMenuOverlay').classList.add('hidden');
    });
    document.getElementById('btnMobileSettings')?.addEventListener('click', () => {
        document.getElementById('modalSettings').classList.remove('hidden');
        document.getElementById('mobileMenuOverlay').classList.add('hidden');
    });
    document.getElementById('btnUploadSave')?.addEventListener('click', () => {
        document.getElementById('fileZipInput').click();
    });
    document.getElementById('fileZipInput')?.addEventListener('change', async (e) => {
        const f = e.target.files && e.target.files[0];
        if (f) await importZipToMain(f);
    });
}

// Read ID3 metadata using jsmediatags
function extractAudioMetadata(file) {
    return new Promise((resolve) => {
        let title = file.name.replace(/\.[^/.]+$/, "");
        let artist = "Unknown Artist";
        if (title.includes(" - ")) {
            const parts = title.split(" - ");
            artist = parts[0].trim();
            title = parts.slice(1).join(" - ").trim();
        }

        if (window.jsmediatags) {
            window.jsmediatags.read(file, {
                onSuccess: function(tag) {
                    const tags = tag.tags;
                    if (tags.title && tags.title.trim()) {
                        title = tags.title.trim();
                    }
                    if (tags.artist && tags.artist.trim()) {
                        artist = tags.artist.trim();
                    }
                    resolve({ title, artist });
                },
                onError: function() {
                    resolve({ title, artist });
                }
            });
        } else {
            resolve({ title, artist });
        }
    });
}

async function handleAudioFileUpload(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    for (const file of files) {
        try {
            const buffer = await file.arrayBuffer();
            const meta = await extractAudioMetadata(file);

            const trackObj = {
                id: 'track_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
                title: meta.title,
                artist: meta.artist,
                fileName: file.name,
                mimeType: file.type || 'audio/mpeg',
                size: file.size,
                fileBuffer: buffer,
                customLyrics: [],
                lyricOffset: 0.0,
                captionSpeed: 1.0,
                lyricsSource: 'none',
                lrclibId: null
            };
            state.playlist.push(trackObj);
            await saveTrackToDB(trackObj);
        } catch (err) {
            console.error('Failed to load audio file:', file.name, err);
        }
    }
    e.target.value = '';
    renderPlaylist();
    if (state.currentIndex === -1 && state.playlist.length > 0) {
        loadAndPlayTrack(0);
    }
}

let pendingTrackIndexForSrt = -1;
function attachSrtToTrack(index) {
    if (index < 0 || index >= state.playlist.length) return;
    pendingTrackIndexForSrt = index;
    const input = document.getElementById('fileSrtInput');
    if (input) {
        input.value = '';
        input.click();
    }
}

function triggerCaptionUpload() {
    if (state.currentIndex < 0) {
        alert('Please select or play a track first, then upload lyrics for it.');
        return;
    }
    pendingTrackIndexForSrt = state.currentIndex;
    const input = document.getElementById('fileSrtInput');
    if (input) {
        input.value = '';
        input.click();
    }
}

function openLyricPasteModal() {
    if (state.currentIndex < 0) {
        alert('Please select or play a track first, then paste lyrics for it.');
        return;
    }
    const track = state.playlist[state.currentIndex];
    const nameEl = document.getElementById('lyricInputTrackName');
    if (nameEl) nameEl.textContent = track ? track.title : 'Current track';
    const ta = document.getElementById('textareaLyricInput');
    if (ta) ta.value = '';
    document.getElementById('modalLyricInput').classList.remove('hidden');
}

async function handleSrtFileUpload(e) {
    const file = e.target.files && e.target.files[0];
    if (!file || pendingTrackIndexForSrt === -1) {
        pendingTrackIndexForSrt = -1;
        return;
    }
    try {
        const text = await file.text();
        let parsedLyrics = [];
        const lower = file.name.toLowerCase();
        if (lower.endsWith('.lrc')) {
            parsedLyrics = parseLrcLyrics(text);
        } else if (lower.endsWith('.yml') || lower.endsWith('.yaml')) {
            parsedLyrics = parseLyricsFile(text);
        } else if (lower.endsWith('.srt')) {
            parsedLyrics = parseSrtCaptions(text);
        } else {
            parsedLyrics = detectAndParseLyrics(text, 'auto');
        }
        if (parsedLyrics.length > 0) {
            const idx = pendingTrackIndexForSrt;
            state.playlist[idx].customLyrics = parsedLyrics;
            state.playlist[idx].lyricsSource = 'custom';
            state.playlist[idx].lrclibId = null;
            if (typeof state.playlist[idx].lyricOffset !== 'number') {
                state.playlist[idx].lyricOffset = 0.0;
            }
            if (typeof state.playlist[idx].captionSpeed !== 'number') {
                state.playlist[idx].captionSpeed = 1.0;
            }
            await saveTrackToDB(state.playlist[idx]);
            
            if (idx === state.currentIndex) {
                state.currentLyrics = parsedLyrics;
                state.activeLyricIndex = -1;
                renderLyrics();
                setLyricStatus('Attached File', 'emerald');
                const trackNameTag = document.getElementById('lyricCurrentTrackName');
                if (trackNameTag) {
                    const t = state.playlist[idx];
                    trackNameTag.textContent = `${t.title} - ${t.artist || 'Unknown'}`;
                }
                updateLcdUI();
            }
            alert(`Lyrics attached successfully (${parsedLyrics.length} lines)!`);
        } else {
            alert('Could not parse timestamps from file. Ensure valid .SRT or .LRC format.');
        }
    } catch (err) {
        console.error(err);
        alert('Failed to read the caption file.');
    } finally {
        pendingTrackIndexForSrt = -1;
        e.target.value = '';
    }
}

async function applyPastedLyrics() {
    if (state.currentIndex < 0) {
        alert('No track selected.');
        return;
    }
    const text = document.getElementById('textareaLyricInput')?.value || '';
    const format = document.getElementById('selectLyricFormat')?.value || 'auto';
    const parsedLyrics = detectAndParseLyrics(text, format);
    if (parsedLyrics.length === 0) {
        alert('No usable lyrics found in the pasted text.');
        return;
    }
    const idx = state.currentIndex;
    state.playlist[idx].customLyrics = parsedLyrics;
    state.playlist[idx].lyricsSource = 'custom';
    state.playlist[idx].lrclibId = null;
    if (typeof state.playlist[idx].lyricOffset !== 'number') {
        state.playlist[idx].lyricOffset = 0.0;
    }
    if (typeof state.playlist[idx].captionSpeed !== 'number') {
        state.playlist[idx].captionSpeed = 1.0;
    }
    await saveTrackToDB(state.playlist[idx]);
    state.currentLyrics = parsedLyrics;
    state.activeLyricIndex = -1;
    renderLyrics();
    setLyricStatus(format === 'auto' ? 'Pasted' : format.toUpperCase(), 'emerald');
    const trackNameTag = document.getElementById('lyricCurrentTrackName');
    if (trackNameTag) {
        const t = state.playlist[idx];
        trackNameTag.textContent = `${t.title} - ${t.artist || 'Unknown'}`;
    }
    updateLcdUI();
    document.getElementById('modalLyricInput').classList.add('hidden');
    alert(`Applied ${parsedLyrics.length} lyric lines.`);
}

async function deleteTrack(index) {
    const track = state.playlist[index];
    if (!track) return;
    await removeTrackFromDB(track.id);
    state.playlist.splice(index, 1);
    if (index === state.currentIndex) {
        if (state.playlist.length > 0) {
            loadAndPlayTrack(Math.min(index, state.playlist.length - 1));
        } else {
            state.currentIndex = -1;
            if (audioElement) audioElement.pause();
            updateLcdUI();
            state.currentLyrics = [];
            setLyricNotFound();
        }
    } else if (index < state.currentIndex) {
        state.currentIndex--;
    }
    renderPlaylist();
}

function applyEqPreset(preset) {
    if (biquadFilters.length < 5) return;
    const gains = {
        flat: [0, 0, 0, 0, 0],
        bass: [7, 4, 0, -2, -4],
        vocal: [-2, 3, 6, 3, -2],
        treble: [-4, -2, 0, 4, 7],
        rock: [5, 2, -1, 3, 5]
    };
    const values = gains[preset] || gains.flat;
    biquadFilters.forEach((filter, i) => {
        filter.gain.value = values[i];
    });
    const eqInd = document.getElementById('lcdEqIndicator');
    if (eqInd) eqInd.style.opacity = preset !== 'flat' ? '1' : '0.4';
}

// ---- Settings form <-> state.settings mapping ------------------------------
// [settingKey, elementId, kind]
const SETTING_FIELDS = [
    ['lcdTheme', 'selectLcdTheme', 'value'],
    ['visMode', 'selectVisMode', 'value'],
    ['visColor', 'selectVisColor', 'value'],
    ['visCustomColor', 'colorVisCustom', 'value'],
    ['visSensitivity', 'rangeVisSens', 'num'],
    ['visSmoothing', 'rangeVisSmooth', 'num'],
    ['visHeight', 'selectVisHeight', 'num'],
    ['visFps', 'selectVisFps', 'num'],
    ['customLcdBg', 'colorLcdBg', 'value'],
    ['customLcdFg', 'colorLcdFg', 'value'],
    ['customCaseA', 'colorCaseA', 'value'],
    ['customCaseB', 'colorCaseB', 'value'],
    ['wheelStyle', 'selectWheelStyle', 'value'],
    ['appBg', 'selectAppBg', 'value'],
    ['appBgColor', 'colorAppBg', 'value'],
    ['scanlines', 'rangeScanlines', 'num'],
    ['lcdGlow', 'chkLcdGlow', 'check'],
    ['playerScale', 'rangePlayerScale', 'num'],
    ['lyricSize', 'rangeLyricSize', 'num'],
    ['lyricActiveColor', 'colorLyricActive', 'value'],
    ['clickVolume', 'rangeClickVol', 'num'],
    ['perfMode', 'chkPerfMode', 'check'],
    ['showLyrics', 'chkShowLyrics', 'check'],
    ['showUpload', 'chkShowUpload', 'check'],
    ['showDsp', 'chkShowDsp', 'check'],
    ['clickSound', 'chkClickSound', 'check'],
    ['lowLatencyLyrics', 'chkLowLatencyLyrics', 'check']
];
// Settings that are purely visual and get a live preview while the dialog is open
const PREVIEW_KEYS = new Set(['lcdTheme', 'visMode', 'visColor', 'visCustomColor', 'visSensitivity', 'visSmoothing',
    'visHeight', 'visFps', 'customLcdBg', 'customLcdFg', 'customCaseA', 'customCaseB', 'wheelStyle', 'appBg',
    'appBgColor', 'scanlines', 'lcdGlow', 'playerScale', 'lyricSize', 'lyricActiveColor', 'perfMode']);

// Read the form into a copy of the current settings (does not save anything)
function readSettingsForm() {
    const s = { ...state.settings };
    SETTING_FIELDS.forEach(([key, id, kind]) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (kind === 'check') s[key] = el.checked;
        else if (kind === 'num') { const n = parseFloat(el.value); if (!isNaN(n)) s[key] = n; }
        else s[key] = el.value;
    });
    return s;
}

function savePreferencesUI() {
    const s = readSettingsForm();
    s.lyricsApi = document.querySelector('input[name="lyricsApi"]:checked')?.value || 'lrclib';
    s.musixmatchKey = document.getElementById('inputMusixmatchKey').value.trim();
    Object.assign(state.settings, s);
    saveSettingsToStorage();
    applySettingsToApp();
    document.getElementById('modalSettings').classList.add('hidden');
}

// Push saved settings values into the settings form controls
function populateSettingsForm() {
    const s = state.settings;
    const set = (id, fn) => { const el = document.getElementById(id); if (el) fn(el); };
    SETTING_FIELDS.forEach(([key, id, kind]) => {
        set(id, el => { if (kind === 'check') el.checked = !!s[key]; else el.value = s[key]; });
    });
    set('inputMusixmatchKey', el => el.value = s.musixmatchKey || '');
    set('chkDisableProfanity', el => el.checked = s.disableProfanityFilter);
    const radio = document.querySelector(`input[name="lyricsApi"][value="${s.lyricsApi}"]`);
    if (radio) radio.checked = true;
    refreshRangeLabels();
}

// "0.8" style read-outs next to the sliders
function refreshRangeLabels() {
    document.querySelectorAll('.range-val').forEach(out => {
        const input = document.getElementById(out.dataset.for);
        if (!input) return;
        const v = parseFloat(input.value);
        const unit = out.dataset.unit || '';
        out.textContent = (unit === 'x' ? v.toFixed(2) : unit === '' ? v.toFixed(2) : Math.round(v)) + (unit === 'x' ? 'x' : unit);
    });
}

// Live preview while the dialog is open; closing without saving reverts it
function previewSettingsFromForm() {
    refreshRangeLabels();
    applyAppearance(readSettingsForm());
}
function revertSettingsPreview() {
    populateSettingsForm();
    applyAppearance(state.settings);
}

// Swap the theme-* class on an element
function swapThemeClass(el, theme) {
    if (!el) return;
    Array.from(el.classList).forEach(c => { if (c.startsWith('theme-')) el.classList.remove(c); });
    el.classList.add(theme);
}

// Everything visual (themes, wheel, background, scanlines, lyrics look, visualizer)
function applyAppearance(s) {
    const root = document.documentElement;
    const st = root.style;
    const theme = s.lcdTheme || 'theme-classic';

    // custom-theme colours + misc CSS variables
    st.setProperty('--c-lcd-bg', s.customLcdBg);
    st.setProperty('--c-lcd-fg', s.customLcdFg);
    st.setProperty('--c-case-a', s.customCaseA);
    st.setProperty('--c-case-b', s.customCaseB);
    st.setProperty('--scan-op', String(Math.max(0, Math.min(100, s.scanlines)) / 100));
    st.setProperty('--lyric-scale', String(Math.max(50, Math.min(200, s.lyricSize)) / 100));
    st.setProperty('--lyric-active', s.lyricActiveColor);
    st.setProperty('--app-bg', s.appBgColor);
    root.dataset.bg = s.appBg;
    root.classList.toggle('lcd-glow', !!s.lcdGlow);
    root.classList.toggle('perf-mode', !!s.perfMode);

    // LCD backlight, iPod case and the lyrics Live Preview stage share the theme class
    swapThemeClass(document.getElementById('lcdDisplay'), theme);
    swapThemeClass(document.getElementById('ipodCase'), theme);
    swapThemeClass(document.querySelector('.lcd-preview-stage'), theme);

    // Click wheel finish
    const wheel = document.getElementById('clickWheel');
    if (wheel) {
        wheel.classList.remove('wheel-graphite', 'wheel-black');
        if (s.wheelStyle === 'graphite' || s.wheelStyle === 'black') wheel.classList.add('wheel-' + s.wheelStyle);
    }

    // Player size (desktop layout only; mobile fills the screen)
    if (!isMobilePlatform) {
        const panel = document.getElementById('panelIpod');
        if (panel) panel.style.zoom = (s.playerScale && s.playerScale !== 100) ? String(s.playerScale / 100) : '';
    }

    visInvalidateColor();
    applyVisualizerSettings(s);
}

// Apply current state.settings to the live UI
function applySettingsToApp() {
    const lyricsApi = state.settings.lyricsApi;

    if (state.settings.lowLatencyLyrics && state.isPlaying) {
        startLowLatencyLyricLoop();
    } else {
        stopLowLatencyLyricLoop();
    }

    applyAppearance(state.settings);
    
    // Toggle Panel Visibilities (only applies if not in mobile view or if mobile rules allow it)
    if (!isMobilePlatform) {
        document.getElementById('panelLyrics').style.display = state.settings.showLyrics ? 'flex' : 'none';
        document.getElementById('uploadBox').style.display = state.settings.showUpload ? 'block' : 'none';
        document.getElementById('dspBox').style.display = state.settings.showDsp ? 'block' : 'none';
    }
    
    updateLcdUI();
    const tag = document.getElementById('lyricSourceTag');
    if (tag && !(lyricsApi === 'lrclib' && tag.querySelector('a'))) tag.textContent = lyricsApi.toUpperCase();
}

// Wire up live preview, slider read-outs and "reset appearance"
function setupAppearanceControls() {
    const modal = document.getElementById('modalSettings');
    if (!modal) return;
    const idToKey = {};
    SETTING_FIELDS.forEach(([key, id]) => { idToKey[id] = key; });
    const onChange = (e) => {
        const key = idToKey[e.target.id];
        if (key && PREVIEW_KEYS.has(key)) previewSettingsFromForm();
        else refreshRangeLabels();
    };
    modal.addEventListener('input', onChange);
    modal.addEventListener('change', onChange);

    document.getElementById('btnResetAppearance')?.addEventListener('click', () => {
        // reset only the visual options to their defaults (the dialog still needs "Save")
        const defaults = {
            lcdTheme: 'theme-classic', visMode: 'bar', visColor: 'lcd', visCustomColor: '#38bdf8', visSensitivity: 1,
            visSmoothing: 0.8, visHeight: 40, visFps: 60, customLcdBg: '#1b1f2a', customLcdFg: '#7df9ff',
            customCaseA: '#2b2f3a', customCaseB: '#10131a', wheelStyle: 'white', appBg: 'default',
            appBgColor: '#0b1020', scanlines: 40, lcdGlow: false, playerScale: 100, lyricSize: 100,
            lyricActiveColor: '#38bdf8', clickVolume: 100, perfMode: false
        };
        SETTING_FIELDS.forEach(([key, id, kind]) => {
            if (!(key in defaults)) return;
            const el = document.getElementById(id);
            if (!el) return;
            if (kind === 'check') el.checked = defaults[key]; else el.value = defaults[key];
        });
        previewSettingsFromForm();
    });
}

// Profanity filter toggle: turning the filter OFF requires a passcode
function setupProfanityToggle() {
    const chk = document.getElementById('chkDisableProfanity');
    if (!chk) return;
    chk.addEventListener('change', () => {
        if (chk.checked) {
            const entered = window.prompt('Enter passcode to disable the profanity filter:');
            if (entered !== PROFANITY_PASSCODE) {
                chk.checked = false;
                if (entered !== null) alert('Incorrect passcode.');
                return;
            }
            state.settings.disableProfanityFilter = true;
        } else {
            state.settings.disableProfanityFilter = false;
        }
        saveSettingsToStorage();
        // Re-render so already-displayed lyrics reflect the change
        if (state.currentLyrics.length > 0) {
            const idx = state.activeLyricIndex;
            renderLyrics();
            state.activeLyricIndex = -1;
            if (audioElement) updateLyricsOnly();
        }
    });
}

function updateStorageStats() {
    let bytes = 0;
    state.playlist.forEach(t => bytes += (t.size || 0));
    const mb = (bytes / (1024 * 1024)).toFixed(1);
    const txt = document.getElementById('storageText');
    if (txt) txt.textContent = `${mb} MB Saved`;
}

function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return "00:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function escapeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

window.addEventListener('DOMContentLoaded', async () => {
    await loadBadWords();
    setupEventListeners();
    setupKeyboardControls();
    setupProfanityToggle();
    setupAppearanceControls();
    populateSettingsForm();
    applySettingsToApp();
    try {
        await initDB();
        const savedTracks = await loadTracksFromDB();
        if (savedTracks && savedTracks.length > 0) {
            state.playlist = savedTracks.map(t => ({
                lyricOffset: 0.0,
                captionSpeed: 1.0,
                lyricsSource: (t.customLyrics && t.customLyrics.length) ? 'custom' : 'none',
                lrclibId: null,
                ...t
            }));
            renderPlaylist();
        }
    } catch (e) {
        console.warn('Storage init warning:', e);
    }
    visInit();
    visSync();
});
