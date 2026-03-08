import fs from 'fs';
import path from 'path';

const jingleBellsPath = path.resolve('PianoTilesJAVA', 'resources', 'assets', 'res', 'song', 'Jingle Bells.json');
const data = JSON.parse(fs.readFileSync(jingleBellsPath, 'utf-8'));

const scores = data.musics[0].scores; // Array of strings for each track
console.log('--- RAW SCORE STRINGS ---');
scores.forEach((s: string, i: number) => {
    console.log(`Track ${i}:`);
    console.log(s.substring(0, 100) + '...');
});

// Let's create an ASCII visualizer that parses the first N commas
const BEATS_PER_SLOT = data.musics[0].baseBeats;

function parseTrack(scoreStr: string, limit: number) {
    const tokens = scoreStr.split(/[,;]+/).filter(Boolean).slice(0, limit);
    const events: any[] = [];
    let time = 0;

    for (const token of tokens) {
        let name = '';
        let brackets = '';
        const match = token.match(/^([^\[]*)\[(.*)\]$/);
        if (match) {
            name = match[1];
            brackets = match[2];
        } else {
            name = token;
        }

        let durationBeats = 1;
        if (brackets.includes('K')) durationBeats = 1;
        else if (brackets.includes('L')) durationBeats = 0.5;
        else if (brackets.includes('I')) durationBeats = 4;
        else if (brackets.includes('J')) durationBeats = 2;
        else if (brackets.includes('H')) durationBeats = 8;
        else if (brackets.includes('M')) durationBeats = 0.25;

        events.push({
            time,
            name: name || 'rest',
            durationSlots: durationBeats / BEATS_PER_SLOT
        });

        time += 1; // 1 comma = 1 slot step timeline
    }
    return events;
}

const t0 = parseTrack(scores[0], 25);
const t1 = parseTrack(scores[1], 25);

console.log('\n--- ASCII LANE GRID (First 20 slots) ---');
console.log('Slot | Melody                 | Bass');
console.log('----------------------------------------------------');

for (let s = 0; s < 25; s++) {
    // Find active notes flowing through this slot based on duration
    const active0 = t0.filter(e => s >= e.time && s < e.time + e.durationSlots && e.name !== 'empty' && e.name !== 'rest');
    const active1 = t1.filter(e => s >= e.time && s < e.time + e.durationSlots && e.name !== 'empty' && e.name !== 'rest');

    let str0 = active0.length > 0 ? `[${active0.map(x => x.name).join(',')}]`.padEnd(20) : '.'.padEnd(20);
    let str1 = active1.length > 0 ? `[${active1.map(x => x.name).join(',')}]`.padEnd(20) : '.'.padEnd(20);

    // If a note STARTS on this slot, mark it with a *
    if (active0.some(e => e.time === s)) str0 = '*' + str0.substring(1);
    if (active1.some(e => e.time === s)) str1 = '*' + str1.substring(1);

    console.log(`${s.toString().padStart(4, '0')} | ${str0} | ${str1}`);
}
