"""Build kb_index.npz (+ rag_vector_dataset.jsonl) from rag_knowledge_base.jsonl.

Vectors:
  * sparse: TF-IDF over unigrams+bigrams (sublinear tf, L2-normalised), stored term->docs
  * dense : LSA (truncated SVD of the TF-IDF matrix), DIM dims, L2-normalised
Only law_chunk and source_link records are indexed. Address records are structured
and are looked up by exact field match instead (see kb_search.py).

Needs: numpy, scipy, scikit-learn (build time only). Search time needs only numpy.
"""
import json, re, sys
from collections import Counter
import numpy as np
from scipy import sparse
from sklearn.decomposition import TruncatedSVD

SRC = sys.argv[1] if len(sys.argv) > 1 else "rag_knowledge_base.jsonl"
OUT = sys.argv[2] if len(sys.argv) > 2 else "kb_index.npz"
DATASET = sys.argv[3] if len(sys.argv) > 3 else "rag_vector_dataset.jsonl"
DIM, MAX_VOCAB, MIN_DF = 128, 24000, 2

STOP = set("a an and are as at be by for from has have in is it its of on or that the this to was were will with shall may any such not no than then there these those their they which who whom".split())
WORD = re.compile(r"[a-z0-9]+")

def tokens(text):
    w = [t for t in WORD.findall(text.lower()) if t not in STOP]
    return w + [f"{a} {b}" for a, b in zip(w, w[1:])]

recs = [json.loads(l) for l in open(SRC, encoding="utf-8")]
docs = [r for r in recs if r["type"] in ("law_chunk", "source_link")]
# index text = context (jurisdiction, URL) + full state names + text, so words like
# "Massachusetts" or "New Jersey" in a query match documents tagged only "MA" / "NJ"
STATES = {"CA": "California", "NJ": "New Jersey", "MA": "Massachusetts"}
def full_ctx(d):
    st = d["jurisdictions"].split(",")[-1].strip()
    return d["context"] + " | " + STATES.get(st, "")
texts = [full_ctx(d) + "\n" + d["text"] for d in docs]
tf = [Counter(tokens(t)) for t in texts]

df = Counter()
for c in tf:
    df.update(c.keys())
keep = [t for t, n in df.most_common() if n >= MIN_DF][:MAX_VOCAB]
vocab = sorted(keep)
idx = {t: i for i, t in enumerate(vocab)}
N = len(docs)
idf = np.array([np.log((1 + N) / (1 + df[t])) + 1.0 for t in vocab], dtype=np.float32)

rows, cols, vals = [], [], []
for i, c in enumerate(tf):
    for t, n in c.items():
        j = idx.get(t)
        if j is not None:
            rows.append(i); cols.append(j); vals.append((1 + np.log(n)) * idf[j])
X = sparse.csr_matrix((vals, (rows, cols)), shape=(N, len(vocab)), dtype=np.float32)
norms = np.sqrt(X.multiply(X).sum(axis=1)).A1
norms[norms == 0] = 1
X = sparse.diags(1 / norms) @ X
X = X.tocsr()

svd = TruncatedSVD(n_components=DIM, random_state=0).fit(X)
E = svd.transform(X)
E /= np.maximum(np.linalg.norm(E, axis=1, keepdims=True), 1e-9)
comp_t = svd.components_.T.astype(np.float16)           # vocab x DIM

Xc = X.tocsc()                                          # term -> docs (for fast queries)
np.savez_compressed(
    OUT,
    vocab=np.array(vocab), idf=idf,
    csc_data=Xc.data.astype(np.float16), csc_indices=Xc.indices.astype(np.int32), csc_indptr=Xc.indptr.astype(np.int64),
    comp_t=comp_t, doc_emb=E.astype(np.float16),
    ids=np.array([d["id"] for d in docs]), n_docs=np.array(N), dim=np.array(DIM),
)
with open(DATASET, "w", encoding="utf-8") as f:
    for d, e in zip(docs, E):
        o = {k: v for k, v in d.items() if k != "context"}
        o["embedding"] = [round(float(x), 4) for x in e]
        f.write(json.dumps(o, ensure_ascii=False) + "\n")
print(f"docs={N} vocab={len(vocab)} dim={DIM} explained_var={svd.explained_variance_ratio_.sum():.2f}")
