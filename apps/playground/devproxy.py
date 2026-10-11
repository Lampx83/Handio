import http.server, http.client, os, sys
KEY=os.environ['LLM_KEY']; UP=(os.environ.get('LLM_HOST','127.0.0.1'),int(os.environ.get('LLM_PORT','8037')))
class H(http.server.BaseHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    def do_GET(self):
        if self.path.split('?')[0] in ('/docs/','/docs','/'):
            b=open('playground.html','rb').read()
            self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Content-Length',str(len(b)));self.send_header('Content-Security-Policy',"default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data: blob:; media-src blob:; frame-src 'self' about: blob:; worker-src blob:; base-uri 'none'; form-action 'none'");self.end_headers();self.wfile.write(b);return
        if self.path=='/test.pdf':
            b=open('test.pdf','rb').read();self.send_response(200);self.send_header('Content-Type','application/pdf');self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b);return
        self.proxy()
    def do_POST(self): self.proxy()
    def proxy(self):
        n=int(self.headers.get('Content-Length') or 0); body=self.rfile.read(n) if n else None
        c=http.client.HTTPConnection(*UP,timeout=300)
        c.request(self.command,self.path,body,{'content-type':self.headers.get('content-type','application/json'),'x-ollama-seckey':KEY})
        r=c.getresponse()
        self.send_response(r.status);self.send_header('Content-Type',r.getheader('content-type','application/json'));self.send_header('Transfer-Encoding','chunked');self.end_headers()
        while True:
            d=r.read1(4096)
            if not d: break
            self.wfile.write(b'%x\r\n'%len(d)+d+b'\r\n');self.wfile.flush()
        self.wfile.write(b'0\r\n\r\n')
    def log_message(self,*a):pass
http.server.ThreadingHTTPServer(('127.0.0.1',8765),H).serve_forever()
