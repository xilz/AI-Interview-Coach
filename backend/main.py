import os
import json
from collections.abc import Iterator

import dashscope
from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, Request
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()
dashscope.api_key = os.getenv("DASHSCOPE_API_KEY")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def root():
    return {"message": "AI Interview Coach API is running"}


def call_llm(prompt):
    response = dashscope.Generation.call(
        model="qwen-plus",
        prompt=prompt,
        result_format="message"
    )

    if response.status_code != 200:
        raise Exception(response.message)

    return response.output.choices[0].message.content


def extract_json(text):
    text = text.strip()

    if text.startswith("```"):
        text = text.replace("```json", "").replace("```", "").strip()

    return json.loads(text)


def analyze_interview(transcript):
    role_prompt = f"""
你是一个面试对话分析助手。

下面是一段面试对话：

{transcript}

请判断每个 speaker 的角色。

只能从以下两个角色中选择：
- interviewer
- candidate

请严格输出 JSON：

{{
  "speakers": {{
    "Speaker 0": "interviewer",
    "Speaker 1": "candidate"
  }}
}}
"""

    roles = extract_json(call_llm(role_prompt))

    qa_prompt = f"""
你是一个面试对话整理助手。

下面是一段已经完成说话人识别的面试对话：

{transcript}

说话人角色：
{json.dumps(roles, ensure_ascii=False)}

请完成以下任务：

1. 找出每一个面试官提出的问题。
2. 找出候选人对应的回答。
3. 将每一组问题和回答整理成一个 Q&A。
4. 不要修改候选人的原始回答内容。
5. 按照问题出现的顺序输出。

请严格输出 JSON：

{{
  "qa_pairs": [
    {{
      "question": "面试官的问题",
      "answer": "候选人的原始回答"
    }}
  ]
}}
"""

    qa_pairs = extract_json(call_llm(qa_prompt))


    analysis_prompt = f"""
你是一名亲切、耐心、实用的 AI 面试教练。

你的目标不是评判候选人是否优秀，而是帮助候选人理解：
1. 这道题目前回答得怎么样。
2. 哪些地方做得不错。
3. 最值得改进的问题是什么。
4. 下一次具体可以怎么回答得更好。

请像一位面试结束后认真帮助学生复盘的教练一样交流。
不要像论文评审、考试评分系统或企业绩效报告一样说话。

【沟通风格】

1. 使用自然、清晰、容易理解的中文。
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

请为每组 Q&A 生成以下字段：

- question：面试官的原始问题。
- answer：候选人的原始回答，不要改写。
- overall_assessment：Excellent、Good 或 Needs Improvement。
- analysis：用自然中文解释整体表现。先说明回答中值得肯定的地方，再指出最重要的不足及其原因。不要写成正式评审报告。
- dimensions：五个维度的评价，每个维度包含 assessment 和 explanation。
- strengths：一到两条具体优点，使用字符串数组。
- areas_to_improve：一到两条最重要的改进点，使用字符串数组。
- suggested_improvement：一段简洁、自然、具体的改进建议，使用字符串，不要虚构个人经历。

维度的 assessment 也只能使用：
Excellent、Good、Needs Improvement。

【真实面试 Q&A】

{json.dumps(qa_pairs, ensure_ascii=False)}

请严格返回合法 JSON，不要添加 Markdown 代码块或 JSON 之外的解释。

输出格式如下：

{{
  "qa_analysis": [
    {{
      "question": "面试官的问题",
      "answer": "候选人的原始回答",
      "overall_assessment": "Good",
      "analysis": "你的回答方向是对的，因为……不过，目前还缺少……这会让面试官不容易了解……",
      "dimensions": {{
        "Relevance": {{
          "assessment": "Good",
          "explanation": "用简单的中文解释评价依据"
        }},
        "Structure": {{
          "assessment": "Good",
          "explanation": "用简单的中文解释评价依据"
        }},
        "Specificity": {{
          "assessment": "Needs Improvement",
          "explanation": "用简单的中文解释评价依据"
        }},
        "Depth": {{
          "assessment": "Needs Improvement",
          "explanation": "用简单的中文解释评价依据"
        }},
        "Communication": {{
          "assessment": "Good",
          "explanation": "用简单的中文解释评价依据"
        }}
      }},
      "strengths": [
        "具体的优点"
      ],
      "areas_to_improve": [
        "最值得改进的地方"
      ],
      "suggested_improvement": "给出一到两个具体、可执行的建议。"
    }}
  ]
}}
"""

    analysis = extract_json(call_llm(analysis_prompt))

    return {
        "speakers": roles["speakers"],
        "qa_pairs": qa_pairs["qa_pairs"],
        "qa_analysis": analysis["qa_analysis"]
    }


@app.post("/api/interviews/upload")
async def upload_interview(file: UploadFile = File(...)):
    audio_data = await file.read()

    audio_path = f"/tmp/{file.filename}"

    with open(audio_path, "wb") as f:
        f.write(audio_data)

    audio_url = f"file://{audio_path}"

    response = dashscope.MultiModalConversation.call(
        model="qwen3-asr-flash",
        messages=[
            {
                "role": "user",
                "content": [
                    {"audio": audio_url}
                ]
            }
        ],
        result_format="message",
    )

    if response.status_code != 200:
        return JSONResponse(
            status_code=500,
            content={"error": response.message}
        )

    transcript = response.output.choices[0].message.content[0]["text"]

    return {
        "filename": file.filename,
        "transcript": transcript
    }


@app.post("/api/interviews/analyze")
async def analyze_transcript(data: dict):
    transcript = data.get("transcript")

    if not transcript:
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

    if not isinstance(transcript, str) or not transcript.strip():
        return JSONResponse(
            status_code=400,
            content={"error": "transcript is required"}
        )

    if len(question) > 4000 or len(transcript) > 120000:
        return JSONResponse(status_code=413, content={"error": "Question or transcript is too long"})
    if not isinstance(analysis, dict):
        analysis = {}
    if not isinstance(history, list):
        return JSONResponse(status_code=400, content={"error": "history must be a list"})
    if len(history) > 20:
        return JSONResponse(status_code=400, content={"error": "history may contain at most 20 messages"})
    clean_history = []
    for message in history:
        if not isinstance(message, dict) or message.get("role") not in ("user", "assistant") or not isinstance(message.get("content"), str):
            return JSONResponse(status_code=400, content={"error": "history contains an invalid message"})
        content = message["content"].strip()
        if content:
            clean_history.append({"role": message["role"], "content": content[:4000]})

    try:
        qa_analysis = analysis.get("qa_analysis", [])
        reference_detail = None

        if reference.startswith("Question "):
            try:
                index = int(reference.split()[-1]) - 1
                if 0 <= index < len(qa_analysis):
                    reference_detail = qa_analysis[index]
            except (ValueError, IndexError):
                reference_detail = None

        if reference_detail:
            context = json.dumps(
                reference_detail,
                ensure_ascii=False,
                indent=2
            )
        else:
            context = json.dumps(
                analysis,
                ensure_ascii=False,
                indent=2
            )

        system_prompt = f"""
你是一名亲切、耐心、实用的 AI 面试教练。

你的任务是帮助用户理解自己的面试表现，并给出具体、可执行的建议。

【沟通要求】
1. 使用自然、清晰、容易理解的中文。
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
{transcript}

【相关分析】
{context}

【当前关注的问题】
{reference or "整场面试"}

【用户的追问】

请直接给出回答，不要输出 JSON，也不要重复整份面试分析。
"""
        messages = [{"role": "system", "content": system_prompt}]
        messages.extend(clean_history)
        messages.append({"role": "user", "content": question})

        def stream_answer() -> Iterator[str]:
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
                        yield _sse_event("error", {"message": "AI Coach 暂时无法回答，请稍后重试。"})
                        return
                    choices = getattr(getattr(chunk, "output", None), "choices", None) or []
                    if not choices:
                        continue
                    message = getattr(choices[0], "message", None)
                    content = getattr(message, "content", "") if message else ""
                    if isinstance(content, str) and content:
                        yield _sse_event("delta", {"text": content})
                yield _sse_event("done", {})
            except GeneratorExit:
                raise
            except Exception:
                # Do not expose SDK exception details, which may contain request metadata.
                yield _sse_event("error", {"message": "AI Coach 连接中断，请重试。"})

        return StreamingResponse(
            stream_answer(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
        )
    except Exception:
        return JSONResponse(status_code=500, content={"error": "AI Coach is temporarily unavailable"})
