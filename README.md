# webPod

A retro iPod-style music player that runs entirely in your browser. Your songs are stored locally, so nothing is uploaded anywhere\*.

If you wanna run the code locally I recommend cloning the repo or downloading the code using the "Code <>" button and run the openinchrome.bat file (assuming you have chrome installed).

## Features

#### Player

* Click wheel with play/pause, next, previous, and menu, plus a synthesized click sound
* Keyboard controls: arrow keys map to the wheel, Space selects
* 5 LCD and case themes: Classic, Matrix Green, Ice Blue, Amber, Cyberpunk Pink
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
* Live visualizer (bars or waveform) on the LCD

#### Library

* Songs saved in your browser with IndexedDB
* Title and artist read from ID3 tags
* ZIP export and import of your full library, including lyrics and offsets

## Pages

|Page|Purpose|
|-|-|
|`home.html`|Landing page|
|Player|Main webPod player|
|`tools/captions.html`|Caption Studio: create SRT captions while a song plays|
|`tools/captionsync.html`|SyncMaster: time existing lyrics and export `.srt` or `.lrc`|
|`other/manager.html`|Backup Manager: export and import your library as a ZIP|

*I'm planning on making a way to save lyrics and some songs online (not publicly)

