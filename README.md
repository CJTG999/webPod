# webPod

A retro iPod-style music player that runs entirely in your browser. Your songs are stored locally, so nothing is uploaded anywhere\*.

If you wanna run the code locally I recommend cloning the repo or downloading the code using the "Code <>" button and run the openinchrome.bat file (assuming you have chrome installed).

## Features

#### Player

* Click wheel with play/pause, next, previous, and menu, plus a synthesized click sound
* Keyboard controls: arrow keys map to the wheel, Space selects
* 17 LCD and case themes (Classic, Matrix Green, Ice Blue, Amber, Cyberpunk Pink, Midnight, Graphite, Deep Ocean, Mint Terminal, Crimson, Sunset, Gold Rush, Lavender, Vaporwave, Game Boy, E-Ink Paper, Sakura) plus a **Custom** theme with your own colours
* Appearance options: click wheel finish, app background, scanline strength, LCD glow, player size, lyric size + highlight colour, click-sound volume, performance mode (live preview in Settings)
* Shuffle, loop all, and loop single track
* Mobile layout that can be installed as a PWA

#### Lyrics \& Captions

* Synced lyrics fetched from LRCLIB (optional Musixmatch support)
* Upload or paste your own `.srt` and `.lrc` files, with format auto-detection
* List view and a live retro LCD caption preview
* Per-track offset (±30s) and caption rate (0.5x–2x) sliders
* Profanity filter for lyrics

#### Audio

* 5-band equalizer with presets: Flat, Bass Heavy, Vocal Booster, Treble Boost, Rock
* Bass boost toggle
* Playback speed from 0.5x to 2.0x
* Live visualizer on the LCD with 11 styles: Bars, Waveform, Fine Spectrum, Mirror Bars, Smooth Spectrum, Oscilloscope, LED Columns, Peak Meters, Pulse Dots, Radial Burst, VU Meter - with colour (LCD / accent / rainbow / custom), sensitivity, smoothing, height and frame-rate controls

#### Library

* Songs saved in your browser with IndexedDB (audio is read from disk only when a track plays, so memory use stays flat however big the library is)
* Title and artist read from ID3 tags
* ZIP export and import of your full library, including lyrics and offsets

## Pages

|Page|Purpose|
|-|-|
|`home.html`|Landing page|
|Player|Main webPod player|
|`tools/captions.html`|Caption Studio: create SRT captions while a song plays|
|`tools/captionsync.html`|SyncMaster: time existing lyrics and export `.srt` or `.lrc`|
|`tools/manager.html`|Backup Manager: export and import your library as a ZIP|

*I'm planning on making a way to save lyrics and some songs online (not publicly)


## Windows desktop app

webPod also runs as a normal Windows program (Electron). Requires [Node.js LTS](https://nodejs.org).

* **Try it:** double-click `start-desktop.bat` (or `npm install` then `npm start`).
* **Build an installer:** double-click `build-windows.bat` (or `npm install` then `npm run dist`).
  The installer (`webPod Setup x.y.z.exe`) and a no-install portable `.exe` appear in `dist/`.
* **Offline use:** `npm run dist` first downloads Tailwind, Font Awesome, the fonts, JSZip and jsmediatags
  into `vendor/` (run `npm run vendor` by hand any time). The desktop app uses those copies automatically,
  so it works with no internet except for fetching lyrics.
* Desktop extras: remembers window size, single instance, hardware media keys, hidden menu bar (press Alt).

Your library lives in the app's own storage, separate from the browser version.
Use the Backup Manager (ZIP export/import) to move songs between the two.
