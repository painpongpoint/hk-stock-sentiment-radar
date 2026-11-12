import { NextResponse } from 'next/server';

import { analyze } from '@/lib/analysis';
import { demoBundle, liveBundle } from '@/lib/sources';
import type { AnalysisResult, ForumPost } from '@/lib/types';

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

function normalizeFutuPosts(value: unknown): ForumPost[] {
  if (!Array.isArray(value)) return [];
  const now = new Date().toISOString();
  const cutoff = Date.now() - 7 * 86_400_000;
  return value.slice(0, 120).flatMap((item, index) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const title = String(record.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 900);
    if (title.length < 4) return [];
    const parsedDate = new Date(String(record.publishedAt ?? now));
    const publishedAt = Number.isNaN(parsedDate.getTime()) || parsedDate.getTime() < cutoff ? now : parsedDate.toISOString();
    const candidateUrl = String(record.url ?? '');
    let url = '#';
    try {
      const parsedUrl = new URL(candidateUrl);
      if (parsedUrl.protocol === 'https:' && (parsedUrl.hostname === 'futunn.com' || parsedUrl.hostname.endsWith('.futunn.com'))) url = parsedUrl.href;
    } catch {
      url = '#';
    }
    return [{
      id: String(record.id ?? `futu-local-${index}`).slice(0, 100),
      title,
      author: String(record.author ?? '富途用戶').replace(/\s+/g, ' ').trim().slice(0, 80),
      publishedAt,
      source: '富途牛牛討論',
      url,
      comments: Math.max(0, Math.min(1_000_000, Number(record.comments ?? 0) || 0)),
      views: Math.max(0, Math.min(10_000_000, Number(record.views ?? 0) || 0)),
    } satisfies ForumPost];
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { code?: string; mode?: string; futuPosts?: unknown };
    const code = normalizeCode(body.code ?? null);
    const mode = body.mode === 'demo' ? 'demo' : 'live';
    const futuPosts = normalizeFutuPosts(body.futuPosts);
    const bundle = mode === 'demo' ? demoBundle(code) : await liveBundle(code);
    if (futuPosts.length) {
      bundle.posts = [...futuPosts, ...bundle.posts];
      bundle.sources = [
        ...bundle.sources.filter((source) => source.key !== 'futu-community'),
        {
          key: 'futu-community',
          label: '富途牛牛討論',
          ok: true,
          count: futuPosts.length,
          message: `由使用者瀏覽器擴充功能取得 ${futuPosts.length} 條可見討論`,
        },
      ];
    } else {
      bundle.sources.push({
        key: 'futu-community',
        label: '富途牛牛討論',
        ok: false,
        count: 0,
        message: '本次分析沒有收到瀏覽器擴充功能擷取的富途討論',
      });
    }
    const data = analyze(bundle);
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '分析暫時失敗，請稍後再試。' }, { status: 400 });
  }
}
