from __future__ import annotations

import base64
from typing import Any, Dict, Optional

import requests


def minimax_tts(text: str, config: Dict[str, Any]) -> Optional[bytes]:
    """
    调用 MiniMax TTS API 合成语音。

    Args:
        text: 要合成的文本
        config: 包含 group_id, api_key, voice_id 等配置

    Returns:
        音频二进制数据 (mp3) 或 None
    """
    group_id = config.get("group_id", "")
    api_key = config.get("api_key", "")
    voice_id = config.get("voice_id", "Chinese (Mandarin)_Unrestrained_Young_Man")

    if not group_id or not api_key:
        return None

    url = f"https://api.minimax.chat/v1/t2a_v2?GroupId={group_id}"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": "speech-2.8-hd",
        "text": text,
        "timbre_weights": [{"voice_id": voice_id, "weight": 1}],
        "audio_setting": {
            "sample_rate": 32000,
            "format": "mp3",
        },
    }

    try:
        response = requests.post(url, headers=headers, json=payload, timeout=60)
        if response.status_code != 200:
            print(f"TTS API returned status {response.status_code}")
            return None

        data = response.json()
        audio_data = data.get("data", {}).get("audio")
        if audio_data:
            return base64.b64decode(audio_data)

        print(f"TTS API response missing audio data: {list(data.keys())}")
        return None
    except Exception as e:
        print(f"TTS error: {e}")
        return None
