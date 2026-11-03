#!/usr/bin/env python3
"""Check every URL in data/*.json and write data/link-report.json.

YouTube links are checked through the oEmbed endpoint (a removed or private
video returns 401/404 there even though the watch page itself returns 200).
Other sites get a GET request; 404/410 count as broken. Sites that block
bots (403/429/5xx/timeouts) are listed as "unknown", not broken.

Usage: python3 tools/check_links.py [--limit N]
"""
import concurrent.futures as cf
import datetime as dt
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SECTIONS = ['games', 'other-games', 'anime', 'misc']
UA = 'Mozilla/5.0 (compatible; entertainment-log-linkcheck/1.0)'


def collect():
    where = {}

    def add(url, label):
        where.setdefault(url, []).append(label)

    def walk(n, sec):
        for s in n.get('links', []):
            if 'url' in s:
                add(s['url'], {'node': n['id'], 'title': n['title'], 'text': s['text']})
        for e in n.get('entries', []):
            for s in e['segments']:
                if 'url' in s:
                    add(s['url'], {'node': n['id'], 'title': n['title'], 'text': s['text']})
        for c in n.get('children', []):
            walk(c, sec)

    for sec in SECTIONS:
        with open(os.path.join(ROOT, 'data', f'{sec}.json'), encoding='utf-8') as f:
            for n in json.load(f)['nodes']:
                walk(n, sec)
    with open(os.path.join(ROOT, 'data', 'channels.json'), encoding='utf-8') as f:
        for c in json.load(f)['channels']:
            if c.get('url'):
                add(c['url'], {'channel': c['id'], 'title': c['name'], 'text': c['name']})
    return where


def status_of(url):
    target = url
    host = urllib.parse.urlparse(url).netloc.lower()
    if 'youtube.com' in host or 'youtu.be' in host:
        q = urllib.parse.urlparse(url)
        if '/watch' in q.path or 'youtu.be' in host or '/playlist' in q.path:
            target = 'https://www.youtube.com/oembed?format=json&url=' + urllib.parse.quote(url, safe='')
    req = urllib.request.Request(target, headers={'User-Agent': UA, 'Accept-Language': 'zh-TW,en;q=0.8'})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:
        return None


def main():
    limit = None
    if '--limit' in sys.argv:
        limit = int(sys.argv[sys.argv.index('--limit') + 1])
    where = collect()
    urls = list(where)[:limit] if limit else list(where)
    broken, unknown = [], []
    with cf.ThreadPoolExecutor(max_workers=8) as ex:
        for url, st in zip(urls, ex.map(status_of, urls)):
            if st in (401, 404, 410):
                broken.append({'url': url, 'status': st, 'where': where[url]})
            elif st is None or st >= 400:
                unknown.append({'url': url, 'status': st, 'where': where[url]})
    report = {
        'checked_at': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'checked': len(urls),
        'broken': broken,
        'unknown': unknown,
    }
    with open(os.path.join(ROOT, 'data', 'link-report.json'), 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print(f'checked {len(urls)} urls: {len(broken)} broken, {len(unknown)} unknown')


if __name__ == '__main__':
    main()
