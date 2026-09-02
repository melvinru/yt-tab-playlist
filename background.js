/**
 * background.js - Persistent background service worker for YouTube Tab Playlist Sorter
 * Version 3.2.0
 * Instant conversion of temporary playlists to permanent account playlists without re-fetching durations.
 */

const tabsApi = (typeof browser !== 'undefined' && browser.tabs) ? browser.tabs : chrome.tabs;
const runtimeApi = (typeof browser !== 'undefined' && browser.runtime) ? browser.runtime : chrome.runtime;
const scriptingApi = (typeof browser !== 'undefined' && browser.scripting) ? browser.scripting : (typeof chrome !== 'undefined' ? chrome.scripting : null);

let taskState = {
  isRunning: false,
  progressPercent: 0,
  logHtml: '',
  resultUrl: null,
  error: null
};

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function parseVideoId(urlStr) {
  try {
    const url = new URL(urlStr);
    if (url.hostname.includes('youtube.com')) {
      if (url.pathname === '/playlist' && !url.searchParams.get('v')) {
        return null;
      }
      return url.searchParams.get('v');
    } else if (url.hostname.includes('youtu.be')) {
      return url.pathname.slice(1);
    }
  } catch (e) {
    return null;
  }
  return null;
}

async function fetchVideoInfo(videoId) {
  let title = `Видео ${videoId}`;
  let duration = 0;

  try {
    const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'Accept-Language': 'en-US,en;q=0.9,ru;q=0.8'
      }
    });
    if (response.ok) {
      const html = await response.text();

      // Title parsing
      const titleMatch = html.match(/<title>(.*?)<\/title>/i);
      if (titleMatch && titleMatch[1]) {
        title = titleMatch[1].replace('- YouTube', '').trim();
      }

      // Duration parsing - Strategy 1: lengthSeconds
      const matchSeconds = html.match(/"lengthSeconds"\s*:\s*"(\d+)"/) || html.match(/"lengthSeconds"\s*:\s*(\d+)/);
      if (matchSeconds && matchSeconds[1]) {
        duration = parseInt(matchSeconds[1], 10);
      } else {
        // Strategy 2: ISO duration
        const matchIso = html.match(/itemprop="duration"\s+content="PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?"/i);
        if (matchIso) {
          const h = parseInt(matchIso[1] || '0', 10);
          const m = parseInt(matchIso[2] || '0', 10);
          const s = parseInt(matchIso[3] || '0', 10);
          duration = h * 3600 + m * 60 + s;
        }
      }
    }
  } catch (err) {
    console.error(`Error fetching info for video ${videoId}:`, err);
  }

  return { id: videoId, title, duration };
}

async function getPlaylistVideoIdsFromTab(tabId, tabUrl) {
  const ids = [];
  const seen = new Set();

  try {
    const url = new URL(tabUrl);
    const videoIdsParam = url.searchParams.get('video_ids');
    if (videoIdsParam) {
      videoIdsParam.split(',').forEach(id => {
        const clean = id.trim();
        if (clean && !seen.has(clean)) {
          seen.add(clean);
          ids.push(clean);
        }
      });
      if (ids.length > 0) return ids;
    }
  } catch (e) {}

  if (scriptingApi) {
    try {
      const results = await scriptingApi.executeScript({
        target: { tabId: tabId },
        func: () => {
          const list = [];
          const watchLinks = document.querySelectorAll('ytd-playlist-panel-video-renderer a#wc-endpoint, ytd-playlist-panel-video-renderer a#thumbnail');
          watchLinks.forEach(a => {
            if (a.href) {
              try {
                const u = new URL(a.href);
                const v = u.searchParams.get('v');
                if (v && !list.includes(v)) list.push(v);
              } catch (e) {}
            }
          });
          if (list.length > 0) return list;

          const playlistLinks = document.querySelectorAll('ytd-playlist-video-renderer a#thumbnail, ytd-playlist-video-renderer a.ytd-playlist-video-renderer');
          playlistLinks.forEach(a => {
            if (a.href) {
              try {
                const u = new URL(a.href);
                const v = u.searchParams.get('v');
                if (v && !list.includes(v)) list.push(v);
              } catch (e) {}
            }
          });
          return list;
        }
      });

      if (results && results[0] && Array.isArray(results[0].result) && results[0].result.length > 0) {
        return results[0].result;
      }
    } catch (e) {}
  }

  try {
    const response = await fetch(tabUrl);
    if (response.ok) {
      const html = await response.text();
      const panelMatches = html.matchAll(/"playlistPanelVideoRenderer"\s*:\s*\{[\s\S]*?"videoId"\s*:\s*"([a-zA-Z0-9_-]{11})"/g);
      for (const m of panelMatches) {
        if (m[1] && !seen.has(m[1])) {
          seen.add(m[1]);
          ids.push(m[1]);
        }
      }
    }
  } catch (e) {}

  const singleId = parseVideoId(tabUrl);
  if (singleId && !seen.has(singleId)) {
    ids.push(singleId);
  }

  return ids;
}

async function ensureContentScriptInjected(tabId) {
  try {
    if (scriptingApi && scriptingApi.executeScript) {
      await scriptingApi.executeScript({
        target: { tabId: tabId },
        files: ['content.js']
      });
    } else if (tabsApi && tabsApi.executeScript) {
      await new Promise(resolve => {
        tabsApi.executeScript(tabId, { file: 'content.js' }, resolve);
      });
    }
  } catch (err) {
    console.warn("Dynamic injection failed:", err);
  }
}

async function sendPlaylistMessageToAnyTab(ytTabs, payload) {
  for (const tab of ytTabs) {
    try {
      await ensureContentScriptInjected(tab.id);
      await new Promise(r => setTimeout(r, 100));

      const res = await new Promise((resolve) => {
        tabsApi.sendMessage(tab.id, payload, (response) => {
          if (runtimeApi && runtimeApi.lastError) {
            resolve(null);
          } else {
            resolve(response);
          }
        });
      });

      if (res && (res.success || res.error)) {
        return res;
      }
    } catch (e) {
      console.warn("Failed sending to tab", tab.id, e);
    }
  }

  return { error: "Не удалось подключиться к вкладкам YouTube." };
}

async function processBackgroundTask(params) {
  const { mode, highlightedVideoTabs, allYtTabs, selectedData, selectedTempData, pTitle, pPrivacy, sortOrder, closeOriginalTabs } = params;

  taskState.isRunning = true;
  taskState.progressPercent = 0;
  taskState.resultUrl = null;
  taskState.error = null;
  taskState.logHtml = `Анализируем запрос...`;

  // Mode: CONVERT TEMPORARY PLAYLIST TO PERMANENT ACCOUNT PLAYLIST (INSTANT VERSION)
  if (mode === 'convert_temp') {
    if (!selectedTempData || !selectedTempData.tabId) {
      taskState.error = 'Не выбрана вкладка с временным плейлистом.';
      taskState.logHtml = `❌ <strong>Ошибка:</strong> ${taskState.error}`;
      taskState.isRunning = false;
      return;
    }

    taskState.logHtml = 'Считываем видео из временного плейлиста...';
    const videoIds = await getPlaylistVideoIdsFromTab(selectedTempData.tabId, selectedTempData.url);

    if (videoIds.length === 0) {
      taskState.error = 'Не удалось найти видео во временном плейлисте.';
      taskState.logHtml = `❌ <strong>Ошибка:</strong> ${taskState.error}`;
      taskState.isRunning = false;
      return;
    }

    taskState.progressPercent = 50;
    taskState.logHtml = `<strong>Найдено видео: ${videoIds.length}.</strong><br>⏳ Сохраняем в ваш аккаунт YouTube...`;

    const payload = {
      action: 'CREATE_PLAYLIST',
      title: pTitle,
      privacyStatus: pPrivacy,
      videoIds: videoIds
    };

    const res = await sendPlaylistMessageToAnyTab(allYtTabs, payload);

    if (res && res.success && res.playlistId) {
      const cleanPlaylistId = res.playlistId.replace(/^VL/, '');
      const fullPlaylistUrl = `https://www.youtube.com/playlist?list=${cleanPlaylistId}`;

      taskState.progressPercent = 100;
      taskState.logHtml = `✅ <strong>Временный плейлист сохранен в аккаунт!</strong><br><a href="${fullPlaylistUrl}" target="_blank" class="playlist-link" title="${fullPlaylistUrl}">🔗 Открыть новый плейлист (${pTitle})</a>`;

      await new Promise(resolve => setTimeout(resolve, 1200));
      await tabsApi.create({ url: fullPlaylistUrl });

      if (closeOriginalTabs && selectedTempData.tabId) {
        await tabsApi.remove(selectedTempData.tabId);
      }
      taskState.resultUrl = fullPlaylistUrl;
    } else {
      taskState.error = res ? (res.error || 'Не удалось создать плейлист.') : 'Нет ответа от вкладок YouTube.';
      taskState.logHtml += `<br>❌ <strong>Ошибка:</strong> ${taskState.error}`;
    }

    taskState.isRunning = false;
    return;
  }

  // Modes: account_new, account_existing, temp
  const newVideoIds = highlightedVideoTabs ? highlightedVideoTabs.map(t => parseVideoId(t.url)).filter(Boolean) : [];
  const tabIdsToRemove = highlightedVideoTabs ? highlightedVideoTabs.map(t => t.id) : [];

  if (mode === 'account_existing' && selectedData && (selectedData.isTemp || !selectedData.playlistId.startsWith('PL'))) {
    taskState.logHtml = 'Считываем видео из временного плейлиста...';
    const existingVideoIds = await getPlaylistVideoIdsFromTab(selectedData.tabId, selectedData.url);
    const combinedIds = Array.from(new Set([...existingVideoIds, ...newVideoIds]));

    const allVideoDetails = [];
    for (let i = 0; i < combinedIds.length; i++) {
      const vid = combinedIds[i];
      const info = await fetchVideoInfo(vid);
      info.isNew = newVideoIds.includes(vid);
      allVideoDetails.push(info);

      taskState.progressPercent = Math.round(((i + 1) / combinedIds.length) * 100);
      taskState.logHtml = `Анализ ${i + 1}/${combinedIds.length}: ${info.title}`;
    }

    const isAsc = sortOrder === 'asc';
    allVideoDetails.sort((a, b) => isAsc ? a.duration - b.duration : b.duration - a.duration);

    let htmlLog = `<strong>Отсортировано всего (${allVideoDetails.length}):</strong><br>`;
    allVideoDetails.forEach(v => {
      const newBadge = v.isNew ? '<span class="badge-new">NEW</span>' : '';
      htmlLog += `
        <div class="video-item">
          <span class="video-title" title="${v.title}">${v.title}${newBadge}</span>
          <span class="video-duration">${formatTime(v.duration)}</span>
        </div>
      `;
    });
    taskState.logHtml = htmlLog;

    const sortedAllIds = allVideoDetails.map(v => v.id);
    const newTempPlaylistUrl = `https://www.youtube.com/watch_videos?video_ids=${sortedAllIds.join(',')}`;

    await tabsApi.update(selectedData.tabId, { url: newTempPlaylistUrl, active: true });

    if (closeOriginalTabs && tabIdsToRemove.length > 0) {
      await tabsApi.remove(tabIdsToRemove);
    }

    taskState.isRunning = false;
    taskState.resultUrl = newTempPlaylistUrl;
    return;
  }

  // Fetch duration for new video IDs
  const videoDetails = [];
  for (let i = 0; i < newVideoIds.length; i++) {
    const vid = newVideoIds[i];
    const info = await fetchVideoInfo(vid);
    videoDetails.push(info);

    taskState.progressPercent = Math.round(((i + 1) / newVideoIds.length) * 100);
    taskState.logHtml = `Анализ ${i + 1}/${newVideoIds.length}: ${info.title}`;
  }

  if (sortOrder !== 'none') {
    const isAsc = sortOrder === 'asc';
    videoDetails.sort((a, b) => isAsc ? a.duration - b.duration : b.duration - a.duration);
  }
  const sortedVideoIds = videoDetails.map(v => v.id);

  let htmlLog = `<strong>Отсортировано (${videoDetails.length}):</strong><br>`;
  videoDetails.forEach(v => {
    htmlLog += `
      <div class="video-item">
        <span class="video-title" title="${v.title}">${v.title}</span>
        <span class="video-duration">${formatTime(v.duration)}</span>
      </div>
    `;
  });
  taskState.logHtml = htmlLog;

  if (mode === 'account_new') {
    taskState.logHtml += '<br><strong>⏳ Создаем новый плейлист в аккаунте...</strong>';

    const payload = {
      action: 'CREATE_PLAYLIST',
      title: pTitle,
      privacyStatus: pPrivacy,
      videoIds: sortedVideoIds
    };

    const res = await sendPlaylistMessageToAnyTab(allYtTabs, payload);

    if (res && res.success && res.playlistId) {
      const cleanPlaylistId = res.playlistId.replace(/^VL/, '');
      const fullPlaylistUrl = `https://www.youtube.com/playlist?list=${cleanPlaylistId}`;

      taskState.logHtml = `✅ <strong>Плейлист создан! Индексация...</strong><br><a href="${fullPlaylistUrl}" target="_blank" class="playlist-link" title="${fullPlaylistUrl}">🔗 Открыть новый плейлист (${pTitle})</a>`;

      await new Promise(resolve => setTimeout(resolve, 1200));
      await tabsApi.create({ url: fullPlaylistUrl });

      if (closeOriginalTabs && tabIdsToRemove.length > 0) {
        await tabsApi.remove(tabIdsToRemove);
      }
      taskState.resultUrl = fullPlaylistUrl;
    } else {
      taskState.error = res ? (res.error || 'Не удалось создать плейлист.') : 'Нет ответа от вкладок YouTube.';
      taskState.logHtml += `<br>❌ <strong>Ошибка:</strong> ${taskState.error}`;
    }
  } else if (mode === 'account_existing') {
    taskState.logHtml += `<br><strong>⏳ Добавляем ${sortedVideoIds.length} видео в плейлист...</strong>`;

    const payload = {
      action: 'ADD_TO_PLAYLIST',
      playlistId: selectedData.playlistId,
      videoIds: sortedVideoIds
    };

    const res = await sendPlaylistMessageToAnyTab(allYtTabs, payload);

    if (res && res.success) {
      const cleanPlaylistId = selectedData.playlistId.replace(/^VL/, '');
      const fullPlaylistUrl = `https://www.youtube.com/playlist?list=${cleanPlaylistId}`;

      taskState.logHtml = `✅ <strong>Видео добавлены! Индексация...</strong><br><a href="${fullPlaylistUrl}" target="_blank" class="playlist-link" title="${fullPlaylistUrl}">🔗 Обновить плейлист</a>`;

      await new Promise(resolve => setTimeout(resolve, 1200));

      if (selectedData.tabId) {
        await tabsApi.update(selectedData.tabId, { url: fullPlaylistUrl, active: true });
      } else {
        await tabsApi.create({ url: fullPlaylistUrl });
      }

      if (closeOriginalTabs && tabIdsToRemove.length > 0) {
        await tabsApi.remove(tabIdsToRemove);
      }
      taskState.resultUrl = fullPlaylistUrl;
    } else {
      taskState.error = res ? (res.error || 'Не удалось обновить плейлист.') : 'Нет ответа от вкладок YouTube.';
      taskState.logHtml += `<br>❌ <strong>Ошибка:</strong> ${taskState.error}`;
    }
  } else {
    // Temp mode
    const playlistUrl = `https://www.youtube.com/watch_videos?video_ids=${sortedVideoIds.join(',')}`;
    await tabsApi.create({ url: playlistUrl });

    if (closeOriginalTabs && tabIdsToRemove.length > 0) {
      await tabsApi.remove(tabIdsToRemove);
    }
    taskState.resultUrl = playlistUrl;
  }

  taskState.isRunning = false;
}

// Runtime message listener for popup
runtimeApi.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'GET_TASK_STATE') {
    sendResponse(taskState);
    return true;
  }

  if (message.action === 'START_BACKGROUND_TASK') {
    if (!taskState.isRunning) {
      processBackgroundTask(message.params);
    }
    sendResponse({ success: true });
    return true;
  }
});
