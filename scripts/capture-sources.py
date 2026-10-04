"""Capture a bounded list of legal sources; never turn a failed response into evidence.

Requires pypdf for PDF extraction. Run with the bundled Python or `pip install pypdf`.
Public official sources are attempted first. With --brightdata and a configured
BRIGHTDATA_API_KEY / BRIGHTDATA_UNLOCKER_ZONE, failed HTML requests use Web Unlocker.
Credentials remain in the environment / ignored .env, never in the capture manifest.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from hashlib import sha256
from html.parser import HTMLParser
from io import BytesIO
import json
import os
from pathlib import Path
import re
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent

class SourceText(HTMLParser):
    def __init__(self):
        super().__init__(); self.parts = []; self.skip = 0
    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style', 'noscript'): self.skip += 1
        if tag in ('p', 'div', 'br', 'li', 'tr', 'section', 'article', 'h1', 'h2', 'h3'): self.parts.append('\n')
    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'noscript') and self.skip: self.skip -= 1
        if tag in ('p', 'div', 'li', 'tr', 'section', 'article'): self.parts.append('\n')
    def handle_data(self, data):
        if not self.skip: self.parts.append(data)
    def text(self):
        lines = [re.sub(r'[ \t\r\f]+', ' ', line).strip() for line in ''.join(self.parts).split('\n')]
        return '\n'.join(line for line in lines if line) + '\n'

def fetch(url, bright=False):
    if bright:
        key, zone = os.getenv('BRIGHTDATA_API_KEY'), os.getenv('BRIGHTDATA_UNLOCKER_ZONE')
        if not key or not zone: raise ValueError('BRIGHTDATA_NOT_CONFIGURED')
        body = json.dumps(dict(zone=zone, url=url, format='raw')).encode()
        request = Request('https://api.brightdata.com/request', data=body,
                          headers={'Authorization': 'Bearer '+key, 'Content-Type':'application/json'})
    else:
        request = Request(url, headers={'User-Agent':'LEXRENT source research (bounded public legal-source retrieval)', 'Accept':'text/html,application/pdf,text/plain'})
    with urlopen(request, timeout=40) as response:
        data = response.read(12_000_001)
        if len(data)>12_000_000: raise ValueError('SOURCE_TOO_LARGE')
        return data, response.headers.get('Content-Type',''), response.geturl()

def capture(item, use_brightdata, force_brightdata=False):
    doc = item['doc_id']; path = ROOT / 'corpus/sources' / (doc+'.txt')
    try:
        method = 'official_public_http'
        try:
            raw, content_type, final_url = fetch(item['url'],bright=force_brightdata)
            if force_brightdata: method='brightdata_web_unlocker'
        except (HTTPError, URLError, TimeoutError) as error:
            if not use_brightdata: raise error
            raw, content_type, final_url = fetch(item['url'], bright=True)
            method = 'brightdata_web_unlocker'
        if raw.startswith(b'%PDF'):
            from pypdf import PdfReader
            pages=[page.extract_text() or '' for page in PdfReader(BytesIO(raw)).pages]
            if item.get('page_keywords'):
                selected=[(index,page) for index,page in enumerate(pages) if any(keyword in page for keyword in item['page_keywords'])]
                if not selected: raise ValueError('SOURCE_EXCERPT_NOT_FOUND')
                item=dict(item,page_numbers=[index+1 for index,_ in selected])
                text='\n\n'.join(page for _,page in selected)+'\n'
            else: text = '\n\n'.join(pages)+'\n'
        elif 'html' in content_type or b'<html' in raw[:500].lower() or b'<!doctype' in raw[:500].lower():
            parser = SourceText(); parser.feed(raw.decode('utf8', errors='replace')); text = parser.text()
        else: text = raw.decode('utf8')
        if len(text.strip())<100 or any(marker in text.lower()[:1000] for marker in ('access denied','verify you are human','checking your browser')):
            raise ValueError('SOURCE_BLOCK_PAGE')
        path.parent.mkdir(parents=True, exist_ok=True); path.write_text(text)
        record = dict(item, capture='yes', retrieved_at=datetime.now(timezone.utc).isoformat(),
                      sha256=sha256(text.encode()).hexdigest(), text_file='sources/'+doc+'.txt', status='captured',
                      captured=True, retrieval_method=method, raw_sha256=sha256(raw).hexdigest(), final_url=final_url)
        print(json.dumps(dict(doc_id=doc,status='captured',characters=len(text),method=method)), flush=True)
        return record
    except Exception as error:
        code = 'HTTP_'+str(error.code) if isinstance(error,HTTPError) else str(error) if isinstance(error,ValueError) and re.match(r'^[A-Z_]+$',str(error)) else type(error).__name__
        print(json.dumps(dict(doc_id=doc,status='failed',error_code=code)), flush=True)
        return dict(item,capture='no',captured=False,status='capture_failed',error_code=code)

def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--docs'); parser.add_argument('--brightdata',action='store_true'); parser.add_argument('--force-brightdata',action='store_true'); args=parser.parse_args()
    for file in ('.env','.env.local'):
        if (ROOT/file).exists():
            for line in (ROOT/file).read_text().splitlines():
                if re.match(r'^[A-Z_][A-Z_0-9]*=',line):
                    key,value=line.split('=',1); os.environ.setdefault(key,value.strip().strip('\"\''))
    items=json.loads((ROOT/'corpus/source-requests.json').read_text())
    if args.docs: items=[item for item in items if item['doc_id'] in args.docs.split(',')]
    with ThreadPoolExecutor(max_workers=3) as pool: records=list(pool.map(lambda item:capture(item,args.brightdata,args.force_brightdata),items))
    target=ROOT/'corpus/supplemental-sources.json'
    existing={record['doc_id']:record for record in json.loads(target.read_text())} if target.exists() else {}
    for record in records:
        if record['captured'] or record['doc_id'] not in existing: existing[record['doc_id']]=record
    target.write_text(json.dumps(list(existing.values()),indent=2)+'\n')

if __name__=='__main__': main()
