export type MarketPoint = { date: string; close: number; volume: number };

export type ForumPost = {
  id: string;
  title: string;
  author: string;
  publishedAt: string;
  source: string;
  url: string;
  comments: number;
  views: number;
  sentiment?: '正面' | '中性' | '負面';
  score?: number;
  topics?: string[];
};

export type SourceStatus = {
  key: string;
  label: string;
  ok: boolean;
  count: number;
  message: string;
};

export type AnalysisResult = {
  generatedAt: string;
  code: string;
  companyName: string;
  mode: 'live' | 'demo';
  window: { from: string; to: string; label: string };
  market: {
    available: boolean;
    points: MarketPoint[];
    latestPrice: number | null;
    changePct: number | null;
    latestDate: string | null;
    trend: string;
  };
  sentiment: {
    index: number;
    label: string;
    trend: string;
    delta: number;
    controversy: number;
    distribution: {
      positive: number;
      neutral: number;
      negative: number;
      positivePct: number;
      neutralPct: number;
      negativePct: number;
    };
  };
  discussionCount: number;
  daily: Array<{
    date: string;
    label: string;
    count: number;
    sentimentIndex: number;
    positive: number;
    neutral: number;
    negative: number;
  }>;
  topics: Array<{ name: string; count: number; share: number }>;
  prediction: {
    direction: string;
    probabilityUp: number;
    probabilityDown: number;
    confidence: number;
    horizon: string;
    method: string;
  };
  excerpts: { positive: ForumPost[]; negative: ForumPost[]; recent: ForumPost[] };
  news: ForumPost[];
  sources: SourceStatus[];
  limitations: string[];
  report: string;
};
