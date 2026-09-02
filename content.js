/**
 * content.js - Content script for YouTube pages
 * Version 5.6.0
 * Features:
 * 1. Native YouTube InnerTube API for creating/editing playlists.
 * 2. Playlist page (/playlist) total duration card + Bulletproof Circular Sort Icon Buttons placed strictly BELOW the action buttons row.
 * 3. Video watch playlist panel (/watch?list=...) with 1:1 donor card fill progress style, exact margin compensation, and 1x / 2.5x speed controls.
 */

const tabsRuntime = (typeof browser !== 'undefined' && browser.runtime) ? browser.runtime : chrome.runtime;

function getCookie(name) {
  try {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
  } catch (e) {}
  return null;
}

async function getSapisidHash() {
  const sapisid = getCookie('SAPISID') || getCookie('__Secure-3PAPISID') || getCookie('__Secure-1PAPISID');
  if (!sapisid) return null;

  const timestamp = Math.floor(Date.now() / 1000);
  const origin = 'https://www.youtube.com';
  const str = `${timestamp} ${sapisid} ${origin}`;

  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-1', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return `SAPISIDHASH ${timestamp}_${hashHex}`;
  } catch (err) {
    console.error("Error computing SAPISIDHASH:", err);
  }
  return null;
}

function getInnertubeCredentialsFromDOM() {
  let apiKey = null;
  let clientVersion = '2.20240101.00.00';

  const scripts = document.querySelectorAll('script');
  for (const s of scripts) {
    const text = s.textContent || '';
    if (!apiKey && text.includes('INNERTUBE_API_KEY')) {
      const mKey = text.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/) || 
                   text.match(/INNERTUBE_API_KEY["']?\s*:\s*["']([^"']+)["']/);
      if (mKey && mKey[1]) apiKey = mKey[1];
    }
    if (text.includes('INNERTUBE_CLIENT_VERSION')) {
      const mVer = text.match(/"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/) || 
                   text.match(/INNERTUBE_CLIENT_VERSION["']?\s*:\s*["']([^"']+)["']/);
      if (mVer && mVer[1]) clientVersion = mVer[1];
    }
  }

  if (!apiKey) {
    const html = document.documentElement ? document.documentElement.innerHTML : '';
    const mKey = html.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/) || 
                 html.match(/INNERTUBE_API_KEY["']?\s*:\s*["']([^"']+)["']/);
    if (mKey && mKey[1]) apiKey = mKey[1];

    const mVer = html.match(/"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/) || 
                 html.match(/INNERTUBE_CLIENT_VERSION["']?\s*:\s*["']([^"']+)["']/);
    if (mVer && mVer[1]) clientVersion = mVer[1];
  }

  return { apiKey, clientVersion };
}

// InnerTube API listener
tabsRuntime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'CREATE_PLAYLIST') {
    (async () => {
      const { apiKey, clientVersion } = getInnertubeCredentialsFromDOM();

      if (!apiKey) {
        sendResponse({ error: 'Не удалось извлечь токен авторизации из страницы YouTube.' });
        return;
      }

      const authHeader = await getSapisidHash();

      const headers = {
        'Content-Type': 'application/json',
        'X-YouTube-Client-Name': '1',
        'X-YouTube-Client-Version': clientVersion,
        'X-Origin': 'https://www.youtube.com'
      };

      if (authHeader) {
        headers['Authorization'] = authHeader;
      }

      const payload = {
        context: {
          client: {
            hl: document.documentElement.lang || 'ru',
            gl: 'RU',
            clientName: 'WEB',
            clientVersion: clientVersion,
            originalUrl: window.location.href
          }
        },
        title: request.title,
        privacyStatus: request.privacyStatus,
        videoIds: request.videoIds
      };

      try {
        const res = await fetch(`/youtubei/v1/playlist/create?key=${apiKey}`, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(payload),
          credentials: 'include'
        });

        if (!res.ok) {
          sendResponse({ error: `Ошибка ответа от YouTube (${res.status} ${res.statusText})` });
          return;
        }

        const data = await res.json();
        if (data.playlistId) {
          sendResponse({ success: true, playlistId: data.playlistId });
        } else if (data.error) {
          sendResponse({ error: data.error.message || JSON.stringify(data.error) });
        } else {
          sendResponse({ error: 'Неизвестный ответ сервера YouTube: ' + JSON.stringify(data) });
        }
      } catch (err) {
        sendResponse({ error: 'Ошибка сети при вызове API: ' + err.toString() });
      }
    })();

    return true;
  }

  if (request.action === 'ADD_TO_PLAYLIST') {
    (async () => {
      const { apiKey, clientVersion } = getInnertubeCredentialsFromDOM();

      if (!apiKey) {
        sendResponse({ error: 'Не удалось извлечь токен авторизации из страницы YouTube.' });
        return;
      }

      const authHeader = await getSapisidHash();

      const headers = {
        'Content-Type': 'application/json',
        'X-YouTube-Client-Name': '1',
        'X-YouTube-Client-Version': clientVersion,
        'X-Origin': 'https://www.youtube.com'
      };

      if (authHeader) {
        headers['Authorization'] = authHeader;
      }

      const actions = request.videoIds.map(vid => ({
        action: 'ACTION_ADD_VIDEO',
        addedVideoId: vid
      }));

      const cleanPlaylistId = request.playlistId.replace(/^VL/, '');

      const payload = {
        context: {
          client: {
            hl: document.documentElement.lang || 'ru',
            gl: 'RU',
            clientName: 'WEB',
            clientVersion: clientVersion,
            originalUrl: window.location.href
          }
        },
        playlistId: cleanPlaylistId,
        actions: actions
      };

      try {
        const res = await fetch(`/youtubei/v1/browse/edit_playlist?key=${apiKey}`, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(payload),
          credentials: 'include'
        });

        if (!res.ok) {
          sendResponse({ error: `Ошибка ответа от YouTube (${res.status} ${res.statusText})` });
          return;
        }

        const data = await res.json();
        if (data.status === 'STATUS_SUCCEEDED' || data.actions || !data.error) {
          sendResponse({ success: true, playlistId: cleanPlaylistId });
        } else if (data.error) {
          sendResponse({ error: data.error.message || JSON.stringify(data.error) });
        } else {
          sendResponse({ error: 'Неизвестный ответ при редактировании плейлиста: ' + JSON.stringify(data) });
        }
      } catch (err) {
        sendResponse({ error: 'Ошибка сети при редактировании плейлиста: ' + err.toString() });
      }
    })();

    return true;
  }
});

/* ==========================================================================
   STRICT TIME EXTRACTION & FORMATTING UTILITIES
   ========================================================================== */

function extractVideoDurationSeconds(videoElement) {
  if (!videoElement) return 0;

  // Strategy 1: #text element — used in ytd-playlist-video-renderer on /playlist pages
  const textEl = videoElement.querySelector('#text');
  if (textEl && textEl.innerText) {
    const text = textEl.innerText.trim();
    let m = text.match(/\b(\d{1,2}):(\d{2}):(\d{2})\b/);
    if (m) {
      return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
    }
    m = text.match(/\b(\d{1,3}):(\d{2})\b/);
    if (m) {
      return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    }
  }

  // Strategy 2: thumbnail overlay badge
  const badge = videoElement.querySelector(
    'ytd-thumbnail-overlay-time-status-renderer, badge-shape, .badge-shape-wiz__text, #time-status, span.ytd-thumbnail-overlay-time-status-renderer'
  );

  if (badge && badge.textContent) {
    const text = badge.textContent.trim();

    let m = text.match(/\b(\d{1,2}):(\d{2}):(\d{2})\b/);
    if (m) {
      return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
    }

    m = text.match(/\b(\d{1,3}):(\d{2})\b/);
    if (m) {
      return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    }
  }

  // Strategy 3: thumbnail container text
  const thumb = videoElement.querySelector('ytd-thumbnail, #thumbnail, a#thumbnail');
  if (thumb && thumb.textContent) {
    const text = thumb.textContent.trim();

    let m = text.match(/\b(\d{1,2}):(\d{2}):(\d{2})\b/);
    if (m) {
      return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
    }

    m = text.match(/\b(\d{1,3}):(\d{2})\b/);
    if (m) {
      return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    }
  }

  return 0;
}

function secondsToTs(seconds) {
  if (!seconds || isNaN(seconds) || seconds <= 0) return '0:00';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  }
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function getSavedSpeed() {
  return parseFloat(localStorage.getItem('yt_playlist_custom_speed') || '2.5') || 2.5;
}

function setSavedSpeed(speed) {
  if (speed > 0) {
    localStorage.setItem('yt_playlist_custom_speed', speed.toString());
  }
}

const checkTheme = () => (document.documentElement.hasAttribute('dark') || document.querySelector('[dark]')) ? 'dark' : 'light';

/* ==========================================================================
   FIREFOX wrappedJSObject — reads Polymer el.data from content script
   In Firefox, el.wrappedJSObject gives access to the page's JS object
   (bypasses Xray isolation without needing main-world script injection).
   ========================================================================== */

function getSetVideoId(el) {
  // Firefox: wrappedJSObject bypasses Xray wrapper to read Polymer data
  if (el && el.wrappedJSObject && el.wrappedJSObject.data && el.wrappedJSObject.data.setVideoId) {
    return el.wrappedJSObject.data.setVideoId;
  }
  // Chrome / fallback: direct access
  if (el && el.data && el.data.setVideoId) {
    return el.data.setVideoId;
  }
  return null;
}

// Call InnerTube edit_playlist API directly from content script
// (same pattern as CREATE_PLAYLIST and ADD_TO_PLAYLIST handlers above)
async function reorderPlaylistViaInnerTube(playlistId, sortedSetVideoIds) {
  const { apiKey, clientVersion } = getInnertubeCredentialsFromDOM();
  if (!apiKey) return { error: 'Нет API ключа' };

  const authHeader = await getSapisidHash();
  const headers = {
    'Content-Type': 'application/json',
    'X-YouTube-Client-Name': '1',
    'X-YouTube-Client-Version': clientVersion,
    'X-Origin': 'https://www.youtube.com'
  };
  if (authHeader) headers['Authorization'] = authHeader;

  // ACTION_MOVE_VIDEO_AFTER builds in reverse order:
  //   - Video with no movedSetVideoIdSuccessor → goes to LAST position
  //   - Each video referencing a predecessor goes right before that predecessor's current slot
  //
  // Therefore: sending [V0,V1,V2,V3] (ASC) → saves [V3,V2,V1,V0] (DESC) on server.
  // Fix: reverse the input first, then chain with i-1, which reverses it back → ASC.
  const idsForAPI = [...sortedSetVideoIds].reverse();
  const actions = idsForAPI.map((setVideoId, i) => {
    const action = { action: 'ACTION_MOVE_VIDEO_AFTER', setVideoId };
    if (i > 0) action.movedSetVideoIdSuccessor = idsForAPI[i - 1];
    return action;
  });


  const payload = {
    context: {
      client: {
        hl: document.documentElement.lang || 'ru',
        gl: 'RU',
        clientName: 'WEB',
        clientVersion,
        originalUrl: window.location.href
      }
    },
    playlistId,
    actions
  };

  try {
    const res = await fetch(`/youtubei/v1/browse/edit_playlist?key=${apiKey}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      credentials: 'include'
    });
    if (!res.ok) return { error: `HTTP ${res.status} ${res.statusText}` };
    const data = await res.json();
    if (data.status === 'STATUS_SUCCEEDED' || !!data.actions || !data.error) {
      return { success: true };
    }
    return { error: data.error ? (data.error.message || JSON.stringify(data.error)) : 'Неизвестная ошибка' };
  } catch (err) {
    return { error: err.toString() };
  }
}

function injectStyles() {
  if (document.getElementById('yt-playlist-sorter-style')) return;

  const style = document.createElement('style');
  style.id = 'yt-playlist-sorter-style';
  style.textContent = `
    .duration-block {
      border-radius: 10px !important;
      position: relative !important;
      overflow: hidden !important;
      box-sizing: border-box !important;
      display: block !important;
    }

    #duration-block-playlist {
      width: 100% !important;
      margin: 10px 0 5px 0 !important;
      padding: 4px 0 !important;
    }

    #duration-block-playing {
      width: calc(100% - 8px) !important;
      margin: 10px 8px 5px 0 !important;
      padding: 4px 0 !important;
    }

    .duration-block[dark] {
      background-color: #ffffff0d !important;
      border: 1px solid rgba(255, 255, 255, .2) !important;
    }

    .duration-block[light] {
      background-color: #0000000d !important;
      border: 1px solid rgba(0, 0, 0, .1) !important;
    }

    .progress-bar {
      position: absolute !important;
      top: 0 !important;
      left: 0 !important;
      border-radius: 10px !important;
      height: 100% !important;
      width: 0% !important;
      z-index: 0 !important;
      pointer-events: none !important;
      transition: width 0.3s ease !important;
    }

    .progress-bar[dark] {
      background-color: #ffffff1a !important;
    }

    .progress-bar[light] {
      background-color: #00000014 !important;
    }

    .duration-content {
      margin: 5px !important;
      font-size: 16px !important;
      font-weight: 500 !important;
      font-family: Roboto, Arial, sans-serif !important;
      line-height: 20px !important;
      display: block !important;
      text-align: center !important;
      z-index: 2 !important;
      position: relative !important;
    }

    .duration-content[dark] { color: #f1f1f1 !important; }
    .duration-content[light] { color: #0f0f0f !important; }

    .played-content {
      margin: 0 5px 5px !important;
      font-size: 14px !important;
      font-weight: 400 !important;
      font-family: Roboto, Arial, sans-serif !important;
      line-height: 18px !important;
      z-index: 2 !important;
      position: relative !important;
    }

    .played-content[dark] { color: #aaa !important; }
    .played-content[light] { color: #606060 !important; }

    #video-counted {
      display: block !important;
      text-align: center !important;
    }

    .current-block {
      display: flex !important;
      justify-content: space-between !important;
      width: 100% !important;
      padding: 0 8px !important;
      box-sizing: border-box !important;
      position: relative !important;
      z-index: 2 !important;
    }

    .yt-dur-speed-bar {
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 6px !important;
      flex-wrap: wrap !important;
      position: relative !important;
      z-index: 2 !important;
      margin: 2px 0 4px 0 !important;
    }

    /* Dedicated Circular Sort Buttons Row */
    #yt-playlist-sort-row {
      display: flex !important;
      align-items: center !important;
      justify-content: flex-start !important;
      gap: 12px !important;
      margin: 12px 0 8px 0 !important;
      width: 100% !important;
      z-index: 99 !important;
      position: relative !important;
    }

    .yt-action-sort-circle-btn {
      width: 40px !important;
      height: 40px !important;
      min-width: 40px !important;
      min-height: 40px !important;
      border-radius: 50% !important;
      background: rgba(255, 255, 255, 0.12) !important;
      border: 1px solid rgba(255, 255, 255, 0.18) !important;
      color: #ffffff !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      cursor: pointer !important;
      transition: all 0.18s ease !important;
      padding: 0 !important;
      box-sizing: border-box !important;
      outline: none !important;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25) !important;
    }

    .yt-action-sort-circle-btn svg {
      width: 22px !important;
      height: 22px !important;
      stroke: #ffffff !important;
      pointer-events: none !important;
    }

    .yt-action-sort-circle-btn:hover {
      background: rgba(255, 255, 255, 0.25) !important;
      border-color: #3ea6ff !important;
      transform: scale(1.06) !important;
    }

    .yt-action-sort-circle-btn:active {
      transform: scale(0.94) !important;
    }

    .yt-action-sort-circle-btn.active {
      background: #3ea6ff !important;
      border-color: #3ea6ff !important;
    }

    .yt-action-sort-circle-btn.active svg {
      stroke: #000000 !important;
    }

    .yt-dur-speed-input-wrap {
      display: flex !important;
      align-items: center !important;
      background: rgba(0, 0, 0, 0.4) !important;
      border: 1px solid rgba(255, 255, 255, 0.22) !important;
      border-radius: 5px !important;
      padding: 1px 4px !important;
    }

    .yt-dur-speed-input {
      width: 38px !important;
      background: transparent !important;
      border: none !important;
      color: #ffffff !important;
      font-weight: bold !important;
      font-size: 11.5px !important;
      text-align: center !important;
      outline: none !important;
    }

    .yt-dur-speed-btn {
      background: rgba(255, 255, 255, 0.09) !important;
      border: 1px solid rgba(255, 255, 255, 0.14) !important;
      color: #dddddd !important;
      border-radius: 4px !important;
      padding: 2px 8px !important;
      font-size: 11.5px !important;
      cursor: pointer !important;
      font-weight: 500 !important;
      transition: all 0.12s !important;
    }

    .yt-dur-speed-btn:hover {
      background: rgba(255, 255, 255, 0.2) !important;
      color: #ffffff !important;
      border-color: #3ea6ff !important;
    }

    .yt-dur-speed-btn.active {
      background: #3ea6ff !important;
      color: #000000 !important;
      font-weight: bold !important;
      border-color: #3ea6ff !important;
    }
  `;
  document.head.appendChild(style);
}

const findRendered = (selector) => {
  for (const el of document.querySelectorAll(selector)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 || r.height > 0) return el;
  }
  return null;
};

/* ==========================================================================
   1. PLAYLIST PAGE ENGINE & IN-PAGE SORTING (/playlist?list=...)
   ========================================================================== */

function getPlaylistPageVideos() {
  const container = document.querySelector(
    '#page-manager [page-subtype="playlist"] #contents #contents #contents, ytd-playlist-video-list-renderer #contents'
  );
  const videos = container ? Array.from(container.children) : Array.from(document.querySelectorAll('ytd-playlist-video-renderer'));
  let count = 0;
  let totalSeconds = 0;

  for (const video of videos) {
    const dur = extractVideoDurationSeconds(video);
    if (dur > 0) {
      totalSeconds += dur;
      count++;
    }
  }
  return { count, totalSeconds };
}

/* Helpers for server-side playlist reorder */

// Show a status message next to the sort buttons
function showSortStatus(msg, type) {
  const el = document.getElementById('yt-sort-status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = type === 'success' ? '#00d26a' : type === 'error' ? '#ff4444' : '#aaaaaa';
  if (type === 'success' || type === 'error') {
    setTimeout(() => { el.textContent = ''; }, 4000);
  }
}

// In-Page DOM Sorting + server-side API reorder
async function sortPlaylistDOM(order = 'asc') {
  // Find playlist container
  const containerSelectors = [
    '#page-manager [page-subtype="playlist"] #contents #contents #contents',
    'ytd-playlist-video-list-renderer #contents',
    'ytd-playlist-video-list-renderer',
    '#page-manager [page-subtype="playlist"] #contents'
  ];

  let container = null;
  for (const sel of containerSelectors) {
    const el = document.querySelector(sel);
    if (el && el.querySelector('ytd-playlist-video-renderer')) {
      container = el;
      break;
    }
  }

  if (!container) {
    console.warn('[YT-Sorter] Playlist container not found');
    return;
  }

  // Collect playlist video elements
  let items = Array.from(container.children).filter(el => el.tagName.toLowerCase() === 'ytd-playlist-video-renderer');
  if (items.length === 0) items = Array.from(container.querySelectorAll('ytd-playlist-video-renderer'));
  if (items.length <= 1) return;

  const playlistId = new URL(window.location.href).searchParams.get('list');
  const isSavedPlaylist = playlistId && playlistId.startsWith('PL');

  // === Step 1: Collect duration + setVideoId for each item ===
  // getSetVideoId() uses el.wrappedJSObject (Firefox) to read Polymer data
  const itemsWithData = items.map(item => ({
    item,
    sec: extractVideoDurationSeconds(item),
    setVideoId: getSetVideoId(item)
  }));

  const foundIds = itemsWithData.filter(x => x.setVideoId).length;
  console.log(`[YT-Sorter] items=${items.length}, setVideoIds found=${foundIds}`);

  // === Step 2: Sort ===
  itemsWithData.sort((a, b) => order === 'asc' ? (a.sec - b.sec) : (b.sec - a.sec));

  // === Step 3: DOM sort (visual, instant) ===
  setIsSorting(true);
  const fragment = document.createDocumentFragment();
  itemsWithData.forEach(({ item }, idx) => {
    const indexSpan = item.querySelector('#index');
    if (indexSpan) indexSpan.textContent = (idx + 1).toString();
    fragment.appendChild(item);
  });
  container.appendChild(fragment);
  setTimeout(() => { setIsSorting(false); }, 300);

  // Highlight active sort button
  const ascBtn = document.getElementById('yt-sort-asc-circle');
  const descBtn = document.getElementById('yt-sort-desc-circle');
  if (ascBtn && descBtn) {
    if (order === 'asc') { ascBtn.classList.add('active'); descBtn.classList.remove('active'); }
    else { descBtn.classList.add('active'); ascBtn.classList.remove('active'); }
  }

  // === Step 4: Persist order via InnerTube API (saved PL* playlists only) ===
  if (!isSavedPlaylist) return;

  const sortedSetVideoIds = itemsWithData.map(x => x.setVideoId).filter(Boolean);

  if (sortedSetVideoIds.length === 0) {
    showSortStatus('⚠️ setVideoId не найден — обновите страницу', 'error');
    return;
  }

  showSortStatus('⏳ Сохраняем порядок...', 'pending');
  const result = await reorderPlaylistViaInnerTube(playlistId, sortedSetVideoIds);
  if (result.success) {
    showSortStatus('✅ Порядок сохранён!', 'success');
  } else {
    showSortStatus('❌ ' + (result.error || 'Ошибка'), 'error');
    console.error('[YT-Sorter] Reorder failed:', result.error);
  }
}

function updatePlaylistPageUI() {
  if (window.location.pathname !== '/playlist') {
    const existing = document.getElementById('duration-block-playlist');
    if (existing) existing.remove();
    const existingSort = document.getElementById('yt-playlist-sort-row');
    if (existingSort) existingSort.remove();
    return;
  }

  injectStyles();
  const theme = checkTheme();
  const speed = getSavedSpeed();
  const { count, totalSeconds } = getPlaylistPageVideos();

  // 1. Duration & Speed Card (mounted above action buttons)
  let block = document.getElementById('duration-block-playlist');
  if (!block) {
    block = document.createElement('div');
    block.id = 'duration-block-playlist';
    block.className = 'duration-block';
    block.setAttribute(theme, '');

    block.innerHTML = `
      <span id="duration-total-playlist" class="duration-content" ${theme}>Total: ...</span>
      <span id="video-counted" class="played-content" ${theme}>Videos counted: ...</span>
      <div class="yt-dur-speed-bar">
        <span style="color:#aaaaaa; font-size:11px;">Скорость:</span>
        <div class="yt-dur-speed-input-wrap">
          <input type="number" id="playlist-speed-input" class="yt-dur-speed-input" value="${speed}" min="0.25" max="16" step="0.25">
          <span style="color:#aaaaaa; font-size:11px;">x</span>
        </div>
        <button class="yt-dur-speed-btn" data-speed="1">1x</button>
        <button class="yt-dur-speed-btn" data-speed="2.5">2.5x</button>
      </div>
    `;

    // Speed input listener
    const speedInput = block.querySelector('#playlist-speed-input');
    speedInput.addEventListener('input', () => {
      const sp = parseFloat(speedInput.value);
      if (sp > 0) setSavedSpeed(sp);
      updatePlaylistPageUI();
    });

    // Preset button listeners
    block.querySelectorAll('.yt-dur-speed-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const sp = parseFloat(btn.dataset.speed);
        speedInput.value = sp;
        setSavedSpeed(sp);
        updatePlaylistPageUI();
      });
    });

    // Insertion candidates for Duration Card
    const candidates = [
      { selector: 'yt-description-preview-view-model', position: 'afterend' },
      { selector: '#page-manager [page-subtype="playlist"] .metadata-action-bar', position: 'afterend' },
      { selector: 'ytd-playlist-sidebar-primary-info-renderer #play-buttons', position: 'afterend' },
      { selector: 'ytd-playlist-header-renderer .metadata-action-bar', position: 'afterend' },
      { selector: 'ytd-playlist-header-renderer #stats', position: 'afterend' },
      { selector: 'ytd-playlist-header-renderer .metadata-wrapper', position: 'beforeend' }
    ];

    let inserted = false;
    for (const { selector, position } of candidates) {
      const anchor = findRendered(selector);
      if (anchor) {
        anchor.insertAdjacentElement(position, block);
        inserted = true;
        break;
      }
    }

    if (!inserted) {
      const header = document.querySelector('ytd-playlist-header-renderer');
      if (header) header.appendChild(block);
    }
  } else {
    block.setAttribute(theme, '');
  }

  // 2. Circular Sort Icon Buttons Row placed strictly BELOW the Action Buttons
  let sortRow = document.getElementById('yt-playlist-sort-row');
  if (!sortRow) {
    sortRow = document.createElement('div');
    sortRow.id = 'yt-playlist-sort-row';

    sortRow.innerHTML = `
      <button class="yt-action-sort-circle-btn" id="yt-sort-asc-circle" title="Сортировать по возрастанию (от коротких к длинным)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="9.5" cy="12" r="6.5"></circle>
          <polyline points="9.5 9.5 9.5 12 11.5 13.5"></polyline>
          <path d="M19 16V8m0 0l-2.5 2.5M19 8l2.5 2.5"></path>
        </svg>
      </button>
      <button class="yt-action-sort-circle-btn" id="yt-sort-desc-circle" title="Сортировать по убыванию (от длинных к коротким)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="9.5" cy="12" r="6.5"></circle>
          <polyline points="9.5 9.5 9.5 12 11.5 13.5"></polyline>
          <path d="M19 8v8m0 0l-2.5-2.5M19 16l2.5-2.5"></path>
        </svg>
      </button>
      <span id="yt-sort-status" style="font-size:11px; color:#aaaaaa; margin-left:4px; transition: color 0.3s;"></span>
    `;

    const ascBtn = sortRow.querySelector('#yt-sort-asc-circle');
    const descBtn = sortRow.querySelector('#yt-sort-desc-circle');

    if (ascBtn) {
      ascBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        sortPlaylistDOM('asc'); // async, runs in background
      });
    }

    if (descBtn) {
      descBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        sortPlaylistDOM('desc'); // async, runs in background
      });
    }
  }

  // Find Action Buttons Row to insert sortRow strictly BELOW it
  const actionAnchorCandidates = [
    'ytd-playlist-header-renderer .metadata-action-bar',
    'ytd-playlist-header-renderer #action-buttons',
    'ytd-playlist-header-renderer #top-level-buttons-computed',
    'ytd-playlist-header-renderer ytd-menu-renderer',
    'ytd-playlist-sidebar-primary-info-renderer #play-buttons'
  ];

  let placed = false;
  for (const sel of actionAnchorCandidates) {
    const anchor = findRendered(sel);
    if (anchor && anchor.parentNode) {
      if (sortRow.previousElementSibling !== anchor) {
        anchor.insertAdjacentElement('afterend', sortRow);
      }
      placed = true;
      break;
    }
  }

  if (!placed) {
    const durBlock = document.getElementById('duration-block-playlist');
    if (durBlock && durBlock.parentNode) {
      if (sortRow.previousElementSibling !== durBlock) {
        durBlock.insertAdjacentElement('afterend', sortRow);
      }
    } else {
      const header = findRendered('ytd-playlist-header-renderer .metadata-wrapper, ytd-playlist-header-renderer');
      if (header && !header.contains(sortRow)) {
        header.appendChild(sortRow);
      }
    }
  }

  // Update text values
  const totalElem = block.querySelector('#duration-total-playlist');
  const countElem = block.querySelector('#video-counted');
  const speedInput = block.querySelector('#playlist-speed-input');

  if (speedInput && document.activeElement !== speedInput) {
    speedInput.value = speed;
  }

  if (totalSeconds > 0) {
    const scaledSeconds = totalSeconds / speed;
    if (speed !== 1.0) {
      if (totalElem) totalElem.textContent = `Total: ${secondsToTs(scaledSeconds)} (${speed}x)`;
      if (countElem) countElem.textContent = `Videos counted: ${count} • 1.0x: ${secondsToTs(totalSeconds)}`;
    } else {
      if (totalElem) totalElem.textContent = `Total: ${secondsToTs(totalSeconds)}`;
      if (countElem) countElem.textContent = `Videos counted: ${count}`;
    }
  } else {
    if (totalElem) totalElem.textContent = `Total: 0:00`;
    if (countElem) countElem.textContent = `Videos counted: ${count}`;
  }

  // Update speed preset buttons active state
  block.querySelectorAll('.yt-dur-speed-btn').forEach(btn => {
    const btnSpeed = parseFloat(btn.dataset.speed);
    if (Math.abs(btnSpeed - speed) < 0.01) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

/* ==========================================================================
   2. WATCH PAGE ENGINE (/watch?v=...&list=...)
   ========================================================================== */

function updateWatchPageUI() {
  const isWatchPlaylist = window.location.pathname === '/watch' && (window.location.search.includes('list=') || window.location.pathname.includes('watch_videos'));

  if (!isWatchPlaylist) {
    const existing = document.getElementById('duration-block-playing');
    if (existing) existing.remove();
    return;
  }

  injectStyles();
  const theme = checkTheme();
  const speed = getSavedSpeed();

  const panelItems = Array.from(document.querySelectorAll('ytd-playlist-panel-video-renderer'));
  if (panelItems.length === 0) return;

  // 1. Detect current index
  let currentIndex = 0;
  for (let i = 0; i < panelItems.length; i++) {
    const item = panelItems[i];
    if (item.hasAttribute('selected') || item.hasAttribute('is-current') || item.classList.contains('selected') || item.querySelector('ytd-thumbnail-overlay-now-playing-renderer, [now-playing], #now-playing-icon')) {
      currentIndex = i;
      break;
    }
  }

  // URL fallback index
  try {
    const u = new URL(window.location.href);
    const idxParam = u.searchParams.get('index');
    if (idxParam) {
      const parsed = parseInt(idxParam, 10) - 1;
      if (parsed >= 0 && parsed < panelItems.length) {
        currentIndex = parsed;
      }
    }
  } catch (e) {}

  // 2. Parse all durations with strict regex
  const durations = panelItems.map(item => extractVideoDurationSeconds(item));
  const totalUnscaled = durations.reduce((acc, d) => acc + d, 0);

  // 3. Calculate elapsed and remaining
  let elapsedUnscaled = 0;
  for (let i = 0; i < currentIndex; i++) {
    elapsedUnscaled += durations[i];
  }

  const video = document.querySelector('video');
  const currentVideoElapsed = video ? (video.currentTime || 0) : 0;
  elapsedUnscaled += currentVideoElapsed;

  const remainingUnscaled = Math.max(0, totalUnscaled - elapsedUnscaled);

  const totalScaled = totalUnscaled / speed;
  const elapsedScaled = elapsedUnscaled / speed;
  const remainingScaled = remainingUnscaled / speed;

  const percent = totalUnscaled > 0 ? Math.min(100, Math.max(0, Math.round((elapsedUnscaled / totalUnscaled) * 100))) : 0;

  let block = document.getElementById('duration-block-playing');
  if (!block) {
    block = document.createElement('div');
    block.id = 'duration-block-playing';
    block.className = 'duration-block';
    block.setAttribute(theme, '');

    block.innerHTML = `
      <div id="progress-bar-playing" class="progress-bar" ${theme} style="width: ${percent}%;"></div>
      <div id="total-block" style="display: flex; justify-content: center; position: relative; z-index: 2;">
        <span id="duration-total-playing" class="duration-content" ${theme}>Total: ${secondsToTs(totalScaled)} (${speed}x)</span>
      </div>
      <div id="current-block" class="current-block" style="position: relative; z-index: 2;">
        <span id="duration-watched" class="played-content" ${theme}>${secondsToTs(elapsedScaled)}</span>
        <span id="duration-percent" class="played-content" ${theme}>${percent}%</span>
        <span id="duration-remaining" class="played-content" ${theme}>- ${secondsToTs(remainingScaled)}</span>
      </div>
      <div class="yt-dur-speed-bar" style="position: relative; z-index: 2;">
        <span style="color:#aaaaaa; font-size:11px;">Скорость:</span>
        <div class="yt-dur-speed-input-wrap">
          <input type="number" id="playing-speed-input" class="yt-dur-speed-input" value="${speed}" min="0.25" max="16" step="0.25">
          <span style="color:#aaaaaa; font-size:11px;">x</span>
        </div>
        <button class="yt-dur-speed-btn" data-speed="1">1x</button>
        <button class="yt-dur-speed-btn" data-speed="2.5">2.5x</button>
      </div>
    `;

    // Speed input listener
    const speedInput = block.querySelector('#playing-speed-input');
    speedInput.addEventListener('input', () => {
      const sp = parseFloat(speedInput.value);
      if (sp > 0) setSavedSpeed(sp);
      updateWatchPageUI();
    });

    // Preset button listeners
    block.querySelectorAll('.yt-dur-speed-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const sp = parseFloat(btn.dataset.speed);
        speedInput.value = sp;
        setSavedSpeed(sp);
        updateWatchPageUI();
      });
    });

    const headerContents = document.querySelector(
      '#page-manager > ytd-watch-flexy #playlist #header-contents, ytd-playlist-panel-renderer #header-contents'
    );
    if (headerContents) {
      headerContents.appendChild(block);
    }
  } else {
    block.setAttribute(theme, '');
  }

  // Update text & progress fill
  const totalElem = block.querySelector('#duration-total-playing');
  const watchedElem = block.querySelector('#duration-watched');
  const percentElem = block.querySelector('#duration-percent');
  const remainingElem = block.querySelector('#duration-remaining');
  const progressBar = block.querySelector('#progress-bar-playing');
  const speedInput = block.querySelector('#playing-speed-input');

  if (speedInput && document.activeElement !== speedInput) {
    speedInput.value = speed;
  }

  if (totalElem) totalElem.textContent = `Total: ${secondsToTs(totalScaled)} (${speed}x)`;
  if (watchedElem) watchedElem.textContent = secondsToTs(elapsedScaled);
  if (percentElem) percentElem.textContent = `${percent}%`;
  if (remainingElem) remainingElem.textContent = `- ${secondsToTs(remainingScaled)}`;
  if (progressBar) progressBar.style.setProperty('width', `${percent}%`, 'important');

  // Update preset buttons
  block.querySelectorAll('.yt-dur-speed-btn').forEach(btn => {
    const btnSpeed = parseFloat(btn.dataset.speed);
    if (Math.abs(btnSpeed - speed) < 0.01) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

/* ==========================================================================
   MUTATION OBSERVERS & EVENT LISTENERS
   ========================================================================== */

let debounceTimer = null;
let isSorting = false; // Guard flag to prevent observer from resetting sort
let isSortingSafetyTimer = null;

function setIsSorting(val) {
  isSorting = val;
  if (isSortingSafetyTimer) clearTimeout(isSortingSafetyTimer);
  if (val) {
    // Safety: always unlock after 5s in case of unhandled errors
    isSortingSafetyTimer = setTimeout(() => { isSorting = false; }, 5000);
  }
}

function runAll() {
  if (isSorting) return; // Don't update UI while sorting is in progress
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    updatePlaylistPageUI();
    updateWatchPageUI();
  }, 100);
}

// Observe active video timeupdate
function attachVideoListeners() {
  const video = document.querySelector('video');
  if (video && !video.dataset.hasYtSorterListener) {
    video.dataset.hasYtSorterListener = 'true';
    video.addEventListener('timeupdate', updateWatchPageUI);
  }
}

window.addEventListener('yt-navigate-finish', () => {
  runAll();
  attachVideoListeners();
});
window.addEventListener('yt-page-data-updated', runAll);
window.addEventListener('load', () => {
  runAll();
  attachVideoListeners();
});
document.addEventListener('DOMContentLoaded', () => {
  runAll();
  attachVideoListeners();
});

// Observe DOM mutations across page
const globalObserver = new MutationObserver(() => {
  runAll();
  attachVideoListeners();
});

globalObserver.observe(document.documentElement, {
  childList: true,
  subtree: true
});

// Periodic fallback
setInterval(() => {
  runAll();
  attachVideoListeners();
}, 2000);
