import os

import dashscope
from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File

load_dotenv()

dashscope.api_key = os.getenv("DASHSCOPE_API_KEY")

app = FastAPI()


@app.get("/")
def root():
    return {"message": "AI Interview Coach API is running"}


@app.post("/api/interviews/upload")
async def upload_interview(file: UploadFile = File(...)):
    audio_data = await file.read()

    audio_path = "/tmp/interview_audio"

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
        return {
            "error": response.message
        }

    transcript = response.output.choices[0].message.content[0]["text"]

    return {
        "filename": file.filename,
        "transcript": transcript
    }