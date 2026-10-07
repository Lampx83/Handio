import http.server, json, hashlib, math, time
def vec(t):
    v=[0.0]*64
    for w in t.lower().split():
        h=int(hashlib.md5(w.strip('.,?!').encode()).hexdigest(),16)
        v[h%64]+=1
    n=math.sqrt(sum(x*x for x in v)) or 1
    return [x/n for x in v]
class H(http.server.BaseHTTPRequestHandler):
    protocol_version='HTTP/1.0'
    def j(self,code,o):
        b=json.dumps(o).encode(); self.send_response(code); self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if self.path.startswith('/docs'):
            b=open('playground.html','rb').read(); self.send_response(200); self.send_header('Content-Type','text/html; charset=utf-8'); self.send_header('Content-Length',str(len(b))); self.end_headers(); self.wfile.write(b); return
        if self.path.endswith('/models'):
            k=self.headers.get('x-ollama-seckey')
            return self.j(200 if k in('chatkey','both') else 403,{'data':[]})
        self.j(404,{})
    def do_POST(self):
        n=int(self.headers.get('Content-Length') or 0); body=json.loads(self.rfile.read(n) or b'{}'); k=self.headers.get('x-ollama-seckey')
        if self.path.endswith('/embed'):
            if k not in('embkey','both'): return self.j(403,{})
            ins=body['input']; return self.j(200,{'embeddings':[vec(t) for t in ins]})
        if k=='rl' and not getattr(H,'rl_done',False):
            H.rl_done=True; self.send_response(429); self.send_header('Retry-After','1'); self.send_header('Content-Length','2'); self.end_headers(); self.wfile.write(b'{}'); return
        if k not in('chatkey','both','rl'): return self.j(403,{})
        c0=body['messages'][-1]['content']; nimg=len([x for x in c0 if x.get('type')=='image_url']) if isinstance(c0,list) else 0
        txt='**Xin chào** *nghiêng* [liên kết](https://neu.edu.vn)\n\n> trích dẫn\n\n---\n\nẢnh nhận được: %d'%nimg
        if body.get('stream'):
            self.send_response(200); self.send_header('Content-Type','text/event-stream'); self.end_headers()
            for w in txt.split(' '):
                self.wfile.write(('data: '+json.dumps({'choices':[{'delta':{'content':w+' '}}]})+'\n\n').encode()); self.wfile.flush(); time.sleep(0.02)
            self.wfile.write(('data: '+json.dumps({'choices':[],'usage':{'prompt_tokens':50,'completion_tokens':20}})+'\n\n').encode()); self.wfile.write(b'data: [DONE]\n\n'); return
        c='{"cua_hang":"X","mat_hang":[],"tong_cong":1}' if body.get('response_format') else txt
        self.j(200,{'choices':[{'message':{'content':c},'finish_reason':'stop'}],'usage':{'prompt_tokens':50,'completion_tokens':20}})
    def log_message(self,*a):pass
http.server.ThreadingHTTPServer(('127.0.0.1',8766),H).serve_forever()
