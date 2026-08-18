import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  sanitizeName,
  padZero,
  extractYear,
  vttToSrt,
  generateMovieNfo,
  generateShowNfo,
  convertAllVttInDirectory,
  SyncEngine
} from './sync.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testMediaDir = path.join(__dirname, 'test_media');

// Test 1: String Sanitization & Zero-width characters
console.log('🧪 Testing sanitization...');
assert.strictEqual(sanitizeName('Alien: Romulus (2024) / Special * <Cut>?'), 'Alien Romulus (2024) Special Cut');
assert.strictEqual(sanitizeName('Show / Season 1 | Episode 1'), 'Show Season 1 Episode 1');
assert.strictEqual(sanitizeName('‌​​​‌​‌​​‌​​​​‌‌​​Above the Shadows'), 'Above the Shadows');
assert.strictEqual(padZero(3), '03');
assert.strictEqual(padZero(12), '12');
assert.strictEqual(extractYear('2023-05-12'), '2023');
assert.strictEqual(extractYear(2024), '2024');

// Test 2: VTT to SRT Conversion
console.log('🧪 Testing VTT to SRT conversion...');
const sampleVtt = `WEBVTT
Kind: captions
Language: sl

NOTE This is a test comment

00:00:01.500 --> 00:00:04.200
<v Narrator>Pozdravljen svet!</v>

00:00:05.100 --> 00:00:08.750
<c.yellow>To je druga vrstica podnapisov.</c>
Z dodatnim besedilom.
`;

const convertedSrt = vttToSrt(sampleVtt);
assert(convertedSrt.includes('1\n00:00:01,500 --> 00:00:04,200\nPozdravljen svet!'), 'First cue must be converted accurately');
assert(convertedSrt.includes('2\n00:00:05,100 --> 00:00:08,750\nTo je druga vrstica podnapisov.\nZ dodatnim besedilom.'), 'Second cue must be converted accurately');
console.log('  ✅ VTT to SRT converted accurately without tags');

// Test 3: NFO XML Generation
console.log('🧪 Testing NFO XML generation...');
const sampleMovie = {
  media_id: 12345,
  media_name: 'Vesna',
  media_name_en: 'Springtime',
  media_description: 'Priljubljena slovenska romantična komedija.',
  media_year: 1953,
  media_rating: 8.5,
  media_genres: [{ genre_name: 'Komedija' }, { genre_name: 'Romanca' }],
  media_duration: 92
};
const movieNfo = generateMovieNfo(sampleMovie, 'Vesna (1953)');
assert(movieNfo.includes('<title>Vesna (1953)</title>'), 'NFO title must match');
assert(movieNfo.includes('<originaltitle>Springtime</originaltitle>'), 'NFO original title must match');
assert(movieNfo.includes('<plot>Priljubljena slovenska romantična komedija.</plot>'), 'NFO plot must match');
assert(movieNfo.includes('<year>1953</year>'), 'NFO year must match');
assert(movieNfo.includes('<genre>Komedija</genre>'), 'NFO genre must match');
assert(movieNfo.includes('<runtime>92</runtime>'), 'NFO runtime must match');
console.log('  ✅ movie.nfo generated with all fields');

// Clean test media dir
if (fs.existsSync(testMediaDir)) {
  fs.rmSync(testMediaDir, { recursive: true, force: true });
}

// Test 4: Sync Engine Processing Movies and Shows with .nfo generation
console.log('🧪 Testing Movie and Series directory generation...');
const engine = new SyncEngine({
  outputDir: testMediaDir,
  bridgeUrl: 'http://localhost:3849',
  force: false,
  dryRun: false,
  apiUrl: 'https://api.sloflix.com',
  languagePreference: 'dual'
});

// Mock Movie using SloFlix API schema (media_name, media_year, media_id)
await engine.processMovie({
  media_id: 27610,
  media_name: 'Nenavaden par 2',
  media_name_en: 'The Odd Couple II',
  media_description: 'Nadaljevanje slavne komedije.',
  media_year: 1998,
  media_rating: 6.8,
  media_type: 1
});

const movieDir = path.join(testMediaDir, 'Movies', 'Nenavaden par 2 - The Odd Couple II (1998)');
const movieStrmPath = path.join(movieDir, 'Nenavaden par 2 - The Odd Couple II (1998).strm');
const movieNfoPath = path.join(movieDir, 'movie.nfo');

assert(fs.existsSync(movieStrmPath), `Movie file should exist at ${movieStrmPath}`);
assert(fs.existsSync(movieNfoPath), `Movie NFO file should exist at ${movieNfoPath}`);
const movieContent = fs.readFileSync(movieStrmPath, 'utf8').trim();
assert.strictEqual(movieContent, 'http://localhost:3849/play/27610');
console.log('  ✅ movie.strm and movie.nfo created successfully');

// Mock Show
await engine.processShow({
  media_id: 27586,
  media_name: 'Rooster',
  media_description: 'Humoristična serija.',
  media_year: 2026,
  media_type: 2
});

const showDir = path.join(testMediaDir, 'Shows', 'Rooster (2026)');
const showStrmPath = path.join(showDir, 'Season 01', 'Rooster - S01E01.strm');
const showNfoPath = path.join(showDir, 'tvshow.nfo');

assert(fs.existsSync(showStrmPath), `Show file should exist at ${showStrmPath}`);
assert(fs.existsSync(showNfoPath), `Show NFO file should exist at ${showNfoPath}`);
console.log('  ✅ show.strm and tvshow.nfo created successfully');

// Test 5: Mass Subtitle Conversion in Directory
console.log('🧪 Testing convertAllVttInDirectory...');
const testSubVtt = path.join(movieDir, 'test_sub.vtt');
fs.writeFileSync(testSubVtt, sampleVtt, 'utf8');

const convStats = convertAllVttInDirectory(testMediaDir, false);
assert.strictEqual(convStats.converted, 1, 'Should convert 1 VTT file');
const testSubSrt = path.join(movieDir, 'test_sub.srt');
assert(fs.existsSync(testSubSrt), 'Converted .srt file should exist');
console.log('  ✅ Mass conversion successfully produced .srt beside .vtt');

// Test 6: Idempotency (Skip existing)
console.log('🧪 Testing idempotency / skip existing...');
const skipRes = engine.writeStrmFile(movieStrmPath, 'new-content');
assert.strictEqual(skipRes.status, 'skipped');

// Clean up test media dir
fs.rmSync(testMediaDir, { recursive: true, force: true });

console.log('\n🎉 ALL unit and integration tests passed successfully!');

