const DISCUSSION_PATTERN = /討論|讨论|評論|评论|牛牛圈|社區|社区|動態|动态/i;
const LOGIN_PATTERN = /註冊\s*\/\s*登入|注册\s*\/\s*登录|立即登入|立即登录/i;
const MAX_POSTS = 120;

function clean(value, limit = 900) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function absoluteUrl(value) {
  try {
    const url = new URL(value || location.href, location.href);
    return url.hostname.endsWith('futunn.com') ? url.href : location.href;
  } catch {
    return location.href;
  }
}

function numberFromText(value) {
  const match = clean(value, 40).replace(/,/g, '').match(/(\d+(?:\.\d+)?)(万|萬|k)?/i);
  if (!match) return 0;
  const base = Number(match[1]) || 0;
  const multiplier = /万|萬/.test(match[2] || '') ? 10_000 : /k/i.test(match[2] || '') ? 1_000 : 1;
  return Math.round(base * multiplier);
}

function parsePublishedAt(value) {
  const text = clean(value, 80);
  const now = new Date();
  if (!text) return now.toISOString();
  if (/剛剛|刚刚|分鐘前|分钟前/.test(text)) return now.toISOString();
  const hoursAgo = text.match(/(\d+)\s*(?:小時|小时)前/);
  if (hoursAgo) return new Date(now.getTime() - Number(hoursAgo[1]) * 3_600_000).toISOString();
  if (/昨天/.test(text)) return new Date(now.getTime() - 86_400_000).toISOString();
  const full = text.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (full) return new Date(`${full[1]}-${full[2].padStart(2, '0')}-${full[3].padStart(2, '0')}T12:00:00+08:00`).toISOString();
  const monthDay = text.match(/(\d{1,2})[-/.月](\d{1,2})/);
  if (monthDay) return new Date(`${now.getFullYear()}-${monthDay[1].padStart(2, '0')}-${monthDay[2].padStart(2, '0')}T12:00:00+08:00`).toISOString();
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? now.toISOString() : parsed.toISOString();
}

function isVisible(element) {
  if (!(element instanceof HTMLElement)) return false;
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
}

async function openDiscussionArea() {
  const controls = [...document.querySelectorAll('a, button, [role="tab"]')]
    .filter((element) => isVisible(element) && DISCUSSION_PATTERN.test(clean(element.textContent, 30)));
  const target = controls.find((element) => /討論|讨论|評論|评论|牛牛圈/.test(clean(element.textContent, 30))) ?? controls[0];
  if (target instanceof HTMLElement) {
    target.click();
    await new Promise((resolve) => setTimeout(resolve, 1_300));
  }
}

function candidateNodes() {
  const selectors = [
    'article',
    '[class*="comment-item"]', '[class*="commentItem"]',
    '[class*="feed-item"]', '[class*="feedItem"]',
    '[class*="post-item"]', '[class*="postItem"]',
    '[class*="moment-item"]', '[class*="momentItem"]',
    '[class*="community-item"]', '[class*="communityItem"]',
    '[data-testid*="post"]', '[data-testid*="feed"]', '[data-testid*="comment"]',
  ];
  return [...new Set(selectors.flatMap((selector) => [...document.querySelectorAll(selector)]))]
    .filter(isVisible);
}

function extractPost(node, index) {
  const contentNode = node.querySelector(
    '[class*="content"], [class*="text"], [class*="detail"], [class*="desc"], p',
  );
  const title = clean(contentNode?.textContent || node.textContent);
  if (title.length < 8 || title.length > 900) return null;
  if (/下載富途|风险提示|風險提示|免责声明|免責聲明/.test(title)) return null;

  const authorNode = node.querySelector(
    '[class*="author"], [class*="user-name"], [class*="userName"], [class*="nickname"], a[href*="/user/"]',
  );
  const timeNode = node.querySelector('time, [class*="time"], [class*="date"]');
  const linkNode = node.querySelector('a[href*="/post/"], a[href*="/community"], a[href*="q.futunn.com"], a[href*="/stock/"]');
  const commentNode = node.querySelector('[class*="comment-count"], [class*="commentCount"], [class*="reply"]');
  const viewNode = node.querySelector('[class*="view-count"], [class*="viewCount"], [class*="read"]');
  return {
    id: `futu-extension-${Date.now()}-${index}`,
    title,
    author: clean(authorNode?.textContent || '富途用戶', 80),
    publishedAt: parsePublishedAt(timeNode?.textContent || ''),
    source: '富途牛牛討論',
    url: absoluteUrl(linkNode?.getAttribute('href') || location.href),
    comments: numberFromText(commentNode?.textContent || ''),
    views: numberFromText(viewNode?.textContent || ''),
  };
}

function sessionStatus() {
  const bodyText = clean(document.body?.innerText, 8_000);
  const hasLoginPrompt = LOGIN_PATTERN.test(bodyText);
  const hasAccountMarker = Boolean(document.querySelector(
    '[class*="avatar"], [class*="user-info"], [class*="userInfo"], a[href*="/user/"]',
  ));
  return {
    loggedIn: hasAccountMarker && !hasLoginPrompt,
    loginPromptVisible: hasLoginPrompt,
    url: location.href,
  };
}

async function scrapeVisiblePosts() {
  await openDiscussionArea();
  const posts = candidateNodes()
    .map(extractPost)
    .filter(Boolean)
    .filter((post, index, all) => all.findIndex((candidate) => candidate.title === post.title) === index)
    .slice(0, MAX_POSTS);
  return {
    posts,
    count: posts.length,
    session: sessionStatus(),
    message: posts.length
      ? `已從富途頁面讀取 ${posts.length} 條可見討論。`
      : '富途頁面已開啟，但暫未識別到討論；可能需要完成登入、切換至討論分頁，或頁面版面已更新。',
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'HKSR_CHECK_SESSION') {
    sendResponse(sessionStatus());
    return false;
  }
  if (message?.type === 'HKSR_SCRAPE_STOCK') {
    scrapeVisiblePosts()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  return false;
});
