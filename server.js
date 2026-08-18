import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SyncEngine, convertAllVttInDirectory, vttToSrt, generateMovieNfo, generateShowNfo, sanitizeName, extractYear } from './sync.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_FILE = process.env.CONFIG_PATH || path.join(__dirname, 'config.json');
const HISTORY_FILE = path.join(path.dirname(CONFIG_FILE), 'sync_history.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

export class SloFlixBridgeServer {
  constructor(options = {}) {
    this.loadConfig();
    this.loadHistory();
    this.port = options.port || this.config.port || 3849;
    this.token = null;
    this.server = null;
    this.isSyncing = false;
    this.currentRunningJobId = null;
    this.logs = 'System initialized.\n';
    this.bridgeLogs = 'Bridge streaming monitor initialized.\n';
    this.jobTimers = new Map();

    this.defaultHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Referer': 'https://sloflix.com/',
      'Origin': 'https://sloflix.com',
      'Accept': 'application/json, text/plain, */*'
    };

    this.initAllJobSchedulers();
  }

  loadConfig() {
    const defaults = {
      apiUrl: 'https://api.sloflix.com',
      port: 3849,
      username: process.env.SLOFLIX_USERNAME || '',
      password: process.env.SLOFLIX_PASSWORD || '',
      bridgeUrl: process.env.BRIDGE_URL || 'http://localhost:3849',
      languagePreference: 'en',
      jellyfinUrl: process.env.JELLYFIN_URL || '',
      jellyfinApiKey: process.env.JELLYFIN_API_KEY || '',
      jellyfinAutoRefresh: true,
      jobs: [
        {
          id: 'job_movies_default',
          name: '🎬 Vsi Filmi (Movies 24h)',
          enabled: true,
          schedule: 'every_24h',
          targetDir: process.env.MOVIES_DIR || '/media/MoviesSloFlix',
          mediaTypeFilter: 'movies',
          sortBy: 1,
          itemLimit: 0,
          minYear: null,
          minRating: null,
          selectedGenres: [],
          languagePreference: 'en',
          lastRun: null,
          nextRun: null
        },
        {
          id: 'job_shows_default',
          name: '📺 Vse Serije (Shows 8h)',
          enabled: true,
          schedule: 'every_8h',
          targetDir: process.env.SHOWS_DIR || '/media/ShowsSloFlix',
          mediaTypeFilter: 'shows',
          sortBy: 1,
          itemLimit: 0,
          minYear: null,
          minRating: null,
          selectedGenres: [],
          languagePreference: 'en',
          lastRun: null,
          nextRun: null
        }
      ]
    };

    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const data = fs.readFileSync(CONFIG_FILE, 'utf8');
        const parsed = JSON.parse(data);
        this.config = { ...defaults, ...parsed };

        // Migrate single-job legacy config to multi-job if needed
        if (!Array.isArray(this.config.jobs) || this.config.jobs.length === 0) {
          this.config.jobs = defaults.jobs;
          this.saveConfig();
        }
      } else {
        this.config = defaults;
        this.saveConfig();
      }
    } catch {
      this.config = defaults;
    }
  }

  saveConfig() {
    try {
      const dir = path.dirname(CONFIG_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2), 'utf8');
    } catch (err) {
      console.error('[Bridge] Error saving config file:', err.message);
    }
  }

  loadHistory() {
    try {
      if (fs.existsSync(HISTORY_FILE)) {
        this.syncHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      } else {
        this.syncHistory = [];
      }
    } catch {
      this.syncHistory = [];
    }
  }

  saveHistory() {
    try {
      const dir = path.dirname(HISTORY_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(this.syncHistory.slice(0, 100), null, 2), 'utf8');
    } catch (err) {
      console.error('[Bridge] Error saving history:', err.message);
    }
  }

  addHistoryEntry(entry) {
    this.syncHistory.unshift({
      id: Date.now().toString(),
      timestamp: new Date().toLocaleString('sl-SI'),
      ...entry
    });
    this.saveHistory();
  }

  appendLog(msg) {
    const time = new Date().toLocaleTimeString();
    const formatted = `[${time}] ${msg}\n`;
    this.logs += formatted;
    if (this.logs.length > 50000) {
      this.logs = this.logs.slice(-30000);
    }
    console.log(`[Sync] ${msg}`);
  }

  appendBridgeLog(msg) {
    const time = new Date().toLocaleTimeString();
    const formatted = `[${time}] ${msg}\n`;
    this.bridgeLogs += formatted;
    if (this.bridgeLogs.length > 50000) {
      this.bridgeLogs = this.bridgeLogs.slice(-30000);
    }
    console.log(`[Bridge] ${msg}`);
  }

  getIntervalMs(schedule) {
    switch (schedule) {
      case 'every_1h': return 1 * 60 * 60 * 1000;
      case 'every_2h': return 2 * 60 * 60 * 1000;
      case 'every_4h': return 4 * 60 * 60 * 1000;
      case 'every_6h': return 6 * 60 * 60 * 1000;
      case 'every_8h': return 8 * 60 * 60 * 1000;
      case 'every_12h': return 12 * 60 * 60 * 1000;
      case 'every_24h':
      case 'daily': return 24 * 60 * 60 * 1000;
      default: return 0;
    }
  }

  initAllJobSchedulers() {
    // Clear existing timers
    for (const timer of this.jobTimers.values()) {
      clearInterval(timer);
    }
    this.jobTimers.clear();

    if (!Array.isArray(this.config.jobs)) return;

    for (const job of this.config.jobs) {
      this.initJobScheduler(job);
    }
  }

  initJobScheduler(job) {
    if (!job || !job.id) return;

    // Clear old timer if any
    if (this.jobTimers.has(job.id)) {
      clearInterval(this.jobTimers.get(job.id));
      this.jobTimers.delete(job.id);
    }

    if (!job.enabled || job.schedule === 'disabled' || !job.schedule) {
      job.nextRun = null;
      return;
    }

    const intervalMs = this.getIntervalMs(job.schedule);
    if (intervalMs > 0) {
      job.nextRun = new Date(Date.now() + intervalMs).toLocaleString('sl-SI');
      this.appendLog(`⏰ Scheduler set for "${job.name}": interval ${job.schedule}, next run at ${job.nextRun}`);

      const timer = setInterval(() => {
        this.appendLog(`⏰ Auto-sync triggered for job: "${job.name}"`);
        job.nextRun = new Date(Date.now() + intervalMs).toLocaleString('sl-SI');
        this.saveConfig();
        this.runJob(job.id, false, 'auto');
      }, intervalMs);

      this.jobTimers.set(job.id, timer);
    }
  }

  async triggerJellyfinRefresh() {
    const jellyfinUrl = (this.config.jellyfinUrl || '').replace(/\/+$/, '');
    const apiKey = this.config.jellyfinApiKey || '';

    if (!jellyfinUrl) {
      return { success: false, message: 'Jellyfin URL is not configured.' };
    }

    try {
      this.appendLog(`🔄 [Jellyfin] Sending library refresh request to ${jellyfinUrl}...`);
      const refreshUrl = `${jellyfinUrl}/Library/Refresh${apiKey ? `?api_key=${encodeURIComponent(apiKey)}` : ''}`;
      
      const headers = {
        'User-Agent': 'JellySloFlix-Bridge/1.0',
        'Accept': 'application/json, text/plain, */*'
      };
      if (apiKey) {
        headers['X-Emby-Token'] = apiKey;
        headers['X-MediaBrowser-Token'] = apiKey;
      }

      const res = await fetch(refreshUrl, {
        method: 'POST',
        headers
      });

      if (res.ok || res.status === 204 || res.status === 200) {
        this.appendLog(`✅ [Jellyfin] Library refresh triggered successfully! (HTTP ${res.status})`);
        return { success: true, message: `Jellyfin library refresh triggered! (HTTP ${res.status})` };
      } else {
        const errorText = await res.text().catch(() => '');
        this.appendLog(`⚠️ [Jellyfin] Refresh request returned status ${res.status}: ${errorText || res.statusText}`);
        return { success: false, message: `Jellyfin returned status ${res.status}: ${errorText || res.statusText}` };
      }
    } catch (err) {
      this.appendLog(`❌ [Jellyfin] Failed to trigger library refresh: ${err.message}`);
      return { success: false, message: err.message };
    }
  }

  async triggerSubtitleConversion(targetPath = null, force = false) {
    const directoriesToScan = [];

    if (targetPath && typeof targetPath === 'string') {
      directoriesToScan.push(targetPath);
    } else if (Array.isArray(this.config.jobs)) {
      for (const job of this.config.jobs) {
        if (job.targetDir && !directoriesToScan.includes(job.targetDir)) {
          directoriesToScan.push(job.targetDir);
        }
      }
    }

    if (directoriesToScan.length === 0) {
      return { success: false, message: 'No target directories found to scan for subtitles.' };
    }

    this.appendLog(`\n======================================================`);
    this.appendLog(`🔄 Starting Subtitle Conversion (VTT -> SRT)...`);
    this.appendLog(`📂 Directories: ${directoriesToScan.join(', ')}`);
    this.appendLog(`======================================================`);

    const totalStats = { found: 0, converted: 0, skipped: 0, errors: 0 };

    for (const dir of directoriesToScan) {
      if (fs.existsSync(dir)) {
        this.appendLog(`🔍 Scanning directory: ${dir}`);
        const stats = convertAllVttInDirectory(dir, force, (msg) => this.appendLog(`  💬 ${msg}`));
        totalStats.found += stats.found;
        totalStats.converted += stats.converted;
        totalStats.skipped += stats.skipped;
        totalStats.errors += stats.errors;
      } else {
        this.appendLog(`⚠️ Directory not found on disk: ${dir}`);
      }
    }

    this.appendLog(`✅ Subtitle conversion complete! (${totalStats.found} found, ${totalStats.converted} converted, ${totalStats.skipped} skipped, ${totalStats.errors} errors)`);
    return { success: true, stats: totalStats };
  }

  async login(username = null, password = null) {
    const user = username || this.config.username;
    const pass = password || this.config.password;

    try {
      const res = await fetch(`${this.config.apiUrl}/v1/user/login`, {
        method: 'POST',
        headers: {
          ...this.defaultHeaders,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username: user, password: pass })
      });
      const data = await res.json();
      if (data.code === 200 && data.metadata?.access_token) {
        if (!username) this.token = data.metadata.access_token;
        return { success: true, token: data.metadata.access_token };
      }
      return { success: false, message: data.error?.message || data.message || 'Login failed' };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  async resolveMedia(mediaId) {
    if (!this.token) {
      const auth = await this.login();
      if (!auth.success) throw new Error(auth.message);
    }

    const singleUrl = `${this.config.apiUrl}/v1/media/single/${mediaId}?dont_count_view=true`;
    let res = await fetch(singleUrl, {
      headers: {
        ...this.defaultHeaders,
        Authorization: `Bearer ${this.token}`
      }
    });

    if (res.status === 401 || res.status === 500) {
      this.token = null;
      await this.login();
      res = await fetch(singleUrl, {
        headers: {
          ...this.defaultHeaders,
          Authorization: `Bearer ${this.token}`
        }
      });
    }

    const data = await res.json();
    if (data.data?.media_sources && data.data.media_sources.length > 0) {
      for (const sourceObj of data.data.media_sources) {
        const rawSource = sourceObj.media_source;
        if (!rawSource) continue;
        
        const match = rawSource.match(/[?&]source=([^&]+)/);
        if (match) {
          return {
            streamUrl: decodeURIComponent(match[1]),
            mediaName: data.data.media_name,
            subtitles: sourceObj.subtitle_location
          };
        }
        return {
          streamUrl: rawSource,
          mediaName: data.data.media_name,
          subtitles: sourceObj.subtitle_location
        };
      }
    }

    throw new Error(`No valid stream URL found for media ID ${mediaId}`);
  }

  async proxyStream(clientReq, clientRes, targetUrl) {
    return new Promise((resolve, reject) => {
      this.proxyStreamNode(clientReq, clientRes, targetUrl, 0, resolve, reject);
    });
  }

  proxyStreamNode(clientReq, clientRes, targetUrl, redirectCount = 0, resolve, reject) {
    if (redirectCount > 5) {
      clientRes.writeHead(500, { 'Content-Type': 'text/plain' });
      clientRes.end('Too many redirects');
      return resolve();
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(targetUrl);
    } catch (err) {
      clientRes.writeHead(400, { 'Content-Type': 'text/plain' });
      clientRes.end('Invalid URL');
      return resolve();
    }

    const isHttps = parsedUrl.protocol === 'https:';
    const httpLib = isHttps ? https : http;

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://player.sloflix.com/',
      'Origin': 'https://player.sloflix.com'
    };

    if (clientReq.headers['range']) {
      headers['range'] = clientReq.headers['range'];
    }

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: clientReq.method || 'GET',
      headers: headers
    };

    const upstreamReq = httpLib.request(options, (upstreamRes) => {
      if ([301, 302, 303, 307, 308].includes(upstreamRes.statusCode) && upstreamRes.headers.location) {
        const redirectUrl = new URL(upstreamRes.headers.location, targetUrl).toString();
        this.appendBridgeLog(`🔄 Redirect (${upstreamRes.statusCode}) to: ${redirectUrl}`);
        upstreamReq.destroy();
        return this.proxyStreamNode(clientReq, clientRes, redirectUrl, redirectCount + 1, resolve, reject);
      }

      const forwardHeaders = {};
      const allowedHeaders = [
        'content-type',
        'content-length',
        'content-range',
        'accept-ranges',
        'last-modified',
        'etag',
        'cache-control'
      ];

      for (const [key, value] of Object.entries(upstreamRes.headers)) {
        if (allowedHeaders.includes(key.toLowerCase())) {
          forwardHeaders[key] = value;
        }
      }

      forwardHeaders['Access-Control-Allow-Origin'] = '*';
      forwardHeaders['Access-Control-Allow-Headers'] = '*';

      clientRes.writeHead(upstreamRes.statusCode, forwardHeaders);
      upstreamRes.pipe(clientRes);

      upstreamRes.on('end', () => resolve());
      upstreamRes.on('error', (err) => {
        this.appendBridgeLog(`Upstream stream error: ${err.message}`);
        resolve();
      });
    });

    upstreamReq.on('error', (err) => {
      this.appendBridgeLog(`Connection error to upstream: ${err.message}`);
      if (!clientRes.headersSent) {
        clientRes.writeHead(502, { 'Content-Type': 'text/plain' });
        clientRes.end(`Bad Gateway: ${err.message}`);
      }
      resolve();
    });

    clientReq.on('close', () => {
      upstreamReq.destroy();
    });

    upstreamReq.end();
  }

  async runJob(jobId, force = false, triggerType = 'manual', targetItemIds = null) {
    if (this.isSyncing) {
      this.appendLog(`⚠️ Cannot run job "${jobId}" - another sync is already in progress!`);
      return { success: false, message: 'Another sync is already in progress' };
    }

    const job = this.config.jobs.find(j => j.id === jobId);
    if (!job) {
      return { success: false, message: `Job "${jobId}" not found` };
    }

    this.isSyncing = true;
    this.currentRunningJobId = jobId;
    const startTime = Date.now();
    this.appendLog(`\n======================================================`);
    this.appendLog(`🚀 Starting Sync Job: "${job.name}" (${triggerType.toUpperCase()})`);
    this.appendLog(`📂 Target Directory: ${job.targetDir}`);
    if (targetItemIds && Array.isArray(targetItemIds) && targetItemIds.length > 0) {
      this.appendLog(`🎯 Selective Sync: ${targetItemIds.length} chosen items`);
    } else {
      this.appendLog(`🎬 Content Scope: ${job.mediaTypeFilter.toUpperCase()} | Limit: ${job.itemLimit || 'All'}`);
    }
    this.appendLog(`======================================================`);

    const moviesDir = job.mediaTypeFilter === 'shows' ? null : job.targetDir;
    const showsDir = job.mediaTypeFilter === 'movies' ? null : job.targetDir;

    // Ensure auth token is available if credentials exist
    if (!this.token && this.config.username && this.config.password) {
      await this.login();
    }

    const engine = new SyncEngine({
      apiUrl: this.config.apiUrl,
      bridgeUrl: this.config.bridgeUrl,
      authToken: this.token,
      outputDir: job.targetDir,
      moviesDir: moviesDir,
      showsDir: showsDir,
      limit: job.itemLimit || null,
      sortBy: parseInt(job.sortBy || 1, 10),
      mediaTypeFilter: job.mediaTypeFilter || 'all',
      selectedGenres: job.selectedGenres || [],
      minYear: job.minYear || null,
      minRating: job.minRating || null,
      targetItemIds: targetItemIds,
      force: force,
      dryRun: false,
      username: this.config.username,
      password: this.config.password,
      languagePreference: job.languagePreference || this.config.languagePreference || 'en',
      onLog: (msg) => this.appendLog(msg)
    });

    try {
      await engine.run();
      const durationSec = Math.round((Date.now() - startTime) / 1000);
      job.lastRun = new Date().toLocaleString('sl-SI');
      this.saveConfig();

      const createdCount = engine.stats.moviesCreated + engine.stats.episodesCreated;
      const skippedCount = engine.stats.moviesSkipped + engine.stats.episodesSkipped;

      this.addHistoryEntry({
        jobId: job.id,
        jobName: job.name,
        trigger: triggerType,
        status: 'success',
        durationSec,
        summary: `+${engine.stats.moviesCreated} filmov, +${engine.stats.episodesCreated} epizod, ${skippedCount} preskočenih (že obstajajo)`,
        moviesCreatedCount: engine.stats.moviesCreated,
        episodesCreatedCount: engine.stats.episodesCreated,
        skippedCount,
        createdItems: engine.stats.createdTitles || []
      });

      this.appendLog(`✅ Job "${job.name}" finished in ${durationSec}s! (+${engine.stats.moviesCreated} movies, +${engine.stats.episodesCreated} episodes, ${skippedCount} skipped)`);

      // Trigger Jellyfin Refresh if new items were created and Jellyfin refresh is enabled
      if (createdCount > 0 && this.config.jellyfinAutoRefresh && this.config.jellyfinUrl) {
        this.appendLog(`🔄 [Jellyfin] New items found (${createdCount}). Triggering automatic library refresh...`);
        this.triggerJellyfinRefresh().catch(err => {
          this.appendLog(`⚠️ [Jellyfin] Auto-refresh error: ${err.message}`);
        });
      }

      return { success: true };
    } catch (err) {
      this.addHistoryEntry({
        jobId: job.id,
        jobName: job.name,
        trigger: triggerType,
        status: 'failed',
        error: err.message,
        summary: `Neuspešno: ${err.message}`,
        createdItems: []
      });
      this.appendLog(`❌ Job "${job.name}" failed: ${err.message}`);
      return { success: false, message: err.message };
    } finally {
      this.isSyncing = false;
      this.currentRunningJobId = null;
    }
  }

  async refreshDirectoryMetadata(folderPath) {
    const absolutePath = path.resolve(folderPath);
    if (!fs.existsSync(absolutePath)) {
      return { success: false, message: 'Directory does not exist' };
    }

    this.appendLog(`🖼️ [Explorer] Refreshing metadata for: ${path.basename(absolutePath)}...`);

    // 1. Scan directory for .strm files to extract SloFlix media ID
    let mediaId = null;
    let isShow = false;

    const findStrmFiles = (dir) => {
      let strmList = [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const ent of entries) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          strmList = strmList.concat(findStrmFiles(full));
        } else if (ent.isFile() && ent.name.endsWith('.strm')) {
          strmList.push(full);
        }
      }
      return strmList;
    };

    const strmFiles = findStrmFiles(absolutePath);
    for (const strmFile of strmFiles) {
      try {
        const content = fs.readFileSync(strmFile, 'utf8');
        const match = content.match(/\/play\/([0-9a-zA-Z_-]+)/);
        if (match) {
          mediaId = match[1];
          break;
        }
      } catch {}
    }

    // Check if it's a show (contains Season XX folders or multiple strms)
    const subEntries = fs.readdirSync(absolutePath, { withFileTypes: true });
    if (subEntries.some(e => e.isDirectory() && e.name.toLowerCase().startsWith('season')) || fs.existsSync(path.join(absolutePath, 'tvshow.nfo'))) {
      isShow = true;
    }

    if (!this.token) {
      const auth = await this.login();
      if (!auth.success) return { success: false, message: `Auth error: ${auth.message}` };
    }

    // 2. Fetch single media details from SloFlix API
    let mediaData = null;
    if (mediaId) {
      try {
        const singleUrl = `${this.config.apiUrl}/v1/media/single/${mediaId}?dont_count_view=true`;
        let res = await fetch(singleUrl, {
          headers: {
            ...this.defaultHeaders,
            Authorization: `Bearer ${this.token}`
          }
        });
        if (res.status === 401) {
          await this.login();
          res = await fetch(singleUrl, {
            headers: {
              ...this.defaultHeaders,
              Authorization: `Bearer ${this.token}`
            }
          });
        }
        const parsed = await res.json();
        mediaData = parsed.data || parsed;
      } catch (err) {
        this.appendLog(`⚠️ Error fetching media ID ${mediaId}: ${err.message}`);
      }
    }

    // Fallback: search by folder title
    if (!mediaData) {
      const folderName = path.basename(absolutePath);
      const cleanTitle = folderName.replace(/\s*\(\d{4}\).*$/, '').trim();
      try {
        const searchUrl = `${this.config.apiUrl}/v1/media/search?keyword=${encodeURIComponent(cleanTitle)}`;
        const res = await fetch(searchUrl, {
          headers: {
            ...this.defaultHeaders,
            Authorization: `Bearer ${this.token}`
          }
        });
        const parsed = await res.json();
        const results = parsed.data || parsed.results || [];
        if (results.length > 0) {
          mediaData = results[0];
          mediaId = mediaData.media_id || mediaData.id;
        }
      } catch {}
    }

    if (!mediaData) {
      return { success: false, message: 'Could not match directory with SloFlix catalog' };
    }

    const title = mediaData.media_name || mediaData.title || path.basename(absolutePath);
    let refreshedItems = [];

    // 3. Re-generate NFO
    try {
      if (isShow || mediaData.media_type === 'series') {
        const nfoContent = generateShowNfo(mediaData, title);
        fs.writeFileSync(path.join(absolutePath, 'tvshow.nfo'), nfoContent, 'utf8');
        refreshedItems.push('tvshow.nfo');
      } else {
        const nfoContent = generateMovieNfo(mediaData, title);
        fs.writeFileSync(path.join(absolutePath, 'movie.nfo'), nfoContent, 'utf8');
        refreshedItems.push('movie.nfo');
      }
    } catch (err) {
      this.appendLog(`⚠️ Error saving NFO: ${err.message}`);
    }

    // Helper for file download
    const downloadHelper = async (url, dest) => {
      if (!url || !url.startsWith('http')) return false;
      try {
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!res.ok) return false;
        const buf = Buffer.from(await res.arrayBuffer());
        if (dest.endsWith('.vtt') || dest.endsWith('.srt')) {
          const str = buf.slice(0, 50).toString('utf8');
          if (str.includes('<html') || str.includes('<!DOCTYPE')) return false;
        }
        fs.writeFileSync(dest, buf);
        return true;
      } catch {
        return false;
      }
    };

    // 4. Re-download Poster & Fanart
    const posterUrl = mediaData.media_thumbnail_url || mediaData.thumbnail;
    const fanartUrl = mediaData.media_banner_url || mediaData.banner;
    if (posterUrl && await downloadHelper(posterUrl, path.join(absolutePath, 'poster.jpg'))) {
      refreshedItems.push('poster.jpg');
    }
    if (fanartUrl && await downloadHelper(fanartUrl, path.join(absolutePath, 'fanart.jpg'))) {
      refreshedItems.push('fanart.jpg');
    }

    // 5. Re-download Subtitles if movie
    if (!isShow && mediaId) {
      try {
        const singleUrl = `${this.config.apiUrl}/v1/media/single/${mediaId}?dont_count_view=true`;
        const res = await fetch(singleUrl, {
          headers: { ...this.defaultHeaders, Authorization: `Bearer ${this.token}` }
        });
        const single = await res.json();
        const singleData = single.data || single || {};
        const sources = singleData.media_sources || singleData.sources || [];
        for (const src of sources) {
          const subLoc = src.subtitle_location || src.subtitles || src.subtitle;
          if (subLoc) {
            const subUrl = subLoc.startsWith('http') ? subLoc : `https://sloflix.com/subtitles/${subLoc}`;
            const baseName = path.basename(absolutePath);
            const subVtt = path.join(absolutePath, `${baseName}.sl.vtt`);
            const subSrt = path.join(absolutePath, `${baseName}.sl.srt`);
            if (await downloadHelper(subUrl, subVtt)) {
              refreshedItems.push(`${baseName}.sl.vtt`);
              try {
                const vttContent = fs.readFileSync(subVtt, 'utf8');
                const srtContent = vttToSrt(vttContent);
                if (srtContent) {
                  fs.writeFileSync(subSrt, srtContent, 'utf8');
                  refreshedItems.push(`${baseName}.sl.srt`);
                }
              } catch {}
            }
            break;
          }
        }
      } catch {}
    }

    // 6. Trigger Jellyfin refresh if configured
    if (this.config.jellyfinAutoRefresh && this.config.jellyfinUrl) {
      this.triggerJellyfinRefresh().catch(() => {});
    }

    this.appendLog(`✅ [Explorer] Successfully refreshed metadata for "${title}": ${refreshedItems.join(', ')}`);
    return {
      success: true,
      message: `Metadata refreshed: ${refreshedItems.join(', ')}`,
      refreshedItems
    };
  }

  serveStaticFile(res, filePath, contentType) {
    fs.readFile(filePath, (err, content) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      } else {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
      }
    });
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

        // CORS Headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range, Authorization');

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        // 1. Video Playback Bridge
        if (reqUrl.pathname.startsWith('/play/')) {
          const mediaId = reqUrl.pathname.replace('/play/', '');
          this.appendBridgeLog(`🎬 Request received for media ID: ${mediaId} from ${req.socket.remoteAddress}`);

          try {
            const mediaInfo = await this.resolveMedia(mediaId);
            this.appendBridgeLog(`▶️ Streaming "${mediaInfo.mediaName}" (ID: ${mediaId})`);
            await this.proxyStream(req, res, mediaInfo.streamUrl);
          } catch (err) {
            this.appendBridgeLog(`❌ Playback failed for ID ${mediaId}: ${err.message}`);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // 2. Global Settings API
        if (reqUrl.pathname === '/api/settings' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(this.config));
          return;
        }

        if (reqUrl.pathname === '/api/settings' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', () => {
            try {
              const updated = JSON.parse(body);
              this.config.username = updated.username ?? this.config.username;
              this.config.password = updated.password ?? this.config.password;
              this.config.bridgeUrl = updated.bridgeUrl ?? this.config.bridgeUrl;
              this.config.port = updated.port ?? this.config.port;
              this.config.languagePreference = updated.languagePreference ?? this.config.languagePreference;
              this.config.jellyfinUrl = updated.jellyfinUrl !== undefined ? updated.jellyfinUrl : this.config.jellyfinUrl;
              this.config.jellyfinApiKey = updated.jellyfinApiKey !== undefined ? updated.jellyfinApiKey : this.config.jellyfinApiKey;
              this.config.jellyfinAutoRefresh = updated.jellyfinAutoRefresh !== undefined ? !!updated.jellyfinAutoRefresh : this.config.jellyfinAutoRefresh;
              this.saveConfig();

              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true, config: this.config }));
            } catch (err) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, message: err.message }));
            }
          });
          return;
        }

        // Jellyfin Connection Test & Manual Refresh
        if (reqUrl.pathname === '/api/jellyfin/test' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', async () => {
            try {
              const payload = JSON.parse(body || '{}');
              if (payload.jellyfinUrl !== undefined) this.config.jellyfinUrl = payload.jellyfinUrl;
              if (payload.jellyfinApiKey !== undefined) this.config.jellyfinApiKey = payload.jellyfinApiKey;
              const result = await this.triggerJellyfinRefresh();
              res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(result));
            } catch (err) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, message: err.message }));
            }
          });
          return;
        }

        // Subtitle Mass Conversion Tool (VTT -> SRT)
        if (reqUrl.pathname === '/api/tools/convert-subtitles' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', async () => {
            try {
              const payload = JSON.parse(body || '{}');
              const targetPath = payload.targetPath || null;
              const force = !!payload.force;
              const result = await this.triggerSubtitleConversion(targetPath, force);
              res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(result));
            } catch (err) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, message: err.message }));
            }
          });
          return;
        }

        // ----------------------------------------------------
        // Graphical File Explorer Endpoints
        // ----------------------------------------------------
        if (reqUrl.pathname === '/api/explorer/roots' && req.method === 'GET') {
          // Return list of accessible directories based on jobs and defaults
          const roots = new Set();
          if (process.env.MOVIES_DIR) roots.add(path.resolve(process.env.MOVIES_DIR));
          if (process.env.SHOWS_DIR) roots.add(path.resolve(process.env.SHOWS_DIR));
          if (Array.isArray(this.config.jobs)) {
            for (const j of this.config.jobs) {
              if (j.targetDir) roots.add(path.resolve(j.targetDir));
            }
          }
          if (roots.size === 0) {
            roots.add(path.resolve(__dirname, 'media'));
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, roots: Array.from(roots) }));
          return;
        }

        if (reqUrl.pathname === '/api/explorer/tree' && req.method === 'GET') {
          const reqPath = reqUrl.searchParams.get('path');
          if (!reqPath) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Path parameter is required' }));
            return;
          }

          const absolutePath = path.resolve(reqPath);
          if (!fs.existsSync(absolutePath)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Directory does not exist' }));
            return;
          }

          try {
            const stat = fs.statSync(absolutePath);
            if (!stat.isDirectory()) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, message: 'Target is not a directory' }));
              return;
            }

            const entries = fs.readdirSync(absolutePath, { withFileTypes: true });
            const items = entries.map(entry => {
              const itemPath = path.join(absolutePath, entry.name);
              let itemStat = null;
              try {
                itemStat = fs.statSync(itemPath);
              } catch {}

              const isDir = entry.isDirectory();
              const ext = isDir ? '' : path.extname(entry.name).toLowerCase();
              
              let childCount = 0;
              if (isDir) {
                try {
                  childCount = fs.readdirSync(itemPath).length;
                } catch {}
              }

              return {
                name: entry.name,
                path: itemPath,
                isDirectory: isDir,
                sizeBytes: itemStat ? itemStat.size : 0,
                mtime: itemStat ? itemStat.mtime.toISOString() : null,
                ext: ext,
                childCount: childCount
              };
            });

            // Sort directories first, then alphabetically
            items.sort((a, b) => {
              if (a.isDirectory && !b.isDirectory) return -1;
              if (!a.isDirectory && b.isDirectory) return 1;
              return a.name.localeCompare(b.name, 'sl', { sensitivity: 'base' });
            });

            const parentPath = path.dirname(absolutePath);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: true,
              currentPath: absolutePath,
              parentPath: parentPath !== absolutePath ? parentPath : null,
              items
            }));
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: err.message }));
          }
          return;
        }

        // Read or Serve File Content (.nfo, .strm, .srt, .vtt, images)
        if (reqUrl.pathname === '/api/explorer/file' && req.method === 'GET') {
          const filePath = reqUrl.searchParams.get('path');
          if (!filePath) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'File path required' }));
            return;
          }

          const absolutePath = path.resolve(filePath);
          if (!fs.existsSync(absolutePath)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'File not found' }));
            return;
          }

          const ext = path.extname(absolutePath).toLowerCase();

          // Image handling (poster.jpg, fanart.jpg)
          if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
            const contentType = ext === '.png' ? 'image/png' : (ext === '.webp' ? 'image/webp' : 'image/jpeg');
            return this.serveStaticFile(res, absolutePath, contentType);
          }

          // Text-based files (.nfo, .strm, .srt, .vtt, .txt, .json)
          try {
            const content = fs.readFileSync(absolutePath, 'utf8');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: true,
              path: absolutePath,
              filename: path.basename(absolutePath),
              ext,
              content
            }));
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: err.message }));
          }
          return;
        }

        // Save edited file (.nfo, .strm, .srt, .vtt)
        if (reqUrl.pathname === '/api/explorer/file' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', () => {
            try {
              const { filePath, content } = JSON.parse(body || '{}');
              if (!filePath || content === undefined) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'filePath and content are required' }));
                return;
              }

              const absolutePath = path.resolve(filePath);
              fs.writeFileSync(absolutePath, content, 'utf8');
              this.appendLog(`✏️ [Explorer] Updated file content: ${path.basename(absolutePath)}`);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true, message: 'File saved successfully' }));
            } catch (err) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, message: err.message }));
            }
          });
          return;
        }

        // Delete File or Directory
        if (reqUrl.pathname === '/api/explorer/item' && req.method === 'DELETE') {
          const itemPath = reqUrl.searchParams.get('path');
          if (!itemPath) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'path is required' }));
            return;
          }

          const absolutePath = path.resolve(itemPath);
          if (!fs.existsSync(absolutePath)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Item not found' }));
            return;
          }

          try {
            const stat = fs.statSync(absolutePath);
            if (stat.isDirectory()) {
              fs.rmSync(absolutePath, { recursive: true, force: true });
              this.appendLog(`🗑️ [Explorer] Deleted directory: ${path.basename(absolutePath)}`);
            } else {
              fs.unlinkSync(absolutePath);
              this.appendLog(`🗑️ [Explorer] Deleted file: ${path.basename(absolutePath)}`);
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: 'Item deleted successfully' }));
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: err.message }));
          }
          return;
        }

        // Refresh Metadata for a Movie or TV Show Directory
        if (reqUrl.pathname === '/api/explorer/refresh-metadata' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', async () => {
            try {
              const { folderPath } = JSON.parse(body || '{}');
              if (!folderPath) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'folderPath is required' }));
                return;
              }

              const result = await this.refreshDirectoryMetadata(folderPath);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(result));
            } catch (err) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, message: err.message }));
            }
          });
          return;
        }

        // 3. Jobs Management REST API
        if (reqUrl.pathname === '/api/jobs' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, jobs: this.config.jobs || [] }));
          return;
        }

        if (reqUrl.pathname === '/api/jobs' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', () => {
            try {
              const newJob = JSON.parse(body);
              newJob.id = newJob.id || 'job_' + Date.now();
              newJob.enabled = newJob.enabled !== false;
              newJob.lastRun = null;
              newJob.nextRun = null;

              this.config.jobs = this.config.jobs || [];
              this.config.jobs.push(newJob);
              this.initJobScheduler(newJob);
              this.saveConfig();

              res.writeHead(201, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true, job: newJob }));
            } catch (err) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, message: err.message }));
            }
          });
          return;
        }

        if (reqUrl.pathname.startsWith('/api/jobs/') && req.method === 'PUT') {
          const jobId = reqUrl.pathname.replace('/api/jobs/', '').split('/')[0];
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', () => {
            try {
              const updatedData = JSON.parse(body);
              const idx = this.config.jobs.findIndex(j => j.id === jobId);
              if (idx === -1) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Job not found' }));
                return;
              }

              this.config.jobs[idx] = { ...this.config.jobs[idx], ...updatedData, id: jobId };
              this.initJobScheduler(this.config.jobs[idx]);
              this.saveConfig();

              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true, job: this.config.jobs[idx] }));
            } catch (err) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, message: err.message }));
            }
          });
          return;
        }

        if (reqUrl.pathname.startsWith('/api/jobs/') && req.method === 'DELETE') {
          const jobId = reqUrl.pathname.replace('/api/jobs/', '').split('/')[0];
          const timer = this.jobTimers.get(jobId);
          if (timer) {
            clearInterval(timer);
            this.jobTimers.delete(jobId);
          }
          this.config.jobs = this.config.jobs.filter(j => j.id !== jobId);
          this.saveConfig();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
          return;
        }

        // Run specific job manually (full or selective items)
        if (reqUrl.pathname.match(/^\/api\/jobs\/([^/]+)\/run$/) && req.method === 'POST') {
          const jobId = reqUrl.pathname.match(/^\/api\/jobs\/([^/]+)\/run$/)[1];
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', () => {
            const parsed = JSON.parse(body || '{}');
            const force = !!parsed.force;
            const targetItemIds = Array.isArray(parsed.targetItemIds) ? parsed.targetItemIds : null;
            this.runJob(jobId, force, targetItemIds ? 'selective' : 'manual', targetItemIds);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: `Started job "${jobId}"` }));
          });
          return;
        }

        // Auth verification endpoint
        if (reqUrl.pathname === '/api/auth/test' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', async () => {
            const { username, password } = JSON.parse(body || '{}');
            const authResult = await this.login(username, password);
            res.writeHead(authResult.success ? 200 : 401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(authResult));
          });
          return;
        }

        // Preview Sync endpoint
        if (reqUrl.pathname === '/api/sync/preview' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', async () => {
            try {
              const currentCfg = JSON.parse(body || '{}');
              const targetDir = currentCfg.targetDir || currentCfg.moviesDir || './test_media';
              const moviesDir = currentCfg.mediaTypeFilter === 'shows' ? null : targetDir;
              const showsDir = currentCfg.mediaTypeFilter === 'movies' ? null : targetDir;

              const engine = new SyncEngine({
                apiUrl: currentCfg.apiUrl ?? this.config.apiUrl,
                bridgeUrl: currentCfg.bridgeUrl ?? this.config.bridgeUrl,
                outputDir: targetDir,
                moviesDir: moviesDir,
                showsDir: showsDir,
                limit: currentCfg.itemLimit !== undefined ? currentCfg.itemLimit : 0,
                sortBy: parseInt(currentCfg.sortBy || 1, 10),
                mediaTypeFilter: currentCfg.mediaTypeFilter || 'all',
                selectedGenres: currentCfg.selectedGenres || [],
                minYear: currentCfg.minYear || null,
                minRating: currentCfg.minRating || null,
                username: currentCfg.username || this.config.username,
                password: currentCfg.password || this.config.password,
                languagePreference: currentCfg.languagePreference || 'en'
              });

              const previewResults = await engine.preview();
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true, ...previewResults }));
            } catch (err) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, message: err.message }));
            }
          });
          return;
        }

        // Live system status endpoint
        if (reqUrl.pathname === '/api/sync/status' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            isSyncing: this.isSyncing,
            currentRunningJobId: this.currentRunningJobId,
            logs: this.logs,
            bridgeLogs: this.bridgeLogs,
            jobs: this.config.jobs || [],
            history: this.syncHistory || []
          }));
          return;
        }

        // Static files (Web GUI)
        if (reqUrl.pathname === '/' || reqUrl.pathname === '/index.html') {
          this.serveStaticFile(res, path.join(PUBLIC_DIR, 'index.html'), 'text/html');
          return;
        }

        if (reqUrl.pathname === '/style.css') {
          this.serveStaticFile(res, path.join(PUBLIC_DIR, 'style.css'), 'text/css');
          return;
        }

        if (reqUrl.pathname === '/app.js') {
          this.serveStaticFile(res, path.join(PUBLIC_DIR, 'app.js'), 'application/javascript');
          return;
        }

        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Route Not Found');
      });

      this.server.listen(this.port, '0.0.0.0', () => {
        this.appendBridgeLog(`🌐 JellySloFlix Web Manager & Stream Bridge running on http://0.0.0.0:${this.port}`);
        resolve();
      });

      this.server.on('error', (err) => {
        console.error('[Bridge] Server listen error:', err);
        reject(err);
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      for (const timer of this.jobTimers.values()) {
        clearInterval(timer);
      }
      this.jobTimers.clear();
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}

if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  const bridge = new SloFlixBridgeServer();
  bridge.start().catch((err) => {
    console.error('Fatal Server Error:', err);
    process.exit(1);
  });
}
