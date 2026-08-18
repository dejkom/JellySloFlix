# JellySloFlix 🎬🇸🇮

> **JellySloFlix** is a lightweight, self-hosted web manager, multi-job sync engine, and streaming bridge that seamlessly integrates **SloFlix** media catalog into **Jellyfin** (or Emby/Plex).

It generates TMDB-compliant `.strm` stream files, downloads official **posters**, **fanarts / backdrops**, creates Kodi/Jellyfin-compatible **`.nfo` metadata**, and provides both **WebVTT (`.sl.vtt`)** and **SubRip (`.sl.srt`)** subtitles, while proxying video streams with full HTTP Byte Range support.

---

## 📸 Screenshots

### 1. Dashboard & Multi-Job Schedulers with Execution History
![Dashboard](docs/screenshots/dashboard.png)

### 2. Job Configuration & Custom Filtering
![Edit Job](docs/screenshots/edit_job.png)

### 3. Sync Preview & Item Selection
![Preview Modal](docs/screenshots/preview_modal.png)

---

## ✨ Features

- **🌐 Modern Dark-Themed Web Dashboard**: Clean interface to manage jobs, preview syncs, test auth, inspect live logs, and view execution history.
- **🍿 Jellyfin Auto-Library Refresh**: Automatically triggers Jellyfin API `/Library/Refresh` immediately when new movies or episodes are synced, ensuring newly added content appears in Jellyfin instantly.
- **📄 Native `.nfo` Metadata Generation**: Generates standard `movie.nfo` and `tvshow.nfo` with Slovene synopses, ratings, genres, and premiere dates so that Jellyfin displays localized metadata without relying on external scrapers.
- **💬 Dual Subtitles & VTT &rarr; SRT Conversion**:
  - Automatically converts SloFlix `.sl.vtt` subtitles into standard `.sl.srt` format beside each `.strm` file during sync.
  - Includes a one-click tool in the Web Manager to batch convert all existing `.vtt` subtitles across all movie and show folders.
- **📁 Graphical File Explorer**:
  - Built-in file browser to inspect media directories, view posters/fanart, review and edit `movie.nfo` / `.strm` files directly in the browser, and safely delete items or folders.
- **📋 Multi-Job Sync Scheduler**:
  - Create multiple independent sync profiles (e.g., *Movies every 24h*, *TV Shows every 8h*, *Kids / Cartoons to custom folder*).
  - Configurable intervals (`Every 1h`, `2h`, `4h`, `6h`, `8h`, `12h`, `24h`, or `Manual`).
- **🖼️ Posters & Fanart Artwork**: Automatically downloads official TMDB `poster.jpg` and `fanart.jpg` into each movie/show directory.
- **🔍 Advanced Catalog Filtering & Sorting**:
  - Filter by **Release Year** (`Min Year`), **Rating** (`Min Rating`), and **24 Genre tags** (including `SLOSiNH`, `Animacija`, `Akcija`...).
  - Sort by SloFlix criteria: *Leto: najprej novejše*, *Nazadnje dodano*, *Najboljša ocena*, *Najbolj gledano*, etc.
- **🔤 Flexible Naming Schemes**:
  - **English First (Recommended for TMDB / Jellyfin)**: `Above the Shadows (2019)`
  - **Dual Naming**: `Dekle v senci - Above the Shadows (2019)`
  - **Slovene Only**: `Dekle v senci (2019)`
- **📺 Full TV Series & Multi-Season Support**: Automatically parses all seasons (`Season 01`, `Season 02`...) and generates unqiue stream files for each episode (`S01E01`, `S01E02`...).
- **⚡ Native HTTP Streaming Bridge**: Acts as a streaming bridge for Jellyfin (`/play/:mediaId`), supporting HTTP redirects and 206 Partial Content (seeking).
- **📜 Persistent Audit History**: Detailed job execution logs tracking newly added items vs. skipped items saved in persistent storage.
- **🐳 Docker Ready**: Single container setup with tiny memory footprint (~35 MB RAM).

---

## 📁 Directory & Media Structure

JellySloFlix produces the exact folder format required by Jellyfin:

```text
/DATA/Media/
├── MoviesSloFlix/
│   └── Above the Shadows (2019)/
│       ├── Above the Shadows (2019).strm     <-- Stream link to Bridge
│       ├── Above the Shadows (2019).sl.vtt   <-- Slovene WebVTT Subtitles
│       ├── Above the Shadows (2019).sl.srt   <-- Auto-converted SRT Subtitles
│       ├── movie.nfo                          <-- Localized Kodi/Jellyfin Metadata
│       ├── poster.jpg                         <-- High-res Poster
│       └── fanart.jpg                         <-- Backdrop Fanart
│
└── ShowsSloFlix/
    └── Ja, Chef! (2021)/
        ├── tvshow.nfo                         <-- Series Metadata
        ├── poster.jpg
        ├── fanart.jpg
        ├── Season 01/
        │   ├── Ja, Chef! - S01E01.strm
        │   ├── Ja, Chef! - S01E01.sl.vtt
        │   ├── Ja, Chef! - S01E01.sl.srt
        │   └── ...
        └── Season 02/
            └── ...
```

---

## 🚀 Quick Start with Docker (Recommended)

### 1. `docker-compose.yml`

```yaml
version: '3.8'

services:
  jellysloflix:
    container_name: jellysloflix
    build: .
    restart: unless-stopped
    ports:
      - "3849:3849"
    environment:
      - NODE_ENV=production
      - PORT=3849
      - CONFIG_PATH=/config/config.json
      - MOVIES_DIR=/media/MoviesSloFlix
      - SHOWS_DIR=/media/ShowsSloFlix
      - BRIDGE_URL=http://jellysloflix:3849
      - SLOFLIX_USERNAME=your_email@example.com
      - SLOFLIX_PASSWORD=your_sloflix_password
    volumes:
      # Persistent configuration & history
      - /DATA/AppData/jellysloflix/config:/config
      # Media output directory (same folder mounted in Jellyfin)
      - /DATA/Media:/media
    networks:
      - jellyfin-network

networks:
  jellyfin-network:
    external: true
```

### 2. Launch the Container

```bash
docker compose up -d --build
```

### 3. Open Web Manager

Open your browser at **`http://YOUR_SERVER_IP:3849`**.

---

## 🖥️ Local Installation (Without Docker)

### Requirements
- **Node.js** v18.0.0 or later.

### Installation

```bash
# Clone the repository
git clone https://github.com/dejkom/JellySloFlix.git
cd JellySloFlix

# Start the Web Manager & Bridge Server
npm start
```


Open **`http://localhost:3849`** in your browser.

---

## ⚙️ CLI Usage (Standalone Sync)

You can also run synchronization directly from the command line:

```bash
# Standard sync
node sync.js

# Preview sync without touching disk (Dry-Run)
node sync.js --dry-run

# Force overwrite existing .strm and download all subtitles
node sync.js --force --output "/path/to/media"
```

### CLI Arguments

| Option | Description | Default |
| :--- | :--- | :--- |
| `--output <dir>` | Base output directory | `./media` |
| `--force` | Overwrite existing `.strm`, subtitles, and posters | `false` |
| `--dry-run` | Preview files without writing to disk | `false` |
| `--limit <num>` | Max items to process | `All` |
| `--help` | Show command line help | |

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome! Feel free to open an issue or submit a pull request.

---

## ⚖️ Disclaimer

This project is created for educational and personal interoperability purposes. Please support official creators and content providers.

---

## 📄 License

MIT License © 2026
