import type { ForumPost, MarketPoint, SourceStatus } from '@/lib/types';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36',
  'Accept-Language': 'zh-HK,zh;q=0.9,en;q=0.5',
};

export type SourceBundle = {
  code: string;
  companyName: string;
  mode: 'live' | 'demo';
  market: MarketPoint[];
  posts: ForumPost[];
  news: ForumPost[];
  sources: SourceStatus[];
};

export type AnalysisProgress = {
  percent: number;
  message: string;
};

type ProgressListener = (progress: AnalysisProgress) => void;

function fetchWithTimeout(url: string, init: RequestInit = {}, timeout = 10_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function cleanHtml(input: string) {
  return input
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_match, value) => String.fromCodePoint(Number.parseInt(value, 16)))
    .replace(/&#(\d+);/g, (_match, value) => String.fromCodePoint(Number.parseInt(value, 10)))
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractJson(text: string, marker: string): unknown {
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) throw new Error('公開頁面格式已變更');
  const objectStart = text.slice(markerIndex + marker.length).search(/[\[{]/);
  if (objectStart < 0) throw new Error('找不到資料物件');
  const start = markerIndex + marker.length + objectStart;
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escape) escape = false;
      else if (char === '\\') escape = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return JSON.parse(text.slice(start, index + 1));
    }
  }
  throw new Error('資料物件不完整');
}

function parseDate(value: unknown) {
  if (typeof value === 'number') {
    const stamp = value > 10_000_000_000 ? value : value * 1000;
    return new Date(stamp);
  }
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (/^\d{10,13}$/.test(text)) {
    const stamp = Number(text);
    return new Date(stamp > 10_000_000_000 ? stamp : stamp * 1000);
  }
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(text)
    ? `${text.slice(0, 10)}T${text.slice(11, 19)}+08:00`
    : text;
  const result = new Date(normalized);
  return Number.isNaN(result.getTime()) ? null : result;
}

function hkDay(date: Date) {
  return new Date(date.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}

function normalizeCompanyName(value: string) {
  const map: Record<string, string> = { 腾: '騰', 讯: '訊', 团: '團', 网: '網', 东: '東', 华: '華', 国: '國', 银: '銀', 业: '業', 药: '藥', 电: '電', 车: '車', 宁: '寧', 长: '長', 门: '門', 发: '發', 际: '際', 联: '聯', 软: '軟', 创: '創', 达: '達', 广: '廣', 实: '實', 宝: '寶', 险: '險', 证: '證' };
  return [...value].map((char) => map[char] ?? char).join('');
}

async function marketSource(code: string) {
  const number = String(Number(code)).padStart(Number(code) <= 9999 ? 4 : 5, '0');
  const symbol = `${number}.HK`;
  try {
    const response = await fetchWithTimeout(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1mo&interval=1d`, { headers: { ...HEADERS, Accept: 'application/json' } }, 4_000);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json() as any;
    const result = payload?.chart?.result?.[0];
    if (!result) throw new Error('沒有行情回應');
    const quote = result.indicators?.quote?.[0] ?? {};
    const market: MarketPoint[] = (result.timestamp ?? []).flatMap((stamp: number, index: number) => {
      const close = quote.close?.[index];
      if (close == null) return [];
      return [{ date: hkDay(new Date(stamp * 1000)), close: Number(Number(close).toFixed(3)), volume: Number(quote.volume?.[index] ?? 0) }];
    }).slice(-8);
    if (!market.length) throw new Error('沒有有效價格');
    const companyName = normalizeCompanyName(String(result.meta?.shortName ?? result.meta?.longName ?? '').trim());
    return { companyName, market, status: { key: 'market', label: '市場行情', ok: true, count: market.length, message: `已取得 ${symbol} 最近交易日行情` } satisfies SourceStatus };
  } catch (error) {
    return { companyName: '', market: [] as MarketPoint[], status: { key: 'market', label: '市場行情', ok: false, count: 0, message: `未能取得行情：${error instanceof Error ? error.message : '未知錯誤'}` } satisfies SourceStatus };
  }
}

async function eastmoneySource(code: string) {
  const cutoff = hkDay(new Date(Date.now() - 2 * 86_400_000));
  const found = new Map<string, ForumPost>();
  try {
    for (let page = 1; page <= 4; page += 1) {
      const params = new URLSearchParams({
        code: `hk${code}`,
        type: '0',
        index: String(page),
        pageSize: '50',
        deviceid: '100',
        version: '200',
        product: 'Guba',
        plat: 'Web',
      });
      const response = await fetchWithTimeout(`https://gbapi.eastmoney.com/webarticlelist/api/Article/Articlelist?${params.toString()}`, {
        headers: {
          ...HEADERS,
          Accept: 'application/json',
          Referer: `https://guba.eastmoney.com/list,hk${code}.html`,
        },
      }, 5_000);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as any;
      const records = Array.isArray(data?.re) ? data.re : [];
      if (!records.length && page === 1) throw new Error('API 沒有回傳討論');
      let recent = 0;
      for (const item of records) {
        if (item?.post_type !== 0) continue;
        const published = parseDate(item.post_publish_time);
        const title = cleanHtml(String(item.post_title ?? ''));
        if (!published || hkDay(published) < cutoff || title.length < 2) continue;
        const id = String(item.post_id ?? `${page}-${found.size}`);
        found.set(id, {
          id, title, author: String(item.user_nickname ?? '匿名用戶'), publishedAt: published.toISOString(), source: '東方財富股吧',
          url: `https://guba.eastmoney.com/news,hk${code},${id}.html`, comments: Number(item.post_comment_count ?? 0), views: Number(item.post_click_count ?? 0),
        });
        recent += 1;
      }
      if (page >= 2 && recent === 0) break;
    }
    const posts = [...found.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    return { posts, status: { key: 'eastmoney', label: '東方財富股吧', ok: posts.length > 0, count: posts.length, message: posts.length ? `已取得近三日 ${posts.length} 條用戶討論` : '近三日沒有可用討論' } satisfies SourceStatus };
  } catch (error) {
    return { posts: [] as ForumPost[], status: { key: 'eastmoney', label: '東方財富股吧', ok: false, count: 0, message: `暫時無法讀取：${error instanceof Error ? error.message : '未知錯誤'}` } satisfies SourceStatus };
  }
}

function walkNews(value: unknown, output: any[]) {
  if (Array.isArray(value)) value.forEach((child) => walkNews(child, output));
  else if (value && typeof value === 'object') {
    const item = value as Record<string, unknown>;
    if (item.title && item.time && item.url) output.push(item);
    Object.values(item).forEach((child) => walkNews(child, output));
  }
}

async function futuSource(code: string) {
  try {
    const response = await fetchWithTimeout(`https://www.futunn.com/stock/${code}-HK`, { headers: HEADERS }, 3_000);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const state = extractJson(await response.text(), 'window.__INITIAL_STATE__=') as any;
    const companyName = normalizeCompanyName(String(state?.stock_info?.name ?? ''));
    const candidates: any[] = [];
    walkNews(state, candidates);
    const cutoff = Date.now() - 3 * 86_400_000;
    const news = candidates.flatMap((item): ForumPost[] => {
      const published = parseDate(item.time);
      const title = cleanHtml(String(item.title ?? ''));
      if (!published || published.getTime() < cutoff || !title) return [];
      return [{ id: String(item.id ?? `${published.getTime()}-${title.slice(0, 12)}`), title, author: String(item.source ?? '富途資訊'), publishedAt: published.toISOString(), source: '富途資訊', url: String(item.url ?? '').replace(/\\u002F/g, '/'), comments: 0, views: 0 }];
    }).filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index).slice(0, 30);
    return { companyName, news, status: { key: 'futu', label: '富途牛牛', ok: true, count: news.length, message: `已取得 ${news.length} 條近期新聞脈絡；公開評論頁未提供穩定接口` } satisfies SourceStatus };
  } catch (error) {
    return { companyName: '', news: [] as ForumPost[], status: { key: 'futu', label: '富途牛牛', ok: false, count: 0, message: `未能讀取公開頁面：${error instanceof Error ? error.message : '未知錯誤'}` } satisfies SourceStatus };
  }
}

async function futuCommunitySource(code: string) {
  try {
    const params = new URLSearchParams({ keyword: code, size: '50' });
    const response = await fetchWithTimeout(`https://ai-news-search.futunn.com/stock_feed?${params.toString()}`, {
      headers: {
        ...HEADERS,
        Accept: 'application/json',
        'User-Agent': 'hk-stock-sentiment-radar/2.2 (Futu official community API)',
      },
    }, 5_000);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json() as { code?: number; message?: string; data?: unknown[] };
    if (payload.code !== 0) throw new Error(payload.message || `API code ${payload.code ?? 'unknown'}`);
    const cutoff = Date.now() - 3 * 86_400_000;
    const stockUrl = `https://www.futunn.com/stock/${code}-HK`;
    const posts = (Array.isArray(payload.data) ? payload.data : []).flatMap((item, index): ForumPost[] => {
      if (!item || typeof item !== 'object') return [];
      const record = item as Record<string, unknown>;
      const title = cleanHtml(String(record.desc || record.title || ''));
      const published = parseDate(record.publish_time);
      if (!published || published.getTime() < cutoff || title.length < 4) return [];
      return [{
        id: String(record.id ?? `futu-api-${index}`),
        title,
        author: '富途社區用戶',
        publishedAt: published.toISOString(),
        source: '富途牛牛討論',
        url: stockUrl,
        comments: 0,
        views: 0,
      }];
    }).filter((item, index, all) => all.findIndex((other) => other.id === item.id || other.title === item.title) === index);
    return {
      posts,
      status: {
        key: 'futu-community',
        label: '富途官方社區 API',
        ok: posts.length > 0,
        count: posts.length,
        message: posts.length ? `官方 stock_feed API 已取得近三日 ${posts.length} 條討論` : '官方 API 暫未回傳近三日討論',
      } satisfies SourceStatus,
    };
  } catch (error) {
    return {
      posts: [] as ForumPost[],
      status: {
        key: 'futu-community',
        label: '富途官方社區 API',
        ok: false,
        count: 0,
        message: `官方 API 暫時無法讀取：${error instanceof Error ? error.message : '未知錯誤'}`,
      } satisfies SourceStatus,
    };
  }
}

async function xueqiuSource(code: string) {
  try {
    const response = await fetchWithTimeout(`https://xueqiu.com/query/v1/search/status.json?q=${code}&count=30&sort=time`, { headers: { ...HEADERS, Accept: 'application/json' } }, 7_000);
    const text = await response.text();
    if (!response.ok || text.trimStart().startsWith('<')) throw new Error('網站啟用了反自動化保護');
    return { posts: [] as ForumPost[], status: { key: 'xueqiu', label: '雪球', ok: false, count: 0, message: '公開回應未提供可驗證的近三日討論' } satisfies SourceStatus };
  } catch (error) {
    return { posts: [] as ForumPost[], status: { key: 'xueqiu', label: '雪球', ok: false, count: 0, message: `暫時無法自動抓取：${error instanceof Error ? error.message : '未知錯誤'}` } satisfies SourceStatus };
  }
}

const DEMO_TEXT = [
  '業績增長不錯，現價開始有吸引力，考慮分段加倉', '今天成交放大但股價偏弱，短線還是要小心',
  '管理層持續回購，對長線估值有支持', '反彈力度太弱，上方套牢盤壓力很大',
  'AI投入可能帶來新增長，但變現還需要時間驗證', '大市氣氛不好，再好的公司也可能跟跌',
  '今日低位有承接，若成交配合有機會反彈', '不要急著抄底，趨勢仍未確認轉強',
  '新產品數據超預期，基本面仍然穩健', '最近連續下跌，市場信心明顯不足',
  '估值已回到合理區間，風險回報改善', '資金流出未止，短期恐怕仍有沽壓',
  '收入增長符合預期，等待下一個催化劑', '回購只能托底，未必代表股價立即上升',
  '遊戲業務恢復增長，是目前最大的利好', '宏觀環境和利率仍然是主要風險',
  '跌到這個位置不悲觀，會繼續持有', '技術走勢轉弱，先觀望再說',
];

export function demoBundle(code: string): SourceBundle {
  const today = hkDay(new Date());
  const names: Record<string, string> = { '00700': '騰訊控股', '09988': '阿里巴巴-W', '01810': '小米集團-W' };
  const posts = DEMO_TEXT.map((title, index): ForumPost => {
    const date = new Date(`${today}T${String(9 + index % 8).padStart(2, '0')}:00:00+08:00`);
    date.setUTCDate(date.getUTCDate() - Math.floor(index / 6));
    return { id: String(index), title, author: `市場觀察員 ${index + 1}`, publishedAt: date.toISOString(), source: '示例討論', url: '#', comments: index % 4, views: 80 + index * 17 };
  });
  const market = [382.6, 378.8, 384.2].map((close, index) => {
    const date = new Date(`${today}T00:00:00+08:00`);
    date.setUTCDate(date.getUTCDate() - (2 - index));
    return { date: hkDay(date), close, volume: 18_000_000 + index * 2_300_000 };
  });
  return { code, companyName: names[code] ?? `港股 ${code}`, mode: 'demo', market, posts, news: [], sources: [
    { key: 'demo', label: '示例資料', ok: true, count: posts.length, message: '內置示例，不代表真實市場' },
    { key: 'market', label: '市場行情', ok: true, count: market.length, message: '使用示例行情' },
    { key: 'xueqiu', label: '雪球', ok: false, count: 0, message: '示例模式未連線' },
    { key: 'futu', label: '富途牛牛', ok: false, count: 0, message: '示例模式未連線' },
    { key: 'futu-community', label: '富途官方社區 API', ok: false, count: 0, message: '示例模式未連線' },
  ] };
}

export async function liveBundle(code: string, onProgress?: ProgressListener): Promise<SourceBundle> {
  // Keep every configured source except Xueqiu in the live collection. Xueqiu's
  // public endpoint is skipped because its anti-bot response is not usable.
  let completedSources = 0;
  const track = async <T,>(label: string, task: Promise<T>) => {
    const result = await task;
    completedSources += 1;
    onProgress?.({
      percent: 14 + completedSources * 16,
      message: `${label}已處理（${completedSources}/4）`,
    });
    return result;
  };
  onProgress?.({ percent: 14, message: '正在並行抓取 4 個資料來源…' });
  const [market, eastmoney, futu, futuCommunity] = await Promise.all([
    track('市場行情', marketSource(code)),
    track('東方財富股吧', eastmoneySource(code)),
    track('富途資訊', futuSource(code)),
    track('富途官方討論', futuCommunitySource(code)),
  ]);
  onProgress?.({ percent: 84, message: '資料抓取完成，正在整理近三日樣本…' });
  const xueqiuStatus: SourceStatus = {
    key: 'xueqiu', label: '雪球', ok: false, count: 0,
    message: '按目前設定略過：公開接口的反自動化回應無法可靠分析',
  };
  return {
    code, mode: 'live', companyName: futu.companyName || market.companyName || `港股 ${code}`,
    market: market.market, posts: [...futuCommunity.posts, ...eastmoney.posts], news: futu.news,
    sources: [market.status, futuCommunity.status, eastmoney.status, xueqiuStatus, futu.status],
  };
}
