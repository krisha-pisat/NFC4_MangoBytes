import os
import time
import requests
from typing import List
from dotenv import load_dotenv
from langchain_core.embeddings import Embeddings

load_dotenv()

HF_TOKEN = os.getenv("HF_TOKEN")
HF_MODEL = os.getenv("HF_EMBED_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
HF_URL   = f"https://router.huggingface.co/hf-inference/models/{HF_MODEL}/pipeline/feature-extraction"

_BATCH_SIZE = 32
_TIMEOUT    = 120


class HuggingFaceRouterEmbeddings(Embeddings):
    """
    Custom LangChain Embeddings class that calls the HuggingFace router
    endpoint (router.huggingface.co) instead of the retired
    api-inference.huggingface.co endpoint.
    """

    def _embed_batch(self, texts: List[str], max_retries: int = 4) -> List[List[float]]:
        headers = {"Content-Type": "application/json"}
        if HF_TOKEN:
            headers["Authorization"] = f"Bearer {HF_TOKEN}"

        last_err = None
        for attempt in range(max_retries):
            try:
                resp = requests.post(
                    HF_URL,
                    headers=headers,
                    json={"inputs": texts},
                    timeout=_TIMEOUT
                )
                if resp.status_code == 503:
                    time.sleep(5 * (attempt + 1))
                    continue
                resp.raise_for_status()
                return resp.json()
            except Exception as e:
                last_err = e
                time.sleep(2 * (attempt + 1))

        raise RuntimeError(f"HuggingFace embedding failed: {last_err}")

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        vectors = []
        for i in range(0, len(texts), _BATCH_SIZE):
            vectors.extend(self._embed_batch(texts[i:i + _BATCH_SIZE]))
        return vectors

    def embed_query(self, text: str) -> List[float]:
        return self._embed_batch([text])[0]


def get_embeddings() -> HuggingFaceRouterEmbeddings:
    return HuggingFaceRouterEmbeddings()
