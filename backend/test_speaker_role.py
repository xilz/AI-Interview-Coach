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
"""

prompt = f"""
你是一个面试对话分析助手。

下面是一段带有 speaker_id 的面试对话：

{transcript}

请判断每个 speaker 的角色。

只能从以下两个角色中选择：
- interviewer
- candidate

请严格按照下面格式输出：

Speaker 0: interviewer
Speaker 1: candidate
"""

response = dashscope.Generation.call(
    model="qwen-plus",
    prompt=prompt
)

print(response.output.text)