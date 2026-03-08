const fs = require('fs');

const data = JSON.parse(fs.readFileSync('PianoTilesJAVA/resources/assets/res/song/Jingle Bells.json', 'utf8'));
const scores = data.musics[0].scores;

const BRACKET_BEATS = {
    H: 8, I: 4, J: 2, K: 1, L: 0.5, M: 0.25, N: 0.125, O: 0.0625, P: 0.03125,
    Q: 8, R: 4, S: 2, T: 1, U: 0.5, V: 0.25, W: 0.125, X: 0.0625, Y: 0.03125, // Rests
};

function getDuration(token) {
    if (token === 'ST') return 3; // S=2, T=1
    if (/^[QRSSTUVWXYZ]+$/.test(token)) {
        let restBeats = 0;
        for (const ch of token) restBeats += BRACKET_BEATS[ch] || 0;
        return restBeats;
    }
    const m = token.match(/\[([HIJKLMNOP]+)\]/);
    if (!m) return 0;
    let beats = 0;
    for (const ch of m[1]) beats += BRACKET_BEATS[ch] || 0;
    return beats;
}

const melodyChunks = scores[0].split(';');
const bassChunks = scores[1].split(';');

console.log("Checking Measure synchronization...");

for (let i = 0; i < Math.min(10, melodyChunks.length); i++) {
    const mTokens = melodyChunks[i].split(',').filter(Boolean);
    const bTokens = bassChunks[i].split(',').filter(Boolean);

    const mBeats = mTokens.reduce((sum, t) => sum + getDuration(t), 0);
    const bBeats = bTokens.reduce((sum, t) => sum + getDuration(t), 0);

    console.log(`Measure ${i}: Melody = ${mBeats} beats | Bass = ${bBeats} beats`);
}
