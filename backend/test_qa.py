import os
import dashscope
from dotenv import load_dotenv

load_dotenv()

dashscope.api_key = os.getenv("DASHSCOPE_API_KEY")

transcript = """
Speaker 0: 请简单介绍一下你自己。
Speaker 1: 您好，我叫朱熙凌，目前就读于香港中文大学（深圳），专业是数学与应用数学。
Speaker 0: 为什么想做 AI 产品经理？
Speaker 1: 我比较喜欢产品设计和用户需求分析，同时也有一定的技术背景。
Speaker 0: 你觉得自己最大的优势是什么？
Speaker 1: 我比较擅长沟通和统筹，也比较喜欢协调团队完成一个项目。
"""

prompt = f"""
你是一个面试对话整理助手。

下面是一段已经完成说话人识别的面试对话：

{transcript}

请完成以下任务：

1. 找出每一个面试官提出的问题。
2. 找出候选人对应的回答。
3. 将每一组问题和回答整理成一个 Q&A。
4. 不要修改候选人的原始回答内容。
5. 按照问题出现的顺序输出。

请严格输出 JSON，不要输出任何其他文字。

格式：

{{
  "qa_pairs": [
    {{
      "question": "面试官的问题",
      "answer": "候选人的原始回答"
    }}
  ]
}}
"""

response = dashscope.Generation.call(
    model="qwen-plus",
    prompt=prompt
)

print(response.output.text)