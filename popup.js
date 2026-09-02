/**
 * YouTube Tab Playlist Sorter
 * Version 3.2.0
 * Instant mode for converting temporary playlists directly without re-fetching video durations.
 */

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

function parsePlaylistId(urlStr) {
  try {
    const url = new URL(urlStr);
    if (url.hostname.includes('youtube.com')) {
      const list = url.searchParams.get('list');
      if (list) return list;
    }
  } catch (e) {
    return null;
  }
  return null;
}

function isAnyPlaylistTab(urlStr) {
  try {
    const url = new URL(urlStr);
    if (!url.hostname.includes('youtube.com')) return false;

    if (url.pathname.includes('watch_videos') && url.searchParams.has('video_ids')) {
      return true;
    }
    if (url.searchParams.has('list')) {
      return true;
    }
  } catch (e) {
    return false;
  }
  return false;
}

document.addEventListener('DOMContentLoaded', async () => {
  const counterContainer = document.getElementById('counterContainer');
  const ytTabCountEl = document.getElementById('ytTabCount');
  const playlistTypeEl = document.getElementById('playlistType');
  const titleGroup = document.getElementById('titleGroup');
  const existingGroup = document.getElementById('existingGroup');
  const targetPlaylistSelect = document.getElementById('targetPlaylistSelect');
  const tempSelectGroup = document.getElementById('tempSelectGroup');
  const targetTempSelect = document.getElementById('targetTempSelect');
  const privacyGroup = document.getElementById('privacyGroup');
  const sortGroup = document.getElementById('sortGroup');
  const playlistTitleEl = document.getElementById('playlistTitle');
  const playlistPrivacyEl = document.getElementById('playlistPrivacy');
  const sortOrderEl = document.getElementById('sortOrder');
  const closeOriginalTabsEl = document.getElementById('closeOriginalTabs');
  const createBtn = document.getElementById('createBtn');
  const btnTextEl = document.getElementById('btnText');
  const progressBar = document.getElementById('progressBar');
  const progressFill = document.getElementById('progressFill');
  const logContainer = document.getElementById('logContainer');

  const tabsApi = (typeof browser !== 'undefined' && browser.tabs) ? browser.tabs : chrome.tabs;
  const runtimeApi = (typeof browser !== 'undefined' && browser.runtime) ? browser.runtime : chrome.runtime;

  let pollInterval = null;

  function scrollToBottom() {
    setTimeout(() => {
      logContainer.scrollTop = logContainer.scrollHeight;
    }, 20);
  }

  function startStatePolling() {
    if (pollInterval) clearInterval(pollInterval);

    pollInterval = setInterval(() => {
      runtimeApi.sendMessage({ action: 'GET_TASK_STATE' }, (state) => {
        if (!state) return;

        if (state.isRunning) {
          createBtn.disabled = true;
          progressBar.style.display = 'block';
          progressFill.style.width = `${state.progressPercent || 0}%`;
          if (state.logHtml) {
            logContainer.innerHTML = state.logHtml;
            scrollToBottom();
          }
        } else {
          clearInterval(pollInterval);
          createBtn.disabled = false;
          if (state.logHtml) {
            logContainer.innerHTML = state.logHtml;
            scrollToBottom();
          }
          if (state.progressPercent >= 100) {
            progressBar.style.display = 'none';
          }
        }
      });
    }, 300);
  }

  let highlightedTabs = [];
  let allYtTabs = [];

  try {
    highlightedTabs = await tabsApi.query({ highlighted: true, currentWindow: true });
    allYtTabs = await tabsApi.query({ currentWindow: true, url: "*://*.youtube.com/*" });
  } catch (e) {
    console.error(e);
  }

  // Filter video tabs from highlighted tabs
  const highlightedVideoTabs = highlightedTabs.filter(t => t.url && parseVideoId(t.url) && !isAnyPlaylistTab(t.url));
  ytTabCountEl.textContent = highlightedVideoTabs.length;

  // Find all open playlist tabs
  const openPlaylistTabs = allYtTabs.filter(t => t.url && isAnyPlaylistTab(t.url));
  const openTempPlaylistTabs = openPlaylistTabs.filter(t => {
    const plId = parsePlaylistId(t.url) || '';
    return !plId.startsWith('PL');
  });

  // Populate targetPlaylistSelect (existing account & temp playlists)
  targetPlaylistSelect.innerHTML = '';
  if (openPlaylistTabs.length > 0) {
    openPlaylistTabs.forEach(pt => {
      const plId = parsePlaylistId(pt.url) || 'TEMP';
      const isTemp = !plId.startsWith('PL');
      const prefixIcon = isTemp ? '⚡' : '⭐';

      const opt = document.createElement('option');
      opt.value = JSON.stringify({ tabId: pt.id, playlistId: plId, url: pt.url, isTemp: isTemp });
      const snippet = (pt.title || 'Плейлист').replace('- YouTube', '').trim();
      opt.textContent = `${prefixIcon} ${snippet.slice(0, 32)}...`;
      targetPlaylistSelect.appendChild(opt);
    });

    const highlightedPlaylistTab = highlightedTabs.find(t => isAnyPlaylistTab(t.url));
    if (highlightedPlaylistTab) {
      const foundOpt = Array.from(targetPlaylistSelect.options).find(o => {
        try {
          const d = JSON.parse(o.value);
          return d.tabId === highlightedPlaylistTab.id;
        } catch(e) { return false; }
      });
      if (foundOpt) {
        targetPlaylistSelect.value = foundOpt.value;
      }
    }
  } else {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '❌ Нет открытых вкладок с плейлистами';
    targetPlaylistSelect.appendChild(opt);
  }

  // Populate targetTempSelect (temporary playlist tabs for convert_temp mode)
  targetTempSelect.innerHTML = '';
  if (openTempPlaylistTabs.length > 0) {
    openTempPlaylistTabs.forEach(pt => {
      const opt = document.createElement('option');
      opt.value = JSON.stringify({ tabId: pt.id, url: pt.url });
      const snippet = (pt.title || 'Временный плейлист').replace('- YouTube', '').trim();
      opt.textContent = `⚡ ${snippet.slice(0, 32)}...`;
      targetTempSelect.appendChild(opt);
    });
  } else {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '❌ Нет открытых временных плейлистов';
    targetTempSelect.appendChild(opt);
  }

  function updateModeUI() {
    const val = playlistTypeEl.value;
    if (val === 'account_new') {
      counterContainer.style.display = 'flex';
      titleGroup.style.display = 'block';
      existingGroup.style.display = 'none';
      tempSelectGroup.style.display = 'none';
      privacyGroup.style.display = 'block';
      sortGroup.style.display = 'block';
      btnTextEl.textContent = 'Создать новый плейлист';
    } else if (val === 'account_existing') {
      counterContainer.style.display = 'flex';
      titleGroup.style.display = 'none';
      existingGroup.style.display = 'block';
      tempSelectGroup.style.display = 'none';
      privacyGroup.style.display = 'none';
      sortGroup.style.display = 'block';
      btnTextEl.textContent = 'Добавить в выбранный плейлист';
    } else if (val === 'convert_temp') {
      counterContainer.style.display = 'none';
      titleGroup.style.display = 'block';
      existingGroup.style.display = 'none';
      tempSelectGroup.style.display = 'block';
      privacyGroup.style.display = 'block';
      sortGroup.style.display = 'none'; // Instant mode: no duration re-analysis needed
      btnTextEl.textContent = 'Мгновенно сохранить в аккаунте';
    } else {
      counterContainer.style.display = 'flex';
      titleGroup.style.display = 'none';
      existingGroup.style.display = 'none';
      tempSelectGroup.style.display = 'none';
      privacyGroup.style.display = 'none';
      sortGroup.style.display = 'block';
      btnTextEl.textContent = 'Создать временный плейлист';
    }
  }

  playlistTypeEl.addEventListener('change', updateModeUI);
  updateModeUI();

  // Check initial state from background.js
  runtimeApi.sendMessage({ action: 'GET_TASK_STATE' }, (state) => {
    if (state && state.isRunning) {
      startStatePolling();
    } else if (state && state.logHtml) {
      logContainer.innerHTML = state.logHtml;
      scrollToBottom();
    } else if (highlightedVideoTabs.length === 0 && playlistTypeEl.value !== 'convert_temp') {
      logContainer.innerHTML = '⚠️ <strong>Не найдено выделенных вкладок с видео!</strong><br><span style="color:#888;">Зажмите Ctrl или Shift и выделите вкладки с видео в браузере.</span>';
    }
  });

  createBtn.addEventListener('click', async () => {
    const mode = playlistTypeEl.value;

    if (mode !== 'convert_temp' && highlightedVideoTabs.length === 0) {
      logContainer.textContent = '❌ Пожалуйста, выделите хотя бы одну вкладку с видео.';
      return;
    }

    createBtn.disabled = true;
    progressBar.style.display = 'block';
    progressFill.style.width = '0%';

    let selectedData = null;
    let selectedTempData = null;

    if (mode === 'account_existing' && targetPlaylistSelect.value) {
      try { selectedData = JSON.parse(targetPlaylistSelect.value); } catch(e) {}
    }

    if (mode === 'convert_temp' && targetTempSelect.value) {
      try { selectedTempData = JSON.parse(targetTempSelect.value); } catch(e) {}
    }

    const params = {
      mode: mode,
      highlightedVideoTabs: highlightedVideoTabs,
      allYtTabs: allYtTabs,
      selectedData: selectedData,
      selectedTempData: selectedTempData,
      pTitle: playlistTitleEl.value.trim() || 'Сохраненный плейлист',
      pPrivacy: playlistPrivacyEl.value,
      sortOrder: sortOrderEl.value,
      closeOriginalTabs: closeOriginalTabsEl.checked
    };

    runtimeApi.sendMessage({ action: 'START_BACKGROUND_TASK', params: params }, () => {
      startStatePolling();
    });
  });
});
