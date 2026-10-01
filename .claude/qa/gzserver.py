"""Static server that gzips text responses like GitHub Pages does (for realistic Lighthouse runs)."""
import gzip, http.server, io, os, sys
ROOT = sys.argv[2] if len(sys.argv) > 2 else "."
TEXT = (".html", ".js", ".css", ".json", ".svg", ".txt", ".webmanifest", ".xml")

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)
    def log_message(self, *a):
        pass
    def send_head(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            path = os.path.join(path, "index.html")
        if path.endswith(TEXT) and "gzip" in self.headers.get("Accept-Encoding", "") and os.path.isfile(path):
            data = gzip.compress(open(path, "rb").read(), 9)
            self.send_response(200)
            self.send_header("Content-Type", self.guess_type(path))
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "max-age=600")  # what GitHub Pages sends
            self.end_headers()
            return io.BytesIO(data)
        return super().send_head()

http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
