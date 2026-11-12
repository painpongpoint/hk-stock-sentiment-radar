const CHANNEL = 'HKSR_WEB_V2';
const ALLOWED_APP_ORIGINS = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://hk-stock-sentiment-radar.luis-mok.chatgpt.site',
]);
const FUTU_LOGIN_URL = 'https://passport.futunn.com/';

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function senderIsAllowed(sender) {
  try {
    return Boolean(sender.tab?.url) && ALLOWED_APP_ORIGINS.has(new URL(sender.tab.url).origin);
  } catch {
    return false;
  }
}

async function focusTab(tab) {
  if (!tab?.id) return;
  await chrome.tabs.update(tab.id, { active: true });
  if (typeof tab.windowId === 'number') await chrome.windows.update(tab.windowId, { focused: true });
}

async function findFutuTab() {
  const tabs = await chrome.tabs.query({ url: ['https://*.futunn.com/*'] });
  return tabs.find((tab) => tab.url?.startsWith('https://passport.futunn.com/'))
    ?? tabs.find((tab) => tab.url?.includes('/stock/'))
    ?? tabs[0]
    ?? null;
}

async function openLoginWindow() {
  const existing = await findFutuTab();
  if (existing) {
    await chrome.tabs.update(existing.id, { url: FUTU_LOGIN_URL, active: true });
    if (typeof existing.windowId === 'number') await chrome.windows.update(existing.windowId, { focused: true });
    return { ok: true, tabId: existing.id, reused: true };
  }
  const created = await chrome.windows.create({
    url: FUTU_LOGIN_URL,
    type: 'popup',
    width: 1180,
    height: 820,
    focused: true,
  });
  return { ok: true, tabId: created.tabs?.[0]?.id ?? null, reused: false };
}

async function waitUntilLoaded(tabId, timeout = 30_000) {
  const initial = await chrome.tabs.get(tabId);
  if (initial.status === 'complete') return initial;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('富途頁面載入逾時，請稍後再試。'));
    }, timeout);
    function listener(updatedTabId, changeInfo, tab) {
      if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(tab);
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function sendToFutuTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    await chrome.tabs.reload(tabId);
    await waitUntilLoaded(tabId);
    await delay(900);
    return chrome.tabs.sendMessage(tabId, message);
  }
}

async function checkSession() {
  const tab = await findFutuTab();
  if (!tab?.id) return { ok: false, error: '找不到富途登入視窗，請先開啟官方登入。' };
  await focusTab(tab);
  if (tab.status !== 'complete') await waitUntilLoaded(tab.id);
  const status = await sendToFutuTab(tab.id, { type: 'HKSR_CHECK_SESSION' });
  return { ok: true, tabId: tab.id, ...status };
}

async function scrapeStock(code) {
  if (!/^\d{5}$/.test(code)) throw new Error('股票編號格式不正確。');
  const stockUrl = `https://www.futunn.com/stock/${code}-HK`;
  let tab = await findFutuTab();
  if (tab?.id) {
    tab = await chrome.tabs.update(tab.id, { url: stockUrl, active: true });
    if (typeof tab.windowId === 'number') await chrome.windows.update(tab.windowId, { focused: true });
  } else {
    tab = await chrome.tabs.create({ url: stockUrl, active: true });
  }
  if (!tab.id) throw new Error('未能建立富途股票頁。');
  await waitUntilLoaded(tab.id);
  await delay(1_500);
  const result = await sendToFutuTab(tab.id, { type: 'HKSR_SCRAPE_STOCK', code, stockUrl });
  return { ok: true, tabId: tab.id, stockUrl, ...result };
}

async function handleRequest(message) {
  switch (message.action) {
    case 'PING':
      return { ok: true, version: chrome.runtime.getManifest().version };
    case 'OPEN_LOGIN':
      return openLoginWindow();
    case 'CHECK_SESSION':
      return checkSession();
    case 'SCRAPE_STOCK':
      return scrapeStock(String(message.payload?.code ?? ''));
    default:
      return { ok: false, error: '不支援的擴充功能操作。' };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.channel !== CHANNEL) return false;
  if (!senderIsAllowed(sender)) {
    sendResponse({ ok: false, error: '這個網站沒有權限使用港股情緒雷達擴充功能。' });
    return false;
  }
  handleRequest(message)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  return true;
});
