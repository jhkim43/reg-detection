"""Daily regulatory tracking pipeline — deterministic 4-step.

기존 LLM 위임 (SKILL.md + 4 sub-agent spawn) 방식의 무한 루프/라벨 중복/경로 오타
문제를 제거하기 위해, 4-step pipeline 자체를 결정적 Python 으로 구현. 각 step
마다 deskrpg API 를 직접 호출하여 sub-agent NPC 시각화 + chat_push 진행 보고 +
task lifecycle 을 LLM 위임 없이 정확히 재현한다.

사용 (메인 LLM 이 exec 으로 1회 호출):
  python scripts/run_daily_pipeline.py \\
      --since=20260611 \\
      --channel_id=<UUID> \\
      --npc_id=<parent supervisor UUID> \\
      --character_id=<UUID> \\
      --user_id=<UUID>

cwd 는 obsidian_vault/_tools 가정. INTERNAL_RPC_SECRET 은 env 또는 .env.integration
fallback. DESKRPG_INTERNAL_URL 미설정 시 http://deskrpg-app:3000.
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path


def _get_internal_secret() -> str | None:
    v = os.environ.get("INTERNAL_RPC_SECRET")
    if v:
        return v
    for p in [
        Path("../../.env.integration"),
        Path("/home/nanobot/.nanobot/api-workspace/.env.integration"),
        Path(".env.integration"),
    ]:
        if not p.exists():
            continue
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith(("INTERNAL_RPC_SECRET=", "JWT_SECRET=")):
                val = line.split("=", 1)[1].strip().strip('"').strip("'")
                if val:
                    return val
    return None


DESKRPG_URL = (os.environ.get("DESKRPG_INTERNAL_URL") or "http://deskrpg-app:3000").rstrip("/")
SECRET = _get_internal_secret()

# 호출 위치(메인 LLM exec)에서 cwd 가 임의로 들어와도 step_*.py 를 찾기 위해
# 절대 경로 + cwd 고정.
TOOLS_DIR = Path("/home/nanobot/.nanobot/api-workspace/obsidian_vault/_tools")
SCRIPTS_DIR = TOOLS_DIR / "scripts"


def _post(path: str, body: dict, timeout: int = 10) -> dict | None:
    req = urllib.request.Request(
        f"{DESKRPG_URL}{path}",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "x-deskrpg-internal-secret": SECRET or "",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            text = r.read().decode("utf-8")
            return json.loads(text) if text else {}
    except urllib.error.HTTPError as e:
        body_err = e.read().decode("utf-8", "replace") if e.fp else ""
        print(f"[pipeline] POST {path} -> {e.code}: {body_err[:200]}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"[pipeline] POST {path} EXCEPTION: {e}", file=sys.stderr)
        return None


def _delete(path: str, timeout: int = 10) -> int | None:
    req = urllib.request.Request(
        f"{DESKRPG_URL}{path}",
        headers={"x-deskrpg-internal-secret": SECRET or ""},
        method="DELETE",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status
    except urllib.error.HTTPError as e:
        print(f"[pipeline] DELETE {path} -> {e.code}", file=sys.stderr)
        return e.code
    except Exception as e:
        print(f"[pipeline] DELETE {path} EXCEPTION: {e}", file=sys.stderr)
        return None


def chat_push(ctx: dict, label: str, message: str) -> None:
    """parent (Supervisor) NPC 채팅에 [label] message push. UI 자동 [label] prefix."""
    _post("/api/internal/chat-push", {
        "session_key": ctx["session_key"],
        "channel_id": ctx["channel_id"],
        "npc_id": ctx["parent_npc_id"],
        "message": message,
        "kind": "subagent_progress",
        "subagent_label": label,
    })


def create_sub_npc(ctx: dict, label: str, identity: str, soul: str) -> tuple[str | None, str]:
    """POST /api/internal/npcs — wire format = camelCase (per docs/api/internal-events-contract.md §3).

    Supervisor (감독관) 책상 (8, 8) 의 아래쪽 빈 책상 자리에 sub-agent NPC 배치.
    감독관 책상 아래, admin character 보다 더 아래쪽 빈 의자 자리 — 대략 (8, 22).
    sequential spawn 이라 같은 위치 재사용 OK (한 번에 한 명만 살아있음).
    """
    agent_id = f"sub_{uuid.uuid4().hex[:8]}"
    resp = _post("/api/internal/npcs", {
        "ownerUserId": ctx["user_id"],
        "channelId": ctx["channel_id"],
        "name": label,
        "agentId": agent_id,
        "parentAgentId": "Supervisor",
        "identity": identity,
        "soul": soul,
        "locale": "ko",
        "positionX": 8,
        "positionY": 11,
        "appearance": {
            "bodyType": "male",
            "layers": {
                "body": {"itemKey": "body", "variant": "light"},
                "eye_color": {"itemKey": "eye_color", "variant": "blue"},
            },
        },
    })
    npc_id = (resp or {}).get("npc", {}).get("id") if resp else None
    return npc_id, agent_id


def delete_sub_npc(npc_id: str) -> None:
    _delete(f"/api/internal/npcs/{npc_id}")


def _push_task(ctx: dict, npc_id: str, npc_task_id: str, label: str, status: str, action: str, summary: str) -> None:
    # /api/internal/tasks 는 camelCase 만 받음.
    _post("/api/internal/tasks", {
        "channelId": ctx["channel_id"],
        "npcId": npc_id,
        "npcTaskId": npc_task_id,
        "title": label,
        "summary": summary,
        "status": status,
        "action": action,
        "assignerCharacterId": ctx["character_id"],
        "ownerUserId": ctx["user_id"],
    })


def run_step(
    ctx: dict, label: str, identity: str, soul: str, work_fn,
    spawn_message: str | None = None,
) -> bool:
    """공통 패턴: NPC 생성 → spawn chat_push → task 등록 → work_fn → task 완료 → NPC 삭제.

    spawn_message: NPC 가 UI 에 등장하는 순간 함께 보일 한 줄 announce. 미지정 시
    `"[생성] {label} 가동"`. work_fn 안의 step 별 detail chat_push 와는 별개.
    """
    print(f"[pipeline] === {label} START ===")

    # NPC 등장 전 사전 안내 — chat 먼저 떠서 사용자가 "곧 NPC 등장" 인지.
    chat_push(ctx, label, spawn_message or f"[생성 중] {label} 가동 중")

    npc_id, agent_id = create_sub_npc(ctx, label, identity, soul)
    if not npc_id:
        print(f"[pipeline] {label}: NPC create failed", file=sys.stderr)
        return False

    _push_task(ctx, npc_id, agent_id, label, "in_progress", "create", f"{label} 진행 중")

    ok = False
    try:
        ok = bool(work_fn(ctx, label))
    except Exception as e:
        print(f"[pipeline] {label} EXCEPTION: {e}", file=sys.stderr)

    _push_task(
        ctx, npc_id, agent_id, label,
        status="complete" if ok else "cancelled",
        action="complete" if ok else "cancel",
        summary=f"{label} {'완료' if ok else '실패'}",
    )
    delete_sub_npc(npc_id)
    print(f"[pipeline] === {label} END ok={ok} ===")
    return ok


# ====================== STEP work_fns ======================


def step_crawl(ctx: dict, label: str) -> bool:
    since = ctx["since"]
    chat_push(ctx, label, f"[크롤링] 4 발행처 시작 (since={since})")
    per_source: dict[str, int] = {}
    total = 0
    sources = ["fsec", "fsc", "fss", "pipc"]
    for i, src in enumerate(sources):
        try:
            r = subprocess.run(
                ["python", "-m", "reg_pipeline.crawler.run_one", src, "--since", since],
                capture_output=True, text=True, timeout=180,
                cwd=str(TOOLS_DIR),
            )
            m = re.search(r"결과:\s*(\d+)건", r.stdout)
            n = int(m.group(1)) if m else 0
        except Exception as e:
            print(f"[pipeline] crawl {src} error: {e}", file=sys.stderr)
            n = 0
        per_source[src] = n
        total += n
        next_src = sources[i + 1] if i + 1 < len(sources) else None
        if next_src:
            chat_push(ctx, label, f"[크롤링] {src} 완료 ({n}건). {next_src} 진행 중")
        else:
            chat_push(ctx, label, f"[크롤링] {src} 완료 ({n}건). 총 {total}건")
    chat_push(ctx, label, f"[완료] 총 {total}건 수집. Ingest로 인계")
    ctx["stats"]["crawl"] = {"per_source": per_source, "total": total}
    return True


def _parse_last_json_line(stdout: str) -> dict:
    for line in reversed([l for l in stdout.strip().split("\n") if l.strip()]):
        try:
            return json.loads(line)
        except Exception:
            continue
    return {}


def step_ingest(ctx: dict, label: str) -> bool:
    chat_push(ctx, label, "[변환] raw → MD 시작")
    r = subprocess.run(["python", str(SCRIPTS_DIR / "step_convert.py")],
                       capture_output=True, text=True, timeout=300, cwd=str(TOOLS_DIR))
    convert_info = _parse_last_json_line(r.stdout)
    chat_push(ctx, label, f"[변환] 성공 {convert_info.get('success', 0)}건, 실패 {convert_info.get('failed', 0)}건. 분류 진행 중")

    r = subprocess.run(["python", str(SCRIPTS_DIR / "step_classify.py")],
                       capture_output=True, text=True, timeout=300, cwd=str(TOOLS_DIR))
    m = re.search(r"(\d+)", r.stdout.strip().split("\n")[-1])
    matched = int(m.group(1)) if m else 0
    chat_push(ctx, label, f"[분류] 통과 {matched}건. GAP 분석으로 인계")
    ctx["stats"]["ingest"] = {
        "convert_success": convert_info.get("success", 0),
        "convert_skip": convert_info.get("skip", 0),
        "convert_failed": convert_info.get("failed", 0),
        "classified_matched": matched,
    }
    return True


def step_gap(ctx: dict, label: str) -> bool:
    chat_push(ctx, label, "[영향평가] LLM 호출 시작 (자료당 5~15초 · 진행률 매 3건마다 보고)")
    # step_judge.py 가 진행률 chat_push 직접 보내도록 deskrpg ctx 인자 전달.
    r = subprocess.run(
        ["python", str(SCRIPTS_DIR / "step_judge.py"),
         f"--channel_id={ctx['channel_id']}",
         f"--npc_id={ctx['parent_npc_id']}",
         f"--session_key={ctx['session_key']}",
         f"--subagent_label={label}",
         "--progress_every=3"],
        capture_output=True, text=True, timeout=1200, cwd=str(TOOLS_DIR),
    )
    info = _parse_last_json_line(r.stdout)
    chat_push(ctx, label, f"[완료] impact≥7: {info.get('high', 0)}건, impact 4~6: {info.get('mid', 0)}건 / 총 {info.get('total', 0)}건. 영향도로 인계")
    ctx["stats"]["gap"] = {
        "high": info.get("high", 0),
        "mid": info.get("mid", 0),
        "total": info.get("total", 0),
    }
    return True


def step_impact(ctx: dict, label: str) -> bool:
    chat_push(ctx, label, "[위키] external 생성 + internal sync 시작")
    r = subprocess.run(["python", str(SCRIPTS_DIR / "step_buildwiki.py")],
                       capture_output=True, text=True, timeout=300, cwd=str(TOOLS_DIR))
    info = _parse_last_json_line(r.stdout)
    chat_push(ctx, label, f"[위키] external {info.get('created', 0)}건 생성, internal {info.get('synced', 0)}건 sync. 보고서 생성 중")
    ctx["stats"]["impact"] = {
        "external_created": info.get("created", 0),
        "internal_synced": info.get("synced", 0),
    }

    # step_telegram 이 stats 도 함께 읽도록 /tmp 에 저장.
    try:
        Path("/tmp/regtrack-stats.json").write_text(
            json.dumps(ctx["stats"], ensure_ascii=False), encoding="utf-8"
        )
    except Exception as e:
        print(f"[pipeline] stats save error: {e}", file=sys.stderr)

    subprocess.run(
        ["python", str(SCRIPTS_DIR / "step_pushreport.py"),
         f"--channel_id={ctx['channel_id']}",
         f"--npc_id={ctx['parent_npc_id']}",
         f"--character_id={ctx['character_id']}"],
        timeout=30, cwd=str(TOOLS_DIR),
    )
    subprocess.run(["python", str(SCRIPTS_DIR / "step_telegram.py")],
                   timeout=30, cwd=str(TOOLS_DIR))
    chat_push(ctx, label, "[완료] ReportPanel + 텔레그램 알람 등록. 외규 업데이트 일배치 종료")
    return True


# ====================== Main ======================


def main():
    # 시연 환경의 default UUID. 메인 LLM 이 SKILL.md 의 strict template 을
    # 따르지 않고 인자를 누락한 채 호출해도 시연 채널에서 동작하도록 default 부여.
    # 운영 (다중 채널) 전환 시 default 제거하고 required=True 복원 + nanobot
    # custom tool 로 metadata 자동 inject 패턴 도입 권장.
    DEMO_CHANNEL_ID = "247148b5-7fc9-42f8-b850-aaa921397da1"
    DEMO_NPC_ID = "978ced1c-6fab-4f0d-b446-9bbd700015ce"
    DEMO_CHARACTER_ID = "ee3ed177-7b45-495c-9d09-eeefa68c6790"
    DEMO_USER_ID = "6060c836-e8d7-437d-8633-4043f799064b"

    # since default = today - 3 days. LLM 인자 무시, 코드만 결정.
    default_since = (datetime.date.today() - datetime.timedelta(days=3)).strftime("%Y%m%d")

    p = argparse.ArgumentParser()
    p.add_argument("--since", "--since-date", "--since_date", dest="since",
                   default=None, help=f"YYYYMMDD (default: {default_since}, today-3d)")
    p.add_argument("--channel_id", default=DEMO_CHANNEL_ID)
    p.add_argument("--npc_id", default=DEMO_NPC_ID, help="parent Supervisor npc_uuid")
    p.add_argument("--character_id", default=DEMO_CHARACTER_ID)
    p.add_argument("--user_id", default=DEMO_USER_ID)
    p.add_argument("--session_key", default="pipeline:daily-regtrack-update")
    # parse_known_args 로 unknown 인자 (예: positional 20260611, since=20260611) 무시.
    args, unknown = p.parse_known_args()
    if not args.since:
        # unknown 안에서 YYYYMMDD 8 자리 숫자 찾아 since 로 채택 (LLM 이 positional
        # 또는 since=20260611 같이 박은 경우도 흡수).
        for u in unknown:
            digits = "".join(c for c in u if c.isdigit())
            if len(digits) == 8 and digits.startswith("2"):
                args.since = digits
                break
    if not args.since:
        args.since = default_since

    if not SECRET:
        print("[pipeline] INTERNAL_RPC_SECRET not found in env or .env.integration", file=sys.stderr)
        sys.exit(1)

    ctx = {
        "since": args.since,
        "channel_id": args.channel_id,
        "user_id": args.user_id,
        "parent_npc_id": args.npc_id,
        "character_id": args.character_id,
        "session_key": args.session_key,
        "stats": {"since": args.since, "crawl": {}, "ingest": {}, "gap": {}, "impact": {}},
    }

    t0 = time.monotonic()
    ok1 = run_step(ctx, "수집 Agent",
                   identity="외부 규제 자료 수집 봇. reg_pipeline.crawler로 4 발행처를 차례로 크롤한다.",
                   soul="결정적 pipeline. LLM 미사용.",
                   work_fn=step_crawl,
                   spawn_message="[생성] 외부 규제 자료 수집을 시작합니다 (fsec → fsc → fss → pipc)")
    if not ok1:
        print("[pipeline] aborted at 수집", file=sys.stderr)
        sys.exit(1)

    # 신규 수집 0 건 — 후속 단계 (변환·분류·평가·위키·보고서) skip + 짧은 텔레그램만.
    # crawl_history.json 가 dedup 한 결과라 의미: "오늘 새로 추가된 외규 없음".
    crawl_total = (ctx.get("stats", {}).get("crawl") or {}).get("total", 0)
    if crawl_total == 0:
        # stats 만 저장 (step_telegram 이 읽음)
        try:
            Path("/tmp/regtrack-stats.json").write_text(
                json.dumps(ctx["stats"], ensure_ascii=False), encoding="utf-8"
            )
        except Exception:
            pass
        # 빈 judged 로 reset — step_telegram 가 stats 만 보고 짧은 메시지 발송
        try:
            Path("/tmp/regtrack-judged.json").write_text("[]", encoding="utf-8")
        except Exception:
            pass
        subprocess.run(["python", str(SCRIPTS_DIR / "step_telegram.py")],
                       timeout=30, cwd=str(TOOLS_DIR))
        chat_push(ctx, "수집 Agent",
                  "[완료] 신규 외규 0건 — 변환·분류·평가·위키 단계 skip. 텔레그램 짧은 알림만 발송.")
        elapsed = time.monotonic() - t0
        print(json.dumps({
            "수집": True, "Ingest": "skip", "GAP": "skip", "영향도": "skip",
            "reason": "no new external regulations crawled",
            "elapsed_sec": round(elapsed, 1),
        }))
        return

    ok2 = run_step(ctx, "Ingest Agent",
                   identity="raw → wiki 변환 봇. converter + classifier.",
                   soul="결정적 pipeline. LLM 미사용.",
                   work_fn=step_ingest,
                   spawn_message="[생성] raw → MD 변환 + sub_area 분류 시작")
    if not ok2:
        print("[pipeline] aborted at Ingest", file=sys.stderr)
        sys.exit(1)

    ok3 = run_step(ctx, "GAP 분석 Agent",
                   identity="외규-내규 영향평가 봇. LLMJudge로 impact_score 산정.",
                   soul="결정적 pipeline. step_judge.py 내부에서만 LLM 사용.",
                   work_fn=step_gap,
                   spawn_message="[생성] 외규 ↔ 내규 영향평가 시작 (LLM judge 호출, 자료당 5~15초)")
    if not ok3:
        print("[pipeline] aborted at GAP", file=sys.stderr)
        sys.exit(1)

    ok4 = run_step(ctx, "영향도 Agent",
                   identity="vault 갱신 + 최종 보고서 봇.",
                   soul="결정적 pipeline. LLM 미사용.",
                   work_fn=step_impact,
                   spawn_message="[생성] external/internal wiki 갱신 + ReportPanel + 텔레그램 알람")

    elapsed = time.monotonic() - t0
    print(json.dumps({
        "수집": ok1, "Ingest": ok2, "GAP": ok3, "영향도": ok4,
        "elapsed_sec": round(elapsed, 1),
    }))


if __name__ == "__main__":
    # detached background 패턴: 메인 LLM exec timeout 변동에 영향 받지 않도록
    # 자식 process 를 부모와 분리해서 띄운 뒤 부모는 즉시 종료. 사용자는 deskrpg
    # UI 의 NPC 4 개 생성/삭제 + 텔레그램으로 진행 상황 추적.
    if "--detached-child" in sys.argv:
        sys.argv.remove("--detached-child")
        main()
    else:
        log_path = "/tmp/regtrack-pipeline.log"
        args = sys.argv[1:] + ["--detached-child"]
        subprocess.Popen(
            ["python3", __file__, *args],
            stdout=open(log_path, "w"),
            stderr=subprocess.STDOUT,
            start_new_session=True,  # 부모 process 그룹과 분리 → SIGKILL 면역
        )
        print(json.dumps({
            "status": "pipeline_started_in_background",
            "log_path": log_path,
            "note": "메인 LLM 은 즉시 응답. 4-step 진행은 deskrpg UI 와 텔레그램으로 확인.",
        }))
