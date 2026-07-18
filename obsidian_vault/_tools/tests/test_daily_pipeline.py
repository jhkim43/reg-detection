from __future__ import annotations

import datetime
import importlib
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


TOOLS_DIR = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = TOOLS_DIR / "scripts"
sys.path.insert(0, str(TOOLS_DIR))


def _load_script(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS_DIR / filename)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {filename}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


pipeline = _load_script("daily_pipeline_script", "run_daily_pipeline.py")
convert = _load_script("step_convert_script", "step_convert.py")
classify = _load_script("step_classify_script", "step_classify.py")
judge = _load_script("step_judge_script", "step_judge.py")
buildwiki = _load_script("step_buildwiki_script", "step_buildwiki.py")
report = _load_script("step_pushreport_script", "step_pushreport.py")
daily_batch = importlib.import_module("reg_pipeline.daily_batch")


class DailyPipelineTest(unittest.TestCase):
    def test_default_range_is_five_days_and_reply_has_dates(self):
        today = datetime.date(2026, 7, 18)

        self.assertEqual(pipeline._default_since(today), "20260713")
        self.assertEqual(
            pipeline._start_reply("20260713", "20260718"),
            "2026년 7월 13일부터 2026년 7월 18일까지 외부 규제 자료 수집을 시작합니다.",
        )

    def test_since_parser_accepts_supported_forms(self):
        for argv in (
            ["20260713"],
            ["since=20260713"],
            ["--since=20260713"],
            ["--since", "20260713"],
        ):
            with self.subTest(argv=argv):
                self.assertEqual(pipeline._since_from_argv(argv), "20260713")

    def test_conversion_manifest_contains_only_files_created_this_run(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_root = root / "raw"
            md_root = root / "md"
            manifest_path = root / "manifest.json"
            source_dir = raw_root / "fsc"
            source_dir.mkdir(parents=True)
            (source_dir / "new.md").write_text("# 신규 문서", encoding="utf-8")

            first = convert.run_conversion(raw_root, md_root, manifest_path)
            second = convert.run_conversion(raw_root, md_root, manifest_path)

            self.assertEqual(first["new_md_count"], 1)
            self.assertEqual(second["new_md_count"], 0)
            self.assertEqual(json.loads(manifest_path.read_text(encoding="utf-8")), [])

    def test_classifier_reads_only_manifest_documents(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            included = root / "external_raw_md" / "fsc" / "new.md"
            excluded = root / "external_raw_md" / "fsc" / "old.md"
            reference = root / "external_raw_md" / "reference" / "reference.md"
            for path in (included, excluded, reference):
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("본문", encoding="utf-8")
            manifest = root / "manifest.json"
            manifest.write_text(
                json.dumps([str(included), str(reference), str(included)], ensure_ascii=False),
                encoding="utf-8",
            )

            self.assertEqual(classify.load_new_documents(manifest), [included])

    def test_progress_messages_do_not_expose_internal_reuse(self):
        messages = [judge._start_message(13), judge._progress_message(3, 13, 4)]
        for message in messages:
            self.assertNotIn("캐시", message)
            self.assertNotIn("cache", message.lower())
            self.assertNotIn("재사용", message)

    def test_internal_wiki_threshold_and_multiple_links(self):
        self.assertEqual(buildwiki.EXTERNAL_WIKI_MIN_SCORE, 0)
        self.assertEqual(buildwiki.INTERNAL_WIKI_MIN_SCORE, 4)
        content = (
            "---\n"
            'related_external: ["기존 외규"]\n'
            "---\n\n"
            "# 관련 외규 (자동 갱신)\n\n"
            "- [[기존 외규]]\n"
        )

        updated = daily_batch._append_internal_reference(content, "신규 외규")
        repeated = daily_batch._append_internal_reference(updated, "신규 외규")

        self.assertIn('related_external: ["기존 외규", "신규 외규"]', updated)
        self.assertIn("- [[신규 외규]]", updated)
        self.assertEqual(repeated, updated)

    def test_report_explains_results_and_decision_rule(self):
        matched = [{
            "raw_md": "../external_raw_md/pipc/20260718_개인정보 보호 강화.md",
            "source": "pipc",
            "matched_internal": ["개인정보", "안전성조치"],
            "evaluation": {
                "impact_score": 8,
                "primary_match": "KB은행_개인정보처리방침",
                "affected_articles": ["제3조", "제8조"],
                "summary": ["보호조치 기준이 강화됩니다.", "점검 항목이 확대됩니다."],
                "reason": "현행 내규의 보호조치 절차와 직접 연결됩니다.",
                "update_recommendation": "관련 조항과 점검표를 개정합니다.",
                "deadline_hint": "2026년 8월 검토",
            },
        }]
        stats = {
            "since": "20260713",
            "until": "20260718",
            "crawl": {"total": 3, "per_source": {"pipc": 3}},
            "ingest": {"new_md_count": 3},
            "impact": {"external_created": 1, "internal_synced": 1},
        }

        markdown = report.build_markdown(
            matched,
            stats,
            generated_at=datetime.datetime(2026, 7, 18, 10, 30),
        )

        self.assertIn("## 결론", markdown)
        self.assertIn("## 처리 현황", markdown)
        self.assertIn("## 판정 기준", markdown)
        self.assertIn("보호조치 기준이 강화됩니다.", markdown)
        self.assertIn("점검 항목이 확대됩니다.", markdown)
        self.assertIn("4점 이상", markdown)
        self.assertNotIn("캐시", markdown)


if __name__ == "__main__":
    unittest.main()
