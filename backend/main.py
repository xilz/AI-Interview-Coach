import os
import json
import logging
import tempfile
import time
from fractions import Fraction
from pathlib import Path
from collections.abc import Iterator

import dashscope
from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, Request
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi import HTTPException

try:
    import av
except ImportError:  # Report a useful error if the declared audio dependency is missing.
    av = None

load_dotenv()
dashscope.api_key = os.getenv("DASHSCOPE_API_KEY")

app = FastAPI()
logger = logging.getLogger(__name__)

MAX_UPLOAD_BYTES = 100 * 1024 * 1024
ASR_MAX_BYTES = 10 * 1024 * 1024
ASR_MAX_SECONDS = 5 * 60
# 4:45 leaves headroom beneath the strict five minute limit and WAV's 10 MB limit.
CHUNK_SECONDS = ASR_MAX_SECONDS - 15
TARGET_SAMPLE_RATE = 16_000


class AudioProcessingError(Exception):
    pass


class ASRSegmentError(Exception):
    def __init__(self, segment_number, detail):
        self.segment_number = segment_number
        super().__init__(f"第 {segment_number} 段转录失败：{detail}")


def _convert_and_split(source: Path, workdir: Path) -> list[Path]:
    """Decode any PyAV-supported audio, resample to mono 16 kHz PCM WAV, split safely."""
    if av is None:
        raise AudioProcessingError("缺少音频处理依赖 PyAV，请在 backend 目录运行 pip install -r requirements.txt")
    segments: list[Path] = []
    segment_index = 0
    output = None
    output_stream = None
    segment_samples = 0
    samples_per_chunk = CHUNK_SECONDS * TARGET_SAMPLE_RATE
    resampler = av.AudioResampler(format="s16", layout="mono", rate=TARGET_SAMPLE_RATE)

    def close_segment():
        nonlocal output, output_stream
        if output is not None:
            for packet in output_stream.encode(None):
                output.mux(packet)
            output.close()
            output = output_stream = None

    def write_frame(frame):
        nonlocal output, output_stream, segment_index, segment_samples
        data = frame.to_ndarray().reshape(-1)
        offset = 0
        while offset < len(data):
            if output is None:
                segment_index += 1
                path = workdir / f"segment-{segment_index:04d}.wav"
                output = av.open(str(path), mode="w", format="wav")
                output_stream = output.add_stream("pcm_s16le", rate=TARGET_SAMPLE_RATE)
                output_stream.layout = "mono"
                segments.append(path)
                segment_samples = 0
            count = min(len(data) - offset, samples_per_chunk - segment_samples)
            part = data[offset:offset + count].copy()
            frame_out = av.AudioFrame.from_ndarray(part.reshape(1, -1), format="s16", layout="mono")
            frame_out.sample_rate = TARGET_SAMPLE_RATE
            frame_out.pts = segment_samples
            frame_out.time_base = Fraction(1, TARGET_SAMPLE_RATE)
            for packet in output_stream.encode(frame_out):
                output.mux(packet)
            segment_samples += count
            offset += count
            if segment_samples >= samples_per_chunk:
                close_segment()

    try:
        with av.open(str(source)) as container:
            if not container.streams.audio:
                raise AudioProcessingError("上传文件中没有音轨")
            for frame in container.decode(audio=0):
                for converted in resampler.resample(frame):
                    write_frame(converted)
            for converted in resampler.resample(None):
                write_frame(converted)
        close_segment()
    except AudioProcessingError:
        raise
    except Exception as exc:
        close_segment()
        logger.exception("Audio decoding/conversion failed")
        raise AudioProcessingError("无法读取音频文件，请确认文件未损坏且格式受支持") from exc

    if not segments:
        raise AudioProcessingError("音频文件为空或没有可识别的音频内容")
    for index, path in enumerate(segments, start=1):
        if path.stat().st_size > ASR_MAX_BYTES:
            raise AudioProcessingError(f"第 {index} 段转换后仍超过模型 10 MB 限制")
    return segments


def _transcribe_segment(path: Path) -> str:
    response = dashscope.MultiModalConversation.call(
        model="qwen3-asr-flash",
        messages=[{"role": "user", "content": [{"audio": f"file://{path.resolve()}"}]}],
        result_format="message",
    )
    if getattr(response, "status_code", None) != 200:
        raise RuntimeError(getattr(response, "message", "ASR 服务返回失败"))
    try:
        text = response.output.choices[0].message.content[0]["text"]
    except (AttributeError, IndexError, KeyError, TypeError) as exc:
        raise RuntimeError("ASR 返回内容格式异常") from exc
    if not isinstance(text, str):
        raise RuntimeError("ASR 返回内容不是文本")
    return text.strip()


def _detect_primary_language(text: str) -> str | None:
    """Detect whether Chinese Han characters or Latin letters dominate the transcript."""
    han_count = sum("\u3400" <= char <= "\u9fff" for char in text)
    latin_count = sum(char.isascii() and char.isalpha() for char in text)
    if not han_count and not latin_count:
        return None
    return "Chinese" if han_count >= latin_count else "English"

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def root():
    return {"message": "AI Interview Coach API is running"}


def call_llm(prompt, stage="analysis"):
    started_at = time.perf_counter()
    try:
        response = dashscope.Generation.call(
            model="qwen-plus",
            prompt=prompt,
            result_format="message"
        )
        if response.status_code != 200:
            raise RuntimeError("qwen-plus returned a non-success status")
        content = response.output.choices[0].message.content
    except Exception:
        logger.warning(
            "LLM stage=%s model=qwen-plus status=failed duration_ms=%.1f",
            stage, (time.perf_counter() - started_at) * 1000,
        )
        raise

    logger.info(
        "LLM stage=%s model=qwen-plus status=success duration_ms=%.1f",
        stage, (time.perf_counter() - started_at) * 1000,
    )
    return content


def extract_json(text):
    text = text.strip()

    if text.startswith("```"):
        text = text.replace("```json", "").replace("```", "").strip()

    return json.loads(text)


def _validate_extraction_result(value):
    if not isinstance(value, dict):
        raise ValueError("Q&A 提取结果必须是 JSON 对象")
    speakers = value.get("speakers")
    if not isinstance(speakers, dict) or not speakers:
        raise ValueError("Q&A 提取结果缺少有效的 speakers 对象")
    if any(not isinstance(role, str) or role not in {"interviewer", "candidate"} for role in speakers.values()):
        raise ValueError("speakers 中的角色只能是 interviewer 或 candidate")
    qa_pairs = value.get("qa_pairs")
    if not isinstance(qa_pairs, list):
        raise ValueError("Q&A 提取结果缺少 qa_pairs 数组")
    for index, pair in enumerate(qa_pairs, start=1):
        if not isinstance(pair, dict) or not isinstance(pair.get("question"), str) or not isinstance(pair.get("answer"), str):
            raise ValueError(f"第 {index} 组 Q&A 必须包含字符串 question 和 answer")
    return {"speakers": speakers, "qa_pairs": qa_pairs}


VALID_ASSESSMENTS = {"Excellent", "Good", "Needs Improvement"}


def _fallback_assessment(qa_analysis):
    ratings = [item.get("overall_assessment") for item in qa_analysis]
    if "Needs Improvement" in ratings:
        return "Needs Improvement"
    if ratings and all(rating == "Excellent" for rating in ratings):
        return "Excellent"
    return "Good"


def _normalize_strengths(value):
    if not isinstance(value, list):
        return []
    normalized = []
    for item in value:
        if isinstance(item, str) and item.strip():
            normalized.append({"point": item.strip(), "evidence": ""})
        elif isinstance(item, dict) and isinstance(item.get("point"), str) and item["point"].strip():
            evidence = item.get("evidence", "")
            if isinstance(evidence, str) and evidence.strip():
                normalized.append({"point": item["point"].strip(), "evidence": evidence.strip()})
    return normalized


def _normalize_improvements(value, legacy_areas, legacy_next_step):
    normalized = []
    if isinstance(value, list):
        for item in value:
            if not isinstance(item, dict) or not isinstance(item.get("issue"), str) or not item["issue"].strip():
                continue
            evidence = item.get("evidence", "")
            next_step = item.get("next_step", "")
            if not isinstance(evidence, str) or not evidence.strip() or not isinstance(next_step, str) or not next_step.strip():
                continue
            normalized.append({
                "issue": item["issue"].strip(),
                "evidence": evidence.strip(),
                "next_step": next_step.strip(),
                **({"example": item["example"].strip()} if isinstance(item.get("example"), str) and item["example"].strip() else {}),
            })
    if normalized or not isinstance(legacy_areas, list):
        return normalized
    for issue in legacy_areas:
        if isinstance(issue, str) and issue.strip():
            normalized.append({
                "issue": issue.strip(),
                "evidence": "",
                "next_step": legacy_next_step if isinstance(legacy_next_step, str) else "",
            })
    return normalized


def _normalize_summary_points(value, summary):
    points = []
    seen = set()
    if isinstance(value, list):
        for item in value:
            if isinstance(item, str) and item.strip():
                point = {"title": "", "detail": item.strip()}
            elif isinstance(item, dict):
                title = item.get("title", "")
                detail = item.get("detail", item.get("summary", ""))
                if isinstance(detail, str) and detail.strip():
                    point = {
                        "title": title.strip() if isinstance(title, str) else "",
                        "detail": detail.strip(),
                    }
                else:
                    continue
            else:
                continue
            key = (point["title"].casefold(), " ".join(point["detail"].casefold().split()))
            if key not in seen:
                seen.add(key)
                points.append(point)
    if points:
        return points[:4]
    if isinstance(summary, str) and summary.strip():
        # Old records have one prose summary. Keep it intact instead of splitting sentences heuristically.
        return [{"title": "", "detail": summary.strip()}]
    return []


def _validate_qa_analysis(value):
    if not isinstance(value, dict) or not isinstance(value.get("qa_analysis"), list):
        raise ValueError("逐题分析结果缺少 qa_analysis 数组")
    normalized_items = []
    for index, source in enumerate(value["qa_analysis"], start=1):
        if not isinstance(source, dict) or not isinstance(source.get("question"), str) or not isinstance(source.get("answer"), str):
            raise ValueError(f"第 {index} 条逐题分析缺少有效的 question 或 answer")
        item = dict(source)
        rating = item.get("overall_assessment")
        item["overall_assessment"] = rating if isinstance(rating, str) and rating in VALID_ASSESSMENTS else "Good"
        summary = item.get("summary")
        if not isinstance(summary, str) or not summary.strip():
            summary = item.get("analysis", "")
        item["summary"] = summary.strip() if isinstance(summary, str) else ""
        item["analysis"] = item["summary"]
        item["strengths"] = _normalize_strengths(item.get("strengths"))
        has_structured_improvements = isinstance(item.get("improvements"), list)
        item["improvements"] = _normalize_improvements(
            item.get("improvements"), item.get("areas_to_improve"), item.get("suggested_improvement", "")
        )
        # Keep legacy fields available to any existing consumers and saved records.
        item["areas_to_improve"] = [improvement["issue"] for improvement in item["improvements"]]
        if has_structured_improvements:
            # New responses carry each action only once in improvements[].next_step.
            item.pop("suggested_improvement", None)
        else:
            item["suggested_improvement"] = " ".join(
                improvement["next_step"] for improvement in item["improvements"] if improvement["next_step"]
            )
        normalized_items.append(item)

    rating = value.get("overall_assessment")
    if not isinstance(rating, str) or rating not in VALID_ASSESSMENTS:
        rating = _fallback_assessment(normalized_items)
    summary = value.get("overall_summary")
    summary = summary.strip() if isinstance(summary, str) else ""
    return {
        "overall_assessment": rating,
        "overall_summary": summary,
        "overall_summary_points": _normalize_summary_points(value.get("overall_summary_points"), summary),
        "qa_analysis": normalized_items,
    }


def analyze_interview(transcript):
    analysis_started_at = time.perf_counter()
    analysis_status = "failed"
    qa_count = 0
    try:
        result = _analyze_interview(transcript)
        analysis_status = "success"
        qa_count = len(result.get("qa_pairs", []))
        return result
    finally:
        logger.info(
            "Interview analysis status=%s qa_count=%d duration_ms=%.1f",
            analysis_status, qa_count, (time.perf_counter() - analysis_started_at) * 1000,
        )


def _analyze_interview(transcript):
    primary_language = _detect_primary_language(transcript)
    if primary_language:
        language_instruction = f"本次面试的主要语言是 {primary_language}。所有新生成的自然语言字段（整体总结、总结要点、逐题点评、优缺点、依据、建议、维度说明和示例回答）都必须使用 {primary_language}。"
    else:
        language_instruction = "请根据真实问答判断最主要的可识别语言；所有新生成的自然语言字段都使用该主要语言，不要默认使用英文或中文。"
    extraction_prompt = f"""
你是一个严谨的面试对话整理助手。请按顺序完成说话人角色识别和问答提取，并且只返回一个合法 JSON 对象。

面试对话：
{transcript}

要求：
1. 判断转录中每个 speaker 的角色，只能是 interviewer 或 candidate；保留转录中使用的 speaker 名称作为对象键。
2. 依据上述角色识别，找出面试官提出的问题及候选人对应的回答，按问题出现顺序输出。
3. question 和 answer 必须尽量逐字保留原转录内容，不要润色或补写；无法确定对应关系时不要编造配对。
4. 不要把面试官追问误作候选人回答，也不要把候选人的反问当成新的面试题。

输出结构必须严格为：
{{
  "speakers": {{"Speaker 0": "interviewer", "Speaker 1": "candidate"}},
  "qa_pairs": [{{"question": "面试官原问题", "answer": "候选人原回答"}}]
}}
"""

    extracted = _validate_extraction_result(extract_json(call_llm(extraction_prompt, stage="speaker_qa_extraction")))


    sample_output = ({
        "overall_assessment": "Good",
        "overall_summary": "Across the interview, answers were generally clear. The strongest recurring point was [evidence-backed strength]; the main priority is [evidence-backed improvement].",
        "overall_summary_points": [
            {"title": "Strength", "detail": "A recurring, evidence-backed strength."},
            {"title": "Priority", "detail": "The most important recurring improvement."},
        ],
        "qa_analysis": [{
            "question": "Interviewer question", "answer": "Candidate's original answer",
            "overall_assessment": "Good", "summary": "A concise, balanced impression.",
            "strengths": [],
            "improvements": [{"issue": "Issue", "evidence": "Evidence from the answer", "next_step": "A specific next action", "example": "A short example using [your real detail]."}],
            "dimensions": {name: {"assessment": "Good", "explanation": "Evidence-based explanation."} for name in ("Relevance", "Structure", "Specificity", "Depth", "Communication")},
        }],
    } if primary_language == "English" else {
        "overall_assessment": "Good",
        "overall_summary": "整场回答整体清楚。反复出现的优点是【有依据的优点】；最值得优先改进的是【有依据的问题】。",
        "overall_summary_points": [
            {"title": "优点", "detail": "有证据支持的跨题表现优点。"},
            {"title": "优先改进", "detail": "最重要的跨题改进方向。"},
        ],
        "qa_analysis": [{
            "question": "面试官原问题", "answer": "候选人原回答",
            "overall_assessment": "Good", "summary": "简洁、平衡的整体点评。",
            "strengths": [],
            "improvements": [{"issue": "问题", "evidence": "回答中的依据", "next_step": "具体的下一步行动", "example": "用【真实信息】替换占位符的简短参考表达。"}],
            "dimensions": {name: {"assessment": "Good", "explanation": "基于回答证据的说明。"} for name in ("Relevance", "Structure", "Specificity", "Depth", "Communication")},
        }],
    })

    analysis_prompt = f"""
你是一名亲切、耐心、实用的 AI 面试教练。

你的目标是基于下面的真实问答，为整场面试和每一道题分别生成简洁、具体、可信的反馈。

请像一位面试结束后认真帮助学生复盘的教练一样交流。
不要像论文评审、考试评分系统或企业绩效报告一样说话。

【沟通风格】

1. {language_instruction}
   使用自然、清晰、容易理解的表达。
2. 语气友善、尊重、鼓励，但不要为了安慰用户而盲目夸奖。
3. 先说清楚回答中值得肯定的地方，再解释最重要的问题。
4. 避免晦涩的专业术语、抽象概念、冗长句子和官话。
5. 如果使用专业术语，必须用简单语言解释其含义。
6. 不要反复说“缺乏深度”“逻辑性不足”“有待提升”等空泛结论。
   必须说明具体是哪句话、哪类信息或哪个环节需要改进。
7. 优先提出一到两个最重要的改进建议，不要一次列出太多任务。
8. 每条建议都应具体、可执行，让候选人知道下一次应该做什么。
9. 评价回答时要结合当前问题，不要对所有问题套用同一套建议。
10. 直接对候选人说“你”，不要使用“该候选人”等生硬表达。

【分析维度】

1. Relevance：是否回答了面试官真正想问的问题。
2. Structure：回答是否有清晰的组织顺序。
3. Specificity：是否提供了具体事实、真实经历或实际例子。
4. Depth：是否解释了原因、思考过程或结果。
5. Communication：文字转录中体现出的表达是否清楚、简洁。

只评价能够从当前回答中观察到的内容。
不能通过文字转录判断的眼神、表情、肢体语言等，不得评价。

【真实性规则】

1. 只能依据候选人的原始回答进行分析。
2. 不得虚构候选人做过的项目、实习、工作、课程或技术任务。
3. 不得编造数据、团队人数、项目成果或个人经历。
4. 如果缺少具体例子，可以建议候选人补充一个自己真实经历过的例子。
5. 如果回答信息较少，只能说当前回答提供的信息有限，不得据此断言候选人能力不足。
6. 改进示例只能帮助候选人组织表达，不能冒充候选人的真实经历。
7. 不要过度关注“呃”“嗯”等口头填充词；只有明显影响表达时才提出建议。
8. 不要预测面试通过率，也不要输出数字分数。

【评价标签】

overall_assessment 只能是以下三种之一：
- Excellent
- Good
- Needs Improvement

请根据当前回答的实际表现判断，不要为了鼓励用户而一律给出 Excellent。

【输出要求】

请先逐题评估所有问答，再根据这些逐题证据归纳整场表现。生成以下字段：

- 顶层 overall_assessment：整场面试等级，只能为 Excellent、Good 或 Needs Improvement。
- 顶层 overall_summary：一段简洁总结整场反复出现的表现特点，兼容旧版文本字段。只总结整体模式，不逐题罗列，不重复单题条目；必须能从这些问答中找到依据。先提及 1–2 个有具体证据的跨题优点，再简洁概括整体表现，最后自然引出最值得优先改进的问题。优点证据不足时不得编造，应如实说明信息有限。
- 顶层 overall_summary_points：2–4 个结构化要点，每项包含 title 和 detail。严格按顺序：先列 1–2 个有具体证据的跨题优点，再用一项概括整场表现，最后用一项指出最优先的改进；证据不足时跳过无依据的类别，不要凑数或重复相近观点。总结回答结构、技术解释、举例或表达清晰度等跨题模式，不逐题罗列。
- qa_analysis：每个问答一项，保留 question 和 answer 原文，并生成 overall_assessment、summary、strengths、improvements、dimensions。
- summary：用一到两句自然语言解释回答给面试官留下的整体印象及其影响；不足和依据由 improvements 具体说明。回答表现良好时如实说明，不要刻意批评。不要复述整场总结，也不要重复 improvements 或 next_step。
- strengths：数组，每项包含 point 和 evidence。point 是具体亮点；evidence 必须引用或忠实概括候选人实际回答。没有可靠亮点时返回空数组。
- improvements：数组，每项包含 issue、evidence、next_step，可选 example。evidence 必须来自实际回答；next_step 必须是可执行动作，而不是“更具体”“加强逻辑”等空泛表达。example 仅在回答内容足以支持时提供与面试主要语言一致的简短参考表达，不得添加候选人未提及的经历或成果；需要真实信息时使用明确占位符。没有可靠问题时返回空数组。
- dimensions：保留五个维度的 assessment 和 explanation，作为次级评价。

维度的 assessment 也只能使用：
Excellent、Good、Needs Improvement。

【真实面试 Q&A】

{json.dumps({"qa_pairs": extracted["qa_pairs"]}, ensure_ascii=False)}

不得编造回答中没有的事实、优点、问题或证据；不得把 AI 建议写成候选人说过的话。所有字符串使用普通文本，不要包含 Markdown 标记。请严格返回合法 JSON，不要添加代码块或 JSON 之外的解释。

输出格式如下，字段结构必须一致：

{json.dumps(sample_output, ensure_ascii=False, indent=2)}
"""

    analysis = _validate_qa_analysis(extract_json(call_llm(analysis_prompt, stage="overall_question_analysis")))

    return {
        "speakers": extracted["speakers"],
        "qa_pairs": extracted["qa_pairs"],
        **analysis,
    }


@app.post("/api/interviews/upload")
async def upload_interview(file: UploadFile = File(...)):
    upload_started_at = time.perf_counter()
    upload_status = "failed"
    original_name = Path(file.filename or "audio").name.replace("\x00", "")[:255]
    try:
        with tempfile.TemporaryDirectory(prefix="interview-asr-") as temp_dir:
            workdir = Path(temp_dir)
            source = workdir / "upload.bin"
            size = 0
            with source.open("wb") as destination:
                while chunk := await file.read(1024 * 1024):
                    size += len(chunk)
                    if size > MAX_UPLOAD_BYTES:
                        raise HTTPException(status_code=413, detail="音频文件不能超过 100 MB")
                    destination.write(chunk)
            if size == 0:
                raise HTTPException(status_code=400, detail="上传文件为空")
            conversion_started_at = time.perf_counter()
            try:
                segments = _convert_and_split(source, workdir)
            except AudioProcessingError as exc:
                logger.warning(
                    "Audio conversion status=failed duration_ms=%.1f",
                    (time.perf_counter() - conversion_started_at) * 1000,
                )
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            logger.info(
                "Audio conversion status=success segment_count=%d duration_ms=%.1f",
                len(segments), (time.perf_counter() - conversion_started_at) * 1000,
            )

            transcript_parts = []
            for number, segment in enumerate(segments, start=1):
                segment_started_at = time.perf_counter()
                logger.info("ASR segment=%d/%d status=started", number, len(segments))
                try:
                    segment_text = _transcribe_segment(segment)
                    if not isinstance(segment_text, str) or not segment_text.strip():
                        raise RuntimeError("该分段未返回有效转录文本")
                except Exception as exc:
                    logger.warning(
                        "ASR segment=%d/%d status=failed duration_ms=%.1f",
                        number, len(segments), (time.perf_counter() - segment_started_at) * 1000,
                    )
                    raise ASRSegmentError(number, str(exc)) from exc
                transcript_parts.append(segment_text.strip())
                logger.info(
                    "ASR segment=%d/%d status=success duration_ms=%.1f",
                    number, len(segments), (time.perf_counter() - segment_started_at) * 1000,
                )

            transcript = "\n".join(transcript_parts)
            if not transcript.strip():
                upload_status = "empty_transcript"
                raise HTTPException(status_code=422, detail="未识别到有效语音文本，请确认录音包含清晰人声后重新上传")
            upload_status = "success"
            return {"filename": original_name, "transcript": transcript}
    except HTTPException as exc:
        upload_status = f"http_{exc.status_code}"
        return JSONResponse(status_code=exc.status_code, content={"error": exc.detail})
    except ASRSegmentError as exc:
        upload_status = "asr_segment_failed"
        return JSONResponse(status_code=502, content={"error": str(exc), "segment": exc.segment_number})
    except Exception:
        upload_status = "failed"
        return JSONResponse(status_code=500, content={"error": "转录服务暂时不可用，请稍后重试"})
    finally:
        await file.close()
        logger.info(
            "Upload/transcription status=%s duration_ms=%.1f",
            upload_status, (time.perf_counter() - upload_started_at) * 1000,
        )


@app.post("/api/interviews/analyze")
async def analyze_transcript(data: dict):
    transcript = data.get("transcript")

    if not isinstance(transcript, str) or not transcript.strip():
        return JSONResponse(
            status_code=400,
            content={"error": "transcript is required"}
        )

    try:
        result = analyze_interview(transcript)

        return {
            "transcript": transcript,
            **result
        }

    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": str(e)}
        )


def _sse_event(event: str, payload: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


COACH_HISTORY_MAX_CHARS = 8_000
COACH_HISTORY_MAX_MESSAGES = 12
COACH_ANALYSIS_FIELDS = (
    "question", "answer", "overall_assessment", "summary", "analysis", "dimensions",
    "strengths", "improvements", "areas_to_improve", "suggested_improvement",
)


def _compact_coach_analysis(analysis: dict, reference: str):
    qa_analysis = analysis.get("qa_analysis")
    reference_detail = analysis.get("reference_detail")
    if not isinstance(reference_detail, dict) and isinstance(qa_analysis, list):
        if reference.startswith("Question "):
            try:
                index = int(reference.split()[-1]) - 1
                if 0 <= index < len(qa_analysis) and isinstance(qa_analysis[index], dict):
                    reference_detail = qa_analysis[index]
            except (ValueError, IndexError):
                pass

    def compact(item):
        if not isinstance(item, dict):
            return None
        return {key: item[key] for key in COACH_ANALYSIS_FIELDS if key in item}

    if isinstance(reference_detail, dict):
        return compact(reference_detail)
    if isinstance(qa_analysis, list):
        return {"qa_analysis": [item for item in (compact(entry) for entry in qa_analysis) if item is not None]}
    # Older clients may send the complete analysis envelope. Exclude its transcript,
    # raw qa_pairs, and speaker map; qa_analysis contains the evaluated Q&A content.
    return {"qa_analysis": []}


def _trim_coach_history(history: list):
    selected = []
    remaining = COACH_HISTORY_MAX_CHARS
    for message in reversed(history[-COACH_HISTORY_MAX_MESSAGES:]):
        content = message["content"]
        if not content or remaining <= 0:
            continue
        if len(content) > remaining:
            content = content[-remaining:]
        selected.append({"role": message["role"], "content": content})
        remaining -= len(content)
    return list(reversed(selected))


@app.post("/api/interviews/coach")
async def interview_coach(data: dict, request: Request):
    question = data.get("question", "")
    if not isinstance(question, str):
        question = ""
    question = question.strip()
    reference = data.get("reference", "")
    if not isinstance(reference, str):
        reference = ""
    transcript = data.get("transcript", "")
    analysis = data.get("analysis", {})
    history = data.get("history", [])

    if not question:
        return JSONResponse(
            status_code=400,
            content={"error": "question is required"}
        )

    if not isinstance(transcript, str):
        transcript = ""
    if len(question) > 4000 or len(transcript) > 120000:
        return JSONResponse(status_code=413, content={"error": "Question or transcript is too long"})
    if not isinstance(analysis, dict):
        analysis = {}
    context = _compact_coach_analysis(analysis, reference)
    reference_detail = context if isinstance(context, dict) and "question" in context and "answer" in context else None
    if not transcript.strip() and not reference_detail:
        return JSONResponse(status_code=400, content={"error": "transcript or a valid question analysis is required"})
    if not isinstance(history, list):
        return JSONResponse(status_code=400, content={"error": "history must be a list"})
    clean_history = []
    for message in history:
        if not isinstance(message, dict) or message.get("role") not in ("user", "assistant") or not isinstance(message.get("content"), str):
            return JSONResponse(status_code=400, content={"error": "history contains an invalid message"})
        content = message["content"].strip()
        if content:
            clean_history.append({"role": message["role"], "content": content})
    clean_history = _trim_coach_history(clean_history)

    language_source = transcript if transcript.strip() else json.dumps(context, ensure_ascii=False)
    primary_language = _detect_primary_language(language_source)
    language_instruction = (
        f"本次面试的主要语言是 {primary_language}，请用该语言回答，建议和示例也必须遵循此语言。"
        if primary_language else
        "请根据当前面试问答判断主要语言，并用该语言回答；不要默认使用英文或中文。"
    )

    try:
        context_json = json.dumps(context, ensure_ascii=False, separators=(",", ":"))
        interview_record = transcript if transcript.strip() else "当前追问针对的原始问题和回答已列在相关分析中。"

        system_prompt = f"""
你是一名亲切、耐心、实用的 AI 面试教练。

你的任务是帮助用户理解自己的面试表现，并给出具体、可执行的建议。

【沟通要求】
1. {language_instruction} 使用自然、清晰、容易理解的表达。
2. 像一位认真帮助学生复盘面试的教练一样交流，不要像正式评审报告。
3. 先直接回答用户的问题，再解释原因。
4. 尽量结合用户真实的面试回答和分析结果。
5. 建议具体、简洁，不要一次提出太多改进任务。
6. 不要为了鼓励用户而盲目夸奖。

【真实性要求】
1. 只能依据提供的面试记录和分析内容。
2. 绝对不能编造用户的个人经历、项目、实习、工作、课程、数据或成果。
3. 即使是为了举例，也不能使用第一人称虚构经历，例如“我曾经做过……”。
4. 如果需要示范回答，可以使用以下方式：
   - 提供不包含虚构事实的回答结构；
   - 使用明确的占位符，例如“我曾经在【真实经历】中……”；
   - 告诉用户应该补充哪类真实信息，而不是替用户编造内容。
5. 如果用户没有提供相关经历，应明确告诉用户可以从自己的真实学习、项目或生活经历中寻找例子。
6. 如果现有信息不足，请直接说明，不要猜测。
7. 如果用户纠正了之前的分析，应认真检查相关证据，不要机械地重复原结论。

【面试记录】
{interview_record}

【相关分析】
{context_json}

【当前关注的问题】
{reference or "整场面试"}

【用户的追问】

请直接给出回答，不要输出 JSON，也不要重复整份面试分析。
"""
        messages = [{"role": "system", "content": system_prompt}]
        messages.extend(clean_history)
        messages.append({"role": "user", "content": question})

        coach_started_at = time.perf_counter()

        def stream_answer() -> Iterator[str]:
            first_content_logged = False
            try:
                # DashScope SDK's stream=True returns provider-generated chunks;
                # incremental_output=True ensures each chunk is newly generated text.
                chunks = dashscope.Generation.call(
                    model="qwen-plus",
                    messages=messages,
                    result_format="message",
                    stream=True,
                    incremental_output=True,
                )
                for chunk in chunks:
                    if chunk.status_code != 200:
                        logger.warning(
                            "Coach stream status=failed duration_ms=%.1f",
                            (time.perf_counter() - coach_started_at) * 1000,
                        )
                        yield _sse_event("error", {"message": "AI Coach 暂时无法回答，请稍后重试。"})
                        return
                    choices = getattr(getattr(chunk, "output", None), "choices", None) or []
                    if not choices:
                        continue
                    message = getattr(choices[0], "message", None)
                    content = getattr(message, "content", "") if message else ""
                    if isinstance(content, str) and content:
                        if not first_content_logged:
                            logger.info(
                                "Coach first_content status=success duration_ms=%.1f",
                                (time.perf_counter() - coach_started_at) * 1000,
                            )
                            first_content_logged = True
                        yield _sse_event("delta", {"text": content})
                if not first_content_logged:
                    logger.info(
                        "Coach stream status=completed_without_content duration_ms=%.1f",
                        (time.perf_counter() - coach_started_at) * 1000,
                    )
                yield _sse_event("done", {})
            except GeneratorExit:
                raise
            except Exception:
                # Do not expose SDK exception details, which may contain request metadata.
                logger.warning(
                    "Coach stream status=failed duration_ms=%.1f",
                    (time.perf_counter() - coach_started_at) * 1000,
                )
                yield _sse_event("error", {"message": "AI Coach 连接中断，请重试。"})

        return StreamingResponse(
            stream_answer(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
        )
    except Exception:
        return JSONResponse(status_code=500, content={"error": "AI Coach is temporarily unavailable"})
