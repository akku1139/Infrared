const STORAGE_KEYS = {
  history: 'infrared:history',
  bookmarks: 'infrared:bookmarks',
  theme: 'infrared:theme',
  engine: 'infrared:engine',
};

const state = {
  history: readStorage(STORAGE_KEYS.history, []),
  bookmarks: readStorage(STORAGE_KEYS.bookmarks, []),
  theme: localStorage.getItem(STORAGE_KEYS.theme) || 'system',
  engine: localStorage.getItem(STORAGE_KEYS.engine) || 'bare',
  currentUrl: '',
  currentBody: '',
  currentView: 'home',
  lastView: 'home',
  serviceWorkerReady: false,
};

const elements = {
  root: document.documentElement,
  form: document.getElementById('proxyForm'),
  input: document.getElementById('destinationInput'),
  engine: document.getElementById('engineSelect'),
  message: document.getElementById('formMessage'),
  statusTitle: document.getElementById('statusTitle'),
  statusDescription: document.getElementById('statusDescription'),
  onlineIndicator: document.getElementById('onlineIndicator'),
  topnav: document.querySelector('.topnav'),
  menuButton: document.getElementById('menuButton'),
  settingsDialog: document.getElementById('settingsDialog'),
  themeSelect: document.getElementById('themeSelect'),
  defaultEngineSelect: document.getElementById('defaultEngineSelect'),
  toast: document.getElementById('toast'),
  historyList: document.getElementById('historyList'),
  historyEmpty: document.getElementById('historyEmpty'),
  bookmarksList: document.getElementById('bookmarksList'),
  bookmarksEmpty: document.getElementById('bookmarksEmpty'),
  responseBody: document.getElementById('responseBody'),
  responseTitle: document.getElementById('responseTitle'),
  responseUrl: document.getElementById('responseUrl'),
  responseStatus: document.getElementById('responseStatus'),
  responseMethod: document.getElementById('responseMethod'),
  responseDetails: document.getElementById('responseDetails'),
  bookmarkResponseButton: document.getElementById('bookmarkResponseButton'),
};

let toastTimer;

function readStorage(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    return Array.isArray(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function titleForUrl(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return value;
  }
}

function normalizeDestination(value) {
  const input = value.trim();
  if (!input) throw new Error('URL または検索ワードを入力してください。');

  if (/^https?:\/\//i.test(input)) {
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('HTTP または HTTPS の URL を入力してください。');
    return url.toString();
  }

  if (/^\/\//.test(input)) return new URL(`https:${input}`).toString();
  if (/^[\w-]+\.[\w.-]+(?:\/.*)?$/i.test(input)) return new URL(`https://${input}`).toString();
  return `https://www.google.com/search?q=${encodeURIComponent(input)}`;
}

function setFormMessage(message, link) {
  elements.message.replaceChildren();
  if (!message) return;
  elements.message.append(document.createTextNode(message));
  if (link) {
    const anchor = document.createElement('a');
    anchor.href = link.href;
    anchor.textContent = link.label;
    anchor.target = '_blank';
    anchor.rel = 'noreferrer';
    anchor.style.marginLeft = '6px';
    elements.message.append(anchor);
  }
}

function setTheme(theme) {
  state.theme = theme;
  localStorage.setItem(STORAGE_KEYS.theme, theme);
  const resolvedTheme = theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : theme;
  elements.root.dataset.theme = resolvedTheme;
  elements.themeSelect.value = theme;
}

function setEngine(engine) {
  state.engine = engine;
  localStorage.setItem(STORAGE_KEYS.engine, engine);
  elements.engine.value = engine;
  elements.defaultEngineSelect.value = engine;
  if (engine === 'wisp') {
    elements.statusTitle.textContent = 'Wisp HTTP proxy is ready';
    elements.statusDescription.textContent = 'Epoxy transport 経由でHTTP閲覧できます';
  } else {
    elements.statusTitle.textContent = 'Proxy is ready';
    elements.statusDescription.textContent = '安全な接続を開始できます';
  }
}

function updateOnlineState() {
  const online = navigator.onLine;
  elements.onlineIndicator.classList.toggle('is-offline', !online);
  elements.onlineIndicator.lastChild.textContent = online ? 'オンライン' : 'オフライン';
}

function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add('is-visible');
  toastTimer = setTimeout(() => elements.toast.classList.remove('is-visible'), 2600);
}

function isBookmarked(url) {
  return state.bookmarks.some((item) => item.url === url);
}

function saveHistory(url) {
  const next = { url, title: titleForUrl(url), timestamp: Date.now() };
  state.history = [next, ...state.history.filter((item) => item.url !== url)].slice(0, 30);
  writeStorage(STORAGE_KEYS.history, state.history);
}

function toggleBookmark(url, title = titleForUrl(url)) {
  if (isBookmarked(url)) {
    state.bookmarks = state.bookmarks.filter((item) => item.url !== url);
    showToast('ブックマークから削除しました');
  } else {
    state.bookmarks = [{ url, title, timestamp: Date.now() }, ...state.bookmarks].slice(0, 50);
    showToast('ブックマークに保存しました');
  }
  writeStorage(STORAGE_KEYS.bookmarks, state.bookmarks);
  renderBookmarks();
  updateBookmarkButton();
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(timestamp);
}

function createLibraryItem(item, kind) {
  const row = document.createElement('article');
  row.className = 'library-item';
  const icon = document.createElement('span');
  icon.className = 'library-item-icon';
  icon.textContent = kind === 'history' ? '◷' : '☆';
  const content = document.createElement('div');
  content.className = 'library-item-content';
  const title = document.createElement('strong');
  title.className = 'library-item-title';
  title.textContent = item.title || titleForUrl(item.url);
  const url = document.createElement('span');
  url.className = 'library-item-url';
  url.textContent = item.url;
  content.append(title, url);
  const date = document.createElement('time');
  date.className = 'library-item-date';
  date.dateTime = new Date(item.timestamp).toISOString();
  date.textContent = formatDate(item.timestamp);
  const actions = document.createElement('div');
  actions.className = 'library-item-actions';
  const openButton = document.createElement('button');
  openButton.className = 'item-action';
  openButton.type = 'button';
  openButton.title = '開く';
  openButton.dataset.action = 'open';
  openButton.dataset.url = item.url;
  openButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg>';
  const bookmarkButton = document.createElement('button');
  bookmarkButton.className = `item-action${isBookmarked(item.url) ? ' is-saved' : ''}`;
  bookmarkButton.type = 'button';
  bookmarkButton.title = isBookmarked(item.url) ? 'ブックマークを削除' : 'ブックマークに保存';
  bookmarkButton.dataset.action = 'bookmark';
  bookmarkButton.dataset.url = item.url;
  bookmarkButton.dataset.title = item.title || titleForUrl(item.url);
  bookmarkButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z"/></svg>';
  const deleteButton = document.createElement('button');
  deleteButton.className = 'item-action';
  deleteButton.type = 'button';
  deleteButton.title = '削除';
  deleteButton.dataset.action = 'delete';
  deleteButton.dataset.url = item.url;
  deleteButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';
  actions.append(openButton, bookmarkButton, deleteButton);
  row.append(icon, content, date, actions);
  return row;
}

function renderHistory() {
  elements.historyList.replaceChildren(...state.history.map((item) => createLibraryItem(item, 'history')));
  elements.historyEmpty.hidden = state.history.length > 0;
}

function renderBookmarks() {
  elements.bookmarksList.replaceChildren(...state.bookmarks.map((item) => createLibraryItem(item, 'bookmarks')));
  elements.bookmarksEmpty.hidden = state.bookmarks.length > 0;
}

function updateBookmarkButton() {
  const saved = isBookmarked(state.currentUrl);
  elements.bookmarkResponseButton.classList.toggle('is-saved', saved);
  elements.bookmarkResponseButton.setAttribute('aria-label', saved ? 'ブックマークから削除' : 'ブックマークに保存');
  elements.bookmarkResponseButton.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z"/></svg>`;
}

function setView(view) {
  const views = {
    home: document.getElementById('homeView'),
    history: document.getElementById('historyView'),
    bookmarks: document.getElementById('bookmarksView'),
    response: document.getElementById('responseView'),
  };
  Object.entries(views).forEach(([name, element]) => {
    const active = name === view;
    element.hidden = !active;
    element.classList.toggle('is-visible', active);
  });
  document.querySelectorAll('[data-nav]').forEach((item) => item.classList.toggle('is-active', item.dataset.nav === view));
  state.currentView = view;
  document.body.classList.toggle('is-browsing', view === 'response');
  if (view !== 'response') state.lastView = view;
  elements.topnav.classList.remove('is-open');
  elements.menuButton.setAttribute('aria-expanded', 'false');
  if (window.location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`);
  if (view === 'history') renderHistory();
  if (view === 'bookmarks') renderBookmarks();
}

function showResponseLoading(url) {
  state.currentUrl = url;
  state.currentBody = '';
  elements.responseTitle.textContent = titleForUrl(url);
  elements.responseUrl.textContent = url;
  elements.responseStatus.textContent = 'CONNECTING';
  elements.responseStatus.style.color = 'var(--accent)';
  elements.responseBody.replaceChildren();
  const frame = document.createElement('iframe');
  frame.title = `プロキシ: ${titleForUrl(url)}`;
  frame.setAttribute('sandbox', 'allow-forms allow-modals allow-popups allow-scripts allow-same-origin');
  frame.src = window.infraredProxy.toProxyUrl(url);
  frame.addEventListener('load', () => {
    elements.responseStatus.textContent = 'OPEN';
    elements.responseStatus.style.color = 'var(--success)';
  }, { once: true });
  elements.responseBody.append(frame);
  elements.responseDetails.replaceChildren();
  appendDetail('ROUTE', '/service/');
  appendDetail('ENGINE', state.engine === 'wisp' ? 'Ultraviolet → Wisp' : 'Ultraviolet → Bare V3');
  setView('response');
}

function appendDetail(label, value) {
  const wrapper = document.createElement('div');
  const term = document.createElement('dt');
  term.textContent = label;
  const description = document.createElement('dd');
  description.textContent = value;
  wrapper.append(term, description);
  elements.responseDetails.append(wrapper);
}

async function openDestination(value) {
  let url;
  try {
    url = normalizeDestination(value);
  } catch (error) {
    setFormMessage(error.message);
    elements.input.focus();
    return;
  }
  setFormMessage('');
  saveHistory(url);
  try {
    await window.infraredServiceWorker;
    await window.infraredSetTransport(state.engine);
  } catch (error) {
    setFormMessage(error.message || 'プロキシの起動に失敗しました。');
    return;
  }
  showResponseLoading(url);
  updateBookmarkButton();
  try {
    await new Promise((resolve, reject) => {
      const frame = elements.responseBody.querySelector('iframe');
      if (!frame) {
        reject(new Error('プロキシ画面を作成できませんでした。'));
        return;
      }
      frame.addEventListener('load', resolve, { once: true });
      frame.addEventListener('error', () => reject(new Error('プロキシページの読み込みに失敗しました。')), { once: true });
    });
  } catch (error) {
    elements.responseTitle.textContent = '接続エラー';
    elements.responseStatus.textContent = 'ERROR';
    elements.responseStatus.style.color = 'var(--danger)';
    elements.responseBody.replaceChildren();
    const pre = document.createElement('pre');
    pre.textContent = error.message || 'プロキシ接続に失敗しました。';
    elements.responseBody.append(pre);
    elements.responseDetails.replaceChildren();
    appendDetail('ENGINE', state.engine === 'wisp' ? 'Ultraviolet → Wisp' : 'Ultraviolet → Bare V3');
    appendDetail('TARGET', url);
    updateBookmarkButton();
  }
}

function handleLibraryAction(event, kind) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const url = button.dataset.url;
  if (button.dataset.action === 'open') {
    setEngine('bare');
    openDestination(url);
  }
  if (button.dataset.action === 'bookmark') toggleBookmark(url, button.dataset.title);
  if (button.dataset.action === 'delete') {
    const collection = kind === 'history' ? 'history' : 'bookmarks';
    state[collection] = state[collection].filter((item) => item.url !== url);
    writeStorage(STORAGE_KEYS[collection], state[collection]);
    kind === 'history' ? renderHistory() : renderBookmarks();
  }
}

function clearCollection(collection) {
  state[collection] = [];
  writeStorage(STORAGE_KEYS[collection], state[collection]);
  collection === 'history' ? renderHistory() : renderBookmarks();
  showToast('データを削除しました');
}

function init() {
  window.infraredServiceWorker.then(() => {
    state.serviceWorkerReady = true;
    elements.statusDescription.textContent = 'Service Worker 経由で接続できます';
  }).catch((error) => {
    elements.statusTitle.textContent = 'Proxy unavailable';
    elements.statusDescription.textContent = error.message;
    showToast(error.message);
  });
  setTheme(state.theme);
  setEngine(state.engine);
  updateOnlineState();
  renderHistory();
  renderBookmarks();
  const initialView = window.location.hash.slice(1);
  setView(['home', 'history', 'bookmarks'].includes(initialView) ? initialView : 'home');

  elements.form.addEventListener('submit', (event) => {
    event.preventDefault();
    openDestination(elements.input.value);
  });
  elements.engine.addEventListener('change', () => setEngine(elements.engine.value));
  document.querySelectorAll('.quick-card').forEach((card) => card.addEventListener('click', () => {
    elements.engine.value = 'bare';
    setEngine('bare');
    openDestination(card.dataset.url);
  }));
  document.addEventListener('click', (event) => {
    const nav = event.target.closest('[data-nav]');
    if (nav) setView(nav.dataset.nav);
  });
  elements.historyList.addEventListener('click', (event) => handleLibraryAction(event, 'history'));
  elements.bookmarksList.addEventListener('click', (event) => handleLibraryAction(event, 'bookmarks'));
  document.getElementById('clearHistoryButton').addEventListener('click', () => clearCollection('history'));
  document.getElementById('clearBookmarksButton').addEventListener('click', () => clearCollection('bookmarks'));
  document.getElementById('responseBackButton').addEventListener('click', () => setView(state.lastView || 'home'));
  document.getElementById('openDirectButton').addEventListener('click', () => window.open(state.currentUrl, '_blank', 'noopener,noreferrer'));
  elements.bookmarkResponseButton.addEventListener('click', () => toggleBookmark(state.currentUrl));
  document.getElementById('copyResponseButton').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(state.currentBody || state.currentUrl);
      showToast('レスポンスをコピーしました');
    } catch {
      showToast('コピーできませんでした');
    }
  });
  elements.menuButton.addEventListener('click', () => {
    const expanded = elements.menuButton.getAttribute('aria-expanded') === 'true';
    elements.menuButton.setAttribute('aria-expanded', String(!expanded));
    elements.topnav.classList.toggle('is-open', !expanded);
  });
  document.getElementById('settingsButton').addEventListener('click', () => elements.settingsDialog.showModal());
  document.getElementById('closeSettingsButton').addEventListener('click', () => elements.settingsDialog.close());
  elements.settingsDialog.addEventListener('click', (event) => {
    if (event.target === elements.settingsDialog) elements.settingsDialog.close();
  });
  elements.themeSelect.addEventListener('change', () => setTheme(elements.themeSelect.value));
  elements.defaultEngineSelect.addEventListener('change', () => setEngine(elements.defaultEngineSelect.value));
  document.getElementById('clearLocalDataButton').addEventListener('click', () => {
    clearCollection('history');
    clearCollection('bookmarks');
    showToast('ローカルデータを削除しました');
  });
  window.addEventListener('online', updateOnlineState);
  window.addEventListener('offline', updateOnlineState);
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (state.theme === 'system') setTheme('system');
  });
  if (window.location.pathname.startsWith(window.infraredProxy.prefix)) {
    const source = window.infraredProxy.sourceUrl(window.location.href);
    if (source && source !== window.location.href) {
      elements.input.value = source;
      queueMicrotask(() => openDestination(source));
    }
  }
}

document.addEventListener('DOMContentLoaded', init);
