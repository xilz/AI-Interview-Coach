import requests
import json

url = "https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/prod/qwen-audio-3.1-asr-flash-filetrans/20261005/00%3A14/4d2d53ef-84c6-45db-8785-79d4c6ab0442.json?Expires=1791216881&OSSAccessKeyId=LTAI5tGzqbGcEmE58b221XQy&Signature=VuDqE0VBkRl6p%2FWCW9%2FMUw9WDGY%3D&response-content-disposition=attachment%3Bfilename%3D4d2d53ef-84c6-45db-8785-79d4c6ab0442.json"

response = requests.get(url)

data = response.json()

print(json.dumps(data, indent=2, ensure_ascii=False))