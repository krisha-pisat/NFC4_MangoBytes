import os
from datetime import datetime, timedelta, timezone
from functools import wraps

import jwt
from werkzeug.security import generate_password_hash, check_password_hash
from flask import request, jsonify
from dotenv import load_dotenv

load_dotenv()

JWT_SECRET = os.getenv("JWT_SECRET", "mangobytes-secret-change-in-production")
JWT_EXPIRY_DAYS = 7


def hash_password(password: str) -> str:
    return generate_password_hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return check_password_hash(password_hash, password)


def create_token(user_id: str, email: str, username: str) -> str:
    payload = {
        "user_id": user_id,
        "email": email,
        "username": username,
        "exp": datetime.now(timezone.utc) + timedelta(days=JWT_EXPIRY_DAYS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def decode_token(token: str) -> dict:
    return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])


def require_auth(f):
    """Decorator: extracts JWT from Authorization header and sets request.user."""
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return jsonify({"error": "Authentication required. Please log in."}), 401
        token = auth_header[7:]
        try:
            request.user = decode_token(token)
        except jwt.ExpiredSignatureError:
            return jsonify({"error": "Session expired. Please log in again."}), 401
        except jwt.InvalidTokenError:
            return jsonify({"error": "Invalid session. Please log in again."}), 401
        return f(*args, **kwargs)
    return decorated
