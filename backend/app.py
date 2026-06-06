import os
import json
import logging
from datetime import datetime, timezone
from flask import Flask, request, jsonify
from dotenv import load_dotenv
from bson import ObjectId

from utils.loader import load_and_store
from utils.vectorstore import get_retriever, db
from utils.chain import build_chain
from utils.auth import hash_password, verify_password, create_token, require_auth

load_dotenv()

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def _parse_msg(m):
    """History items may be stored as JSON strings or plain dicts."""
    if isinstance(m, str):
        try:
            return json.loads(m)
        except Exception:
            return {}
    return m if isinstance(m, dict) else {}

# MongoDB collections
users_col             = db['users']
user_sessions_col     = db['user_sessions']
document_summaries_col = db['document_summaries']

# Ensure unique index on email
users_col.create_index('email', unique=True)

# ── CORS ─────────────────────────────────────────────────────────────────────
@app.after_request
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin']  = '*'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type,Authorization,Accept'
    response.headers['Access-Control-Allow-Methods'] = 'GET,POST,DELETE,OPTIONS'
    response.headers['Access-Control-Max-Age']       = '86400'
    return response

@app.route('/api/<path:path>', methods=['OPTIONS'])
def handle_options(path):
    return jsonify({}), 200

# ── AUTH: REGISTER ────────────────────────────────────────────────────────────
@app.route('/api/auth/register', methods=['POST'])
def register():
    try:
        data     = request.json or {}
        email    = (data.get('email') or '').strip().lower()
        username = (data.get('username') or '').strip()
        password = data.get('password', '')

        if not email or not username or not password:
            return jsonify({'error': 'Email, username and password are required.'}), 400
        if len(password) < 6:
            return jsonify({'error': 'Password must be at least 6 characters.'}), 400
        if '@' not in email:
            return jsonify({'error': 'Enter a valid email address.'}), 400

        if users_col.find_one({'email': email}):
            return jsonify({'error': 'An account with this email already exists.'}), 409

        result = users_col.insert_one({
            'email':         email,
            'username':      username,
            'password_hash': hash_password(password),
            'created_at':    datetime.now(timezone.utc),
        })

        user_id = str(result.inserted_id)
        token   = create_token(user_id, email, username)
        return jsonify({'token': token, 'username': username, 'email': email}), 201

    except Exception as e:
        logger.error(f"Register error: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

# ── AUTH: LOGIN ───────────────────────────────────────────────────────────────
@app.route('/api/auth/login', methods=['POST'])
def login():
    try:
        data     = request.json or {}
        email    = (data.get('email') or '').strip().lower()
        password = data.get('password', '')

        if not email or not password:
            return jsonify({'error': 'Email and password are required.'}), 400

        user = users_col.find_one({'email': email})
        if not user or not verify_password(password, user['password_hash']):
            return jsonify({'error': 'Incorrect email or password.'}), 401

        user_id = str(user['_id'])
        token   = create_token(user_id, email, user['username'])
        return jsonify({'token': token, 'username': user['username'], 'email': email}), 200

    except Exception as e:
        logger.error(f"Login error: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

# ── AUTH: ME ──────────────────────────────────────────────────────────────────
@app.route('/api/auth/me', methods=['GET'])
@require_auth
def me():
    return jsonify({
        'user_id':  request.user['user_id'],
        'email':    request.user['email'],
        'username': request.user['username'],
    }), 200

# ── UPLOAD ────────────────────────────────────────────────────────────────────
@app.route('/api/upload', methods=['POST'])
@require_auth
def upload_document():
    try:
        uploaded_files = []

        i = 0
        while f'file{i}' in request.files:
            f = request.files[f'file{i}']
            if f.filename:
                uploaded_files.append(f)
            i += 1

        if 'file' in request.files:
            f = request.files['file']
            if f.filename:
                uploaded_files.append(f)

        if not uploaded_files:
            return jsonify({'error': 'No files uploaded'}), 400

        results = []
        for f in uploaded_files:
            filename    = f.filename
            file_bytes  = f.read()
            document_id = load_and_store(file_bytes, filename)
            results.append({'documentId': document_id, 'filename': filename})
            logger.info(f"✅ Uploaded: {filename} → {document_id}")

        if len(results) == 1:
            return jsonify({
                'message':    f"'{results[0]['filename']}' uploaded successfully.",
                'documentId': results[0]['documentId'],
                'filename':   results[0]['filename'],
            }), 200

        return jsonify({
            'message':     f"{len(results)} documents uploaded successfully.",
            'documentIds': [r['documentId'] for r in results],
            'filenames':   [r['filename']   for r in results],
            'documentId':  results[0]['documentId'],
            'filename':    results[0]['filename'],
        }), 200

    except Exception as e:
        logger.error(f"Upload error: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

# ── QUERY ─────────────────────────────────────────────────────────────────────
@app.route('/api/query', methods=['POST'])
@require_auth
def query_documents():
    try:
        data           = request.json or {}
        user_message   = data.get('message') or data.get('query', '')
        document_ids   = data.get('document_ids', [])
        document_names = data.get('document_names', [])
        session_id     = data.get('session_id', 'default')
        user_id        = request.user['user_id']

        if not user_message:
            return jsonify({'error': 'No message provided'}), 400
        if not document_ids:
            return jsonify({'error': 'No document_ids provided'}), 400

        # Register/update session — title set once on insert, doc list updated every send
        if not session_id.startswith('summary-') and not session_id.startswith('comparison-'):
            title = user_message[:60] + '...' if len(user_message) > 60 else user_message
            user_sessions_col.update_one(
                {'session_id': session_id, 'user_id': user_id},
                {
                    '$setOnInsert': {
                        'session_id': session_id,
                        'user_id':    user_id,
                        'title':      title,
                        'created_at': datetime.now(timezone.utc),
                    },
                    '$set': {
                        'document_ids':   document_ids,
                        'document_names': document_names,
                    },
                },
                upsert=True,
            )
            logger.info(f"Session registered: {session_id} → user {user_id}")

        retriever = get_retriever(document_ids, k=2)
        chain     = build_chain(retriever)

        result = chain.invoke(
            {"input": user_message},
            config={"configurable": {"session_id": session_id}}
        )

        answer = result.get('answer', '')
        if not answer:
            answer = "I couldn't find relevant information in the uploaded documents. Please try rephrasing your question."

        # Auto-cache summaries so they are never regenerated
        if session_id.startswith('summary-'):
            doc_id = session_id[len('summary-'):]
            document_summaries_col.update_one(
                {'type': 'individual', 'document_id': doc_id},
                {'$set': {'summary': answer, 'updated_at': datetime.now(timezone.utc)}},
                upsert=True,
            )
        elif session_id.startswith('comparison-'):
            doc_ids_key = session_id[len('comparison-'):]
            document_summaries_col.update_one(
                {'type': 'comparison', 'doc_ids_key': doc_ids_key},
                {'$set': {'summary': answer, 'updated_at': datetime.now(timezone.utc)}},
                upsert=True,
            )

        return jsonify({'answer': answer}), 200

    except Exception as e:
        logger.error(f"Query error: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

# ── SESSIONS LIST ─────────────────────────────────────────────────────────────
@app.route('/api/sessions', methods=['GET'])
@require_auth
def list_sessions():
    try:
        from langchain_mongodb.chat_message_histories import MongoDBChatMessageHistory
        from langchain_core.messages import HumanMessage

        user_id = request.user['user_id']

        cursor = user_sessions_col.find(
            {'user_id': user_id},
            {'session_id': 1, 'title': 1, 'created_at': 1, '_id': 0}
        ).sort('created_at', -1)

        result = []
        for doc in cursor:
            if 'session_id' not in doc:
                continue

            title = doc.get('title')

            # Fallback for old sessions created before title was stored
            if not title:
                try:
                    h = MongoDBChatMessageHistory(
                        connection_string=os.getenv('MONGO_URI'),
                        session_id=doc['session_id'],
                        database_name=os.getenv('DATABASE_NAME'),
                        collection_name='chat_sessions',
                    )
                    first_human = next((m for m in h.messages if isinstance(m, HumanMessage)), None)
                    if first_human:
                        c = first_human.content
                        title = c[:60] + '...' if len(c) > 60 else c
                        # Back-fill so we don't pay this cost again
                        user_sessions_col.update_one(
                            {'session_id': doc['session_id']},
                            {'$set': {'title': title}}
                        )
                except Exception:
                    pass

            if title:
                result.append({'session_id': doc['session_id'], 'title': title})

        logger.info(f"Sessions for user {user_id}: {len(result)} found")
        return jsonify(result), 200

    except Exception as e:
        logger.error(f"Sessions list error: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

# ── SESSION DELETE ────────────────────────────────────────────────────────────
@app.route('/api/sessions/<session_id>', methods=['DELETE'])
@require_auth
def delete_session(session_id):
    try:
        user_id = request.user['user_id']

        ownership = user_sessions_col.find_one({
            'session_id': session_id,
            'user_id':    user_id,
        })
        if not ownership:
            return jsonify({'error': 'Session not found.'}), 404

        # Remove from user_sessions (ownership + title registry)
        user_sessions_col.delete_one({'session_id': session_id, 'user_id': user_id})

        # Remove chat history from chat_sessions
        chat_col = db['chat_sessions']
        chat_col.delete_many({'$or': [{'SessionId': session_id}, {'session_id': session_id}]})

        logger.info(f"Deleted session {session_id} for user {user_id}")
        return jsonify({'message': 'Session deleted.'}), 200

    except Exception as e:
        logger.error(f"Delete session error: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

# ── SESSION MESSAGES ──────────────────────────────────────────────────────────
@app.route('/api/sessions/<session_id>', methods=['GET'])
@require_auth
def get_session_messages(session_id):
    try:
        from langchain_mongodb.chat_message_histories import MongoDBChatMessageHistory
        from langchain_core.messages import HumanMessage

        user_id = request.user['user_id']

        ownership = user_sessions_col.find_one({
            'session_id': session_id,
            'user_id':    user_id,
        })
        if not ownership:
            return jsonify({'error': 'Session not found.'}), 404

        # Use LangChain's own deserialiser — avoids brittle raw-dict parsing
        history = MongoDBChatMessageHistory(
            connection_string=os.getenv('MONGO_URI'),
            session_id=session_id,
            database_name=os.getenv('DATABASE_NAME'),
            collection_name='chat_sessions',
        )

        messages = [
            {
                'sender': 'user' if isinstance(msg, HumanMessage) else 'bot',
                'text':   msg.content,
            }
            for msg in history.messages
        ]

        logger.info(f"Loaded {len(messages)} messages for session {session_id}")
        return jsonify({
            'messages':       messages,
            'document_ids':   ownership.get('document_ids',   []),
            'document_names': ownership.get('document_names', []),
        }), 200

    except Exception as e:
        logger.error(f"Get session error: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

# ── SUMMARIES CACHE ───────────────────────────────────────────────────────────
@app.route('/api/summaries', methods=['POST'])
@require_auth
def get_cached_summaries():
    """Return any already-generated summaries for the given document IDs."""
    try:
        data         = request.json or {}
        document_ids = data.get('document_ids', [])

        cached = {}

        # Individual summaries
        for doc_id in document_ids:
            row = document_summaries_col.find_one(
                {'type': 'individual', 'document_id': doc_id},
                {'summary': 1, '_id': 0}
            )
            if row:
                cached[f'summary-{doc_id}'] = row['summary']

        # Comparison summary (only meaningful when >1 doc)
        if len(document_ids) > 1:
            key = '-'.join(document_ids)
            row = document_summaries_col.find_one(
                {'type': 'comparison', 'doc_ids_key': key},
                {'summary': 1, '_id': 0}
            )
            if row:
                cached[f'comparison-{key}'] = row['summary']

        return jsonify(cached), 200

    except Exception as e:
        logger.error(f"Summaries cache error: {e}", exc_info=True)
        return jsonify({}), 200   # fail-open so frontend falls back to generation

# ── HEALTH ────────────────────────────────────────────────────────────────────
@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok'}), 200

# ── MAIN ──────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    if os.environ.get('PORT') or os.environ.get('FLASK_ENV') == 'production':
        from waitress import serve
        serve(app, host='0.0.0.0', port=port, threads=4)
    else:
        app.run(debug=True, host='0.0.0.0', port=port)
