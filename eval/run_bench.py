#!/usr/bin/env python3
"""Bench 509 soal chat akuntansi — streaming, TTFT <= 25 dtk, GT dari gen500.

Input : /tmp/opencode/questions500.json  [{tier,q,must,module}]
Mode  : START=N resume; RERUN="3,7,9" ulang soal tertentu; LIMIT=N berhenti setelah N soal jalan
Output: /tmp/opencode/bench500.json + bench500.md
"""
import json, os, re, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
API = os.environ.get("EVAL_API", "http://127.0.0.1:3001")
SID = os.environ.get("EVAL_SID", "")
if not SID:
    sid_file = os.environ.get("EVAL_SID_FILE", os.path.join(HERE, ".sid"))
    SID = open(sid_file).read().strip()
LABEL = os.environ.get("LABEL", "bench500")
TTFT_LIMIT = float(os.environ.get("EVAL_TTFT_LIMIT", "25"))

QUESTIONS = json.load(open(os.environ.get("EVAL_QUESTIONS", os.path.join(HERE, "questions500.json"))))
OUT_DIR = os.environ.get("EVAL_OUT", os.path.join(HERE, "results"))
os.makedirs(OUT_DIR, exist_ok=True)
OUT_JSON = os.path.join(OUT_DIR, f"{LABEL}.json")
OUT_MD = os.path.join(OUT_DIR, f"{LABEL}.md")


def check_must(answer: str, must: list[str]) -> list[str]:
    a = answer.lower()
    fails = []
    for p in must:
        if not re.search(p, a, re.IGNORECASE):
            fails.append(p)
    return fails


def ask(q: str, ses: str | None, timeout: float = 180) -> dict:
    body = json.dumps({"message": q, **({"sessionId": ses} if ses else {})}).encode()
    req = urllib.request.Request(
        f"{API}/api/chat/stream", data=body,
        headers={"Content-Type": "application/json", "Cookie": "sid=" + SID})
    t0 = time.time()
    ttft = None
    tools = []
    ans = []
    err = None
    done = False
    ses_id = ses
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            while True:
                line = r.readline()
                if not line:
                    break
                try:
                    ev = json.loads(line)
                except Exception:
                    continue
                t = ev.get("type")
                if t == "text_delta":
                    if ttft is None:
                        ttft = time.time() - t0
                    ans.append(ev.get("delta", ""))
                elif t == "tool_call":
                    tools.append(ev.get("tool"))
                elif t == "start" and ev.get("sessionId"):
                    ses_id = ev["sessionId"]
                elif t == "done":
                    done = True
                elif t == "error":
                    err = ev.get("message") or ev.get("error") or "error"
    except Exception as e:
        err = str(e)
    return {
        "q": q, "session": ses_id,
        "ttft": round(ttft, 2) if ttft else None,
        "total": round(time.time() - t0, 2),
        "tools": tools, "err": err, "done": done,
        "answer": "".join(ans),
    }


def main():
    n_all = len(QUESTIONS)
    start = int(os.environ.get("START", "1"))
    limit = int(os.environ.get("LIMIT", "0"))
    rerun = {int(x) for x in os.environ.get("RERUN", "").split(",") if x.strip()}
    results = []
    ses = None
    if os.path.exists(OUT_JSON):
        prev = json.load(open(OUT_JSON))
        results = prev.get("results", [])
        ses = prev.get("session")
        if prev.get("label") != LABEL:
            results, ses = [], None
    if rerun:
        if len(results) < n_all:
            results += [None] * (n_all - len(results))
        for i in sorted(rerun):
            results[i - 1] = None
        start = 1
        ses = None
        print(f"RERUN {len(rerun)} soal -> {sorted(rerun)}", flush=True)
    elif start > 1:
        results = results[: start - 1]
        print(f"resume dari checkpoint: {len(results)} hasil lama dipertahankan, sesi={ses}", flush=True)
    ran = 0
    for i, item in enumerate(QUESTIONS, 1):
        if i < start:
            continue
        if i <= len(results) and results[i - 1] is not None:
            continue
        if limit and ran >= limit:
            break
        r = ask(item["q"], ses)
        ses = r["session"]
        r["tier"] = item["tier"]
        r["module"] = item.get("module")
        r["must"] = item["must"]
        r["fails"] = check_must(r["answer"], item["must"])
        r["correct"] = not r["fails"] and bool(r["answer"].strip()) and not r["err"]
        r["ttft_ok"] = r["ttft"] is not None and r["ttft"] <= TTFT_LIMIT
        if i <= len(results):
            results[i - 1] = r
        else:
            results.append(r)
        ran += 1
        ok = "OK" if r["correct"] else ("ERR" if r["err"] else "SALAH")
        over = " ⚠TTFT" if (r["ttft"] is not None and r["ttft"] > TTFT_LIMIT) else ""
        print(f"[{i:03d}/{n_all}] T{item['tier']} {ok} ttft={r['ttft']}s total={r['total']}s "
              f"tools={len(r['tools'])} {item['q'][:55]}{over}", flush=True)
        if r["fails"]:
            print(f"         gagal cek: {r['fails']}", flush=True)
        if r["err"]:
            print(f"         err: {str(r['err'])[:120]}", flush=True)
        json.dump({"label": LABEL, "session": ses, "results": results},
                  open(OUT_JSON, "w"), ensure_ascii=False, indent=1)
        time.sleep(0.4)

    done_results = [r for r in results if r is not None]
    n = len(done_results)
    if n == 0:
        print("belum ada hasil")
        return
    ok = [r for r in done_results if r["correct"]]
    ttfts = sorted(r["ttft"] for r in done_results if r["ttft"] is not None)
    over = [r for r in done_results if r["ttft"] is not None and r["ttft"] > TTFT_LIMIT]
    no_ttft = [r for r in done_results if r["ttft"] is None]
    errs = [r for r in done_results if r["err"]]
    by_tier = {}
    for t in range(1, 6):
        rs = [r for r in done_results if r["tier"] == t]
        t_tf = sorted(r["ttft"] for r in rs if r["ttft"] is not None)
        by_tier[t] = {
            "n": len(rs),
            "benar": sum(1 for r in rs if r["correct"]),
            "ttft_med": t_tf[len(t_tf) // 2] if t_tf else None,
            "ttft_max": max(t_tf) if t_tf else None,
        }
    med_ttft = ttfts[len(ttfts) // 2] if ttfts else None

    with open(OUT_MD, "w") as f:
        f.write(f"# Bench 509 soal — {LABEL}\n\n")
        f.write(f"- Benar: **{len(ok)}/{n}** (target 509)\n")
        f.write(f"- TTFT median: {med_ttft} dtk; max: {max(ttfts) if ttfts else None} dtk\n")
        f.write(f"- Pelanggar TTFT > {TTFT_LIMIT} dtk: {len(over)}\n")
        f.write(f"- Tanpa TTFT / error: {len(no_ttft)} / {len(errs)}\n\n")
        f.write("| Tier | n | Benar | median TTFT | max TTFT |\n|---|---|---|---|---|\n")
        for t, v in by_tier.items():
            f.write(f"| T{t} | {v['n']} | {v['benar']} | {v['ttft_med']} | {v['ttft_max']} |\n")
        wrong = [r for r in done_results if not r["correct"]]
        if wrong:
            f.write("\n## Soal gagal\n")
            for idx, r in enumerate(results, 1):
                if r is None or r["correct"]:
                    continue
                f.write(f"- [{idx:03d}] T{r['tier']} {'ERR' if r['err'] else 'SALAH'}: {r['q']}\n")
                if r["fails"]:
                    f.write(f"    - gagal: {r['fails']}\n")
                if r["err"]:
                    f.write(f"    - err: {r['err']}\n")
        if over:
            f.write("\n## Pelanggar TTFT\n")
            for r in over:
                f.write(f"- {r['ttft']}s: {r['q']}\n")

    print(f"\n=== RINGKASAN {LABEL} ===")
    print(f"benar {len(ok)}/{n} | med_ttft={med_ttft} max={max(ttfts) if ttfts else None} "
          f"| >25dtk={len(over)} | no_ttft={len(no_ttft)} | err={len(errs)}")
    for t, v in by_tier.items():
        print(f"  T{t}: {v['benar']}/{v['n']} med={v['ttft_med']} max={v['ttft_max']}")
    print(f"output: {OUT_JSON}, {OUT_MD}")


if __name__ == "__main__":
    main()
