import { NextResponse } from 'next/server';

import { analyze } from '@/lib/analysis';
import { demoBundle, liveBundle } from '@/lib/sources';
import type { AnalysisResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

const cache = new Map<string, { expires: number; data: AnalysisResult }>();
const inFlight = new Map<string, Promise<AnalysisResult>>();

function responseHeaders(cacheState: 'HIT' | 'MISS', startedAt: number) {
  return {
    'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=300',
    'Server-Timing': `analysis;dur=${Date.now() - startedAt}`,
    'X-Data-Cache': cacheState,
  };
}

function normalizeCode(value: string | null) {
  const cleaned = String(value ?? '').trim().toUpperCase().replace(/^HK\./, '').replace(/\.HK$/, '');
  if (!/^\d{1,5}$/.test(cleaned)) throw new Error('請輸入 1 至 5 位數字的港股編號，例如 00700。');
  return cleaned.padStart(5, '0');
}

export async function GET(request: Request) {
  const startedAt = Date.now();
  try {
    const url = new URL(request.url);
    const code = normalizeCode(url.searchParams.get('code'));
    const mode = url.searchParams.get('mode') === 'demo' ? 'demo' : 'live';
    const cacheKey = `${code}:${mode}`;
    const cached = cache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return NextResponse.json(cached.data, { headers: responseHeaders('HIT', startedAt) });
    }
    let task = inFlight.get(cacheKey);
    if (!task) {
      task = (async () => analyze(mode === 'demo' ? demoBundle(code) : await liveBundle(code)))();
      inFlight.set(cacheKey, task);
    }
    let data: AnalysisResult;
    try {
      data = await task;
    } finally {
      if (inFlight.get(cacheKey) === task) inFlight.delete(cacheKey);
    }
    cache.set(cacheKey, { expires: Date.now() + 5 * 60_000, data });
    return NextResponse.json(data, { headers: responseHeaders('MISS', startedAt) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '分析暫時失敗，請稍後再試。' }, { status: 400 });
  }
}
