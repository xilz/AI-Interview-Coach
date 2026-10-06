import os
import json

import dashscope
from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File
from fastapi.responses import JSONResponse

load_dotenv()

dashscope.api_key = os.getenv("DASHSCOPE_API_KEY")

app = FastAPI()


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
你是一名专业的 AI 面试教练。

下面是候选人的真实面试 Q&A：

{json.dumps(qa_pairs, ensure_ascii=False)}

你的任务是分析候选人的真实回答，并提供有针对性的改进建议。

评价维度：

1. Relevance：回答是否真正回应了问题
2. Structure：回答是否有清晰的逻辑结构
3. Specificity：是否有具体事实、经历、例子或结果
4. Depth：是否体现了足够的思考深度
5. Communication：表达是否清晰、自然、简洁

非常重要的规则：

1. 只能基于候选人在 answer 中实际提供的信息进行评价。
2. 不允许虚构、假设或补充候选人没有提到的经历。
3. 不允许假设候选人做过某个项目、实习、课程、技术工作或其他经历。
4. 如果候选人缺少具体经历，可以指出“缺少具体例子”，并建议候选人补充一个真实经历，但不要替候选人编造经历。
5. suggested_improvement 必须是可以帮助候选人改进回答的方法，而不是虚构一个新的个人经历。
6. 如果回答本身信息很少，不要因为信息少就推测候选人的能力不足，只评价当前回答。
7. 不要评价无法从文字中判断的因素，例如眼神交流、肢体语言、表情等。
8. 如果出现“呃”“嗯”等口头填充词，可以指出其对表达流畅度的影响，但不要过度评价。
9. 不要给数字分数。
10. 整体评价只能使用：
   - Excellent
   - Good
   - Needs Improvement

对于每一个问题输出：

- question
- answer
- assessment
- strengths
- areas_to_improve
- suggested_improvement

请严格输出 JSON：

{{
  "qa_analysis": [
    {{
      "question": "...",
      "answer": "...",
      "assessment": "Good",
      "strengths": [
        "..."
      ],
      "areas_to_improve": [
        "..."
      ],
      "suggested_improvement": [
        "..."
      ]
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