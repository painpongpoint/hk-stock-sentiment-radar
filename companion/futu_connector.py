"""港股情緒雷達 V2：本機富途網頁連接器。

登入只在由 Playwright 開啟的官方富途 Chrome 視窗完成。本服務不接收、記錄或
傳送帳號、密碼、驗證碼與 Cookie；它只把目前股票頁面可見的公開討論文字交給
使用者正在瀏覽的港股情緒雷達網站。
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import signal
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


HOST = "127.0.0.1"
PORT = 8766
VERSION = "2.0.0"
ALLOWED_ORIGINS = {
    "https://hk-stock-sentiment-radar.luis-mok.chatgpt.site",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
}


def compact_text(value: Any, limit: int = 900) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text[:limit]


class FutuBrowser:
    def __init__(self) -> None:
        self._playwright: Any = None
        self._context: Any = None
        self._page: Any = None
        self.login_confirmed = False
        self.last_error = ""
        self.last_scrape_at: str | None = None
        self.last_count = 0

    @property
    def browser_open(self) -> bool:
        return self._context is not None and self._page is not None

    def status(self) -> dict[str, Any]:
        return {
            "ok": True,
            "version": VERSION,
            "browserOpen": self.browser_open,
            "loginConfirmed": self.login_confirmed,
            "state": "connected" if self.login_confirmed else "login-open" if self.browser_open else "service-ready",
            "lastScrapeAt": self.last_scrape_at,
            "lastCount": self.last_count,
            "message": self.last_error or "本機連接器正在運行",
        }

    def open_login(self) -> dict[str, Any]:
        try:
            if not self.browser_open:
                from playwright.sync_api import sync_playwright

                data_root = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "HKStockSentimentRadar"
                profile = data_root / "futu-browser-profile"
                profile.mkdir(parents=True, exist_ok=True)
                self._playwright = sync_playwright().start()
                self._context = self._playwright.chromium.launch_persistent_context(
                    str(profile),
                    channel="chrome",
                    headless=False,
                    viewport={"width": 1280, "height": 860},
                )
                self._page = self._context.pages[0] if self._context.pages else self._context.new_page()
            self._page.bring_to_front()
            self._page.goto("https://www.futunn.com/", wait_until="domcontentloaded", timeout=45_000)
            self.last_error = ""
            return self.status()
        except ModuleNotFoundError as exc:
            self.last_error = "尚未安裝 Playwright；請重新執行啟動批次檔。"
            raise RuntimeError(self.last_error) from exc
        except Exception as exc:
            self.last_error = f"未能開啟富途登入頁：{exc}"
            raise RuntimeError(self.last_error) from exc

    def confirm_login(self) -> dict[str, Any]:
        if not self.browser_open:
            raise RuntimeError("請先開啟富途登入頁。")
        self.login_confirmed = True
        self.last_error = "登入狀態由使用者確認；首次抓取時會再檢查頁面。"
        return self.status()

    def _open_discussion_area(self) -> None:
        pattern = re.compile(r"討論|讨论|評論|评论|社區|社区|牛牛圈|動態|动态", re.I)
        candidates = self._page.locator("a, button, [role='tab']").filter(has_text=pattern).all()
        for candidate in candidates[:12]:
            try:
                label = compact_text(candidate.inner_text(timeout=800), 30)
                if label and candidate.is_visible():
                    candidate.click(timeout=2_000)
                    self._page.wait_for_timeout(1_200)
                    break
            except Exception:
                continue

    def _extract_visible_posts(self) -> list[dict[str, Any]]:
        return self._page.evaluate(
            r"""
            () => {
              const selectors = [
                'article', '[class*="comment-item"]', '[class*="commentItem"]',
                '[class*="feed-item"]', '[class*="feedItem"]', '[class*="post-item"]',
                '[class*="postItem"]', '[class*="moment-item"]', '[class*="community"]',
                '[data-testid*="post"]', '[data-testid*="feed"]', '[data-testid*="comment"]'
              ];
              const nodes = [...new Set(selectors.flatMap((selector) => [...document.querySelectorAll(selector)]))];
              const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
              const output = [];
              for (const node of nodes) {
                const rect = node.getBoundingClientRect();
                if (!rect.width || !rect.height) continue;
                const text = clean(node.innerText);
                if (text.length < 12 || text.length > 900) continue;
                const authorNode = node.querySelector('[class*="author"], [class*="user-name"], [class*="userName"], a[href*="/user/"]');
                const timeNode = node.querySelector('time, [class*="time"], [class*="date"]');
                const linkNode = node.querySelector('a[href*="/post/"], a[href*="/community"], a[href*="/stock/"]');
                output.push({
                  text,
                  author: clean(authorNode?.textContent || '富途用戶'),
                  publishedLabel: clean(timeNode?.textContent || ''),
                  url: linkNode?.href || location.href,
                });
              }
              return output.slice(0, 160);
            }
            """
        )

    def _extract_initial_state(self) -> list[dict[str, Any]]:
        return self._page.evaluate(
            r"""
            () => {
              const root = window.__INITIAL_STATE__;
              if (!root || typeof root !== 'object') return [];
              const seen = new WeakSet();
              const output = [];
              const clean = (value) => String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
              function walk(value, depth = 0) {
                if (!value || typeof value !== 'object' || depth > 9 || output.length >= 180) return;
                if (seen.has(value)) return;
                seen.add(value);
                const raw = value.content || value.text || value.description || value.message || value.title;
                const user = value.user || value.author || value.user_info || value.userInfo;
                const author = typeof user === 'object' ? (user.nickname || user.name || user.screen_name) : user;
                const hasCommunitySignal = Boolean(author || value.comment_count || value.commentCount || value.reply_count || value.like_count);
                const text = clean(raw);
                if (hasCommunitySignal && text.length >= 12 && text.length <= 900) {
                  output.push({
                    text,
                    author: clean(author || value.nickname || '富途用戶'),
                    publishedLabel: clean(value.time || value.created_at || value.createdAt || value.publish_time || ''),
                    url: clean(value.url || value.link || location.href),
                  });
                }
                if (Array.isArray(value)) value.forEach((child) => walk(child, depth + 1));
                else Object.values(value).forEach((child) => walk(child, depth + 1));
              }
              walk(root);
              return output;
            }
            """
        )

    def scrape(self, code: str) -> dict[str, Any]:
        if not self.browser_open or not self.login_confirmed:
            raise RuntimeError("請先在官方富途視窗登入，然後按『已完成登入』。")
        normalized = str(code or "").strip().zfill(5)
        if not re.fullmatch(r"\d{5}", normalized):
            raise RuntimeError("股票編號格式不正確。")
        try:
            stock_url = f"https://www.futunn.com/stock/{normalized}-HK"
            self._page.bring_to_front()
            self._page.goto(stock_url, wait_until="domcontentloaded", timeout=45_000)
            self._page.wait_for_timeout(2_000)
            self._open_discussion_area()
            for _ in range(4):
                self._page.mouse.wheel(0, 900)
                self._page.wait_for_timeout(650)

            raw_items = self._extract_visible_posts()
            if len(raw_items) < 3:
                raw_items.extend(self._extract_initial_state())

            now = datetime.now(timezone.utc).isoformat()
            posts: list[dict[str, Any]] = []
            seen: set[str] = set()
            for item in raw_items:
                text = compact_text(item.get("text"))
                if len(text) < 12:
                    continue
                digest = hashlib.sha1(text.encode("utf-8")).hexdigest()[:16]
                if digest in seen:
                    continue
                seen.add(digest)
                url = compact_text(item.get("url"), 500)
                if not url.startswith("https://www.futunn.com/"):
                    url = stock_url
                posts.append(
                    {
                        "id": digest,
                        "title": text,
                        "author": compact_text(item.get("author") or "富途用戶", 80),
                        "publishedAt": now,
                        "publishedLabel": compact_text(item.get("publishedLabel"), 60),
                        "source": "富途牛牛討論",
                        "url": url,
                        "comments": 0,
                        "views": 0,
                    }
                )
                if len(posts) >= 120:
                    break

            self.last_scrape_at = now
            self.last_count = len(posts)
            self.last_error = "" if posts else "頁面已開啟，但未識別到討論；富途版面可能已更新。"
            return {
                "ok": bool(posts),
                "code": normalized,
                "count": len(posts),
                "posts": posts,
                "stockUrl": stock_url,
                "capturedAt": now,
                "message": self.last_error or f"已從登入頁面整理 {len(posts)} 條最新討論",
            }
        except Exception as exc:
            self.last_error = f"抓取失敗：{exc}"
            raise RuntimeError(self.last_error) from exc

    def close(self) -> None:
        try:
            if self._context:
                self._context.close()
            if self._playwright:
                self._playwright.stop()
        finally:
            self._page = None
            self._context = None
            self._playwright = None


BROWSER = FutuBrowser()


class ConnectorHandler(BaseHTTPRequestHandler):
    server_version = "HKStockSentimentFutuConnector/2.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[{self.log_date_time_string()}] {fmt % args}")

    def _origin(self) -> str:
        return self.headers.get("Origin", "")

    def _cors(self) -> None:
        origin = self._origin()
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Cache-Control", "no-store")

    def _send(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict[str, Any]:
        length = min(int(self.headers.get("Content-Length", "0") or 0), 32_768)
        if not length:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if urlparse(self.path).path in {"/", "/health", "/status"}:
            self._send(200, BROWSER.status())
        else:
            self._send(404, {"ok": False, "error": "找不到此端點"})

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        try:
            if path == "/open-login":
                self._send(200, BROWSER.open_login())
            elif path == "/confirm-login":
                self._send(200, BROWSER.confirm_login())
            elif path == "/scrape":
                payload = self._read_json()
                self._send(200, BROWSER.scrape(str(payload.get("code") or "")))
            else:
                self._send(404, {"ok": False, "error": "找不到此端點"})
        except Exception as exc:
            self._send(400, {"ok": False, "error": str(exc), **BROWSER.status()})


def main() -> None:
    server = HTTPServer((HOST, PORT), ConnectorHandler)
    print("港股情緒雷達 V2－富途本機連接器")
    print(f"狀態網址：http://{HOST}:{PORT}/health")
    print("請保持此視窗開啟；按 Ctrl+C 可停止服務。")

    def stop_server(*_: Any) -> None:
        BROWSER.close()
        raise KeyboardInterrupt

    signal.signal(signal.SIGINT, stop_server)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        BROWSER.close()
        server.server_close()


if __name__ == "__main__":
    main()
