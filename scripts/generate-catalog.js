import fs from 'fs';
import path from 'path';

const songsDir = path.join(process.cwd(), 'public', 'songs');
const catalogPath = path.join(process.cwd(), 'src', 'songCatalog.json');

const files = fs.readdirSync(songsDir).filter(f => f.endsWith('.json'));

const catalog = files.map((file, i) => {
    const title = file.replace('.json', '');
    return {
        id: title, // use title as id to fetch
        title: title,
        level: Math.floor(i / 10) + 1, // mock levels
        author: 'Unknown',
        stars: 0
    };
});

fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
console.log(`Generated catalog with ${catalog.length} songs.`);
