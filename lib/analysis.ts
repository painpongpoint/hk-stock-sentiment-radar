import type { AnalysisResult, ForumPost, MarketPoint, SourceStatus } from '@/lib/types';

const POSITIVE: Record<string, number> = {
  看好: 2, 利好: 2, 上升: 1.3, 上涨: 1.3, 升穿: 1.8, 突破: 1.8,
  反彈: 1.2, 反弹: 1.2, 回升: 1.2, 增長: 1.2, 增长: 1.2,
  超預期: 2, 超预期: 2, 吸引力: 1.2, 穩健: 1.1, 稳健: 1.1,
  加倉: 1.5, 加仓: 1.5, 買入: 1.5, 买入: 1.5, 抄底: 1,
  回購: 1, 回购: 1, 承接: 1, 新高: 1.5, 支持: 0.8, 改善: 1,
  機會: 0.9, 机会: 0.9, 強勢: 1.2, 强势: 1.2, 龍頭: 0.8, 龙头: 0.8,
};

const NEGATIVE: Record<string, number> = {
  看淡: 2, 利空: 2, 下跌: 1.3, 跌: 0.8, 沽壓: 1.5, 沽压: 1.5,
  風險: 1, 风险: 1, 減持: 1.6, 减持: 1.6, 賣出: 1.6, 卖出: 1.6,
  割肉: 2, 破位: 1.8, 新低: 1.5, 套牢: 1, 弱: 0.8, 垃圾: 1.8,
  失望: 1.5, 悲觀: 1.3, 悲观: 1.3, 壓力: 0.8, 压力: 0.8,
  流出: 1.2, 觀望: 0.7, 观望: 0.7, 小心: 0.8, 暴跌: 2, 崩: 1.5,
};

const NEGATED: Record<string, number> = {
  不看好: -2.5, 不悲觀: 1.5, 不悲观: 1.5, 跌不下去: 0.8,
  不可能上: -1.5, 不會升: -1.5, 不会涨: -1.5, 未必升: -0.8,
  未必涨: -0.8, 不要急著抄底: -1,
};

const TOPICS: Record<string, string[]> = {
  'AI／科技投入': ['ai', '人工智能', '模型', '算力', '雲', '云', '智能體', '智能体'],
  遊戲業務: ['遊戲', '游戏', '手遊', '手游', '版號', '版号', '電競', '电竞'],
  業績與估值: ['業績', '业绩', '盈利', '利潤', '利润', '收入', '估值', '市盈率', '財報', '财报'],
  回購與股東回報: ['回購', '回购', '派息', '股息', '分紅', '分红', '減持', '减持'],
  股價與技術走勢: ['股價', '股价', '成交', '突破', '反彈', '反弹', '抄底', '新低', '走勢', '走势', '技術', '技术'],
  資金與宏觀環境: ['資金', '资金', '南向', '北水', '利率', '大市', '恒生', '宏觀', '宏观'],
  產品與商業化: ['產品', '产品', '廣告', '广告', '用戶', '用户', '商業化', '商业化'],
};

const round = (value: number, digits = 0) => Number(value.toFixed(digits));
const hkDate = (date: Date) => new Date(date.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
const shiftDate = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00+08:00`);
  value.setUTCDate(value.getUTCDate() + days);
  return hkDate(value);
};

function scoreText(text: string) {
  const value = text.toLowerCase();
  let raw = 0;
  const consumed = new Set<string>();
  for (const [phrase, score] of Object.entries(NEGATED)) {
    if (!value.includes(phrase)) continue;
    raw += score;
    [...Object.keys(POSITIVE), ...Object.keys(NEGATIVE)].forEach((word) => {
      if (phrase.includes(word)) consumed.add(word);
    });
  }
  for (const [word, weight] of Object.entries(POSITIVE)) {
    if (!consumed.has(word) && value.includes(word)) raw += weight;
  }
  for (const [word, weight] of Object.entries(NEGATIVE)) {
    if (!consumed.has(word) && value.includes(word)) raw -= weight;
  }
  const score = Math.max(-1, Math.min(1, raw / 3.2));
  return { score: round(score, 4), sentiment: score >= 0.18 ? '正面' as const : score <= -0.18 ? '負面' as const : '中性' as const };
}

function makeReport(data: Omit<AnalysisResult, 'report'>) {
  const d = data.sentiment.distribution;
  const price = data.market.available
    ? `最近三個交易日累計 ${data.market.changePct && data.market.changePct > 0 ? '+' : ''}${data.market.changePct?.toFixed(2)}%，走勢為「${data.market.trend}」。`
    : '目前未能取得有效市場行情，方向評分主要來自討論情緒。';
  const sources = data.sources.map((s) => `- ${s.label}：${s.ok ? '正常' : '受限'}；${s.message}`).join('\n');
  const topics = data.topics.map((t, index) => `${index + 1}. ${t.name}：${t.count} 條（${t.share.toFixed(1)}%）`).join('\n');
  return `${data.companyName}（${data.code}）三日市場情緒報告
==================================
分析時段：${data.window.from} 至 ${data.window.to}
產生時間：${data.generatedAt.replace('T', ' ').slice(0, 19)}（香港時間）
資料模式：${data.mode === 'live' ? '即時公開資料' : '內置示例資料'}

一、摘要
情緒指數 ${data.sentiment.index >= 0 ? '+' : ''}${data.sentiment.index}（-100 至 +100），整體「${data.sentiment.label}」，三日變化「${data.sentiment.trend}」。
共分析 ${data.discussionCount} 條討論；正面 ${d.positivePct.toFixed(1)}%、中性 ${d.neutralPct.toFixed(1)}%、負面 ${d.negativePct.toFixed(1)}%。
爭議度 ${data.sentiment.controversy}／100。${price}

二、熱門議題
${topics}

三、短線研判
方向：${data.prediction.direction}
向上概率：${data.prediction.probabilityUp}%；向下概率：${data.prediction.probabilityDown}%
分析信心：${data.prediction.confidence}／100
方法：${data.prediction.method}

四、資料來源狀態
${sources}

免責聲明：本報告只供市場研究與技術展示，不構成任何投資建議、招攬或買賣依據。`;
}

export function analyze(input: {
  code: string;
  companyName: string;
  mode: 'live' | 'demo';
  market: MarketPoint[];
  posts: ForumPost[];
  news: ForumPost[];
  sources: SourceStatus[];
}): AnalysisResult {
  const today = hkDate(new Date());
  const dates = [shiftDate(today, -2), shiftDate(today, -1), today];
  const annotated = input.posts.map((post) => {
    const scored = scoreText(post.title);
    const topics = Object.entries(TOPICS).filter(([, words]) => words.some((word) => post.title.toLowerCase().includes(word))).map(([name]) => name);
    return { ...post, ...scored, topics };
  });
  const positive = annotated.filter((p) => p.sentiment === '正面');
  const negative = annotated.filter((p) => p.sentiment === '負面');
  const neutral = annotated.filter((p) => p.sentiment === '中性');
  const total = annotated.length;
  const sentimentIndex = total ? Math.round(annotated.reduce((sum, p) => sum + (p.score ?? 0), 0) / total * 100) : 0;
  const directional = positive.length + negative.length;
  const controversy = directional ? Math.round(100 * (1 - Math.abs(positive.length - negative.length) / directional)) : 0;
  const daily = dates.map((date) => {
    const items = annotated.filter((p) => p.publishedAt.slice(0, 10) === date);
    const sentimentIndex = items.length ? Math.round(items.reduce((sum, p) => sum + (p.score ?? 0), 0) / items.length * 100) : 0;
    return {
      date, label: `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`, count: items.length, sentimentIndex,
      positive: items.filter((p) => p.sentiment === '正面').length,
      neutral: items.filter((p) => p.sentiment === '中性').length,
      negative: items.filter((p) => p.sentiment === '負面').length,
    };
  });
  const delta = daily[2].sentimentIndex - daily[0].sentimentIndex;
  const sentimentTrend = delta >= 12 ? '明顯改善' : delta <= -12 ? '明顯轉弱' : delta >= 4 ? '輕微改善' : delta <= -4 ? '輕微轉弱' : '大致穩定';
  const points = input.market.slice(-3);
  const latestPrice = points.at(-1)?.close ?? null;
  const changePct = points.length > 1 && points[0].close ? round((points.at(-1)!.close / points[0].close - 1) * 100, 2) : null;
  const marketTrend = changePct == null ? '資料不足' : changePct > 0.8 ? '上升' : changePct < -0.8 ? '下跌' : '橫行';
  const rawProbability = 50 + sentimentIndex * 0.17 + (changePct ?? 0) * 1.3 + delta * 0.08;
  const probabilityUp = Math.round(Math.max(25, Math.min(75, rawProbability)));
  const availableSources = input.sources.filter((s) => s.ok && s.count > 0).length;
  let confidence = total ? Math.round(Math.min(68, 18 + Math.sqrt(total) * 4.5 + availableSources * 4)) : 10;
  if (input.mode === 'demo') confidence = Math.min(confidence, 35);
  const topicCounts = new Map<string, number>();
  annotated.flatMap((p) => p.topics ?? []).forEach((name) => topicCounts.set(name, (topicCounts.get(name) ?? 0) + 1));
  const topics = [...topicCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, count]) => ({ name, count, share: total ? round(count / total * 100, 1) : 0 }));
  if (!topics.length) topics.push({ name: '未形成明顯主題', count: 0, share: 0 });
  const withoutReport: Omit<AnalysisResult, 'report'> = {
    generatedAt: new Date(Date.now() + 8 * 3600_000).toISOString().replace('Z', '+08:00'),
    code: input.code, companyName: input.companyName, mode: input.mode,
    window: { from: dates[0], to: dates[2], label: '當天及前兩個曆日' },
    market: { available: points.length > 0, points, latestPrice, changePct, latestDate: points.at(-1)?.date ?? null, trend: marketTrend },
    sentiment: {
      index: sentimentIndex,
      label: sentimentIndex >= 18 ? '偏正面' : sentimentIndex <= -18 ? '偏負面' : '中性',
      trend: sentimentTrend, delta, controversy,
      distribution: {
        positive: positive.length, neutral: neutral.length, negative: negative.length,
        positivePct: total ? round(positive.length / total * 100, 1) : 0,
        neutralPct: total ? round(neutral.length / total * 100, 1) : 0,
        negativePct: total ? round(negative.length / total * 100, 1) : 0,
      },
    },
    discussionCount: total, daily, topics,
    prediction: {
      direction: probabilityUp >= 60 ? '偏強' : probabilityUp <= 40 ? '偏弱' : '震盪／中性',
      probabilityUp, probabilityDown: 100 - probabilityUp, confidence,
      horizon: '未來 1 至 3 個交易日',
      method: '規則式中文情緒分數、三日情緒變化及價格動能的原型加權',
    },
    excerpts: {
      positive: [...positive].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 5),
      negative: [...negative].sort((a, b) => (a.score ?? 0) - (b.score ?? 0)).slice(0, 5),
      recent: [...annotated].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 12),
    },
    news: input.news.slice(0, 8), sources: input.sources,
    limitations: [
      'V1 使用可解釋的中文詞典與規則式分析，尚未接入大型語言模型。',
      '論壇用戶不代表整體市場，留言可能包含反諷、廣告或重複帳戶。',
      '短線方向未經完整回測，並非交易訊號或投資建議。',
    ],
  };
  return { ...withoutReport, report: makeReport(withoutReport) };
}
