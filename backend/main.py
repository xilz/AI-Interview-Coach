from fastapi import FastAPI, UploadFile, File

app = FastAPI()


@app.get("/")
def root():
    return {"message": "AI Interview Coach API is running"}


@app.post("/api/interviews/upload")
async def upload_interview(file: UploadFile = File(...)):
    return {
        "filename": file.filename,
        "content_type": file.content_type
    }