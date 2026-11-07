'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  Activity, ArrowDownRight, ArrowUpRight, CheckCircle2, CircleAlert, Database,
  Download, ExternalLink, FileText, LoaderCircle, LogIn, MonitorUp, PlugZap,
  RefreshCw, Search, ShieldCheck, Sparkles, TrendingUp, WifiOff,
} from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import type { AnalysisResult, ForumPost } from '@/lib/types';

const SAMPLE: AnalysisResult = {
  generatedAt: '2026-10-29T12:00:00+08:00', code: '00700', companyName: '騰訊控股', mode: 'demo',
  window: { from: '2026-10-27', to: '2026-10-29', label: '當天及前兩個曆日' },
  market: { available: true, points: [{ date: '2026-10-27', close: 382.6, volume: 18000000 }, { date: '2026-10-28', close: 378.8, volume: 20300000 }, { date: '2026-10-29', close: 384.2, volume: 22600000 }], latestPrice: 384.2, changePct: 0.42, latestDate: '2026-10-29', trend: '橫行' },
  sentiment: { index: 13, label: '中性', trend: '輕微改善', delta: 9, controversy: 82, distribution: { positive: 58, neutral: 84, negative: 54, positivePct: 29.6, neutralPct: 42.9, negativePct: 27.5 } },
  discussionCount: 196,
  daily: [{ date: '2026-10-27', label: '10/27', count: 52, sentimentIndex: 4, positive: 14, neutral: 24, negative: 14 }, { date: '2026-10-28', label: '10/28', count: 71, sentimentIndex: 8, positive: 20, neutral: 33, negative: 18 }, { date: '2026-10-29', label: '10/29', count: 73, sentimentIndex: 13, positive: 24, neutral: 27, negative: 22 }],
  topics: [{ name: '業績與估值', count: 44, share: 22.4 }, { name: '股價與技術走勢', count: 37, share: 18.9 }, { name: 'AI／科技投入', count: 29, share: 14.8 }, { name: '回購與股東回報', count: 22, share: 11.2 }],
  prediction: { direction: '震盪／中性', probabilityUp: 52, probabilityDown: 48, confidence: 35, horizon: '未來 1 至 3 個交易日', method: '規則式中文情緒分數、三日情緒變化及價格動能的原型加權' },
  excerpts: {
    positive: [{ id: '1', title: '業績增長不錯，現價開始有吸引力，考慮分段加倉', author: '市場觀察員', publishedAt: '2026-10-29T02:10:00Z', source: '示例討論', url: '#', comments: 3, views: 168, sentiment: '正面', score: 0.78 }],
    negative: [{ id: '2', title: '成交放大但股價偏弱，短線仍要小心上方壓力', author: '趨勢交易者', publishedAt: '2026-10-29T03:30:00Z', source: '示例討論', url: '#', comments: 5, views: 201, sentiment: '負面', score: -0.63 }], recent: [],
  },
  news: [],
  sources: [{ key: 'market', label: '市場行情', ok: true, count: 8, message: '最近交易日行情' }, { key: 'eastmoney', label: '公開論壇', ok: true, count: 196, message: '近三日公開討論' }, { key: 'xueqiu', label: '雪球', ok: false, count: 0, message: '公開接口可能受限' }, { key: 'futu', label: '富途牛牛', ok: true, count: 12, message: '近期新聞脈絡' }],
  limitations: ['V2 使用可解釋的中文詞典與規則式分析。', '論壇用戶不代表整體市場。', '短線方向並非交易訊號。'], report: '',
};

const chartConfig = { close: { label: '收市價', color: '#c8ff45' }, sentimentIndex: { label: '情緒指數', color: '#56d6ae' } };
const CONNECTOR_URL = 'http://127.0.0.1:8766';

type ConnectorState = 'checking' | 'unavailable' | 'service-ready' | 'login-open' | 'connected' | 'scraping' | 'error';
type ConnectorStatus = {
  ok: boolean;
  state: ConnectorState;
  browserOpen?: boolean;
  loginConfirmed?: boolean;
  message?: string;
  posts?: ForumPost[];
  count?: number;
  error?: string;
};

async function connectorRequest(path: string, init?: RequestInit, timeout = 6_000): Promise<ConnectorStatus> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(`${CONNECTOR_URL}${path}`, { ...init, mode: 'cors', cache: 'no-store', signal: controller.signal });
    const payload = await response.json() as ConnectorStatus;
    if (!response.ok) throw new Error(payload.error || payload.message || '本機連接器回應錯誤');
    return payload;
  } finally {
    window.clearTimeout(timer);
  }
}

function formatSigned(value: number | null, suffix = '') {
  if (value == null) return '—';
  return `${value > 0 ? '+' : ''}${value}${suffix}`;
}

function PostList({ title, posts, tone }: { title: string; posts: ForumPost[]; tone: 'positive' | 'negative' }) {
  return (
    <article className="report-panel opinion-panel">
      <div className="panel-heading"><div><span>REPRESENTATIVE VIEWS</span><h3>{title}</h3></div><Badge variant="outline" className={tone}>{posts.length} 條</Badge></div>
      <div className="opinion-list">
        {posts.length ? posts.slice(0, 3).map((post) => (
          <a className="opinion-item" href={post.url === '#' ? undefined : post.url} target="_blank" rel="noreferrer" key={`${post.source}-${post.id}`}>
            <span className={`sentiment-mark ${tone}`} /><div><p>{post.title}</p><small>{post.source} · {post.author}</small></div>{post.url !== '#' && <ExternalLink size={13} />}
          </a>
        )) : <div className="empty-note">本時段未識別到明顯{tone === 'positive' ? '正面' : '負面'}觀點。</div>}
      </div>
    </article>
  );
}

export default function Home() {
  const [code, setCode] = useState('00700');
  const [result, setResult] = useState<AnalysisResult>(SAMPLE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hasRun, setHasRun] = useState(false);
  const [connectorState, setConnectorState] = useState<ConnectorState>('checking');
  const [connectorMessage, setConnectorMessage] = useState('正在檢查 Windows 本機連接器…');
  const [futuCount, setFutuCount] = useState(0);

  useEffect(() => { void checkConnector(true); }, []);

  const metrics = useMemo(() => [
    { label: '最新價格', value: result.market.latestPrice == null ? '未取得' : `HK$ ${result.market.latestPrice.toFixed(2)}`, note: result.market.changePct == null ? result.market.trend : `三日 ${formatSigned(result.market.changePct, '%')}`, up: (result.market.changePct ?? 0) >= 0 },
    { label: '情緒指數', value: formatSigned(result.sentiment.index), note: `${result.sentiment.label} · ${result.sentiment.trend}`, up: result.sentiment.index >= 0 },
    { label: '討論樣本', value: String(result.discussionCount), note: '近三日公開討論', up: true },
    { label: '短線向上概率', value: `${result.prediction.probabilityUp}%`, note: `信心 ${result.prediction.confidence} / 100`, up: result.prediction.probabilityUp >= 50 },
  ], [result]);

  const futuLatest = useMemo(
    () => result.excerpts.recent.filter((post) => post.source === '富途牛牛討論').slice(0, 6),
    [result],
  );

  async function checkConnector(quiet = false) {
    if (!quiet) setConnectorState('checking');
    try {
      const status = await connectorRequest('/health');
      const state = status.loginConfirmed ? 'connected' : status.browserOpen ? 'login-open' : 'service-ready';
      setConnectorState(state);
      setConnectorMessage(status.loginConfirmed ? '富途本機登入已確認，可以同步最新討論。' : status.browserOpen ? '官方富途登入頁已開啟；完成登入後返回這裡確認。' : '本機連接器已啟動，下一步開啟富途官方登入。');
    } catch {
      setConnectorState('unavailable');
      setConnectorMessage('尚未偵測到本機連接器。下載並啟動後，再按重新檢查。');
    }
  }

  async function openFutuLogin() {
    setConnectorState('checking');
    setConnectorMessage('正在開啟富途官方登入頁…');
    try {
      await connectorRequest('/open-login', { method: 'POST' }, 55_000);
      setConnectorState('login-open');
      setConnectorMessage('請在新 Chrome 視窗完成富途登入及驗證，密碼不會傳到本網站。');
    } catch (reason) {
      setConnectorState('error');
      setConnectorMessage(reason instanceof Error ? reason.message : '未能開啟富途登入頁。');
    }
  }

  async function confirmFutuLogin() {
    setConnectorState('checking');
    try {
      await connectorRequest('/confirm-login', { method: 'POST' });
      setConnectorState('connected');
      setConnectorMessage('登入已確認；開始分析時會由本機瀏覽器同步富途最新討論。');
    } catch (reason) {
      setConnectorState('error');
      setConnectorMessage(reason instanceof Error ? reason.message : '未能確認登入。');
    }
  }

  async function runAnalysis(event?: FormEvent, requestedCode = code, mode: 'live' | 'demo' = 'live') {
    event?.preventDefault();
    const cleaned = requestedCode.replace(/\D/g, '').slice(0, 5);
    if (!cleaned) { setError('請輸入港股編號，例如 00700。'); return; }
    const normalized = cleaned.padStart(5, '0');
    setCode(normalized); setLoading(true); setError('');
    try {
      let futuPosts: ForumPost[] = [];
      if (mode === 'live' && connectorState === 'connected') {
        setConnectorState('scraping');
        setConnectorMessage(`正在從富途登入頁整理 HK ${normalized} 最新討論…`);
        try {
          const local = await connectorRequest('/scrape', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: normalized }),
          }, 75_000);
          futuPosts = local.posts ?? [];
          setFutuCount(futuPosts.length);
          setConnectorState('connected');
          setConnectorMessage(futuPosts.length ? `已同步 ${futuPosts.length} 條富途最新討論。` : (local.message || '本次未識別到富途討論，已繼續分析其他來源。'));
        } catch (reason) {
          setConnectorState('error');
          setConnectorMessage(`${reason instanceof Error ? reason.message : '富途抓取失敗'}；本次已改用其他公開來源。`);
        }
      }
      const response = futuPosts.length
        ? await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: normalized, mode, futuPosts }) })
        : await fetch(`/api/analyze?code=${encodeURIComponent(normalized)}&mode=${mode}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? '分析暫時失敗。');
      setResult(payload); setHasRun(true);
      requestAnimationFrame(() => document.querySelector('#analysis-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '分析暫時失敗，請稍後再試。');
    } finally { setLoading(false); }
  }

  function downloadReport() {
    const content = result.report || `${result.companyName}（${result.code}）\n情緒指數：${formatSigned(result.sentiment.index)}\n短線研判：${result.prediction.direction}\n\n免責聲明：只供市場研究，不構成投資建議。`;
    const url = URL.createObjectURL(new Blob(['\uFEFF', content], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `${result.code}-三日情緒報告.txt`; link.click(); URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-screen overflow-hidden">
      <div className="market-grid" aria-hidden="true" />
      <header className="site-header"><a className="brand" href="#top" aria-label="港股情緒雷達首頁"><span className="brand-mark">港</span><span><strong>港股情緒雷達</strong><small>MARKET SENTIMENT LAB</small></span></a><Badge variant="outline" className="live-badge"><span className="live-dot" /> PUBLIC V2</Badge></header>

      <section className="workspace-shell" id="top">
        <div className="intro-copy"><Badge variant="outline" className="section-badge"><Activity data-icon="inline-start" /> SECONDARY MARKET INTELLIGENCE</Badge><h1>從市場雜音中，<span>看見情緒轉向。</span></h1><p>整合公開論壇、富途登入頁最新討論與價格變化，分析當天及前兩日市場情緒。</p></div>

        <section className={`futu-connect-card state-${connectorState}`} aria-label="富途牛牛本機連接">
          <div className="futu-connect-main">
            <div className="futu-icon"><MonitorUp size={23} /></div>
            <div className="futu-connect-copy">
              <div><span>FUTU LOCAL CONNECTOR</span><Badge variant="outline">V2 安全登入</Badge></div>
              <h2>連接富途牛牛討論</h2>
              <p>{connectorMessage}</p>
            </div>
            <div className="connector-status"><i /><span>{connectorState === 'connected' || connectorState === 'scraping' ? '已連接' : connectorState === 'service-ready' || connectorState === 'login-open' ? '等待登入' : connectorState === 'checking' ? '檢查中' : '未連接'}</span>{futuCount > 0 && <b>{futuCount} 條</b>}</div>
          </div>
          <div className="connector-steps">
            <div className={connectorState !== 'unavailable' ? 'done' : ''}><span>1</span><p>啟動 Windows 連接器</p></div>
            <i />
            <div className={['login-open', 'connected', 'scraping'].includes(connectorState) ? 'done' : ''}><span>2</span><p>官方頁面登入</p></div>
            <i />
            <div className={['connected', 'scraping'].includes(connectorState) ? 'done' : ''}><span>3</span><p>同步最新討論</p></div>
          </div>
          <div className="connector-actions">
            {connectorState === 'unavailable' && <a className="connector-download" href="/futu-connector-v2.zip" download><Download size={15} />下載 Windows 連接器</a>}
            {(connectorState === 'unavailable' || connectorState === 'error') && <Button type="button" variant="outline" onClick={() => checkConnector(false)}><RefreshCw data-icon="inline-start" />重新檢查</Button>}
            {connectorState === 'service-ready' && <Button type="button" onClick={openFutuLogin}><LogIn data-icon="inline-start" />開啟富途官方登入</Button>}
            {connectorState === 'login-open' && <Button type="button" onClick={confirmFutuLogin}><CheckCircle2 data-icon="inline-start" />我已完成登入</Button>}
            {connectorState === 'connected' && <Button type="button" variant="outline" onClick={() => checkConnector(false)}><PlugZap data-icon="inline-start" />檢查連線</Button>}
            {connectorState === 'checking' || connectorState === 'scraping' ? <span className="connector-working"><LoaderCircle className="spin" size={15} />處理中</span> : null}
            <small><ShieldCheck size={13} />帳號、密碼、驗證碼及 Cookie 只留在你的電腦</small>
          </div>
        </section>

        <form className="stock-search" aria-label="港股分析搜尋" onSubmit={runAnalysis}>
          <label htmlFor="stock-code">港股編號</label>
          <div className="search-controls"><div className="stock-input-wrap"><span>HK</span><Input id="stock-code" name="code" inputMode="numeric" maxLength={5} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} aria-describedby="search-note" /></div><Button type="submit" size="lg" className="analyze-button" disabled={loading}>{loading ? <LoaderCircle className="spin" data-icon="inline-start" /> : <Search data-icon="inline-start" />}{loading ? (connectorState === 'scraping' ? '正在抓取富途…' : '正在整合資料…') : '抓取及分析'} <ArrowUpRight data-icon="inline-end" /></Button></div>
          <div className="search-footer" id="search-note"><span>常用：{[['00700', '騰訊'], ['09988', '阿里'], ['01810', '小米']].map(([value, label], index) => <button type="button" onClick={() => setCode(value)} key={value}>{index ? ' · ' : ''}{value} {label}</button>)}</span><span><ShieldCheck size={13} /> 公開來源＋可選本機富途資料</span></div>
          {error && <div className="error-banner" role="alert"><CircleAlert size={16} />{error}<button type="button" onClick={() => runAnalysis(undefined, code, 'demo')}>改看示例</button></div>}
        </form>

        <section id="analysis-result" className="analysis-section" aria-live="polite" aria-busy={loading}>
          <div className="signal-header"><div><span>{hasRun ? '即時分析' : '示例預覽'}</span><h2>{result.companyName} <small>HK {result.code}</small></h2></div><div className="header-actions"><div className="data-window"><Database size={14} /> {result.window.from} — {result.window.to}</div><Button size="sm" variant="outline" onClick={downloadReport}><Download data-icon="inline-start" />下載報告</Button></div></div>
          {!hasRun && <div className="preview-notice"><Sparkles size={15} />目前顯示介面示例；輸入代碼後會抓取最新公開資料。</div>}
          <div className="metric-grid">{metrics.map((metric) => <article className="metric-card" key={metric.label}><div className="metric-label">{metric.label}</div><strong>{metric.value}</strong><span className={metric.up ? 'up' : 'down'}>{metric.up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}{metric.note}</span></article>)}</div>

          <div className="dashboard-grid">
            <article className="report-panel chart-panel wide"><div className="panel-heading"><div><span>MARKET MOMENTUM</span><h3>最近交易日價格</h3></div><b>{result.market.trend}</b></div>{result.market.points.length ? <ChartContainer config={chartConfig} className="price-chart"><AreaChart data={result.market.points} margin={{ left: 0, right: 8, top: 12, bottom: 0 }}><defs><linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#c8ff45" stopOpacity={0.28}/><stop offset="95%" stopColor="#c8ff45" stopOpacity={0}/></linearGradient></defs><CartesianGrid vertical={false} strokeDasharray="3 3"/><XAxis dataKey="date" tickFormatter={(value) => value.slice(5)} axisLine={false} tickLine={false}/><YAxis domain={['auto', 'auto']} axisLine={false} tickLine={false} width={42}/><ChartTooltip content={<ChartTooltipContent />} /><Area type="monotone" dataKey="close" stroke="#c8ff45" fill="url(#priceFill)" strokeWidth={2}/></AreaChart></ChartContainer> : <div className="empty-note chart-empty">未能取得市場行情</div>}</article>
            <article className="report-panel probability-panel"><div className="panel-heading"><div><span>SHORT-TERM OUTLOOK</span><h3>短線研判</h3></div><TrendingUp size={20}/></div><strong>{result.prediction.direction}</strong><div className="probability"><span>向上概率</span><b>{result.prediction.probabilityUp}%</b></div><Progress value={result.prediction.probabilityUp}/><div className="confidence"><span>分析信心</span><span>{result.prediction.confidence} / 100</span></div><small>{result.prediction.horizon}</small></article>
            <article className="report-panel chart-panel wide"><div className="panel-heading"><div><span>SENTIMENT PULSE</span><h3>三日情緒脈衝</h3></div><b>{result.sentiment.trend}</b></div><ChartContainer config={chartConfig} className="sentiment-chart"><BarChart data={result.daily} margin={{ left: -20, right: 6, top: 8, bottom: 0 }}><CartesianGrid vertical={false} strokeDasharray="3 3"/><XAxis dataKey="label" axisLine={false} tickLine={false}/><YAxis domain={[-100, 100]} axisLine={false} tickLine={false}/><ChartTooltip content={<ChartTooltipContent />} /><Bar dataKey="sentimentIndex" fill="#56d6ae" radius={[5, 5, 2, 2]}/></BarChart></ChartContainer></article>
            <article className="report-panel distribution-panel"><div className="panel-heading"><div><span>OPINION MIX</span><h3>觀點分佈</h3></div><b>爭議 {result.sentiment.controversy}</b></div>{([['正面', result.sentiment.distribution.positivePct, 'positive'], ['中性', result.sentiment.distribution.neutralPct, 'neutral'], ['負面', result.sentiment.distribution.negativePct, 'negative']] as const).map(([label, value, tone]) => <div className="distribution-row" key={label}><div><span>{label}</span><b>{value.toFixed(1)}%</b></div><div className="distribution-track"><i className={tone} style={{ width: `${value}%` }}/></div></div>)}</article>
          </div>

          <div className="topics-block"><div className="block-title"><span>TOP DISCUSSION THEMES</span><h3>熱門議題</h3></div><div className="topic-grid">{result.topics.map((topic, index) => <article key={topic.name}><span>0{index + 1}</span><div><strong>{topic.name}</strong><small>{topic.count} 條相關討論</small></div><b>{topic.share.toFixed(1)}%</b></article>)}</div></div>
          {futuLatest.length > 0 && <article className="source-card futu-latest-card"><div className="panel-heading"><div><span>FUTU LATEST DISCUSSIONS</span><h3>富途最新討論</h3></div><Badge variant="outline" className="futu-count">{futuLatest.length} 條代表內容</Badge></div><div className="futu-latest-list">{futuLatest.map((post) => <a href={post.url === '#' ? undefined : post.url} target="_blank" rel="noreferrer" key={`${post.source}-${post.id}`}><div><strong>{post.author}</strong><small>{new Date(post.publishedAt).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small></div><p>{post.title}</p>{post.url !== '#' && <ExternalLink size={13}/>}</a>)}</div></article>}
          <div className="opinion-grid"><PostList title="代表性看好觀點" posts={result.excerpts.positive} tone="positive"/><PostList title="代表性看淡觀點" posts={result.excerpts.negative} tone="negative"/></div>
          <article className="source-card"><div className="panel-heading"><div><span>DATA TRANSPARENCY</span><h3>資料來源狀態</h3></div><FileText size={18}/></div><div className="source-grid">{result.sources.map((source) => <div key={source.key}><span className={source.ok ? 'source-ok' : 'source-limited'}>{source.ok ? <CheckCircle2 size={15}/> : <WifiOff size={15}/>} {source.label}</span><strong>{source.count || '—'}</strong><small>{source.message}</small></div>)}</div></article>
          <div className="disclaimer"><ShieldCheck size={16}/><p><strong>研究工具，不是投資建議。</strong> V2 可加入使用者本機富途登入頁的可見討論；所有來源仍可能受限、延遲或不完整。任何概率只供比較市場情緒強弱。</p></div>
        </section>
      </section>
      <footer><span>港股情緒雷達 · PUBLIC V2</span><span>資料截至分析當刻 · 香港時間</span></footer>
    </main>
  );
}
