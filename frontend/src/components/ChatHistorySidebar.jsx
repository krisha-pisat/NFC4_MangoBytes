import React, { useState } from 'react';
import './ChatHistorySidebar.css';

const ChatHistorySidebar = ({ sessions, activeSessionId, onNewChat, onSessionSelect, onSessionDelete, collapsed, onToggle }) => {
  const [deletingId, setDeletingId] = useState(null);

  const handleDelete = async (e, session) => {
    e.stopPropagation();
    if (!window.confirm(`Delete "${session.title}"? This cannot be undone.`)) return;
    setDeletingId(session.session_id);
    try {
      await onSessionDelete(session.session_id);
    } finally {
      setDeletingId(null);
    }
  };

  if (collapsed) {
    return (
      <div className="chat-history-sidebar collapsed">
        <button className="sidebar-collapse-btn" onClick={onToggle} title="Expand history">
          ›
        </button>
      </div>
    );
  }

  return (
    <div className="chat-history-sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">Chat History</span>
        <button className="sidebar-collapse-btn" onClick={onToggle} title="Collapse history">
          ‹
        </button>
      </div>

      <button className="new-chat-btn" onClick={onNewChat}>
        <span className="new-chat-icon">+</span>
        <span>New Chat</span>
      </button>

      <div className="sessions-list">
        {sessions.length === 0 ? (
          <div className="no-sessions">No previous chats yet</div>
        ) : (
          sessions.map((session) => (
            <div
              key={session.session_id}
              className={`session-item ${activeSessionId === session.session_id ? 'active' : ''}`}
              onClick={() => onSessionSelect(session)}
              title={session.title}
            >
              <div className="session-title">{session.title}</div>
              <button
                className={`session-delete-btn ${deletingId === session.session_id ? 'deleting' : ''}`}
                onClick={(e) => handleDelete(e, session)}
                disabled={deletingId === session.session_id}
                title="Delete conversation"
              >
                {deletingId === session.session_id ? '...' : '🗑'}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default ChatHistorySidebar;
