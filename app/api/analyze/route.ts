import { NextResponse } from 'next/server';

import { analyze } from '@/lib/analysis';
import { demoBundle, liveBundle } from '@/lib/sources';
import type { AnalysisResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

const cache = new Map<string, { expires: number; data: AnalysisResult }>();

function normalizeCode(value: string | null) {
  const cleaned = String(value ?? '').trim().toUpperCase().replace(/^HK\./, '').replace(/\.HK$/, '');
  if (!/^\d{1,5}$/.test(cleaned)) throw new Error('請輸入 1 至 5 位數字的港股編號，例如 00700。');
  return cleaned.padStart(5, '0');
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const code = normalizeCode(url.searchParams.get('code'));
    const mode = url.searchParams.get('mode') === 'demo' ? 'demo' : 'live';
    const cacheKey = `${code}:${mode}`;
    const cached = cache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return NextResponse.json(cached.data, { headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=240', 'X-Data-Cache': 'HIT' } });
    }
    const bundle = mode === 'demo' ? demoBundle(code) : await liveBundle(code);
    const data = analyze(bundle);
    cache.set(cacheKey, { expires: Date.now() + 5 * 60_000, data });
    return NextResponse.json(data, { headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=240', 'X-Data-Cache': 'MISS' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '分析暫時失敗，請稍後再試。' }, { status: 400 });
  }
}
