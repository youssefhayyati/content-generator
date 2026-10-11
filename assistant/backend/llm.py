"""Ollama cloud chat client (GLM 5.3 Flash by default), streaming with tool calls."""

from collections.abc import AsyncIterator

import httpx
from ollama import AsyncClient, Message


class LLM:
    def __init__(self, host: str, api_key: str, model: str, think: bool | str):
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else None
        # Without a timeout a stalled request hangs the reply (or a browser task) for good; streamed, it is the
        # longest wait for the next piece
        self.client = AsyncClient(host=host, headers=headers, timeout=httpx.Timeout(180, connect=15))
        self.model = model
        self.think = think

    async def stream(self, messages: list, tools: list[dict], usage: dict | None = None) -> AsyncIterator[Message]:
        """usage, if given, gets the call's token counts once it ends (prompt, output)."""
        response = await self.client.chat(
            model=self.model, messages=messages, tools=tools or None, stream=True, think=self.think
        )
        async for chunk in response:
            if chunk.done and usage is not None:
                usage["prompt"] = usage.get("prompt", 0) + (chunk.prompt_eval_count or 0)
                usage["output"] = usage.get("output", 0) + (chunk.eval_count or 0)
            yield chunk.message

    async def chat(self, messages: list, tools: list[dict]) -> Message:
        response = await self.client.chat(
            model=self.model, messages=messages, tools=tools or None, think=self.think
        )
        return response.message
