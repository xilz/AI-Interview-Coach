import os
import json
import time

import requests
import dashscope

from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File

load_dotenv()

DASHSCOPE_API_KEY = os.getenv("DASHSCOPE_API_KEY")

app = FastAPI()


@app.get("/")
def root():
    return {"message": "AI Interview Coach API is running"}


@app.post("/api/interviews/upload")
async def upload_interview(file: UploadFile = File(...)):
    # 1. 保存用户上传的音频
    audio_data = await file.read()

    audio_path = f"/tmp/{file.filename}"

    with open(audio_path, "wb") as f:
        f.write(audio_data)

    return {
        "filename": file.filename,
        "message": "Audio uploaded successfully",
        "next_step": "Need public audio URL for FileTrans ASR"
    }