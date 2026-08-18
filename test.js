import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sanitizeName, padZero, extractYear, SyncEngine } from './sync.js';

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

// Clean test media dir
if (fs.existsSync(testMediaDir)) {
  fs.rmSync(testMediaDir, { recursive: true, force: true });
}

// Test 2: Sync Engine Processing Movies and Shows with SloFlix API schema
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
engine.processMovie({
  media_id: 27610,
  media_name: 'Nenavaden par 2',
  media_name_en: 'The Odd Couple II',
  media_year: 1998,
  media_type: 1
});

const movieStrmPath = path.join(testMediaDir, 'Movies', 'Nenavaden par 2 - The Odd Couple II (1998)', 'Nenavaden par 2 - The Odd Couple II (1998).strm');
assert(fs.existsSync(movieStrmPath), `Movie file should exist at ${movieStrmPath}`);
const movieContent = fs.readFileSync(movieStrmPath, 'utf8').trim();
assert.strictEqual(movieContent, 'http://localhost:3849/play/27610');


// Mock Show
await engine.processShow({
  media_id: 27586,
  media_name: 'Rooster',
  media_year: 2026,
  media_type: 2
});

const showStrmPath = path.join(testMediaDir, 'Shows', 'Rooster (2026)', 'Season 01', 'Rooster - S01E01.strm');
assert(fs.existsSync(showStrmPath), `Show file should exist at ${showStrmPath}`);
const showContent = fs.readFileSync(showStrmPath, 'utf8').trim();
assert.strictEqual(showContent, 'http://localhost:3849/play/27586');


// Test 3: Idempotency (Skip existing)
console.log('🧪 Testing idempotency / skip existing...');
const skipRes = engine.writeStrmFile(movieStrmPath, 'new-content');
assert.strictEqual(skipRes.status, 'skipped');

// Clean up test media dir
fs.rmSync(testMediaDir, { recursive: true, force: true });

console.log('✅ All unit and integration tests passed successfully!');
