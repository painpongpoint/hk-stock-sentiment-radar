import { NextResponse } from 'next/server';

import { analyze } from '@/lib/analysis';
import { demoBundle, liveBundle } from '@/lib/sources';
import type { AnalysisProgress } from '@/lib/sources';
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

async function resolveAnalysis(
  code: string,
  mode: 'live' | 'demo',
  onProgress?: (progress: AnalysisProgress) => void,
) {
  const cacheKey = `${code}:${mode}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    onProgress?.({ percent: 100, message: '已載入最近分析結果' });
    return { data: cached.data, cacheState: 'HIT' as const };
  }

  let task = inFlight.get(cacheKey);
  if (!task) {
    task = (async () => {
      const bundle = mode === 'demo'
        ? demoBundle(code)
        : await liveBundle(code, onProgress);
      onProgress?.({ percent: 92, message: '正在計算情緒、熱門議題與短線趨勢…' });
      return analyze(bundle);
    })();
    inFlight.set(cacheKey, task);
  } else {
    onProgress?.({ percent: 20, message: '相同股票正在分析，正在等待共用結果…' });
  }

  let data: AnalysisResult;
  try {
    data = await task;
  } finally {
    if (inFlight.get(cacheKey) === task) inFlight.delete(cacheKey);
  }
  cache.set(cacheKey, { expires: Date.now() + 5 * 60_000, data });
  onProgress?.({ percent: 100, message: '分析報告已完成' });
  return { data, cacheState: 'MISS' as const };
}

function streamAnalysis(code: string, mode: 'live' | 'demo') {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        send({ type: 'progress', percent: 6, message: '正在準備分析範圍…' });
        const result = await resolveAnalysis(code, mode, (progress) => send({ type: 'progress', ...progress }));
        send({ type: 'result', data: result.data, cache: result.cacheState });
      } catch (error) {
        send({ type: 'error', message: error instanceof Error ? error.message : '分析暫時失敗，請稍後再試。' });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}

export async function GET(request: Request) {
  const startedAt = Date.now();
  try {
    const url = new URL(request.url);
    const code = normalizeCode(url.searchParams.get('code'));
    const mode = url.searchParams.get('mode') === 'demo' ? 'demo' : 'live';
    if (url.searchParams.get('stream') === '1') return streamAnalysis(code, mode);
    const result = await resolveAnalysis(code, mode);
    return NextResponse.json(result.data, { headers: responseHeaders(result.cacheState, startedAt) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '分析暫時失敗，請稍後再試。' }, { status: 400 });
  }
}
