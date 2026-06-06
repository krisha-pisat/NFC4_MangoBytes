import os
import uuid
import hashlib
import logging
import tempfile
from dotenv import load_dotenv
from langchain_community.document_loaders import PyMuPDFLoader, Docx2txtLoader, TextLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_core.documents import Document
from .embeddings import get_embeddings
from .vectorstore import collection
from .translator import translate_document_content

load_dotenv()
logger = logging.getLogger(__name__)

splitter = RecursiveCharacterTextSplitter(
    chunk_size=500,
    chunk_overlap=100,
    separators=["\n\n", "\n", ".", " ", ""]
)

def load_and_store(file_bytes: bytes, filename: str) -> str:
    """
    Parse file → translate if needed → split into chunks → embed → store in MongoDB.
    Returns the document_id assigned to all chunks.
    If the exact same file was uploaded before, returns the existing document_id instantly.
    """
    # Deduplication: if this exact file content was processed before, reuse it
    file_hash = hashlib.sha256(file_bytes).hexdigest()
    existing = collection.find_one({'file_hash': file_hash}, {'document_id': 1, '_id': 0})
    if existing:
        logger.info(f"DUPLICATE DETECTED: '{filename}' already exists in DB (hash={file_hash[:12]}…) — skipping processing, reusing document_id={existing['document_id']}")
        return existing['document_id']

    document_id = str(uuid.uuid4())
    ext = os.path.splitext(filename)[1].lower()

    with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name

    try:
        # 1. Load
        if ext == ".pdf":
            loader = PyMuPDFLoader(tmp_path)
        elif ext == ".docx":
            loader = Docx2txtLoader(tmp_path)
        else:
            loader = TextLoader(tmp_path, encoding="utf-8")

        documents = loader.load()

        # Check that we actually got text (scanned/image PDFs return empty page_content)
        full_text = " ".join([d.page_content for d in documents]).strip()
        if not full_text:
            raise ValueError(
                f"No text could be extracted from '{filename}'. "
                "This appears to be a scanned or image-based file. "
                "Please upload a PDF with selectable text (not a scanned image)."
            )
        translated_text, detected_lang, was_translated = translate_document_content(full_text, filename)

        if was_translated:
            logger.info(f"Translated '{filename}' from {detected_lang} to English")
            documents = [Document(
                page_content=translated_text,
                metadata={"source": filename, "original_language": detected_lang}
            )]

        # 3. Split into chunks
        chunks = splitter.split_documents(documents)

        if not chunks:
            raise ValueError(f"No chunks produced from {filename}")

        # 4. Embed all chunks
        embeddings = get_embeddings()
        texts = [chunk.page_content for chunk in chunks]
        vectors = embeddings.embed_documents(texts)

        # 5. Store directly in MongoDB
        mongo_docs = []
        for i, (chunk, vector) in enumerate(zip(chunks, vectors)):
            mongo_docs.append({
                "document_id":       document_id,
                "file_hash":         file_hash,
                "filename":          filename,
                "text":              chunk.page_content,
                "embedding":         vector,
                "original_language": detected_lang,
                "was_translated":    was_translated,
                "chunk_index":       i
            })

        collection.insert_many(mongo_docs)
        logger.info(f"NEW DOCUMENT: '{filename}' — stored {len(mongo_docs)} chunks (document_id={document_id})")
        return document_id

    finally:
        os.unlink(tmp_path)
