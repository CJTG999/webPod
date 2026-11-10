// Downloads the CDN files the pages use (Tailwind, Font Awesome, Google Fonts, JSZip,
// jsmediatags) into ./vendor so the desktop app works with no internet connection.
// Run:  npm run vendor      (the "dist" script runs it automatically)
// It never fails the build: if a download fails, the app just falls back to the CDN.
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'vendor');
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const FA_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/';

async function fetchOk(url, headers) {
    const res = await fetch(url, { headers: headers || {} });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res;
}
function write(rel, data) {
    const file = path.join(OUT, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
    console.log('  saved', rel);
}
async function saveText(url, rel, headers) { const t = await (await fetchOk(url, headers)).text(); write(rel, t); return t; }
async function saveBin(url, rel) { write(rel, Buffer.from(await (await fetchOk(url)).arrayBuffer())); }

async function step(name, fn) {
    try { console.log(name); await fn(); } catch (e) { console.warn(`  ! skipped (${e.message}) - the app will use the online copy instead`); }
}

(async () => {
    fs.mkdirSync(OUT, { recursive: true });

    await step('Tailwind CSS', async () => {
        try { await saveText('https://cdn.tailwindcss.com/3.4.17', 'tailwind.js'); }
        catch (e) { await saveText('https://cdn.tailwindcss.com', 'tailwind.js'); }
    });

    await step('JSZip + jsmediatags', async () => {
        await saveText('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', 'jszip.min.js');
        await saveText('https://cdnjs.cloudflare.com/ajax/libs/jsmediatags/3.9.5/jsmediatags.min.js', 'jsmediatags.min.js');
    });

    await step('Font Awesome', async () => {
        const cssUrl = FA_BASE + 'css/all.min.css';
        const css = await saveText(cssUrl, 'fontawesome/css/all.min.css');
        const urls = new Set();
        for (const m of css.matchAll(/url\(([^)]+)\)/g)) urls.add(m[1].replace(/['"]/g, ''));
        for (const u of urls) {
            if (u.startsWith('data:')) continue;
            const abs = new URL(u, cssUrl);
            await saveBin(abs.href.split('?')[0], 'fontawesome/' + abs.href.slice(FA_BASE.length).split(/[?#]/)[0]);
        }
    });

    await step('Google Fonts (VT323, Inter, JetBrains Mono)', async () => {
        const cssUrl = 'https://fonts.googleapis.com/css2?family=VT323&family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap';
        let css = await (await fetchOk(cssUrl, { 'User-Agent': CHROME_UA })).text();   // modern UA => woff2
        const urls = [...new Set([...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com[^)]+)\)/g)].map(m => m[1]))];
        let i = 0;
        for (const u of urls) {
            const name = `f${i++}_${path.basename(new URL(u).pathname)}`;
            await saveBin(u, 'fonts/' + name);
            css = css.split(u).join('./' + name);
        }
        write('fonts/fonts.css', css);
    });

    console.log('\nDone. Offline files are in ./vendor');
})();
