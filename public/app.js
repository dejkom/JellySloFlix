document.addEventListener('DOMContentLoaded', () => {
  // All 24 SloFlix Genres & Tags
  const ALL_GENRES = [
    'Akcija', 'Animacija', 'Biografski', 'Dokumentarni', 'Drama',
    'Družinski', 'Fantazija', 'Grozljivka', 'Glasba', 'Komedija',
    'Kriminalka', 'Muzikal', 'Misterij', 'Pustolovščina', 'Romanca',
    'Sci-Fi', 'Šport', 'Triler', 'Vojni', 'Western', 'Zgodovinski',
    'SLOSiNH', 'SLO', 'Sinhronizirano'
  ];

  const SCHEDULE_LABELS = {
    'disabled': 'Disabled (Manual Only)',
    'every_1h': 'Every 1 Hour',
    'every_2h': 'Every 2 Hours',
    'every_4h': 'Every 4 Hours',
    'every_6h': 'Every 6 Hours',
    'every_8h': 'Every 8 Hours',
    'every_12h': 'Every 12 Hours',
    'every_24h': 'Every 24 Hours (Daily)',
    'daily': 'Daily'
  };

  const SORT_LABELS = {
    1: 'Nazadnje dodano',
    4: 'Leto: najprej novejše',
    3: 'Najboljša ocena',
    6: 'Najbolj gledano',
    5: 'Leto: najprej starejše',
    2: 'Najprej dodano'
  };

  let globalConfig = null;
  let allJobs = [];
  let isSyncing = false;
  let runningJobId = null;

  // File Explorer State
  let currentExplorerPath = '';
  let currentExplorerItems = [];
  let activeEditingFilePath = '';

  // DOM Elements
  const toggleSettingsBtn = document.getElementById('toggle-settings-btn');
  const globalSettingsForm = document.getElementById('global-settings-form');
  const testAuthBtn = document.getElementById('test-auth-btn');
  const testJellyfinBtn = document.getElementById('test-jellyfin-btn');
  const massConvertSubtitlesBtn = document.getElementById('mass-convert-subtitles-btn');
  const jobsGridContainer = document.getElementById('jobs-grid-container');
  const createJobBtn = document.getElementById('create-job-btn');

  // File Explorer Elements
  const explorerRootSelect = document.getElementById('explorer-root-select');
  const explorerRefreshBtn = document.getElementById('explorer-refresh-btn');
  const explorerBreadcrumbs = document.getElementById('explorer-breadcrumbs');
  const explorerSearchInput = document.getElementById('explorer-search-input');
  const explorerItemCount = document.getElementById('explorer-item-count');
  const explorerTableBody = document.getElementById('explorer-table-body');

  // File Editor Modal Elements
  const fileEditorModal = document.getElementById('file-editor-modal');
  const fileEditorTitle = document.getElementById('file-editor-title');
  const fileEditorPath = document.getElementById('file-editor-path');
  const fileEditorContent = document.getElementById('file-editor-content');
  const fileEditorCloseBtn = document.getElementById('file-editor-close-btn');
  const fileEditorCancelBtn = document.getElementById('file-editor-cancel-btn');
  const fileEditorSaveBtn = document.getElementById('file-editor-save-btn');
  const fileImagePreviewContainer = document.getElementById('file-image-preview-container');
  const fileImagePreview = document.getElementById('file-image-preview');
  const fileEditorTextareaContainer = document.getElementById('file-editor-textarea-container');

  // Terminal & Logs Elements
  const tabSyncLogs = document.getElementById('tab-sync-logs');
  const tabBridgeLogs = document.getElementById('tab-bridge-logs');
  const tabJobHistory = document.getElementById('tab-job-history');
  const logOutput = document.getElementById('log-output');
  const bridgeLogOutput = document.getElementById('bridge-log-output');
  const historyContainer = document.getElementById('history-container');
  const historyList = document.getElementById('history-list');
  const syncRunningTag = document.getElementById('sync-running-tag');

  // Job Modal Elements
  const jobModal = document.getElementById('job-modal');
  const jobForm = document.getElementById('job-form');
  const jobModalTitle = document.getElementById('job-modal-title');
  const jobModalCloseBtn = document.getElementById('job-modal-close-btn');
  const jobModalCancelBtn = document.getElementById('job-modal-cancel-btn');
  const jobPreviewBtn = document.getElementById('job-preview-btn');
  const genreContainer = document.getElementById('genre-checkbox-container');

  // Preview Modal Elements
  const previewModal = document.getElementById('preview-modal');
  const previewCloseBtn = document.getElementById('preview-close-btn');
  const previewCancelBtn = document.getElementById('preview-cancel-btn');
  const previewTitle = document.getElementById('preview-title');
  const previewSubtitle = document.getElementById('preview-subtitle');
  const previewSummaryTags = document.getElementById('preview-summary-tags');
  const previewItemsBody = document.getElementById('preview-items-body');

  const toast = document.getElementById('toast');

  // Toast Helper
  function showToast(msg, type = 'success') {
    toast.textContent = msg;
    toast.className = `toast toast-${type}`;
    toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, 3500);
  }

  // Toggle Global Settings
  toggleSettingsBtn.addEventListener('click', () => {
    const isHidden = globalSettingsForm.style.display === 'none';
    globalSettingsForm.style.display = isHidden ? 'block' : 'none';
    toggleSettingsBtn.textContent = isHidden ? '🙈 Hide Settings' : '👁️ Show / Hide Settings';
  });

  // Render Genre Checkboxes in Modal
  function renderGenreCheckboxes(selected = []) {
    const selectedSet = new Set(selected || []);
    genreContainer.innerHTML = ALL_GENRES.map(g => `
      <label class="genre-item">
        <input type="checkbox" value="${g}" ${selectedSet.has(g) ? 'checked' : ''} />
        ${g}
      </label>
    `).join('');
  }

  // Quick Genre Action Buttons
  document.getElementById('genre-select-all')?.addEventListener('click', () => {
    genreContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
  });

  document.getElementById('genre-clear-all')?.addEventListener('click', () => {
    genreContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
  });

  document.getElementById('genre-slo-only')?.addEventListener('click', () => {
    const sloTags = new Set(['SLOSiNH', 'SLO', 'Sinhronizirano']);
    genreContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.checked = sloTags.has(cb.value);
    });
  });

  // Tabs Switching
  tabSyncLogs.addEventListener('click', () => {
    tabSyncLogs.classList.add('active');
    tabBridgeLogs.classList.remove('active');
    tabJobHistory.classList.remove('active');
    logOutput.style.display = 'block';
    bridgeLogOutput.style.display = 'none';
    historyContainer.style.display = 'none';
  });

  tabBridgeLogs.addEventListener('click', () => {
    tabBridgeLogs.classList.add('active');
    tabSyncLogs.classList.remove('active');
    tabJobHistory.classList.remove('active');
    logOutput.style.display = 'none';
    bridgeLogOutput.style.display = 'block';
    historyContainer.style.display = 'none';
  });

  tabJobHistory.addEventListener('click', () => {
    tabJobHistory.classList.add('active');
    tabSyncLogs.classList.remove('active');
    tabBridgeLogs.classList.remove('active');
    logOutput.style.display = 'none';
    bridgeLogOutput.style.display = 'none';
    historyContainer.style.display = 'block';
  });

  // Load Global Settings & Jobs
  async function loadInitialData() {
    try {
      const res = await fetch('/api/settings');
      globalConfig = await res.json();

      document.getElementById('username').value = globalConfig.username || '';
      document.getElementById('password').value = globalConfig.password || '';
      document.getElementById('bridgeUrl').value = globalConfig.bridgeUrl || 'http://localhost:3849';
      document.getElementById('port').value = globalConfig.port || 3849;
      
      document.getElementById('jellyfinUrl').value = globalConfig.jellyfinUrl || '';
      document.getElementById('jellyfinApiKey').value = globalConfig.jellyfinApiKey || '';
      document.getElementById('jellyfinAutoRefresh').checked = globalConfig.jellyfinAutoRefresh !== false;

      allJobs = globalConfig.jobs || [];
      renderJobsList(allJobs);
      loadExplorerRoots();
    } catch (err) {
      showToast(`Error loading configuration: ${err.message}`, 'error');
    }
  }

  // Render Job Cards Grid
  function renderJobsList(jobs = []) {
    if (!jobsGridContainer) return;
    if (jobs.length === 0) {
      jobsGridContainer.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 2rem; color: var(--text-muted);">No sync jobs defined. Click "Create New Sync Job" to get started.</div>';
      return;
    }

    jobsGridContainer.innerHTML = jobs.map(job => {
      const isRunning = isSyncing && runningJobId === job.id;
      const statusPill = isRunning
        ? '<span class="job-pill job-pill-running">RUNNING NOW</span>'
        : (job.enabled !== false
          ? '<span class="job-pill job-pill-enabled">ACTIVE</span>'
          : '<span class="job-pill job-pill-disabled">PAUSED</span>');

      const schedLabel = SCHEDULE_LABELS[job.schedule] || job.schedule || 'Disabled';
      const sortLabel = SORT_LABELS[job.sortBy] || 'Nazadnje dodano';
      const scopeLabel = job.mediaTypeFilter === 'movies' ? '🎬 Movies Only' : (job.mediaTypeFilter === 'shows' ? '📺 TV Shows Only' : '🎬 & 📺 Both');

      return `
        <div class="job-card" id="card-${job.id}">
          <div class="job-card-header">
            <div class="job-title-group">
              <h3>${job.name}</h3>
              <div style="margin-top: 0.25rem;">${statusPill}</div>
            </div>
            <button type="button" class="btn btn-outline btn-sm toggle-job-btn" data-id="${job.id}" title="${job.enabled ? 'Pause Job' : 'Enable Job'}">
              ${job.enabled ? '⏸️ Pause' : '▶️ Enable'}
            </button>
          </div>

          <div class="job-meta-grid">
            <div>
              <span class="job-meta-label">Target Folder:</span><br>
              <span class="job-meta-val" style="color: #86efac; font-family: monospace;">${job.targetDir}</span>
            </div>
            <div>
              <span class="job-meta-label">Schedule:</span><br>
              <span class="job-meta-val" style="color: #93c5fd;">${schedLabel}</span>
            </div>
            <div>
              <span class="job-meta-label">Scope & Sort:</span><br>
              <span class="job-meta-val">${scopeLabel} (${sortLabel})</span>
            </div>
            <div>
              <span class="job-meta-label">Next Run:</span><br>
              <span class="job-meta-val" style="color: #facc15;">${job.nextRun || (job.enabled && job.schedule !== 'disabled' ? 'Pending' : 'Manual')}</span>
            </div>
          </div>

          <div class="job-actions">
            <button type="button" class="btn btn-outline btn-sm edit-job-btn" data-id="${job.id}">✏️ Edit</button>
            <button type="button" class="btn btn-outline btn-sm delete-job-btn" data-id="${job.id}" style="color: #f87171;">🗑️</button>
            <button type="button" class="btn btn-success btn-sm run-job-btn" data-id="${job.id}" ${isSyncing ? 'disabled' : ''}>
              ▶️ Run Job
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Attach Action Handlers
    document.querySelectorAll('.run-job-btn').forEach(btn => {
      btn.addEventListener('click', () => runJobById(btn.dataset.id));
    });

    document.querySelectorAll('.edit-job-btn').forEach(btn => {
      btn.addEventListener('click', () => openEditJobModal(btn.dataset.id));
    });

    document.querySelectorAll('.delete-job-btn').forEach(btn => {
      btn.addEventListener('click', () => deleteJobById(btn.dataset.id));
    });

    document.querySelectorAll('.toggle-job-btn').forEach(btn => {
      btn.addEventListener('click', () => toggleJobById(btn.dataset.id));
    });
  }

  // Run Specific Job
  async function runJobById(jobId) {
    if (isSyncing) return;
    try {
      showToast('Starting sync job...', 'info');
      const res = await fetch(`/api/jobs/${jobId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: false })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Job started successfully!', 'success');
      } else {
        showToast(data.message, 'error');
      }
    } catch (err) {
      showToast(`Error running job: ${err.message}`, 'error');
    }
  }

  // Toggle Job Active / Paused
  async function toggleJobById(jobId) {
    const job = allJobs.find(j => j.id === jobId);
    if (!job) return;

    try {
      const updated = { ...job, enabled: !job.enabled };
      const res = await fetch(`/api/jobs/${jobId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Job "${job.name}" is now ${updated.enabled ? 'active' : 'paused'}.`);
        loadInitialData();
      }
    } catch (err) {
      showToast(`Error toggling job: ${err.message}`, 'error');
    }
  }

  // Delete Job
  async function deleteJobById(jobId) {
    const job = allJobs.find(j => j.id === jobId);
    if (!job) return;
    if (!confirm(`Are you sure you want to delete job "${job.name}"?`)) return;

    try {
      const res = await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        showToast(`Job "${job.name}" deleted.`, 'success');
        loadInitialData();
      }
    } catch (err) {
      showToast(`Error deleting job: ${err.message}`, 'error');
    }
  }

  // Open Create Job Modal
  createJobBtn.addEventListener('click', () => {
    jobModalTitle.textContent = '➕ Create New Sync Job';
    document.getElementById('job-id').value = '';
    document.getElementById('job-name').value = '';
    document.getElementById('job-target-dir').value = '/media/MoviesSloFlix';
    document.getElementById('job-schedule').value = 'every_24h';
    document.getElementById('job-media-type').value = 'all';
    document.getElementById('job-sort-by').value = '1';
    document.getElementById('job-item-limit').value = '';
    document.getElementById('job-min-year').value = '';
    document.getElementById('job-min-rating').value = '';
    document.getElementById('job-naming').value = 'en';

    renderGenreCheckboxes([]);
    jobModal.style.display = 'flex';
  });

  // Open Edit Job Modal
  function openEditJobModal(jobId) {
    const job = allJobs.find(j => j.id === jobId);
    if (!job) return;

    jobModalTitle.textContent = `⚙️ Edit Job: ${job.name}`;
    document.getElementById('job-id').value = job.id;
    document.getElementById('job-name').value = job.name || '';
    document.getElementById('job-target-dir').value = job.targetDir || '';
    document.getElementById('job-schedule').value = job.schedule || 'disabled';
    document.getElementById('job-media-type').value = job.mediaTypeFilter || 'all';
    document.getElementById('job-sort-by').value = job.sortBy || '1';
    document.getElementById('job-item-limit').value = job.itemLimit || '';
    document.getElementById('job-min-year').value = job.minYear || '';
    document.getElementById('job-min-rating').value = job.minRating || '';
    document.getElementById('job-naming').value = job.languagePreference || 'en';

    renderGenreCheckboxes(job.selectedGenres || []);
    jobModal.style.display = 'flex';
  }

  // Close Job Modal
  function closeJobModal() {
    jobModal.style.display = 'none';
  }
  jobModalCloseBtn.addEventListener('click', closeJobModal);
  jobModalCancelBtn.addEventListener('click', closeJobModal);

  // Save Job (Create or Update)
  jobForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const selectedGenres = Array.from(
      genreContainer.querySelectorAll('input[type="checkbox"]:checked')
    ).map(cb => cb.value);

    const jobId = document.getElementById('job-id').value;
    const payload = {
      name: document.getElementById('job-name').value,
      targetDir: document.getElementById('job-target-dir').value,
      schedule: document.getElementById('job-schedule').value,
      mediaTypeFilter: document.getElementById('job-media-type').value,
      sortBy: parseInt(document.getElementById('job-sort-by').value || '1', 10),
      itemLimit: parseInt(document.getElementById('job-item-limit').value || '0', 10),
      minYear: parseInt(document.getElementById('job-min-year').value || '0', 10) || null,
      minRating: parseFloat(document.getElementById('job-min-rating').value || '0') || null,
      selectedGenres: selectedGenres,
      languagePreference: document.getElementById('job-naming').value,
      enabled: true
    };

    try {
      const url = jobId ? `/api/jobs/${jobId}` : '/api/jobs';
      const method = jobId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (data.success) {
        showToast(`Job "${payload.name}" saved successfully!`, 'success');
        closeJobModal();
        loadInitialData();
      } else {
        showToast(data.message, 'error');
      }
    } catch (err) {
      showToast(`Save error: ${err.message}`, 'error');
    }
  });

  // Save Global Settings
  globalSettingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      username: document.getElementById('username').value,
      password: document.getElementById('password').value,
      bridgeUrl: document.getElementById('bridgeUrl').value,
      port: parseInt(document.getElementById('port').value, 10),
      jellyfinUrl: document.getElementById('jellyfinUrl').value.trim(),
      jellyfinApiKey: document.getElementById('jellyfinApiKey').value.trim(),
      jellyfinAutoRefresh: document.getElementById('jellyfinAutoRefresh').checked
    };

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        showToast('Settings saved successfully!', 'success');
        loadInitialData();
      }
    } catch (err) {
      showToast(`Error saving settings: ${err.message}`, 'error');
    }
  });

  // Test Jellyfin Connection / Refresh
  testJellyfinBtn?.addEventListener('click', async () => {
    testJellyfinBtn.disabled = true;
    testJellyfinBtn.textContent = 'Testing connection...';
    try {
      const res = await fetch('/api/jellyfin/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jellyfinUrl: document.getElementById('jellyfinUrl').value.trim(),
          jellyfinApiKey: document.getElementById('jellyfinApiKey').value.trim()
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast('✅ Jellyfin connection successful! Library refresh triggered.', 'success');
      } else {
        showToast(`⚠️ Jellyfin error: ${data.message}`, 'error');
      }
    } catch (err) {
      showToast(`Connection failed: ${err.message}`, 'error');
    } finally {
      testJellyfinBtn.disabled = false;
      testJellyfinBtn.textContent = '🔗 Test Jellyfin Connection / Refresh';
    }
  });

  // Mass Subtitle Conversion (VTT -> SRT)
  massConvertSubtitlesBtn?.addEventListener('click', async () => {
    if (!confirm('Ali želite pretvoriti vse obstoječe .vtt podnapise v mapah v format .srt?')) return;

    massConvertSubtitlesBtn.disabled = true;
    massConvertSubtitlesBtn.textContent = 'Pretvarjam podnapise...';
    try {
      showToast('Zagon množične konverzije VTT -> SRT...', 'info');
      const res = await fetch('/api/tools/convert-subtitles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: false })
      });
      const data = await res.json();
      if (data.success) {
        const s = data.stats;
        showToast(`✅ Konverzija zaključena! Najdeno: ${s.found}, Pretvorjeno: ${s.converted}, Že obstaja: ${s.skipped}`, 'success');
        if (currentExplorerPath) {
          loadExplorerPath(currentExplorerPath);
        }
      } else {
        showToast(`Napaka pri konverziji: ${data.message}`, 'error');
      }
    } catch (err) {
      showToast(`Napaka: ${err.message}`, 'error');
    } finally {
      massConvertSubtitlesBtn.disabled = false;
      massConvertSubtitlesBtn.textContent = '🔄 Convert all existing VTT to SRT';
    }
  });

  // ----------------------------------------------------
  // File Explorer Logic
  // ----------------------------------------------------
  async function loadExplorerRoots() {
    try {
      const res = await fetch('/api/explorer/roots');
      const data = await res.json();
      if (data.success && data.roots && data.roots.length > 0) {
        explorerRootSelect.innerHTML = data.roots.map(r => `<option value="${r}">${r}</option>`).join('');
        if (!currentExplorerPath) {
          loadExplorerPath(data.roots[0]);
        }
      }
    } catch (err) {
      console.warn('Error loading explorer roots:', err.message);
    }
  }

  explorerRootSelect?.addEventListener('change', () => {
    const selected = explorerRootSelect.value;
    if (selected) loadExplorerPath(selected);
  });

  explorerRefreshBtn?.addEventListener('click', () => {
    if (currentExplorerPath) {
      loadExplorerPath(currentExplorerPath);
    } else if (explorerRootSelect.value) {
      loadExplorerPath(explorerRootSelect.value);
    }
  });

  async function loadExplorerPath(targetPath) {
    explorerTableBody.innerHTML = '<tr><td colspan="5" style="padding:1.5rem; text-align:center; color:#94a3b8;">⏳ Loading contents...</td></tr>';
    try {
      const res = await fetch(`/api/explorer/tree?path=${encodeURIComponent(targetPath)}`);
      const data = await res.json();
      if (!data.success) {
        explorerTableBody.innerHTML = `<tr><td colspan="5" style="padding:1.5rem; text-align:center; color:#ef4444;">❌ Error: ${data.message}</td></tr>`;
        return;
      }

      currentExplorerPath = data.currentPath;
      currentExplorerItems = data.items || [];
      renderExplorerBreadcrumbs(data.currentPath);
      renderExplorerTable(currentExplorerItems, data.parentPath);
    } catch (err) {
      explorerTableBody.innerHTML = `<tr><td colspan="5" style="padding:1.5rem; text-align:center; color:#ef4444;">❌ Network error: ${err.message}</td></tr>`;
    }
  }

  function renderExplorerBreadcrumbs(fullPath) {
    const parts = fullPath.replace(/\\/g, '/').split('/').filter(Boolean);
    const isWindowsDrive = fullPath.match(/^[A-Za-z]:/);
    
    let currentAcc = isWindowsDrive ? parts[0] : '';
    let breadcrumbHtml = `<span class="breadcrumb-item" data-path="${isWindowsDrive ? parts[0] + '/' : '/'}">📁 Root</span>`;

    const startIndex = isWindowsDrive ? 1 : 0;
    for (let i = startIndex; i < parts.length; i++) {
      currentAcc += (currentAcc.endsWith('/') || currentAcc.endsWith('\\') ? '' : '/') + parts[i];
      const isLast = i === parts.length - 1;
      breadcrumbHtml += `<span class="breadcrumb-separator">/</span>`;
      if (isLast) {
        breadcrumbHtml += `<span class="breadcrumb-item active">${parts[i]}</span>`;
      } else {
        breadcrumbHtml += `<span class="breadcrumb-item" data-path="${currentAcc}">${parts[i]}</span>`;
      }
    }

    explorerBreadcrumbs.innerHTML = breadcrumbHtml;

    explorerBreadcrumbs.querySelectorAll('.breadcrumb-item[data-path]').forEach(el => {
      el.addEventListener('click', () => loadExplorerPath(el.dataset.path));
    });
  }

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function getFileIcon(item) {
    if (item.isDirectory) return '📁';
    const ext = (item.ext || '').toLowerCase();
    switch (ext) {
      case '.strm': return '🎬';
      case '.nfo': return '📄';
      case '.srt':
      case '.vtt': return '💬';
      case '.jpg':
      case '.jpeg':
      case '.png':
      case '.webp': return '🖼️';
      default: return '📄';
    }
  }

  function renderExplorerTable(items, parentPath) {
    const query = (explorerSearchInput.value || '').trim().toLowerCase();
    const filtered = query
      ? items.filter(it => it.name.toLowerCase().includes(query))
      : items;

    explorerItemCount.textContent = `${filtered.length} item(s)`;

    let rowsHtml = '';

    // Up one level row
    if (parentPath && parentPath !== currentExplorerPath) {
      rowsHtml += `
        <tr class="explorer-item-row" data-action="navigate" data-path="${parentPath}" style="background:#0f1523;">
          <td colspan="5" style="padding: 0.6rem 0.8rem; color: #60a5fa; font-weight: 500;">
            <span class="explorer-icon">⬆️</span> .. [Go Up One Level]
          </td>
        </tr>
      `;
    }

    if (filtered.length === 0) {
      rowsHtml += `<tr><td colspan="5" style="padding: 2rem; text-align:center; color:#64748b;">This folder is empty.</td></tr>`;
      explorerTableBody.innerHTML = rowsHtml;
      return;
    }

    for (const item of filtered) {
      const icon = getFileIcon(item);
      const extClass = item.isDirectory ? 'ext-dir' : `ext-${(item.ext || '').replace('.', '')}`;
      const extLabel = item.isDirectory ? 'DIR' : (item.ext ? item.ext.toUpperCase().replace('.', '') : 'FILE');
      const sizeLabel = item.isDirectory ? `${item.childCount || 0} items` : formatBytes(item.sizeBytes);
      const dateLabel = item.mtime ? new Date(item.mtime).toLocaleString('sl-SI') : '-';

      const isTextEditable = !item.isDirectory && ['.nfo', '.strm', '.srt', '.vtt', '.txt', '.json'].includes((item.ext || '').toLowerCase());
      const isImage = !item.isDirectory && ['.jpg', '.jpeg', '.png', '.webp'].includes((item.ext || '').toLowerCase());
      const isVtt = !item.isDirectory && (item.ext || '').toLowerCase() === '.vtt';

      rowsHtml += `
        <tr class="explorer-item-row" data-action="${item.isDirectory ? 'navigate' : (isTextEditable || isImage ? 'view' : '')}" data-path="${item.path}" data-ext="${item.ext}">
          <td style="padding: 0.6rem 0.8rem;">
            <span class="explorer-icon">${icon}</span>
            <span style="font-weight: ${item.isDirectory ? '600' : '400'}; color: ${item.isDirectory ? '#f3f4f6' : '#e2e8f0'};">${item.name}</span>
          </td>
          <td style="padding: 0.6rem 0.8rem;">
            <span class="ext-badge ${extClass}">${extLabel}</span>
          </td>
          <td style="padding: 0.6rem 0.8rem; color: #94a3b8; font-size: 0.8rem;">${sizeLabel}</td>
          <td style="padding: 0.6rem 0.8rem; color: #94a3b8; font-size: 0.8rem;">${dateLabel}</td>
          <td style="padding: 0.6rem 0.8rem; text-align: right;" onclick="event.stopPropagation();">
            <div style="display: inline-flex; gap: 0.3rem;">
              ${isTextEditable ? `<button type="button" class="btn-icon" data-action="edit" data-path="${item.path}" title="Edit / View Content">✏️</button>` : ''}
              ${isImage ? `<button type="button" class="btn-icon" data-action="view-image" data-path="${item.path}" title="Preview Poster / Fanart">👁️</button>` : ''}
              ${isVtt ? `<button type="button" class="btn-icon" data-action="convert-vtt" data-path="${item.path}" title="Convert this VTT to SRT">🔄</button>` : ''}
              <button type="button" class="btn-icon btn-icon-danger" data-action="delete" data-path="${item.path}" data-name="${item.name}" data-is-dir="${item.isDirectory}" title="Delete">🗑️</button>
            </div>
          </td>
        </tr>
      `;
    }

    explorerTableBody.innerHTML = rowsHtml;

    // Attach Row and Action handlers
    explorerTableBody.querySelectorAll('.explorer-item-row').forEach(row => {
      row.addEventListener('click', () => {
        const action = row.dataset.action;
        const target = row.dataset.path;
        if (action === 'navigate') {
          loadExplorerPath(target);
        } else if (action === 'view') {
          openFileEditor(target);
        }
      });
    });

    explorerTableBody.querySelectorAll('button[data-action="edit"]').forEach(btn => {
      btn.addEventListener('click', () => openFileEditor(btn.dataset.path));
    });

    explorerTableBody.querySelectorAll('button[data-action="view-image"]').forEach(btn => {
      btn.addEventListener('click', () => openImagePreview(btn.dataset.path));
    });

    explorerTableBody.querySelectorAll('button[data-action="convert-vtt"]').forEach(btn => {
      btn.addEventListener('click', () => convertSingleVtt(btn.dataset.path));
    });

    explorerTableBody.querySelectorAll('button[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', () => deleteExplorerItem(btn.dataset.path, btn.dataset.name, btn.dataset.isDir === 'true'));
    });
  }

  explorerSearchInput?.addEventListener('input', () => {
    if (currentExplorerItems) {
      renderExplorerTable(currentExplorerItems, null);
    }
  });

  // Open Text File Editor
  async function openFileEditor(filePath) {
    activeEditingFilePath = filePath;
    fileEditorTitle.textContent = `📝 Edit File: ${filePath.split(/[\/\\]/).pop()}`;
    fileEditorPath.textContent = filePath;
    fileImagePreviewContainer.style.display = 'none';
    fileEditorTextareaContainer.style.display = 'block';
    fileEditorSaveBtn.style.display = 'inline-block';
    fileEditorContent.value = 'Loading content...';
    fileEditorModal.style.display = 'flex';

    try {
      const res = await fetch(`/api/explorer/file?path=${encodeURIComponent(filePath)}`);
      const data = await res.json();
      if (data.success) {
        fileEditorContent.value = data.content;
      } else {
        fileEditorContent.value = `Error loading file: ${data.message}`;
      }
    } catch (err) {
      fileEditorContent.value = `Network error: ${err.message}`;
    }
  }

  // Open Image Preview
  function openImagePreview(filePath) {
    activeEditingFilePath = filePath;
    fileEditorTitle.textContent = `🖼️ Image Preview: ${filePath.split(/[\/\\]/).pop()}`;
    fileEditorPath.textContent = filePath;
    fileImagePreviewContainer.style.display = 'block';
    fileImagePreview.src = `/api/explorer/file?path=${encodeURIComponent(filePath)}&t=${Date.now()}`;
    fileEditorTextareaContainer.style.display = 'none';
    fileEditorSaveBtn.style.display = 'none';
    fileEditorModal.style.display = 'flex';
  }

  // Save File Editor Changes
  fileEditorSaveBtn?.addEventListener('click', async () => {
    if (!activeEditingFilePath) return;
    fileEditorSaveBtn.disabled = true;
    fileEditorSaveBtn.textContent = 'Saving...';
    try {
      const res = await fetch('/api/explorer/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: activeEditingFilePath,
          content: fileEditorContent.value
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast('File saved successfully!', 'success');
        fileEditorModal.style.display = 'none';
        if (currentExplorerPath) loadExplorerPath(currentExplorerPath);
      } else {
        showToast(`Save failed: ${data.message}`, 'error');
      }
    } catch (err) {
      showToast(`Error saving file: ${err.message}`, 'error');
    } finally {
      fileEditorSaveBtn.disabled = false;
      fileEditorSaveBtn.textContent = '💾 Save Changes';
    }
  });

  fileEditorCloseBtn?.addEventListener('click', () => fileEditorModal.style.display = 'none');
  fileEditorCancelBtn?.addEventListener('click', () => fileEditorModal.style.display = 'none');

  // Convert Single VTT Subtitle
  async function convertSingleVtt(vttPath) {
    try {
      showToast(`Converting ${vttPath.split(/[\/\\]/).pop()} to .srt...`, 'info');
      const res = await fetch('/api/tools/convert-subtitles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetPath: currentExplorerPath,
          force: true
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Converted subtitle to .srt format!', 'success');
        if (currentExplorerPath) loadExplorerPath(currentExplorerPath);
      } else {
        showToast(data.message, 'error');
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
    }
  }

  // Delete Item in Explorer
  async function deleteExplorerItem(itemPath, itemName, isDir) {
    const promptMsg = isDir
      ? `Ali ste prepričani, da želite trajno izbrisati celotno mapo "${itemName}" in vso njeno vsebino?`
      : `Ali želite izbrisati datoteko "${itemName}"?`;

    if (!confirm(promptMsg)) return;

    try {
      const res = await fetch(`/api/explorer/item?path=${encodeURIComponent(itemPath)}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Izbrisano: ${itemName}`, 'success');
        if (currentExplorerPath) loadExplorerPath(currentExplorerPath);
      } else {
        showToast(`Napaka pri brisanju: ${data.message}`, 'error');
      }
    } catch (err) {
      showToast(`Napaka pri brisanju: ${err.message}`, 'error');
    }
  }

  // Test Auth
  testAuthBtn.addEventListener('click', async () => {
    testAuthBtn.disabled = true;
    testAuthBtn.textContent = 'Authenticating...';
    try {
      const res = await fetch('/api/auth/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: document.getElementById('username').value,
          password: document.getElementById('password').value
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Login successful! Account is verified.', 'success');
      } else {
        showToast(`Login failed: ${data.message}`, 'error');
      }
    } catch (err) {
      showToast(`Auth error: ${err.message}`, 'error');
    } finally {
      testAuthBtn.disabled = false;
      testAuthBtn.textContent = '🔐 Test Auth';
    }
  });

  // Job Preview Button in Modal
  jobPreviewBtn.addEventListener('click', async () => {
    jobPreviewBtn.disabled = true;
    jobPreviewBtn.textContent = 'Calculating...';

    const selectedGenres = Array.from(
      genreContainer.querySelectorAll('input[type="checkbox"]:checked')
    ).map(cb => cb.value);

    const payload = {
      targetDir: document.getElementById('job-target-dir').value,
      mediaTypeFilter: document.getElementById('job-media-type').value,
      sortBy: parseInt(document.getElementById('job-sort-by').value || '1', 10),
      itemLimit: parseInt(document.getElementById('job-item-limit').value || '0', 10),
      minYear: parseInt(document.getElementById('job-min-year').value || '0', 10) || null,
      minRating: parseFloat(document.getElementById('job-min-rating').value || '0') || null,
      selectedGenres: selectedGenres,
      languagePreference: document.getElementById('job-naming').value
    };

    try {
      previewModal.style.display = 'flex';
      previewTitle.textContent = '🔍 Sync Preview';
      previewSubtitle.textContent = 'Calculating matching items from SloFlix...';
      previewSummaryTags.innerHTML = '';
      previewItemsBody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 2rem;">⏳ Fetching catalog...</td></tr>';

      const res = await fetch('/api/sync/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (data.success) {
        previewTitle.textContent = `🔍 Preview (${data.totalItems} items matching)`;
        previewSubtitle.textContent = `Found ${data.totalMovies} movies and ${data.totalShows} series matching current filters:`;

        const isAllGenres = !selectedGenres || selectedGenres.length === 0 || selectedGenres.length === ALL_GENRES.length;
        previewSummaryTags.innerHTML = `
          <span class="filter-badge">🎬 Movies: ${data.totalMovies}</span>
          <span class="filter-badge">📺 Series: ${data.totalShows}</span>
          <span class="filter-badge">🏷️ Genres: ${isAllGenres ? 'All' : selectedGenres.join(', ')}</span>
          ${payload.minYear ? `<span class="filter-badge">📅 Min Year: ≥ ${payload.minYear}</span>` : ''}
          ${payload.minRating ? `<span class="filter-badge">⭐ Min Rating: ≥ ${payload.minRating}</span>` : ''}
          ${payload.itemLimit ? `<span class="filter-badge">🔢 Limit: Top ${payload.itemLimit}</span>` : '<span class="filter-badge">🔢 Limit: All</span>'}
        `;

        if (!data.items || data.items.length === 0) {
          previewItemsBody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 2rem; color: #9ca3af;">No items match the selected filter criteria.</td></tr>';
        } else {
          previewItemsBody.innerHTML = data.items.map(item => `
            <tr>
              <td><span class="type-pill type-${item.type}">${item.type.toUpperCase()}</span></td>
              <td>
                <strong>${item.titleSlo}</strong>
                ${item.titleEn && item.titleEn !== item.titleSlo ? `<br><small style="color:#9ca3af;">${item.titleEn}</small>` : ''}
              </td>
              <td>${item.year}</td>
              <td>⭐ ${item.rating}</td>
              <td style="color:#a5b4fc; font-size:0.75rem;">${item.genres}</td>
              <td style="font-family:monospace; font-size:0.75rem; color:#86efac;">${item.targetFolder}</td>
            </tr>
          `).join('');
        }
      }
    } catch (err) {
      previewItemsBody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: #ef4444; padding: 2rem;">Error: ${err.message}</td></tr>`;
    } finally {
      jobPreviewBtn.disabled = false;
      jobPreviewBtn.textContent = '🔍 Preview Matching';
    }
  });

  previewCloseBtn.addEventListener('click', () => previewModal.style.display = 'none');
  previewCancelBtn.addEventListener('click', () => previewModal.style.display = 'none');

  // Render History Audit List
  function renderHistory(history = []) {
    if (!historyList) return;
    if (history.length === 0) {
      historyList.innerHTML = '<div style="text-align:center; padding: 2rem; color: var(--text-muted); font-size: 0.85rem;">Ni še zabeleženih zagonov opravil.</div>';
      return;
    }

    historyList.innerHTML = history.map(entry => {
      const isSuccess = entry.status === 'success';
      const isAuto = entry.trigger === 'auto';

      const itemsHtml = (entry.createdItems && entry.createdItems.length > 0)
        ? `<div style="margin-top: 0.4rem; padding-top: 0.4rem; border-top: 1px dashed #334155; font-size: 0.75rem;">
             <strong style="color: #93c5fd;">Novo dodano (${entry.createdItems.length}):</strong>
             <ul style="margin: 0.25rem 0 0 1rem; padding: 0; color: #86efac; font-family: monospace;">
               ${entry.createdItems.slice(0, 10).map(it => `<li>${it.title} (${it.year || 'N/A'})</li>`).join('')}
               ${entry.createdItems.length > 10 ? `<li style="color:#94a3b8;">... in še ${entry.createdItems.length - 10} vsebin</li>` : ''}
             </ul>
           </div>`
        : '';

      return `
        <div style="background: #141822; border: 1px solid var(--card-border); border-radius: 8px; padding: 0.75rem 1rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.825rem;">
            <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
              <strong style="color: #f3f4f6; font-size: 0.9rem;">${entry.jobName || 'Sync Job'}</strong>
              <span style="font-size: 0.68rem; font-weight: 700; padding: 0.15rem 0.4rem; border-radius: 4px; background: ${isAuto ? '#3b82f620' : '#8b5cf620'}; color: ${isAuto ? '#60a5fa' : '#c084fc'}; border: 1px solid ${isAuto ? '#3b82f640' : '#8b5cf640'};">
                ${isAuto ? '⏰ AVTOMATSKO' : '👤 ROČNO'}
              </span>
              <strong style="color: ${isSuccess ? '#10b981' : '#ef4444'};">${isSuccess ? '✅ Uspešno' : '❌ Napaka'}</strong>
              <span style="color: var(--text-muted); font-size: 0.75rem;">(${entry.timestamp})</span>
            </div>
            <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: 600;">${entry.durationSec ? entry.durationSec + 's' : ''}</span>
          </div>
          <div style="font-size: 0.785rem; color: #cbd5e1; margin-top: 0.35rem;">
            ${entry.summary || ''}
          </div>
          ${itemsHtml}
        </div>
      `;
    }).join('');
  }

  // Polling loop for live status & logs
  setInterval(async () => {
    try {
      const res = await fetch('/api/sync/status');
      const data = await res.json();
      if (data) {
        if (data.logs) {
          logOutput.textContent = data.logs;
          logOutput.scrollTop = logOutput.scrollHeight;
        }

        if (data.bridgeLogs) {
          bridgeLogOutput.textContent = data.bridgeLogs;
          bridgeLogOutput.scrollTop = bridgeLogOutput.scrollHeight;
        }

        if (data.history) {
          renderHistory(data.history);
        }

        const prevIsSyncing = isSyncing;
        isSyncing = !!data.isSyncing;
        runningJobId = data.currentRunningJobId;
        syncRunningTag.style.display = isSyncing ? 'inline-block' : 'none';

        if (data.jobs && (!prevIsSyncing && isSyncing || prevIsSyncing && !isSyncing)) {
          allJobs = data.jobs;
          renderJobsList(allJobs);
        }
      }
    } catch {}
  }, 1500);

  loadInitialData();
});
