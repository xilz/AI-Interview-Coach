import json
import unittest
import asyncio
from types import SimpleNamespace
from unittest.mock import patch

from starlette.requests import Request

import main


class AnalysisPipelineTests(unittest.TestCase):
    def test_primary_language_uses_dominant_transcript_script(self):
        self.assertEqual(main._detect_primary_language("我负责产品设计，使用 Python 做数据分析"), "Chinese")
        self.assertEqual(main._detect_primary_language("I designed the product and analyzed user feedback"), "English")
        self.assertEqual(main._detect_primary_language("123 !!!"), None)

    def test_analysis_prompt_requires_interview_language_and_positive_first_overview(self):
        extraction = {"speakers": {"Speaker 0": "interviewer"}, "qa_pairs": []}
        for transcript, expected in [
            ("我负责分析用户需求，并提出方案。", "本次面试的主要语言是 Chinese"),
            ("I analyzed user needs and proposed a solution.", "本次面试的主要语言是 English"),
        ]:
            with self.subTest(expected=expected), patch.object(
                main, "call_llm", side_effect=[json.dumps(extraction), json.dumps({"qa_analysis": []})]
            ) as call:
                main.analyze_interview(transcript)
            prompt = call.call_args_list[1].args[0]
            self.assertIn(expected, prompt)
            self.assertIn("先提及 1–2 个有具体证据的跨题优点", prompt)
            self.assertIn("严格按顺序", prompt)

    def test_role_extraction_and_qa_extraction_use_one_call(self):
        extraction = {
            "speakers": {"Speaker 0": "interviewer", "Speaker 1": "candidate"},
            "qa_pairs": [{"question": "介绍一下自己", "answer": "我做过一个项目。"}],
        }
        evaluated = {"qa_analysis": [{"question": "介绍一下自己", "answer": "我做过一个项目。"}]}
        with patch.object(main, "call_llm", side_effect=[json.dumps(extraction), json.dumps(evaluated)]) as call:
            result = main.analyze_interview("面试转录")

        self.assertEqual(call.call_count, 2)
        self.assertEqual(result["speakers"], extraction["speakers"])
        self.assertEqual(result["qa_pairs"], extraction["qa_pairs"])
        self.assertEqual(len(result["qa_analysis"]), 1)
        self.assertEqual(result["qa_analysis"][0]["question"], "介绍一下自己")
        self.assertEqual(result["overall_assessment"], "Good")

    def test_invalid_combined_extraction_fails_before_evaluation_call(self):
        with patch.object(main, "call_llm", return_value=json.dumps({"speakers": {}, "qa_pairs": []})) as call:
            with self.assertRaisesRegex(ValueError, "speakers"):
                main.analyze_interview("面试转录")
        self.assertEqual(call.call_count, 1)

    def test_invalid_analysis_output_is_rejected(self):
        extraction = {"speakers": {"Speaker 0": "interviewer"}, "qa_pairs": []}
        with patch.object(main, "call_llm", side_effect=[json.dumps(extraction), json.dumps({"qa_analysis": "invalid"})]):
            with self.assertRaisesRegex(ValueError, "qa_analysis"):
                main.analyze_interview("面试转录")

    def test_analysis_rejects_blank_transcript_without_running_model(self):
        response = asyncio.run(main.analyze_transcript({"transcript": " \n "}))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.body, b'{"error":"transcript is required"}')

    def test_analysis_failure_returns_error_for_frontend_retry(self):
        with patch.object(main, "analyze_interview", side_effect=ValueError("invalid model JSON")):
            response = asyncio.run(main.analyze_transcript({"transcript": "valid saved transcript"}))
        self.assertEqual(response.status_code, 500)
        self.assertIn("invalid model JSON", response.body.decode())

    def test_two_analysis_calls_log_stage_and_duration(self):
        extraction = {"speakers": {"Speaker 0": "interviewer"}, "qa_pairs": []}
        analysis = {"qa_analysis": [], "overall_summary": "信息有限。"}

        def response(payload):
            message = SimpleNamespace(content=json.dumps(payload, ensure_ascii=False))
            choice = SimpleNamespace(message=message)
            return SimpleNamespace(status_code=200, output=SimpleNamespace(choices=[choice]))

        with patch.object(main.dashscope.Generation, "call", side_effect=[response(extraction), response(analysis)]), self.assertLogs(main.logger, level="INFO") as captured:
            result = main.analyze_interview("mock interview transcript")

        self.assertEqual(result["overall_summary"], "信息有限。")
        logs = "\n".join(captured.output)
        self.assertIn("LLM stage=speaker_qa_extraction model=qwen-plus status=success duration_ms=", logs)
        self.assertIn("LLM stage=overall_question_analysis model=qwen-plus status=success duration_ms=", logs)
        self.assertNotIn("mock interview transcript", logs)

    def test_new_structured_feedback_and_overall_fields_are_preserved(self):
        result = main._validate_qa_analysis({
            "overall_assessment": "Excellent",
            "overall_summary": "多个回答都给出了具体行动和结果。",
            "overall_summary_points": [
                {"title": "表达结构", "detail": "多个回答都先给出结论。"},
                {"title": "表达结构", "detail": "多个回答都先给出结论。"},
                {"title": "结果", "detail": "多个回答都补充了实际结果。"},
            ],
            "qa_analysis": [{
                "question": "Q", "answer": "A", "overall_assessment": "Good",
                "summary": "本题点评。",
                "strengths": [{"point": "亮点", "evidence": "回答中的证据。"}],
                "improvements": [{"issue": "问题", "evidence": "对应内容。", "next_step": "具体行动。"}],
                "dimensions": {"Relevance": {"assessment": "Good", "explanation": "相关。"}},
            }],
        })
        self.assertEqual(result["overall_assessment"], "Excellent")
        self.assertEqual(result["overall_summary"], "多个回答都给出了具体行动和结果。")
        self.assertEqual(len(result["overall_summary_points"]), 2)
        self.assertEqual(result["overall_summary_points"][0]["title"], "表达结构")
        self.assertEqual(result["qa_analysis"][0]["strengths"][0]["evidence"], "回答中的证据。")
        self.assertEqual(result["qa_analysis"][0]["improvements"][0]["next_step"], "具体行动。")

    def test_grounded_reference_example_is_optional_and_preserved(self):
        result = main._validate_qa_analysis({
            "qa_analysis": [{
                "question": "Q", "answer": "A",
                "improvements": [{
                    "issue": "问题", "evidence": "回答依据", "next_step": "补充实际结果",
                    "example": "I achieved [replace with your actual result].",
                }],
            }],
        })
        self.assertEqual(
            result["qa_analysis"][0]["improvements"][0]["example"],
            "I achieved [replace with your actual result].",
        )

    def test_new_structured_improvement_does_not_duplicate_legacy_alias(self):
        next_step = "下一次先说明目标，再给出实际结果。"
        item = main._validate_qa_analysis({"qa_analysis": [{
            "question": "Q", "answer": "A",
            "improvements": [{"issue": "结果不足", "evidence": "没有提到结果", "next_step": next_step}],
            "suggested_improvement": next_step,
        }]})["qa_analysis"][0]
        self.assertEqual(len(item["improvements"]), 1)
        self.assertNotIn("suggested_improvement", item)

    def test_legacy_summary_stays_one_point_and_empty_summary_has_no_points(self):
        legacy = main._validate_qa_analysis({"overall_summary": "旧记录整体总结。", "qa_analysis": []})
        self.assertEqual(legacy["overall_summary_points"], [{"title": "", "detail": "旧记录整体总结。"}])
        empty = main._validate_qa_analysis({"overall_summary_points": [], "qa_analysis": []})
        self.assertEqual(empty["overall_summary_points"], [])

    def test_legacy_feedback_fields_are_normalized_for_old_records(self):
        result = main._validate_qa_analysis({
            "qa_analysis": [{
                "question": "Q", "answer": "A", "overall_assessment": "Needs Improvement",
                "analysis": "旧版点评", "strengths": ["旧版优点"],
                "areas_to_improve": ["旧版不足"], "suggested_improvement": "旧版建议",
            }],
        })
        item = result["qa_analysis"][0]
        self.assertEqual(result["overall_assessment"], "Needs Improvement")
        self.assertEqual(item["summary"], "旧版点评")
        self.assertEqual(item["strengths"], [{"point": "旧版优点", "evidence": ""}])
        self.assertEqual(item["improvements"], [{"issue": "旧版不足", "evidence": "", "next_step": "旧版建议"}])

    def test_invalid_overall_rating_uses_legacy_rating_rule(self):
        result = main._validate_qa_analysis({
            "overall_assessment": {"unexpected": True},
            "qa_analysis": [
                {"question": "Q1", "answer": "A1", "overall_assessment": "Excellent"},
                {"question": "Q2", "answer": "A2", "overall_assessment": "Needs Improvement"},
            ],
        })
        self.assertEqual(result["overall_assessment"], "Needs Improvement")
        self.assertEqual(result["overall_summary"], "")

    def test_empty_qa_and_empty_feedback_arrays_are_valid(self):
        empty = main._validate_qa_analysis({"qa_analysis": []})
        self.assertEqual(empty["overall_assessment"], "Good")
        self.assertEqual(empty["qa_analysis"], [])

        item = main._validate_qa_analysis({"qa_analysis": [{
            "question": "Q", "answer": "A", "strengths": [], "improvements": [],
        }]})["qa_analysis"][0]
        self.assertEqual(item["strengths"], [])
        self.assertEqual(item["improvements"], [])


class CoachContextTests(unittest.TestCase):
    def run_coach(self, payload, model_call):
        scope = {
            "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
            "method": "POST", "scheme": "http", "path": "/api/interviews/coach",
            "raw_path": b"/api/interviews/coach", "query_string": b"", "headers": [],
            "client": ("test", 123), "server": ("test", 80),
        }
        request = Request(scope)

        async def consume():
            response = await main.interview_coach(payload, request)
            chunks = []
            async for chunk in response.body_iterator:
                chunks.append(chunk)
            return response, b"".join(chunk if isinstance(chunk, bytes) else chunk.encode() for chunk in chunks)

        with patch.object(main.dashscope.Generation, "call", return_value=iter([model_call])) as call:
            result = asyncio.run(consume())
        return result, call

    def test_compact_context_drops_duplicate_transcript_and_raw_qa_pairs(self):
        analysis = {
            "transcript": "duplicate transcript",
            "speakers": {"Speaker 0": "interviewer"},
            "qa_pairs": [{"question": "raw duplicate", "answer": "raw duplicate"}],
            "qa_analysis": [{"question": "Q", "answer": "A", "analysis": "feedback", "unused": "drop"}],
        }
        result = main._compact_coach_analysis(analysis, "")
        self.assertEqual(result, {"qa_analysis": [{"question": "Q", "answer": "A", "analysis": "feedback"}]})

    def test_question_context_contains_only_the_selected_question(self):
        selected = {"question": "Q2", "answer": "A2", "analysis": "feedback 2"}
        result = main._compact_coach_analysis({"reference_detail": selected}, "Question 2")
        self.assertEqual(result, selected)

    def test_history_is_bounded_by_total_characters_and_keeps_recent_messages(self):
        history = [
            {"role": "user", "content": "old" * 2000},
            {"role": "assistant", "content": "recent" * 2000},
        ]
        result = main._trim_coach_history(history)
        self.assertLessEqual(sum(len(message["content"]) for message in result), main.COACH_HISTORY_MAX_CHARS)
        self.assertEqual(result[-1]["role"], "assistant")

    def test_whole_interview_prompt_contains_transcript_once_and_streams_once(self):
        delta = SimpleNamespace(
            status_code=200,
            output=SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="ok"))]),
        )
        payload = {
            "question": "整体有什么建议？", "reference": "", "history": [],
            "transcript": "RAW_TRANSCRIPT_ONCE",
            "analysis": {
                "transcript": "DUPLICATE_TRANSCRIPT_SHOULD_NOT_APPEAR",
                "qa_pairs": [{"question": "RAW_QA_SHOULD_NOT_APPEAR", "answer": "raw"}],
                "qa_analysis": [{"question": "Q", "answer": "A", "analysis": "feedback"}],
            },
        }
        with self.assertLogs(main.logger, level="INFO") as captured:
            (response, body), call = self.run_coach(payload, delta)
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"event: delta", body)
        self.assertIn(b"event: done", body)
        self.assertEqual(call.call_count, 1)
        self.assertEqual(call.call_args.kwargs["model"], "qwen-plus")
        prompt = call.call_args.kwargs["messages"][0]["content"]
        self.assertEqual(prompt.count("RAW_TRANSCRIPT_ONCE"), 1)
        self.assertNotIn("DUPLICATE_TRANSCRIPT_SHOULD_NOT_APPEAR", prompt)

    def test_coach_prompt_uses_language_of_focused_interview_answer(self):
        delta = SimpleNamespace(
            status_code=200,
            output=SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="Try this structure."))]),
        )
        payload = {
            "question": "How can I improve this?", "reference": "Question 1", "history": [],
            "transcript": "",
            "analysis": {"reference_detail": {
                "question": "Tell me about your approach.",
                "answer": "I first reviewed the user feedback and then proposed a solution.",
            }},
        }
        (_, _body), call = self.run_coach(payload, delta)
        prompt = call.call_args.kwargs["messages"][0]["content"]
        self.assertIn("本次面试的主要语言是 English", prompt)
        self.assertIn("建议和示例也必须遵循此语言", prompt)
        self.assertNotIn("RAW_QA_SHOULD_NOT_APPEAR", prompt)
        self.assertIn("Coach first_content status=success duration_ms=", "\n".join(captured.output))

    def test_question_specific_prompt_does_not_need_full_transcript(self):
        delta = SimpleNamespace(status_code=200, output=SimpleNamespace(choices=[]))
        payload = {
            "question": "如何改进？", "reference": "Question 2", "history": [], "transcript": "",
            "analysis": {"reference_detail": {"question": "Q2", "answer": "A2", "analysis": "feedback 2"}},
        }
        (response, _body), call = self.run_coach(payload, delta)
        self.assertEqual(response.status_code, 200)
        prompt = call.call_args.kwargs["messages"][0]["content"]
        self.assertIn("Q2", prompt)
        self.assertIn("A2", prompt)
        self.assertNotIn("DUPLICATE_TRANSCRIPT", prompt)


if __name__ == "__main__":
    unittest.main()
