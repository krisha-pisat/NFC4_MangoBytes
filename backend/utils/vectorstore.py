import os
import numpy as np
from typing import List
from dotenv import load_dotenv
from pymongo import MongoClient
from langchain_core.retrievers import BaseRetriever
from langchain_core.documents import Document
from langchain_core.callbacks import CallbackManagerForRetrieverRun
from .embeddings import get_embeddings

load_dotenv()

MONGO_URI       = os.getenv("MONGO_URI")
DATABASE_NAME   = os.getenv("DATABASE_NAME")
COLLECTION_NAME = os.getenv("COLLECTION_NAME", "mangobytes_lc")

client     = MongoClient(MONGO_URI)
db         = client[DATABASE_NAME]
collection = db[COLLECTION_NAME]

# Index for fast deduplication lookups
collection.create_index('file_hash', sparse=True)


class FilteredRetriever(BaseRetriever):
    """
    Fetches all chunks for the given document_ids directly from MongoDB,
    then ranks by cosine similarity in Python. No Atlas Search index needed.
    """
    document_ids: List[str]
    k: int = 4

    def _get_relevant_documents(
        self, query: str, *, run_manager: CallbackManagerForRetrieverRun
    ) -> List[Document]:

        print(f"🔍 Fetching chunks for document_ids: {self.document_ids}")

        # Fetch ALL chunks for these documents directly from MongoDB
        raw = list(collection.find(
            {"document_id": {"$in": self.document_ids}},
            {"text": 1, "embedding": 1, "document_id": 1, "filename": 1, "_id": 0}
        ))

        print(f"📦 Found {len(raw)} chunks in MongoDB")

        if not raw:
            print("⚠️ No chunks found for these document_ids")
            return []

        # Embed the query
        query_vec = np.array(get_embeddings().embed_query(query))

        # Rank chunks by cosine similarity
        scored = []
        for doc in raw:
            emb = doc.get("embedding")
            if not emb:
                continue
            chunk_vec = np.array(emb)
            norm = np.linalg.norm(chunk_vec) * np.linalg.norm(query_vec)
            sim = float(np.dot(chunk_vec, query_vec) / norm) if norm else 0.0
            scored.append((sim, doc))

        scored.sort(key=lambda x: x[0], reverse=True)
        top = scored[:self.k]

        print(f"✅ Returning top {len(top)} chunks")

        return [
            Document(
                page_content=doc["text"],
                metadata={
                    "document_id": doc.get("document_id", ""),
                    "filename":    doc.get("filename", "")
                }
            )
            for _, doc in top
        ]


def get_retriever(document_ids: List[str], k: int = 4) -> FilteredRetriever:
    return FilteredRetriever(document_ids=document_ids, k=k)
