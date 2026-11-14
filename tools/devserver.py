"""EasyMeta development server - not needed to use the app.

Serves the EasyMeta folder on http://127.0.0.1:PORT and, for automated tests,
any local file at /fs/<url-encoded absolute path> with HTTP Range support, so
    EasyMeta.html?open=/fs/E%3A/data/stack.mrc&open=/fs/...
reads it the same partial way the app reads dropped files.

    python tools/devserver.py [port]
"""
import http.server
import os
import re
import sys
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"  # keep-alive: many small range reads

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, *args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_HEAD(self):
        if self.path.startswith("/fs/"):
            return self.serve_fs(head=True)
        return super().do_HEAD()

    def do_GET(self):
        if self.path.startswith("/fs/"):
            return self.serve_fs(head=False)
        return super().do_GET()

    def serve_fs(self, head):
        path = urllib.parse.unquote(self.path[4:].split("?")[0])
        if not os.path.isfile(path):
            self.send_error(404, "no such file")
            return
        size = os.path.getsize(path)
        start, end, status = 0, size - 1, 200
        rng = self.headers.get("Range")
        if rng and not head:
            m = re.match(r"bytes=(\d+)-(\d*)", rng)
            if m:
                start = int(m.group(1))
                end = min(int(m.group(2)) if m.group(2) else size - 1, size - 1)
                status = 206
        length = max(0, end - start + 1)
        self.send_response(status)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(size if head else length))
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        if head:
            return
        with open(path, "rb") as f:
            f.seek(start)
            left = length
            while left > 0:
                chunk = f.read(min(1 << 20, left))
                if not chunk:
                    break
                self.wfile.write(chunk)
                left -= len(chunk)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"EasyMeta dev server on http://127.0.0.1:{port}/EasyMeta.html", flush=True)
    server.serve_forever()
