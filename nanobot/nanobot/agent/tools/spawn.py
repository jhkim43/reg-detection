"""Spawn tool for creating background subagents and syncing via DeskRPG internal API."""

import os
import json
import asyncio
import urllib.request
import uuid
import re
from contextvars import ContextVar
from typing import TYPE_CHECKING, Any
from loguru import logger
from nanobot.agent.tools.base import Tool, tool_parameters
from nanobot.agent.tools.schema import StringSchema, tool_parameters_schema

if TYPE_CHECKING:
    from nanobot.agent.subagent import SubagentManager

async def notify_deskrpg_spawn(
    owner_user_id: str,
    channel_id: str,
    name: str,
    agent_id: str,
    parent_agent_id: str,
    identity: str,
    soul: str
):
    """
    DeskRPG 백엔드의 POST /api/internal/npcs endpoint 규격을 정확히 호출합니다.
    ```
    curl -sS -X POST "http://localhost:3000/api/internal/npcs" \
        -H "x-deskrpg-internal-secret: 6bd2..." \
        -H "content-type: application/json" \
        -d '{
            "ownerUserId": "385e7205-....",
            "channelId": "c59dc519-....",
            "name": "리서치담당",
            "agentId": "agent-research-001",
            "parentAgentId": "supervisor",
            "identity": "국제 정세 리서치 전문가.",
            "soul": "정확하고 중립적인 사실 기반 리포트.",
            "locale": "ko",
            "appearance": {
            "bodyType": "male",
            "layers": {
                "body":      { "itemKey": "body",      "variant": "light" },
                "eye_color": { "itemKey": "eye_color", "variant": "blue" }
            }
            }
        }'
    ```
    """
    # 도커 네트워크 명세 상 기본 호스트 바인딩 오버라이드 처리
    deskrpg_url = os.environ.get("DESKRPG_INTERNAL_URL", "http://deskrpg-app:3000/api/internal/npcs")
    secret = os.environ.get("INTERNAL_RPC_SECRET", "test-secret")
    
    payload = {
        "ownerUserId": owner_user_id,
        "channelId": channel_id,
        "name": name,
        "agentId": agent_id,
        "parentAgentId": parent_agent_id,
        "identity": identity,
        "soul": soul,
        "locale": "ko",
        "appearance": {
            "bodyType": "male",
            "layers": {
                "body":      { "itemKey": "body",      "variant": "light" },
                "eye_color": { "itemKey": "eye_color", "variant": "blue" }
            }
        }
    }
    headers = {
        "x-deskrpg-internal-secret": secret,
        "Content-Type": "application/json"
    }
    
    def _send_request():
        import urllib.error
        req = urllib.request.Request(
            deskrpg_url, 
            data=json.dumps(payload).encode('utf-8'), 
            headers=headers, 
            method='POST'
        )
        try:
            with urllib.request.urlopen(req, timeout=5) as response:
                logger.info(f"[DeskRPG Sync] Successfully spawned sub-agent: {name} mapped to parent {parent_agent_id}")
        except urllib.error.HTTPError as e:
            # ★ 404, 400 등 에러 발생 시 백엔드가 반환한 상세 에러 JSON을 긁어서 로깅
            error_body = e.read().decode('utf-8')
            logger.error(f"[DeskRPG Sync Error] HTTP {e.code}: {error_body}")
        except Exception as e:
            logger.error(f"[DeskRPG Sync Error] Failed post request to internal api: {e}")

    # 메인 서브 루프 지연 회피를 위해 스레드 풀 격리 실행
    await asyncio.to_thread(_send_request)


@tool_parameters(
    tool_parameters_schema(
        task=StringSchema("The task description for the subagent to handle contextually"),
        label=StringSchema("The display nickname/label for this NPC asset inside the virtual office"),
        identity=StringSchema("The core persona instruction, role or prompt guidance context"),
        soul=StringSchema("The psychological profile, behavioral boundaries, or unique background story"),
        required=["task", "label", "identity", "soul"],
    )
)
class SpawnTool(Tool):
    """Tool to spawn a subagent for background task execution and synchronize states with DeskRPG UI."""

    def __init__(self, manager: "SubagentManager"):
        self._manager = manager
        # ContextVars for routing infrastructure
        self._origin_channel: ContextVar[str] = ContextVar("spawn_origin_channel", default="cli")
        self._origin_chat_id: ContextVar[str] = ContextVar("spawn_origin_chat_id", default="direct")
        self._session_key: ContextVar[str] = ContextVar("spawn_session_key", default="cli:direct")
        self._origin_message_id: ContextVar[str | None] = ContextVar("spawn_origin_message_id", default=None)
        
        # DeskRPG 비즈니스 메타 동기화 전용 ContextVars
        self._owner_user_id: ContextVar[str | None] = ContextVar("spawn_owner_user_id", default=None)
        self._channel_id: ContextVar[str | None] = ContextVar("spawn_channel_id", default=None)
        self._parent_agent_id: ContextVar[str | None] = ContextVar("spawn_parent_agent_id", default=None)

    def set_context(
        self, 
        channel: str, 
        chat_id: str, 
        effective_key: str | None = None,
        owner_user_id: str | None = None,
        channel_id: str | None = None,
        parent_agent_id: str | None = None,
    ) -> None:
        """루프 티켓 처리 흐름으로부터 DeskRPG의 데이터 지형을 전달받아 저장합니다."""
        self._origin_channel.set(channel)
        self._origin_chat_id.set(chat_id)
        self._session_key.set(effective_key or f"{channel}:{chat_id}")
        
        # 외부 주입 정보 바인딩 처리
        self._owner_user_id.set(owner_user_id)
        self._channel_id.set(channel_id)
        self._parent_agent_id.set(parent_agent_id)

    def set_origin_message_id(self, message_id: str | None) -> None:
        self._origin_message_id.set(message_id)

    @property
    def name(self) -> str:
        return "spawn"

    @property
    def description(self) -> str:
        return (
            "MANDATORY: Use this tool IMMEDIATELY whenever the user explicitly asks to assign a task "
            "to a subagent, background agent, or requests a task to run 'independently' or 'in the background'. "
            "Spawning a subagent will offload complex jobs and visually register a new coworker NPC in DeskRPG. "
            "You MUST provide label, identity, and soul arguments based on the requested role."
        )

    async def execute(self, task: str, label: str, identity: str, soul: str, **kwargs: Any) -> str:
        """서브 에이전트의 로컬 실행 환경을 생성하고 DeskRPG 채널에 실시간 갱신(소켓 전파)을 요청합니다."""
        running = self._manager.get_running_count()
        limit = self._manager.max_concurrent_subagents
        if running >= limit:
            return (
                f"Cannot spawn subagent: concurrency limit reached "
                f"({running}/{limit} running). Wait for a running subagent "
                f"to complete before spawning a new one."
            )

        # 2. Nanobot 서브 에이전트 핵심 파일 및 로컬 인스턴스 생성
        result = await self._manager.spawn(
            task=task,
            label=label,
            origin_channel=self._origin_channel.get(),
            origin_chat_id=self._origin_chat_id.get(),
            session_key=self._session_key.get(),
            origin_message_id=self._origin_message_id.get(),
        )
        logger.info(f"[SpawnTool] Spawned subagent with task: {task}, label: {label}, identity: {identity}, soul: {soul}. Result: {result}")

        # 3. DeskRPG 동기화 변수 추출
        owner_id = self._owner_user_id.get()
        parent_id = self._parent_agent_id.get()
        # 대화 본문 메타데이터에 channel_id가 누락되었을 경우를 대비한 fallback 방어코드 적용
        channel_uuid = self._channel_id.get() or self._origin_chat_id.get()
        
        # 부모 정보 및 소유자 컨텍스트 검증 성공 시 동기화 전파 시도
        if owner_id and parent_id and channel_uuid:
            # 매니저 반환 문자열에서 정규식을 이용해 고유 세션 키 혹은 디렉토리 ID 파싱
            match = re.search(r"'([^']+)'", str(result))
            subagent_id = match.group(1) if match else f"sub_{uuid.uuid4().hex[:8]}"

            # 논블로킹 비동기 스케줄링 태스크 등록 후 즉시 반환
            asyncio.create_task(
                notify_deskrpg_spawn(
                    owner_user_id=owner_id,
                    channel_id=channel_uuid,
                    name=label,
                    agent_id=subagent_id,
                    parent_agent_id=parent_id,
                    identity=identity,
                    soul=soul,
                )
            )
            logger.info(f"[SpawnTool] Requesting visual spawn and sync for {label} to map grid.")
            return f"{result}\n[DeskRPG Sync] Requesting visual spawn and sync for {label} to map grid."
            
        logger.warning(f"[SpawnTool] Skipped visual layout propagation: Missing valid meta-context (owner: {owner_id}, parent: {parent_id}, channel: {channel_uuid}).")
        return f"{result}\n[DeskRPG Sync] Skipped visual layout propagation: Missing valid meta-context (owner: {owner_id}, parent: {parent_id}, channel: {channel_uuid})."