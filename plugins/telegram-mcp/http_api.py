#!/usr/bin/env python3
"""HTTP control plane for Telegram login wizard (Connections UI).

Listens on 127.0.0.1:8791 — proxied by ARTEX gateway at /telegram-plugin/*
Shares the same Telethon session as the MCP server.
"""

from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse

import asyncio

import core

HOST = os.environ.get("TELEGRAM_HTTP_HOST", "127.0.0.1")
PORT = int(os.environ.get("TELEGRAM_HTTP_PORT", "8791"))


def _run(coro):
    return asyncio.run(coro)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: Any) -> None:  # quieter
        print(f"[telegram-http] {self.address_string()} {fmt % args}")

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, code: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False, default=str).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict[str, Any]:
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0:
            return {}
        raw = self.rfile.read(n)
        try:
            data = json.loads(raw.decode() or "{}")
        except json.JSONDecodeError:
            return {}
        return data if isinstance(data, dict) else {}

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path.rstrip("/") or "/"
        if path in ("/", "/health"):
            self._json(200, {"ok": True, "service": "telegram-plugin"})
            return
        if path == "/status":
            self._json(200, _run(core.status()))
            return
        if path == "/me":
            self._json(200, _run(core.me()))
            return
        self._json(404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path.rstrip("/") or "/"
        body = self._read_json()
        if path == "/login/send_code":
            self._json(200, _run(core.login_send_code(str(body.get("phone") or ""))))
            return
        if path == "/login/verify_code":
            self._json(200, _run(core.login_verify_code(str(body.get("code") or ""))))
            return
        if path == "/login/2fa":
            self._json(200, _run(core.login_2fa(str(body.get("password") or ""))))
            return
        if path == "/logout":
            self._json(200, _run(core.logout()))
            return
        if path == "/send":
            self._json(
                200,
                _run(
                    core.send_message(str(body.get("chat") or ""), str(body.get("text") or ""))
                ),
            )
            return
        self._json(404, {"ok": False, "error": "not found"})


def main() -> None:
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[telegram-http] listening http://{HOST}:{PORT}")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
