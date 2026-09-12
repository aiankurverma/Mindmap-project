#!/usr/bin/env python3
"""Static dev server with no-cache headers (so edited modules/CSS always reload). Usage: python3 serve.py [port]"""
import sys, os
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8092
ROOT = os.path.dirname(os.path.abspath(__file__))
class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate'); self.send_header('Expires', '0'); super().end_headers()
    def log_message(self, *a): pass
if __name__ == '__main__':
    print(f'Mind Map app: http://127.0.0.1:{PORT}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
