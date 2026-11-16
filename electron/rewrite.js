// Swaps CDN URLs in HTML for locally bundled copies (vendor/ folder) so the app
// works offline. Pure function (no Electron APIs) so it can be unit-tested.
const fs = require('fs');
const path = require('path');

// [regex matching the CDN URL, vendor file that must exist, local URL path]
const RULES = [
    [/https:\/\/cdn\.tailwindcss\.com[^"']*/g, 'tailwind.js', '/vendor/tailwind.js'],
    [/https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/font-awesome\/6\.4\.0\/css\/all\.min\.css/g, 'fontawesome/css/all.min.css', '/vendor/fontawesome/css/all.min.css'],
    [/https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/jszip\/3\.10\.1\/jszip\.min\.js/g, 'jszip.min.js', '/vendor/jszip.min.js'],
    [/https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/jsmediatags\/3\.9\.5\/jsmediatags\.min\.js/g, 'jsmediatags.min.js', '/vendor/jsmediatags.min.js'],
    [/https:\/\/fonts\.googleapis\.com\/css2\?[^"']*/g, 'fonts/fonts.css', '/vendor/fonts/fonts.css']
];

function rewriteHtml(html, vendorDir, origin) {
    let out = html;
    for (const [re, file, local] of RULES) {
        if (fs.existsSync(path.join(vendorDir, file))) out = out.replace(re, origin + local);
    }
    return out;
}

module.exports = { rewriteHtml };
