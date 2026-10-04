#!/usr/bin/env python3
"""Search the Rental Housing Law knowledge base. Needs only numpy.

  kb_search.py search "security deposit maximum" [--k 5] [--for "Berkeley, CA"] [--juris CA] [--chars 700] [--full] [--json]
  kb_search.py show D001#003            full text of one chunk
  kb_search.py neighbors D001#003 [--span 1]
  kb_search.py doc D001                 chunk count + metadata of one document
  kb_search.py address "DE LONGPRE" [--city "Los Angeles"] [--state CA] [--limit 10] [--json]

search = hybrid of TF-IDF (sparse) and LSA (dense) vectors, merged by weighted reciprocal rank fusion (TF-IDF x2, LSA x1).
--for "City, ST" keeps that city's documents AND the state-level documents; --juris keeps
only documents whose jurisdiction list contains the given value exactly.
Files (same folder as this script by default): kb_index.npz, rag_knowledge_base.jsonl
"""
import argparse, json, os, re, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
INDEX = os.environ.get("KB_INDEX", os.path.join(HERE, "kb_index.npz"))
DATA = os.environ.get("KB_DATA", os.path.join(HERE, "rag_knowledge_base.jsonl"))

STOP = set("a an and are as at be by for from has have in is it its of on or that the this to was were will with shall may any such not no than then there these those their they which who whom".split())
WORD = re.compile(r"[a-z0-9]+")


def tokens(text):
    w = [t for t in WORD.findall(text.lower()) if t not in STOP]
    return w + [f"{a} {b}" for a, b in zip(w, w[1:])]


def load_records():
    with open(DATA, encoding="utf-8") as f:
        return [json.loads(l) for l in f]


class Index:
    def __init__(self):
        z = np.load(INDEX, allow_pickle=False)
        self.vocab = {t: i for i, t in enumerate(z["vocab"].tolist())}
        self.idf = z["idf"]
        self.data, self.indices, self.indptr = z["csc_data"], z["csc_indices"], z["csc_indptr"]
        self.comp_t, self.emb = z["comp_t"], z["doc_emb"].astype(np.float32)
        self.ids = z["ids"].tolist()
        self.n = int(z["n_docs"])

    def query(self, text):
        counts = {}
        for t in tokens(text):
            j = self.vocab.get(t)
            if j is not None:
                counts[j] = counts.get(j, 0) + 1
        if not counts:
            return np.zeros(self.n), np.zeros(self.n)
        js = np.array(list(counts))
        w = (1 + np.log(np.array([counts[j] for j in js], dtype=np.float32))) * self.idf[js]
        w /= np.linalg.norm(w)
        sparse_s = np.zeros(self.n, dtype=np.float32)
        for j, wj in zip(js, w):
            a, b = self.indptr[j], self.indptr[j + 1]
            sparse_s[self.indices[a:b]] += wj * self.data[a:b].astype(np.float32)
        q = (w[:, None] * self.comp_t[js].astype(np.float32)).sum(axis=0)
        q /= max(np.linalg.norm(q), 1e-9)
        return sparse_s, self.emb @ q


def snippet(text, query, width):
    """Return the window of `width` chars that contains the most query terms."""
    if len(text) <= width:
        return text, False
    qt = {t for t in WORD.findall(query.lower()) if t not in STOP}
    low = text.lower()
    best, best_i = -1, 0
    for i in range(0, len(text) - width + 100, 100):
        w = low[i:i + width]
        sc = sum(1 for t in qt if t in w)
        if sc > best:
            best, best_i = sc, i
    return text[best_i:best_i + width], True


def rrf(scores, mask, k=60):
    order = np.argsort(-np.where(mask, scores, -1e9))
    out = np.zeros_like(scores)
    for rank, i in enumerate(order[: int(mask.sum())]):
        out[i] = 1.0 / (k + rank + 1)
    return out


def cmd_search(a):
    recs = {r["id"]: r for r in load_records()}
    ix = Index()
    docs = [recs[i] for i in ix.ids]
    mask = np.ones(ix.n, dtype=bool)
    if not a.links:   # link-only records hold just a URL; list them separately instead of ranking them
        mask &= np.array([d["type"] == "law_chunk" for d in docs])
    if a.juris:
        mask &= np.array([d["jurisdictions"] == a.juris for d in docs])
    if a.for_:
        state = a.for_.split(",")[-1].strip()
        mask &= np.array([d["jurisdictions"] in (a.for_, state) for d in docs])
    if not mask.any():
        print("No documents match that jurisdiction filter."); return
    sp, de = ix.query(a.query)
    score = 2 * rrf(sp, mask) + rrf(de, mask)   # exact terms weigh more than the LSA vectors
    top = [i for i in np.argsort(-score) if mask[i]][: a.k]
    out = []
    for r, i in enumerate(top, 1):
        d = docs[i]
        txt, cut = (d["text"], False) if a.full else snippet(d["text"], a.query, a.chars)
        out.append(dict(rank=r, id=d["id"], type=d["type"], jurisdictions=d["jurisdictions"], source_type=d["source_type"],
                        url=d["url"], retrieved_at=d.get("retrieved_at"), fused=round(float(score[i]), 4),
                        sparse=round(float(sp[i]), 3), dense=round(float(de[i]), 3), text=txt, truncated=cut))
    if a.json:
        print(json.dumps(out, ensure_ascii=False, indent=1)); return
    for o in out:
        print(f"#{o['rank']} {o['id']} [{o['jurisdictions']}] {o['source_type']} fused={o['fused']} (tfidf={o['sparse']} lsa={o['dense']})")
        print(f"   {o['url']}  retrieved {o['retrieved_at']}")
        print("   " + ("... " if o["truncated"] else "") + o["text"].replace("\n", "\n   ") + (" ..." if o["truncated"] else ""))
        print()
    if a.for_ or a.juris:
        shown = {o["id"] for o in out}
        links = [d for d in docs if d["type"] == "source_link" and d["id"] not in shown and mask[ix.ids.index(d["id"])]]
        if links:
            print("Link-only sources in scope (no text captured):")
            for d in links:
                print(f"  {d['id']} [{d['jurisdictions']}] {d['source_type']} {d['url']}")


def cmd_show(a):
    for r in load_records():
        if r["id"] == a.id:
            print(json.dumps({k: v for k, v in r.items() if k != "text"}, ensure_ascii=False))
            print(r["text"]); return
    sys.exit("id not found")


def cmd_neighbors(a):
    recs = load_records()
    base = a.id.split("#")[0]
    num = int(a.id.split("#")[1])
    for r in recs:
        if r["type"] == "law_chunk" and r["doc_id"] == base and abs(r["chunk_index"] - num) <= a.span:
            print(f"--- {r['id']} ---\n{r['text']}\n")


def cmd_doc(a):
    ch = [r for r in load_records() if r.get("doc_id") == a.doc_id]
    if not ch:
        sys.exit("doc not found")
    h = ch[0]
    print(json.dumps({"doc_id": a.doc_id, "jurisdictions": h["jurisdictions"], "url": h["url"], "source_type": h["source_type"],
                      "retrieved_at": h.get("retrieved_at"), "records": len(ch), "type": h["type"]}))


def cmd_address(a):
    q = a.query.lower()
    out = []
    for r in load_records():
        if r["type"] != "address":
            continue
        if a.state and r["state"].lower() != a.state.lower(): continue
        if a.city and a.city.lower() not in r["postal_city"].lower(): continue
        if q in r["street_address"].lower() or q == r["address_id"].lower() or not q:
            out.append(r)
    out = out[: a.limit]
    if a.json:
        print(json.dumps(out, ensure_ascii=False, indent=1)); return
    for r in out:
        print(f"{r['address_id']} | {r['street_address']}, {r['postal_city']}, {r['state']} {r['zip'] or ''} | built {r['year_built'] or 'unknown'} | units {r['units'] or 'unknown'} | {r['use_description']}")
    print(f"({len(out)} shown)")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    s = p.add_subparsers(dest="cmd", required=True)
    x = s.add_parser("search"); x.add_argument("query"); x.add_argument("--k", type=int, default=5)
    x.add_argument("--for", dest="for_"); x.add_argument("--juris"); x.add_argument("--chars", type=int, default=700)
    x.add_argument("--full", action="store_true"); x.add_argument("--links", action="store_true", help="also rank link-only sources"); x.add_argument("--json", action="store_true"); x.set_defaults(f=cmd_search)
    x = s.add_parser("show"); x.add_argument("id"); x.set_defaults(f=cmd_show)
    x = s.add_parser("neighbors"); x.add_argument("id"); x.add_argument("--span", type=int, default=1); x.set_defaults(f=cmd_neighbors)
    x = s.add_parser("doc"); x.add_argument("doc_id"); x.set_defaults(f=cmd_doc)
    x = s.add_parser("address"); x.add_argument("query", nargs="?", default="")
    x.add_argument("--city"); x.add_argument("--state"); x.add_argument("--limit", type=int, default=10)
    x.add_argument("--json", action="store_true"); x.set_defaults(f=cmd_address)
    a = p.parse_args()
    a.f(a)


if __name__ == "__main__":
    main()
