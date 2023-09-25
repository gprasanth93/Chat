from fastapi import FastAPI, WebSocket, Depends, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
import asyncio

app = FastAPI()
templates = Jinja2Templates(directory="templates")

# Store messages in-memory (you might want to use a database in production)
messages = []

@app.get("/", response_class=HTMLResponse)
async def chat_page(request: HTTPException):
    return templates.TemplateResponse("chat.html", {"request": request})

@app.post("/send_message/")
async def send_message(message: str):
    messages.append(message)
    return {"message": "Message sent successfully"}

@app.get("/get_messages/")
async def get_messages(last_index: int = 0):
    while last_index >= len(messages):
        await asyncio.sleep(1)  # Long-polling, wait for new messages
    return messages[last_index:]

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)