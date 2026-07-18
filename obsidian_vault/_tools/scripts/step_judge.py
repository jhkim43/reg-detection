"""Step 7 helper — LLM 영향 판정. cwd가 obsidian_vault/_tools 가정.

입력: /tmp/regtrack-matched.json (step_classify 결과)
결과: /tmp/regtrack-judged.json (evaluation 추가됨)
stdout: {"high": H, "mid": M, "total": T} JSON 1줄

--progress-chat 옵션 으로 deskrpg chat_push 직접 호출하여 매 외규 처리 후 진행률 보고 가능
(run_daily_pipeline.py 의 step_gap 에서 주입).
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, ".")
from reg_pipeline.llm_judge import LLMJudge


def _get_internal_secret() -> str | None:
    v = os.environ.get("INTERNAL_RPC_SECRET")
    if v:
        return v
    for p in [
        Path("../../.env.integration"),
        Path("/home/nanobot/.nanobot/api-workspace/.env.integration"),
        Path(".env.integration"),
    ]:
        if p.exists():
            for line in p.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line.startswith(("INTERNAL_RPC_SECRET=", "JWT_SECRET=")):
                    val = line.split("=", 1)[1].strip().strip('"').strip("'")
                    if val:
                        return val
    return None


def _progress_chat_push(channel_id: str, npc_id: str, session_key: str, label: str, message: str) -> None:
    """deskrpg /api/internal/chat-push 직접 호출 (run_daily_pipeline 의존 회피)."""
    base = (os.environ.get("DESKRPG_INTERNAL_URL") or "http://deskrpg-app:3000").rstrip("/")
    secret = _get_internal_secret()
    if not secret:
        return
    payload = json.dumps({
        "session_key": session_key,
        "channel_id": channel_id,
        "npc_id": npc_id,
        "message": message,
        "kind": "subagent_progress",
        "subagent_label": label,
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{base}/api/internal/chat-push",
        data=payload,
        headers={"Content-Type": "application/json", "x-deskrpg-internal-secret": secret},
        method="POST",
    )
    try:
        urllib.request.urlopen(req, timeout=5).read()
    except Exception:
        pass  # progress chat 실패는 비치명


def _load_cache(cache_path: Path) -> dict:
    if not cache_path.exists():
        return {}
    try:
        return json.loads(cache_path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_cache(cache_path: Path, cache: dict) -> None:
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")


def _cached_evaluation(item: dict, cache: dict) -> dict | None:
    raw_path = item["raw_md"]
    try:
        mtime = os.path.getmtime(raw_path)
    except OSError:
        mtime = 0.0
    cached = cache.get(raw_path)
    if cached and cached.get("mtime") == mtime and cached.get("evaluation"):
        return cached
    return None


def _impact_level(score: int) -> str:
    if score >= 7:
        return "우선 검토"
    if score >= 4:
        return "일반 검토"
    return "낮음"


def _start_message(total: int) -> str:
    return f"[대상 확정] 신규 문서 중 영향평가 대상 {total}건을 판정합니다."


def _progress_message(
    current: int,
    total: int,
    score: int,
) -> str:
    return (
        f"[진행 {current}/{total}] 영향평가 진행 중\n"
        f"최근 문서 영향도 {score}/10 ({_impact_level(score)})"
    )


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--matched_path", default="/tmp/regtrack-matched.json")
    p.add_argument("--out_path", default="/tmp/regtrack-judged.json")
    p.add_argument("--cache_path", default="../../.cache/judge_cache.json",
                   help="judge 결과 cache 위치 (key=raw_md path, value={mtime, evaluation})")
    # 진행률 chat_push 옵션 (없으면 미보고)
    p.add_argument("--channel_id", default=None)
    p.add_argument("--npc_id", default=None)
    p.add_argument("--session_key", default="pipeline:daily-regtrack-update")
    p.add_argument("--subagent_label", default="GAP 분석 Agent")
    p.add_argument("--progress_every", type=int, default=3)
    args = p.parse_args()

    matched = json.load(open(args.matched_path))
    total_n = len(matched)
    j = LLMJudge(score_threshold=4)
    can_progress = bool(args.channel_id and args.npc_id)

    cache_path = Path(args.cache_path)
    cache = _load_cache(cache_path)
    cache_hits = 0
    cache_misses = 0
    cached_by_index = [_cached_evaluation(item, cache) for item in matched]
    if can_progress and total_n:
        _progress_chat_push(
            args.channel_id, args.npc_id, args.session_key, args.subagent_label,
            _start_message(total_n),
        )

    for i, (item, cached) in enumerate(zip(matched, cached_by_index), start=1):
        raw_path = item["raw_md"]
        cache_key = raw_path

        if cached:
            # cache hit — LLM 호출 skip, 기존 evaluation 재사용
            item["evaluation"] = cached["evaluation"]
            item["is_new"] = False
            cache_hits += 1
        else:
            # cache miss — 신규 또는 파일 수정됨
            text = open(raw_path).read()
            ev = j.judge(
                external_title=raw_path,
                external_text=text,
                external_sub_areas=item["sub_areas"],
                matched_internals=item["top_internal"],
            )
            evaluation = {
                "has_impact": ev.impact.has_impact,
                "impact_score": ev.impact.impact_score,
                "reason": ev.impact.reason,
                "primary_match": ev.impact.primary_match,
                "affected_articles": ev.impact.affected_articles,
                "summary": ev.summary,
                "update_recommendation": ev.update_recommendation,
                "deadline_hint": ev.deadline_hint,
            }
            item["evaluation"] = evaluation
            item["is_new"] = True
            try:
                mtime = os.path.getmtime(raw_path)
            except OSError:
                mtime = 0.0
            cache[cache_key] = {"mtime": mtime, "evaluation": evaluation}
            cache_misses += 1

        if can_progress and (i % args.progress_every == 0 or i == total_n):
            score = item["evaluation"].get("impact_score", 0)
            _progress_chat_push(
                args.channel_id, args.npc_id, args.session_key, args.subagent_label,
                _progress_message(i, total_n, score),
            )

    _save_cache(cache_path, cache)

    json.dump(matched, open(args.out_path, "w"), ensure_ascii=False)
    new_items = [m for m in matched if m.get("is_new")]
    high = sum(1 for m in matched if m.get("evaluation", {}).get("impact_score", 0) >= 7)
    mid = sum(1 for m in matched if 4 <= m.get("evaluation", {}).get("impact_score", 0) < 7)
    low = total_n - high - mid
    print(json.dumps({
        "high": high, "mid": mid, "low": low, "total": total_n,
        "new": len(new_items), "cached": cache_hits,
    }))


if __name__ == "__main__":
    main()
