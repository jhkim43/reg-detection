"""OpenRouter 클라이언트 (OpenAI SDK 호환).

API key는 .env.integration 또는 환경변수 OPENROUTER_API_KEY에서 로드.
"""

from __future__ import annotations

import os
from pathlib import Path


# regtrack 루트 (cwd 무관하게 .env.integration 찾기 위해)
# __file__ = _tools/reg_pipeline/llm_judge/client.py
# 5단계 parent = regtrack/
_REGTRACK_ROOT = Path(__file__).resolve().parents[4]


def load_api_key(env_file: Path | None = None) -> str:
    """OPENROUTER_API_KEY 로드.

    우선순위:
      1. 환경변수 OPENROUTER_API_KEY
      2. env_file 인자
      3. regtrack 루트의 .env.integration / .env.local / .env
      4. cwd의 .env.integration / .env.local / .env  (legacy)
    """
    # 1. 환경변수 직접
    key = os.getenv("OPENROUTER_API_KEY")
    if key:
        return key

    # 2~4. .env 파일 파싱 (python-dotenv 없이 직접)
    candidates: list[Path] = [env_file] if env_file else []
    for name in (".env.integration", ".env.local", ".env"):
        candidates.append(_REGTRACK_ROOT / name)   # regtrack 루트
        candidates.append(Path(name))              # cwd (legacy)

    for path in candidates:
        if path and path.exists():
            for line in path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line.startswith("OPENROUTER_API_KEY"):
                    _, _, val = line.partition("=")
                    val = val.strip().strip('"').strip("'")
                    if val:
                        return val
    raise RuntimeError(
        f"OPENROUTER_API_KEY 미발견. 환경변수 또는 "
        f"{_REGTRACK_ROOT}/.env.integration 에 추가 필요"
    )


class LLMClient:
    """OpenRouter 경유 LLM 호출 (OpenAI SDK 호환)."""

    def __init__(
        self,
        model: str = "openai/gpt-5-mini",
        api_key: str | None = None,
        env_file: Path | None = None,
    ):
        try:
            from openai import OpenAI
        except ImportError as e:
            raise RuntimeError(
                "openai SDK 필요: pip install openai"
            ) from e
        self.model = model
        self.client = OpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=api_key or load_api_key(env_file),
        )

    def chat(
        self,
        system: str,
        user: str,
        temperature: float = 0.2,
        max_tokens: int = 2000,
        json_mode: bool = False,
    ) -> str:
        """단일 chat 호출 → 응답 텍스트."""
        kwargs = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        response = self.client.chat.completions.create(**kwargs)
        return response.choices[0].message.content or ""
