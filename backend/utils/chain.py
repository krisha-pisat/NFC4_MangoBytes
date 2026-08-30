import os
from typing import List
from dotenv import load_dotenv
from langchain_groq import ChatGroq
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.runnables.history import RunnableWithMessageHistory
from langchain_core.chat_history import BaseChatMessageHistory
from langchain_core.messages import BaseMessage
from langchain.chains import create_retrieval_chain
from langchain.chains.combine_documents import create_stuff_documents_chain
from langchain_mongodb.chat_message_histories import MongoDBChatMessageHistory

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_MODEL   = os.getenv("GROQ_MODEL", "openai/gpt-oss-20b")
MONGO_URI    = os.getenv("MONGO_URI")
DATABASE_NAME = os.getenv("DATABASE_NAME")

# ── LLM ──────────────────────────────────────────────────────────────────────
llm = ChatGroq(
    model=GROQ_MODEL,
    api_key=GROQ_API_KEY,
    temperature=0.3,
    max_tokens=1500
)

# ── Sliding window: cap history at last N messages before sending to LLM ─────
MAX_HISTORY = 4  # last 2 exchanges (human + ai pairs)

class CappedHistory(BaseChatMessageHistory):
    """Wraps MongoDBChatMessageHistory but only exposes the last MAX_HISTORY messages."""
    def __init__(self, inner: MongoDBChatMessageHistory):
        self._inner = inner

    @property
    def messages(self) -> List[BaseMessage]:
        return self._inner.messages[-MAX_HISTORY:]

    def add_message(self, message: BaseMessage) -> None:
        self._inner.add_message(message)

    def add_messages(self, messages: List[BaseMessage]) -> None:
        for m in messages:
            self._inner.add_message(m)

    def clear(self) -> None:
        self._inner.clear()

# ── Prompt ───────────────────────────────────────────────────────────────────
prompt = ChatPromptTemplate.from_messages([
    ("system", """You are an expert document analyst. \
Answer based ONLY on the context provided below. \
If the context does not contain enough information, say so clearly. \
IMPORTANT: Always write complete, untruncated responses. Never cut off mid-sentence. \
Use markdown formatting: bullet points, bold for key terms, headers for sections.

Context:
{context}"""),
    MessagesPlaceholder("chat_history"),
    ("human", "{input}"),
])

# ── Memory: persistent in MongoDB, capped at MAX_HISTORY messages ─────────────
def get_session_history(session_id: str) -> CappedHistory:
    inner = MongoDBChatMessageHistory(
        connection_string=MONGO_URI,
        session_id=session_id,
        database_name=DATABASE_NAME,
        collection_name="chat_sessions",
    )
    return CappedHistory(inner)

# ── Build chain with a given retriever ───────────────────────────────────────
def build_chain(retriever):
    """
    Returns a chain with memory already wired in.
    Call with:
        chain = build_chain(retriever)
        result = chain.invoke(
            {"input": "user question"},
            config={"configurable": {"session_id": "abc-123"}}
        )
    result["answer"] is the LLM's response string.
    """
    qa_chain  = create_stuff_documents_chain(llm, prompt)
    rag_chain = create_retrieval_chain(retriever, qa_chain)

    chain_with_memory = RunnableWithMessageHistory(
        rag_chain,
        get_session_history,
        input_messages_key="input",
        history_messages_key="chat_history",
        output_messages_key="answer",
    )

    return chain_with_memory
