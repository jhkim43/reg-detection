"""converter — raw 파일을 마크다운으로 변환.

지원 포맷:
  PDF (.pdf)       → opendataloader-pdf
  HWP (.hwp)       → olefile + zlib (pure Python)
  HWPX (.hwpx)     → zipfile + ET (pure Python)
  JSON (.json)     → 정형 데이터 재귀 파싱 (law_center)
  MD (.md)         → 그대로 복사 (fsec 보도자료)

미지원: xlsx, jpg 등 (skip)
"""

from .to_md import convert_to_md, BatchConverter

__all__ = ["convert_to_md", "BatchConverter"]
