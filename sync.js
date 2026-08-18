#!/usr/bin/env node

/**
 * SloFlix to Jellyfin .strm Catalog Synchronizer
 *
 * Connects to SloFlix API, retrieves movies and series catalog,
 * and creates a Jellyfin/TMDB-compliant directory structure with .strm files.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==========================================
// Configuration & Defaults
// ==========================================
const CONFIG = {
  apiBaseUrl: process.env.SLOFLIX_API_URL || 'https://api.sloflix.com',
  bridgeUrl: process.env.BRIDGE_URL || 'http://localhost:3849',
  defaultOutputDir: path.resolve(__dirname, 'media'),
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Referer': 'https://sloflix.com/',
    'Origin': 'https://sloflix.com',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9,sl;q=0.8'
  },
  timeoutMs: 15000,
  pageSize: 100
};

// ==========================================
// CLI Argument Parsing
// ==========================================
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    outputDir: CONFIG.defaultOutputDir,
    moviesDir: null,
    showsDir: null,
    force: false,
    dryRun: false,
    help: false,
    apiUrl: CONFIG.apiBaseUrl,
    bridgeUrl: CONFIG.bridgeUrl,
    limit: null,
    mediaTypeFilter: 'all', // 'all', 'movies', 'shows'
    selectedGenres: [],     // array of genre names e.g. ['Slovenski', 'SLOSiNH']
    minYear: null,
    minRating: null,
    authToken: process.env.SLOFLIX_TOKEN || null,
    username: process.env.SLOFLIX_USERNAME || '',
    password: process.env.SLOFLIX_PASSWORD || '',
    languagePreference: 'sl' // 'sl' (Slovene title first) or 'en' (English title first)

  };




  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--force' || arg === '-f') {
      options.force = true;
    } else if (arg === '--dry-run' || arg === '-d') {
      options.dryRun = true;
    } else if (arg === '--output' || arg === '-o') {
      if (args[i + 1] && !args[i + 1].startsWith('-')) {
        options.outputDir = path.resolve(process.cwd(), args[++i]);
      }
    } else if (arg.startsWith('--output=')) {
      options.outputDir = path.resolve(process.cwd(), arg.split('=')[1]);
    } else if (arg === '--api-url') {
      if (args[i + 1] && !args[i + 1].startsWith('-')) {
        options.apiUrl = args[++i];
      }
    } else if (arg.startsWith('--api-url=')) {
      options.apiUrl = arg.split('=')[1];
    } else if (arg === '--limit') {
      if (args[i + 1] && !args[i + 1].startsWith('-')) {
        options.limit = parseInt(args[++i], 10);
      }
    } else if (arg.startsWith('--limit=')) {
      options.limit = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--token') {
      if (args[i + 1] && !args[i + 1].startsWith('-')) {
        options.authToken = args[++i];
      }
    } else if (arg.startsWith('--token=')) {
      options.authToken = arg.split('=')[1];
    } else if (arg === '--username' || arg === '-u') {
      if (args[i + 1] && !args[i + 1].startsWith('-')) {
        options.username = args[++i];
      }
    } else if (arg === '--password' || arg === '-p') {
      if (args[i + 1] && !args[i + 1].startsWith('-')) {
        options.password = args[++i];
      }
    } else if (arg === '--lang' || arg === '--language') {
      if (args[i + 1] && !args[i + 1].startsWith('-')) {
        options.languagePreference = args[++i];
      }
    }
  }

  return options;
}

function showHelp() {
  console.log(`
SloFlix to Jellyfin .strm Catalog Synchronizer

Usage:
  node sync.js [options]

Options:
  -o, --output <dir>       Set base output directory (default: ./media)
  -f, --force              Overwrite existing .strm files
  -d, --dry-run            Simulate sync process without writing to disk
      --limit <number>     Limit total items processed per category (useful for testing)
      --token <jwt>        Provide SloFlix authToken for full episode / stream sync
  -u, --username <user>    SloFlix username to log in automatically
  -p, --password <pass>    SloFlix password to log in automatically
      --lang <sl|en>       Title language preference (default: sl)
      --api-url <url>      Custom SloFlix API base URL (default: https://api.sloflix.com)
  -h, --help               Show this help message

Examples:
  node sync.js
  node sync.js --dry-run --limit 20
  node sync.js --username myuser --password mypass
  node sync.js --token "eyJhbG..." --output "C:/Jellyfin/media"
`);
}

// ==========================================
// Utilities
// ==========================================

/**
 * Sanitize filename strings by stripping invisible unicode artifacts,
 * and illegal filesystem characters: / \ : * ? " < > |
 */
function sanitizeName(name) {
  if (!name) return '';
  return name
    .toString()
    // Strip zero-width and control characters
    .replace(/[\u200B-\u200D\uFEFF\u200E\u200F\u0000-\u001F]/g, '')
    .replace(/[\\/:*?"<>|]/g, '') // remove forbidden characters
    .replace(/\s+/g, ' ')         // normalize multiple spaces
    .trim();
}


/**
 * Format two-digit number (e.g. 1 -> "01")
 */
function padZero(num) {
  return String(num).padStart(2, '0');
}

/**
 * Extract 4-digit release year from date or year field.
 */
function extractYear(releaseDate, defaultYear = '') {
  if (!releaseDate) return defaultYear;
  const match = String(releaseDate).match(/\b(19\d\d|20\d\d)\b/);
  return match ? match[1] : defaultYear;
}

/**
 * Escape special XML characters for safe inclusion in .nfo files
 */
function escapeXml(unsafe) {
  if (unsafe === null || unsafe === undefined) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Converts WebVTT formatted subtitle text into standard SubRip (.srt) format
 */
function vttToSrt(vttContent) {
  if (!vttContent || typeof vttContent !== 'string') return '';

  // Remove WEBVTT header, NOTE comments, and STYLE/REGION blocks
  let clean = vttContent.replace(/^\uFEFF?WEBVTT[^\r\n]*(\r\n|\n|\r)/, '');
  clean = clean.replace(/NOTE(\s+[\s\S]*?)?(\r\n\r\n|\n\n|\r\r|$)/g, '');
  clean = clean.replace(/STYLE(\s+[\s\S]*?)?(\r\n\r\n|\n\n|\r\r|$)/g, '');
  clean = clean.replace(/REGION(\s+[\s\S]*?)?(\r\n\r\n|\n\n|\r\r|$)/g, '');

  // Normalize line endings to \n
  clean = clean.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Split into cue blocks separated by 2 or more newlines
  const rawBlocks = clean.split(/\n{2,}/);
  const srtBlocks = [];
  let counter = 1;

  // Regex to match timestamp lines: (HH:)?MM:SS.mmm --> (HH:)?MM:SS.mmm
  const timestampRegex = /(?:(\d{2,}):)?(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(?:(\d{2,}):)?(\d{2}):(\d{2})\.(\d{3})/;

  for (const block of rawBlocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const lines = trimmed.split('\n');
    let timestampLineIndex = -1;
    let match = null;

    for (let i = 0; i < lines.length; i++) {
      match = lines[i].match(timestampRegex);
      if (match) {
        timestampLineIndex = i;
        break;
      }
    }

    if (timestampLineIndex === -1 || !match) {
      continue;
    }

    // Format start and end timestamp to 00:00:00,000
    const formatTime = (h, m, s, ms) => {
      const hours = padZero(parseInt(h || '0', 10));
      const minutes = padZero(parseInt(m, 10));
      const seconds = padZero(parseInt(s, 10));
      const milliseconds = String(ms).padEnd(3, '0').slice(0, 3);
      return `${hours}:${minutes}:${seconds},${milliseconds}`;
    };

    const startTime = formatTime(match[1], match[2], match[3], match[4]);
    const endTime = formatTime(match[5], match[6], match[7], match[8]);
    const srtTimestamp = `${startTime} --> ${endTime}`;

    // Subtitle text lines after the timestamp line
    const textLines = lines.slice(timestampLineIndex + 1).map(line => {
      // Remove VTT styling tags like <c.yellow>, </c>, <v Speaker>, <b>, <i>, etc.
      return line.replace(/<\/?[^>]+(>|$)/g, '').trim();
    }).filter(line => line.length > 0);

    if (textLines.length > 0) {
      srtBlocks.push(`${counter}\n${srtTimestamp}\n${textLines.join('\n')}`);
      counter++;
    }
  }

  return srtBlocks.join('\n\n') + (srtBlocks.length > 0 ? '\n' : '');
}

/**
 * Generate Kodi/Jellyfin compatible movie.nfo XML content
 */
function generateMovieNfo(movie, resolvedTitle = '') {
  const title = resolvedTitle || movie.media_name || movie.media_name_en || movie.title || '';
  const originalTitle = movie.media_name_en || movie.media_name || '';
  const plot = movie.media_description || movie.description || movie.media_synopsis || movie.synopsis || '';
  const rawYear = movie.media_year || movie.year || movie.release_date;
  const year = extractYear(rawYear, '');
  const rating = parseFloat(movie.media_rating || (movie.media_rating?.rating ? movie.media_rating.rating / 10 : 0)) || 0;
  
  const genres = (movie.media_genres || []).map(g => typeof g === 'object' ? g.genre_name : g).filter(Boolean);

  let xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`;
  xml += `<movie>\n`;
  xml += `  <title>${escapeXml(title)}</title>\n`;
  if (originalTitle && originalTitle !== title) {
    xml += `  <originaltitle>${escapeXml(originalTitle)}</originaltitle>\n`;
  }
  if (plot) {
    xml += `  <plot>${escapeXml(plot)}</plot>\n`;
    xml += `  <outline>${escapeXml(plot.slice(0, 200))}</outline>\n`;
  }
  if (year) {
    xml += `  <year>${escapeXml(year)}</year>\n`;
  }
  if (rating > 0) {
    xml += `  <rating>${rating.toFixed(1)}</rating>\n`;
  }
  for (const g of genres) {
    xml += `  <genre>${escapeXml(g)}</genre>\n`;
  }
  if (movie.media_duration || movie.duration) {
    const runtime = parseInt(movie.media_duration || movie.duration, 10);
    if (!isNaN(runtime)) xml += `  <runtime>${runtime}</runtime>\n`;
  }
  xml += `</movie>\n`;
  return xml;
}

/**
 * Generate Kodi/Jellyfin compatible tvshow.nfo XML content
 */
function generateShowNfo(show, resolvedTitle = '') {
  let title = resolvedTitle || show.series_name || show.show_name || show.media_name || show.media_name_en || show.name || show.title || '';
  // Never allow generic "Epizoda" or episode strings as the root series title
  if (!title || title.toLowerCase().startsWith('epizoda') || title.toLowerCase() === 'untitled') {
    title = show.series_name || show.show_name || show.original_title || show.media_name_en || show.media_name || '';
  }
  const originalTitle = show.series_name_en || show.media_name_en || show.media_name || '';
  const plot = show.media_description || show.description || show.media_synopsis || show.synopsis || '';
  const rawYear = show.media_year || show.year || show.first_air_date;
  const year = extractYear(rawYear, '');
  const rating = parseFloat(show.media_rating || (show.media_rating?.rating ? show.media_rating.rating / 10 : 0)) || 0;
  
  const genres = (show.media_genres || []).map(g => typeof g === 'object' ? g.genre_name : g).filter(Boolean);

  let xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`;
  xml += `<tvshow>\n`;
  xml += `  <title>${escapeXml(title)}</title>\n`;
  if (originalTitle && originalTitle !== title && !originalTitle.toLowerCase().startsWith('epizoda')) {
    xml += `  <originaltitle>${escapeXml(originalTitle)}</originaltitle>\n`;
  }
  if (plot) {
    xml += `  <plot>${escapeXml(plot)}</plot>\n`;
    xml += `  <outline>${escapeXml(plot.slice(0, 200))}</outline>\n`;
  }
  if (year) {
    xml += `  <year>${escapeXml(year)}</year>\n`;
  }
  if (rating > 0) {
    xml += `  <rating>${rating.toFixed(1)}</rating>\n`;
  }
  for (const g of genres) {
    xml += `  <genre>${escapeXml(g)}</genre>\n`;
  }
  xml += `</tvshow>\n`;
  return xml;
}

/**
 * Recursively find and convert all .vtt subtitles to .srt format in given directory
 */
function convertAllVttInDirectory(dirPath, force = false, onProgress = null) {
  const stats = { found: 0, converted: 0, skipped: 0, errors: 0 };
  if (!fs.existsSync(dirPath)) return stats;

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.vtt')) {
        stats.found++;
        const srtPath = fullPath.slice(0, -4) + '.srt';
        if (fs.existsSync(srtPath) && !force) {
          stats.skipped++;
          continue;
        }
        try {
          const vttContent = fs.readFileSync(fullPath, 'utf8');
          const srtContent = vttToSrt(vttContent);
          if (srtContent && srtContent.trim().length > 0) {
            fs.writeFileSync(srtPath, srtContent, 'utf8');
            stats.converted++;
            if (onProgress) onProgress(`Converted: ${path.basename(fullPath)} -> ${path.basename(srtPath)}`);
          } else {
            stats.skipped++;
          }
        } catch (err) {
          stats.errors++;
          if (onProgress) onProgress(`Error converting ${entry.name}: ${err.message}`);
        }
      }
    }
  }

  walk(dirPath);
  return stats;
}

// ==========================================
// API Client
// ==========================================
class SloFlixClient {
  constructor(baseUrl, headers, token = null) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.headers = { ...headers };
    if (token) {
      this.setAuthToken(token);
    }
  }

  setAuthToken(token) {
    this.headers['Authorization'] = `Bearer ${token}`;
  }

  async login(username, password) {
    console.log(`🔑 Logging into SloFlix as "${username}"...`);
    const url = `${this.baseUrl}/v1/user/login`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          ...this.headers,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (data.code === 200 && data.metadata && data.metadata.access_token) {
        this.setAuthToken(data.metadata.access_token);
        console.log('✅ Logged in successfully!');
        return data.metadata.access_token;
      } else {
        console.warn(`⚠️ Login failed: ${data.error?.message || data.message || 'Unknown error'}`);
      }
    } catch (err) {
      console.warn(`⚠️ Login request error: ${err.message}`);
    }
    return null;
  }

  async fetchEndpoint(endpoint) {
    const url = `${this.baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), CONFIG.timeoutMs);

      const response = await fetch(url, {
        method: 'GET',
        headers: this.headers,
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (err) {
      throw new Error(`Failed to fetch ${url}: ${err.message}`);
    }
  }

  /**
   * Fetch complete media catalog via pagination from /v1/media
   */
  async getCatalog(limit = null, mediaTypeFilter = 'all', sortBy = 1) {
    console.log(`\n🔍 Fetching catalog from SloFlix API (${this.baseUrl}, sortBy=${sortBy})...`);

    let allItems = [];
    let offset = 0;
    const batchSize = CONFIG.pageSize;
    let totalAvailable = Infinity;

    // Determine how many items we need to scan
    // If filtering by movies/shows, we keep scanning until we have enough matching items or reach the end
    while (allItems.length < totalAvailable) {
      const endpoint = `/v1/media?sortBy=${sortBy || 1}&limit=${batchSize}&offset=${offset}`;
      process.stdout.write(`  ⏳ Fetching batch at offset ${offset}... `);


      try {
        const response = await this.fetchEndpoint(endpoint);
        
        let batch = [];
        if (response && response.data && Array.isArray(response.data)) {
          batch = response.data;
          if (response.metadata && response.metadata.all_movies) {
            totalAvailable = response.metadata.all_movies;
          }
        } else if (Array.isArray(response)) {
          batch = response;
        }

        if (batch.length === 0) {
          console.log('done.');
          break;
        }

        allItems.push(...batch);
        console.log(`received ${batch.length} items (${allItems.length}/${totalAvailable === Infinity ? '?' : totalAvailable})`);

        offset += batch.length;

        // Check if we have gathered enough movies/shows to satisfy the limit
        if (limit && limit > 0) {
          if (mediaTypeFilter === 'movies') {
            const currentMovies = allItems.filter(item => item.media_type === 1 || item.type === 'movie' || (!item.media_type && !item.seasons));
            if (currentMovies.length >= limit) break;
          } else if (mediaTypeFilter === 'shows') {
            const currentShows = allItems.filter(item => item.media_type === 2 || item.type === 'series' || item.type === 'show' || item.seasons);
            if (currentShows.length >= limit) break;
          } else if (allItems.length >= limit) {
            break;
          }
        }

        if (batch.length < batchSize) {
          break;
        }
      } catch (err) {
        console.log(`\n  ⚠️ Batch error at offset ${offset}: ${err.message}`);
        break;
      }
    }

    // Separate movies (media_type = 1) and series/shows (media_type = 2)
    const movies = allItems.filter(item => item.media_type === 1 || item.type === 'movie' || (!item.media_type && !item.seasons));
    const shows = allItems.filter(item => item.media_type === 2 || item.type === 'series' || item.type === 'show' || item.seasons);

    return { movies, shows };
  }


  /**
   * Fetch all episodes for a show across all its seasons
   */
  async getShowEpisodes(showId) {
    const allEpisodes = [];
    try {
      // 1. Fetch show metadata to get seasons list
      const singleData = await this.fetchEndpoint(`/v1/media/single/${showId}?dont_count_view=true`);
      const seasons = singleData?.data?.seasons || [1];

      for (const seasonNum of seasons) {
        try {
          const epData = await this.fetchEndpoint(`/v1/media/episodes/${showId}/${seasonNum}`);
          if (epData && epData.data && Array.isArray(epData.data)) {
            for (const ep of epData.data) {
              allEpisodes.push({
                ...ep,
                season: seasonNum,
                episode: ep.episode_index || ep.episode || 1
              });
            }
          }
        } catch (epErr) {
          console.warn(`  ⚠️ Could not fetch Season ${seasonNum} for show ${showId}: ${epErr.message}`);
        }
      }

      if (allEpisodes.length > 0) {
        return allEpisodes;
      }
    } catch (err) {
      console.warn(`  ⚠️ Could not fetch show metadata for ${showId}: ${err.message}`);
    }
    return null;
  }

}

// ==========================================
// Sync Engine
// ==========================================
class SyncEngine {
  constructor(options) {
    this.options = options;
    this.client = new SloFlixClient(options.apiUrl, CONFIG.headers, options.authToken);
    this.onLog = options.onLog || ((msg) => console.log(msg));
    this.moviesBaseDir = options.moviesDir || path.join(options.outputDir, 'Movies');
    this.showsBaseDir = options.showsDir || path.join(options.outputDir, 'Shows');
    this.stats = {
      moviesFound: 0,
      moviesCreated: 0,
      moviesSkipped: 0,
      showsFound: 0,
      episodesFound: 0,
      episodesCreated: 0,
      episodesSkipped: 0,
      createdTitles: [],
      errors: 0
    };
  }

  log(msg) {
    this.onLog(msg);
  }

  resolveTitle(item) {
    const sloName = sanitizeName(item.media_name || item.title || item.name || '');
    const enName = sanitizeName(item.media_name_en || '');

    if (this.options.languagePreference === 'dual') {
      if (sloName && enName && sloName.toLowerCase() !== enName.toLowerCase()) {
        return `${sloName} - ${enName}`;
      }
      return sloName || enName || 'Untitled';
    }

    if (this.options.languagePreference === 'en') {
      return enName || sloName || 'Untitled';
    }

    // Default 'sl'
    return sloName || enName || 'Untitled';
  }


  writeStrmFile(filePath, streamUrl) {
    const dir = path.dirname(filePath);

    if (fs.existsSync(filePath) && !this.options.force) {
      return { status: 'skipped', reason: 'already exists' };
    }

    if (this.options.dryRun) {
      return { status: 'created', dryRun: true };
    }

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, streamUrl.trim() + '\n', 'utf-8');
    return { status: 'created' };
  }

  async downloadFile(url, destPath) {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) return false;
    if (fs.existsSync(destPath) && !this.options.force) return false;
    if (this.options.dryRun) return true;

    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Referer': 'https://sloflix.com/'
        }
      });
      if (!res.ok) return false;

      const buffer = Buffer.from(await res.arrayBuffer());
      // Validate that subtitles are not HTML 404 pages
      if (destPath.endsWith('.vtt') || destPath.endsWith('.srt')) {
        const textStart = buffer.slice(0, 50).toString('utf8');
        if (textStart.includes('<!DOCTYPE') || textStart.includes('<html')) return false;
      }
      fs.writeFileSync(destPath, buffer);
      return true;
    } catch {
      return false;
    }
  }

  async processMovie(movie) {
    const title = this.resolveTitle(movie);
    const rawYear = movie.media_year || movie.year || movie.release_date;
    const year = extractYear(rawYear, '');
    const folderName = year ? `${title} (${year})` : title;
    const fileName = `${folderName}.strm`;

    const targetDir = path.join(this.moviesBaseDir, folderName);
    const targetFile = path.join(targetDir, fileName);

    const mediaId = movie.media_id || movie.id;
    const streamContent = `${this.options.bridgeUrl}/play/${mediaId}`;

    const res = this.writeStrmFile(targetFile, streamContent);

    if (res.status === 'created') {
      this.stats.moviesCreated++;
      this.stats.createdTitles.push({
        type: 'movie',
        title: title,
        year: year,
        target: `${folderName}/${fileName}`
      });
      this.log(`  ➕ [Movie] [${res.dryRun ? 'DRY-RUN' : 'CREATED'}] ${folderName}/${fileName}`);

      // Generate movie.nfo
      if (!this.options.dryRun) {
        try {
          const nfoContent = generateMovieNfo(movie, title);
          const nfoPath = path.join(targetDir, 'movie.nfo');
          if (!fs.existsSync(nfoPath) || this.options.force) {
            fs.writeFileSync(nfoPath, nfoContent, 'utf8');
          }
        } catch (err) {
          this.log(`     ⚠️ [NFO] Napaka pri ustvarjanju movie.nfo: ${err.message}`);
        }
      }

      // Download Poster & Fanart if available
      const posterUrl = movie.media_thumbnail_url || movie.thumbnail;
      const fanartUrl = movie.media_banner_url || movie.banner;
      if (posterUrl) await this.downloadFile(posterUrl, path.join(targetDir, 'poster.jpg'));
      if (fanartUrl) await this.downloadFile(fanartUrl, path.join(targetDir, 'fanart.jpg'));

      // Fetch Subtitles from media single
      if (mediaId && !this.options.dryRun) {
        try {
          const single = await this.client.fetchEndpoint(`/v1/media/single/${mediaId}?dont_count_view=true`);
          const singleData = single?.data || single || {};
          const sources = singleData.media_sources || singleData.sources || [];
          
          let subtitleFound = false;

          // 1. Check sources for subtitle_location
          for (const src of sources) {
            const subLoc = src.subtitle_location || src.subtitles || src.subtitle;
            if (subLoc) {
              const subUrl = subLoc.startsWith('http') ? subLoc : `https://sloflix.com/subtitles/${subLoc}`;
              const subTargetVtt = path.join(targetDir, `${folderName}.sl.vtt`);
              const subTargetSrt = path.join(targetDir, `${folderName}.sl.srt`);
              const downloaded = await this.downloadFile(subUrl, subTargetVtt);
              if (downloaded) {
                subtitleFound = true;
                this.log(`     💬 [Subtitle] Prejeti slovenski podnapisi (${folderName}.sl.vtt)`);
                try {
                  const vttContent = fs.readFileSync(subTargetVtt, 'utf8');
                  const srtContent = vttToSrt(vttContent);
                  if (srtContent && srtContent.trim().length > 0) {
                    fs.writeFileSync(subTargetSrt, srtContent, 'utf8');
                    this.log(`     💬 [Subtitle] Samodejno pretvorjeno v SRT (${folderName}.sl.srt)`);
                  }
                } catch {}
                break;
              }
            }
          }

          // 2. Direct singleData.subtitles or singleData.media_subtitles check
          if (!subtitleFound && (singleData.subtitle_location || singleData.subtitles)) {
            const subLoc = singleData.subtitle_location || singleData.subtitles;
            const subUrl = typeof subLoc === 'string' && subLoc.startsWith('http') ? subLoc : `https://sloflix.com/subtitles/${subLoc}`;
            const subTargetVtt = path.join(targetDir, `${folderName}.sl.vtt`);
            const subTargetSrt = path.join(targetDir, `${folderName}.sl.srt`);
            const downloaded = await this.downloadFile(subUrl, subTargetVtt);
            if (downloaded) {
              this.log(`     💬 [Subtitle] Prejeti slovenski podnapisi (${folderName}.sl.vtt)`);
              try {
                const vttContent = fs.readFileSync(subTargetVtt, 'utf8');
                const srtContent = vttToSrt(vttContent);
                if (srtContent && srtContent.trim().length > 0) {
                  fs.writeFileSync(subTargetSrt, srtContent, 'utf8');
                  this.log(`     💬 [Subtitle] Samodejno pretvorjeno v SRT (${folderName}.sl.srt)`);
                }
              } catch {}
            }
          }
        } catch (subErr) {
          this.log(`     ⚠️ [Subtitle] Napaka pri pridobivanju podnapisov za ${title}: ${subErr.message}`);
        }
      }
    } else {
      this.stats.moviesSkipped++;
      this.log(`  ⏭️  [Movie] [SKIPPED] ${folderName}/${fileName}`);
    }
  }

  async processShow(show) {
    const title = this.resolveTitle(show);
    const rawYear = show.media_year || show.year || show.first_air_date;
    const year = extractYear(rawYear, '');
    const showFolderName = year ? `${title} (${year})` : title;
    const showDir = path.join(this.showsBaseDir, showFolderName);

    // Generate tvshow.nfo
    if (!this.options.dryRun) {
      try {
        if (!fs.existsSync(showDir)) fs.mkdirSync(showDir, { recursive: true });
        const nfoContent = generateShowNfo(show, title);
        const nfoPath = path.join(showDir, 'tvshow.nfo');
        if (!fs.existsSync(nfoPath) || this.options.force) {
          fs.writeFileSync(nfoPath, nfoContent, 'utf8');
        }
      } catch (err) {
        this.log(`     ⚠️ [NFO] Napaka pri ustvarjanju tvshow.nfo: ${err.message}`);
      }
    }

    // Download Show Poster & Fanart
    const posterUrl = show.media_thumbnail_url || show.thumbnail;
    const fanartUrl = show.media_banner_url || show.banner;
    if (posterUrl) await this.downloadFile(posterUrl, path.join(showDir, 'poster.jpg'));
    if (fanartUrl) await this.downloadFile(fanartUrl, path.join(showDir, 'fanart.jpg'));

    const showId = show.media_id || show.id;
    let episodesData = null;

    if (showId) {
      episodesData = await this.client.getShowEpisodes(showId);
    }

    if (episodesData && Array.isArray(episodesData) && episodesData.length > 0) {
      for (const ep of episodesData) {
        this.stats.episodesFound++;
        const seasonNum = ep.season_number || ep.season || 1;
        const epNum = ep.episode_number || ep.episode || 1;
        const seasonFolderName = `Season ${padZero(seasonNum)}`;
        const sxxexx = `S${padZero(seasonNum)}E${padZero(epNum)}`;
        const epFileName = `${title} - ${sxxexx}.strm`;

        const targetDir = path.join(this.showsBaseDir, showFolderName, seasonFolderName);
        const targetFile = path.join(targetDir, epFileName);

        const epId = ep.id || ep.media_id || `${showId}`;
        const streamContent = `${this.options.bridgeUrl}/play/${epId}`;

        const res = this.writeStrmFile(targetFile, streamContent);
        if (res.status === 'created') {
          this.stats.episodesCreated++;
          this.stats.createdTitles.push({
            type: 'episode',
            title: `${title} - ${sxxexx}`,
            year: year,
            target: `${showFolderName}/${seasonFolderName}/${epFileName}`
          });
          this.log(`  ➕ [Episode] [${res.dryRun ? 'DRY-RUN' : 'CREATED'}] ${showFolderName}/${seasonFolderName}/${epFileName}`);

          // Fetch Subtitles for episode if available
          if (epId && !this.options.dryRun) {
            try {
              const single = await this.client.fetchEndpoint(`/v1/media/single/${epId}?dont_count_view=true`);
              const singleData = single?.data || single || {};
              const sources = singleData.media_sources || singleData.sources || [];
              let epSubFound = false;

              for (const src of sources) {
                const subLoc = src.subtitle_location || src.subtitles || src.subtitle;
                if (subLoc) {
                  const subUrl = subLoc.startsWith('http') ? subLoc : `https://sloflix.com/subtitles/${subLoc}`;
                  const subTargetVtt = path.join(targetDir, `${title} - ${sxxexx}.sl.vtt`);
                  const subTargetSrt = path.join(targetDir, `${title} - ${sxxexx}.sl.srt`);
                  const downloaded = await this.downloadFile(subUrl, subTargetVtt);
                  if (downloaded) {
                    epSubFound = true;
                    this.log(`     💬 [Subtitle] Prejeti slovenski podnapisi (${title} - ${sxxexx}.sl.vtt)`);
                    try {
                      const vttContent = fs.readFileSync(subTargetVtt, 'utf8');
                      const srtContent = vttToSrt(vttContent);
                      if (srtContent && srtContent.trim().length > 0) {
                        fs.writeFileSync(subTargetSrt, srtContent, 'utf8');
                        this.log(`     💬 [Subtitle] Samodejno pretvorjeno v SRT (${title} - ${sxxexx}.sl.srt)`);
                      }
                    } catch {}
                    break;
                  }
                }
              }

              if (!epSubFound && (singleData.subtitle_location || singleData.subtitles)) {
                const subLoc = singleData.subtitle_location || singleData.subtitles;
                const subUrl = typeof subLoc === 'string' && subLoc.startsWith('http') ? subLoc : `https://sloflix.com/subtitles/${subLoc}`;
                const subTargetVtt = path.join(targetDir, `${title} - ${sxxexx}.sl.vtt`);
                const subTargetSrt = path.join(targetDir, `${title} - ${sxxexx}.sl.srt`);
                const downloaded = await this.downloadFile(subUrl, subTargetVtt);
                if (downloaded) {
                  this.log(`     💬 [Subtitle] Prejeti slovenski podnapisi (${title} - ${sxxexx}.sl.vtt)`);
                  try {
                    const vttContent = fs.readFileSync(subTargetVtt, 'utf8');
                    const srtContent = vttToSrt(vttContent);
                    if (srtContent && srtContent.trim().length > 0) {
                      fs.writeFileSync(subTargetSrt, srtContent, 'utf8');
                      this.log(`     💬 [Subtitle] Samodejno pretvorjeno v SRT (${title} - ${sxxexx}.sl.srt)`);
                    }
                  } catch {}
                }
              }
            } catch (subErr) {
              this.log(`     ⚠️ [Subtitle] Napaka pri pridobivanju podnapisov za ${title} - ${sxxexx}: ${subErr.message}`);
            }
          }
        } else {
          this.stats.episodesSkipped++;
          this.log(`  ⏭️  [Episode] [SKIPPED] ${showFolderName}/${seasonFolderName}/${epFileName}`);
        }
      }
    } else {
      // Default placeholder S01E01
      this.stats.episodesFound++;
      const seasonFolderName = 'Season 01';
      const epFileName = `${title} - S01E01.strm`;

      const targetDir = path.join(this.showsBaseDir, showFolderName, seasonFolderName);
      const targetFile = path.join(targetDir, epFileName);

      const streamContent = `${this.options.bridgeUrl}/play/${showId}`;
      const res = this.writeStrmFile(targetFile, streamContent);

      if (res.status === 'created') {
        this.stats.episodesCreated++;
        this.stats.createdTitles.push({
          type: 'episode',
          title: `${title} - S01E01`,
          year: year,
          target: `${showFolderName}/${seasonFolderName}/${epFileName}`
        });
        this.log(`  ➕ [Show Placeholder] [${res.dryRun ? 'DRY-RUN' : 'CREATED'}] ${showFolderName}/${seasonFolderName}/${epFileName}`);
      } else {
        this.stats.episodesSkipped++;
        this.log(`  ⏭️  [Show Placeholder] [SKIPPED] ${showFolderName}/${seasonFolderName}/${epFileName}`);
      }
    }
  }





  async preview() {
    const { movies, shows } = await this.client.getCatalog(this.options.limit, this.options.mediaTypeFilter, this.options.sortBy);

    let filteredMovies = this.options.mediaTypeFilter === 'shows' ? [] : movies;
    let filteredShows = this.options.mediaTypeFilter === 'movies' ? [] : shows;


    const matchesFilter = (item) => {
      const itemYear = parseInt(item.media_year || item.year || 0, 10);
      if (this.options.minYear && itemYear && itemYear < this.options.minYear) return false;

      const itemRating = parseFloat(item.media_rating || (item.media_rating?.rating ? item.media_rating.rating / 10 : 0));
      if (this.options.minRating && itemRating && itemRating < this.options.minRating) return false;

      if (this.options.selectedGenres && this.options.selectedGenres.length > 0) {
        const itemGenres = item.media_genres || [];
        const genreNames = itemGenres.map(g => typeof g === 'object' ? g.genre_name : g);
        const hasMatchingGenre = this.options.selectedGenres.some(g => genreNames.includes(g));
        if (!hasMatchingGenre) return false;
      }
      return true;
    };

    filteredMovies = filteredMovies.filter(matchesFilter);
    filteredShows = filteredShows.filter(matchesFilter);

    if (this.options.limit && this.options.limit > 0) {
      filteredMovies = filteredMovies.slice(0, this.options.limit);
      filteredShows = filteredShows.slice(0, Math.max(0, this.options.limit - filteredMovies.length));
    }

    const previewList = [];

    // Movies
    for (const m of filteredMovies) {
      const title = this.resolveTitle(m);
      const rawYear = m.media_year || m.year || m.release_date;
      const year = extractYear(rawYear, '');
      const folderName = year ? `${title} (${year})` : title;
      const genres = (m.media_genres || []).map(g => typeof g === 'object' ? g.genre_name : g).join(', ');

      previewList.push({
        id: m.media_id || m.id,
        type: 'movie',
        titleSlo: m.media_name || title,
        titleEn: m.media_name_en || '',
        year: year || 'N/A',
        rating: m.media_rating || 'N/A',
        genres: genres || 'None',
        targetFolder: `Movies/${folderName}`
      });
    }

    // Shows
    for (const s of filteredShows) {
      const title = this.resolveTitle(s);
      const rawYear = s.media_year || s.year || s.first_air_date;
      const year = extractYear(rawYear, '');
      const folderName = year ? `${title} (${year})` : title;
      const genres = (s.media_genres || []).map(g => typeof g === 'object' ? g.genre_name : g).join(', ');

      previewList.push({
        id: s.media_id || s.id,
        type: 'show',
        titleSlo: s.media_name || title,
        titleEn: s.media_name_en || '',
        year: year || 'N/A',
        rating: s.media_rating || 'N/A',
        genres: genres || 'None',
        targetFolder: `Shows/${folderName}`
      });
    }


    return {
      totalMovies: filteredMovies.length,
      totalShows: filteredShows.length,
      totalItems: filteredMovies.length + filteredShows.length,
      items: previewList
    };
  }

  async run() {

    console.log('====================================================');
    console.log('       SloFlix -> Jellyfin Catalog Synchronizer     ');
    console.log('====================================================');
    console.log(`Target Media Directory : ${this.options.outputDir}`);
    console.log(`Force Overwrite        : ${this.options.force ? 'YES' : 'NO'}`);
    console.log(`Dry Run Mode           : ${this.options.dryRun ? 'YES (No files written)' : 'NO'}`);
    console.log(`API Base URL           : ${this.options.apiUrl}`);
    if (this.options.limit) {
      console.log(`Item Limit             : ${this.options.limit}`);
    }
    console.log('----------------------------------------------------');

    // Attempt login if credentials are supplied
    if (this.options.username && this.options.password) {
      await this.client.login(this.options.username, this.options.password);
    }

    try {
      const { movies, shows } = await this.client.getCatalog(this.options.limit, this.options.mediaTypeFilter, this.options.sortBy);

      // 1. Filter by Media Type
      let filteredMovies = this.options.mediaTypeFilter === 'shows' ? [] : movies;
      let filteredShows = this.options.mediaTypeFilter === 'movies' ? [] : shows;


      // Filter by selected individual IDs (if triggered from Preview Selection)
      if (this.options.targetItemIds && Array.isArray(this.options.targetItemIds) && this.options.targetItemIds.length > 0) {
        const idSet = new Set(this.options.targetItemIds.map(String));
        filteredMovies = filteredMovies.filter(m => idSet.has(String(m.media_id || m.id)));
        filteredShows = filteredShows.filter(s => idSet.has(String(s.media_id || s.id)));
      } else {
        // 2. Filter by Year & Rating & Genres
        const matchesFilter = (item) => {
          const itemYear = parseInt(item.media_year || item.year || 0, 10);
          if (this.options.minYear && itemYear && itemYear < this.options.minYear) {
            return false;
          }

          const itemRating = parseFloat(item.media_rating || (item.media_rating?.rating ? item.media_rating.rating / 10 : 0));
          if (this.options.minRating && itemRating && itemRating < this.options.minRating) {
            return false;
          }

          if (this.options.selectedGenres && this.options.selectedGenres.length > 0) {
            const itemGenres = item.media_genres || [];
            const genreNames = itemGenres.map(g => typeof g === 'object' ? g.genre_name : g);
            const hasMatchingGenre = this.options.selectedGenres.some(g => genreNames.includes(g));
            if (!hasMatchingGenre) {
              return false;
            }
          }

          return true;
        };

        filteredMovies = filteredMovies.filter(matchesFilter);
        filteredShows = filteredShows.filter(matchesFilter);

        // Apply limit if specified
        if (this.options.limit && this.options.limit > 0) {
          filteredMovies = filteredMovies.slice(0, this.options.limit);
          filteredShows = filteredShows.slice(0, Math.max(0, this.options.limit - filteredMovies.length));
        }
      }


      this.stats.moviesFound = filteredMovies.length;
      this.stats.showsFound = filteredShows.length;

      this.log(`\nFiltered catalog: ${filteredMovies.length} movies and ${filteredShows.length} series to sync.\n`);

      // Process Movies
      if (filteredMovies.length > 0) {
        this.log(`🎬 Processing Movies (${filteredMovies.length})...`);
        for (const movie of filteredMovies) {
          try {
            await this.processMovie(movie);
          } catch (err) {
            this.stats.errors++;
            this.log(`  ❌ Error processing movie: ${err.message}`);
          }
        }
      }


      // Process Series
      if (filteredShows.length > 0) {
        this.log(`\n📺 Processing Series (${filteredShows.length})...`);
        for (const show of filteredShows) {
          try {
            await this.processShow(show);
          } catch (err) {
            this.stats.errors++;
            this.log(`  ❌ Error processing show: ${err.message}`);
          }
        }
      }


      // Final Summary
      console.log('\n====================================================');
      console.log('                 Sync Complete Summary              ');
      console.log('====================================================');
      console.log(`🎬 Movies   : ${this.stats.moviesFound} found | ${this.stats.moviesCreated} created | ${this.stats.moviesSkipped} skipped`);
      console.log(`📺 Series   : ${this.stats.showsFound} found`);
      console.log(`🍿 Episodes : ${this.stats.episodesFound} found | ${this.stats.episodesCreated} created | ${this.stats.episodesSkipped} skipped`);
      if (this.stats.errors > 0) {
        console.log(`⚠️  Errors   : ${this.stats.errors}`);
      }
      console.log('====================================================\n');

    } catch (error) {
      console.error('\n❌ Fatal Sync Error:', error.message);
    }
  }
}

// ==========================================
// Main Entrypoint
// ==========================================
export {
  sanitizeName,
  padZero,
  extractYear,
  escapeXml,
  vttToSrt,
  generateMovieNfo,
  generateShowNfo,
  convertAllVttInDirectory,
  SloFlixClient,
  SyncEngine,
  parseArgs
};

if (process.argv[1] && (path.resolve(process.argv[1]) === path.resolve(__filename) || process.argv[1].endsWith('sync.js'))) {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  const engine = new SyncEngine(options);
  engine.run();
}
