// src/components/Chatbot.jsx
import React, { useState, useRef, useEffect, useCallback } from 'react';
import axios from 'axios';
import jsPDF from 'jspdf';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import DocumentSummary from './DocumentSummary';
import ChatHistorySidebar from './ChatHistorySidebar';
import './Chatbot.css';
import './Summary.css';

const Chatbot = ({ documentNames, documentIds, onBackToUpload, username, onLogout }) => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [documentSummaries, setDocumentSummaries] = useState([]);
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());
  const [sessions, setSessions] = useState([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeDocIds, setActiveDocIds] = useState(documentIds || []);
  const [activeDocNames, setActiveDocNames] = useState(documentNames || []);
  const [isAddingDoc, setIsAddingDoc] = useState(false);
  const chatboxRef = useRef(null);
  const inputRef = useRef(null);
  const addDocInputRef = useRef(null);

  // ── Session history ────────────────────────────────────────────────────────
  const fetchSessions = useCallback(async () => {
    try {
      const res = await axios.get(`${import.meta.env.VITE_API_BASE_URL}/api/sessions`);
      setSessions(res.data);
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
    // Refresh sidebar every 15 seconds so the current session appears while chatting
    const interval = setInterval(fetchSessions, 15000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  const handleNewChat = () => {
    // Go back to upload page so user can choose new documents
    if (onBackToUpload) onBackToUpload();
  };

  const handleAddDocument = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    // Reset so the same file can be picked again later
    e.target.value = '';

    setIsAddingDoc(true);
    try {
      const formData = new FormData();
      files.forEach((file, i) => formData.append(`file${i}`, file));

      const res = await axios.post(
        `${import.meta.env.VITE_API_BASE_URL}/api/upload`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60000 }
      );

      const newIds   = res.data.documentIds   || [res.data.documentId];
      const newNames = res.data.filenames      || [res.data.filename];

      setActiveDocIds(prev  => [...prev,  ...newIds.filter(id => !prev.includes(id))]);
      setActiveDocNames(prev => [...prev, ...newNames.filter(n => !prev.includes(n))]);

      const added = newNames.join(', ');
      setMessages(prev => [
        ...prev,
        {
          sender: 'bot',
          text: `**${added}** added to this conversation. You can now ask questions about all uploaded documents.`,
          timestamp: new Date(),
        },
      ]);
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed to upload document.';
      setMessages(prev => [
        ...prev,
        { sender: 'bot', text: `Upload failed: ${msg}`, timestamp: new Date() },
      ]);
    } finally {
      setIsAddingDoc(false);
    }
  };

  const handleSessionDelete = async (sessionIdToDelete) => {
    await axios.delete(`${import.meta.env.VITE_API_BASE_URL}/api/sessions/${sessionIdToDelete}`);
    // If we just deleted the active session, reset to a fresh chat
    if (sessionIdToDelete === sessionId) {
      setMessages([]);
      setSessionId(crypto.randomUUID());
    }
    fetchSessions();
  };

  const handleSessionSelect = async (session) => {
    try {
      const res = await axios.get(
        `${import.meta.env.VITE_API_BASE_URL}/api/sessions/${session.session_id}`
      );
      const loaded = res.data.messages.map((m) => ({
        sender: m.sender,
        text: m.text,
        timestamp: new Date(),
      }));
      setMessages(loaded);
      setSessionId(session.session_id);

      // Restore the documents that were used in this session
      if (res.data.document_ids?.length) {
        setActiveDocIds(res.data.document_ids);
        setActiveDocNames(res.data.document_names || []);
      } else {
        // Old session with no stored doc info — clear so UI shows "no doc" state
        setActiveDocIds([]);
        setActiveDocNames([]);
      }
    } catch (err) {
      console.error('Failed to load session:', err);
    }
  };

  // Sample suggestions for empty state
  const suggestions = [
    "What is this document about?",
    "Summarize the main points",
    "What are the key findings?",
    "Extract important dates",
    "List the main topics"
  ];

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (chatboxRef.current) {
      chatboxRef.current.scrollTop = chatboxRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const sendMessage = async (messageText = null) => {
    const userMessage = messageText || input.trim();
    if (userMessage === '' || isLoading) return;

    const newMessages = [...messages, { sender: 'user', text: userMessage, timestamp: new Date() }];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);

    try {
      console.log('📤 Sending query with document IDs:', documentIds);
      
      // API call to your backend
      const response = await axios.post(`${import.meta.env.VITE_API_BASE_URL}/api/query`, {
        message: userMessage,
        document_ids: activeDocIds,
        document_names: activeDocNames,
        session_id: sessionId,
      }, {
        timeout: 180000,
      });

      const botReply = response.data.answer || response.data.reply || "I'm processing your request. Could you please try rephrasing your question?";
      setMessages((prev) => [...prev, {
        sender: 'bot',
        text: botReply,
        timestamp: new Date(),
      }]);
      fetchSessions();
    } catch (error) {
      console.error('Error sending message:', error);
      let errorMessage = 'I apologize, but I encountered an issue processing your request. Please try again.';
      
      if (error.code === 'ECONNABORTED') {
        errorMessage = 'The request timed out. Please try again with a shorter question.';
      } else if (error.response?.data?.message) {
        errorMessage = error.response.data.message;
      }
      
      setMessages((prev) => [...prev, { 
        sender: 'bot', 
        text: errorMessage, 
        timestamp: new Date() 
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleSuggestionClick = (suggestion) => {
    sendMessage(suggestion);
  };

  const handleSummariesUpdate = (summaries) => {
    console.log('📋 Received summaries from DocumentSummary:', summaries);
    setDocumentSummaries(summaries);
  };

  // Strip emojis and markdown syntax so jsPDF (Latin-1 font) renders clean text
  const stripForPdf = (text) => {
    if (!text) return '';
    return text
      .replace(/#{1,6}\s*/g, '')           // ## headings
      .replace(/\*\*(.+?)\*\*/g, '$1')     // **bold**
      .replace(/\*(.+?)\*/g, '$1')         // *italic*
      .replace(/^[-*+]\s+/gm, '  - ')      // bullet markers
      .replace(/[^\x00-\x7F]/g, '')        // strip all non-ASCII (emojis, special chars)
      .replace(/\n{3,}/g, '\n\n')          // collapse excess newlines
      .trim();
  };

  const downloadChatReport = () => {
    setIsDownloading(true);
    
    try {
      const doc = new jsPDF();
      let yPosition = 20;
      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 20;
      const textWidth = pageWidth - (2 * margin);
      
      // Title
      doc.setFontSize(20);
      doc.setFont(undefined, 'bold');
      doc.text('Chat Conversation Report', pageWidth / 2, yPosition, { align: 'center' });
      yPosition += 15;
      
      // Document information
      doc.setFontSize(12);
      doc.setFont(undefined, 'normal');
      doc.text(`Documents Analyzed: ${documentNames.join(', ')}`, margin, yPosition);
      yPosition += 10;
      doc.text(`Generated on: ${new Date().toLocaleString()}`, margin, yPosition);
      yPosition += 20;
      
      // Chat messages only
      doc.setFontSize(14);
      doc.setFont(undefined, 'bold');
      doc.text('Chat Conversation:', margin, yPosition);
      yPosition += 10;
      
      doc.setFontSize(11);
      doc.setFont(undefined, 'normal');
      
      messages.forEach((msg) => {
        const sender = msg.sender === 'user' ? 'You' : 'Assistant';
        const timestamp = msg.timestamp.toLocaleString();
        
        // Check if we need a new page
        if (yPosition > 250) {
          doc.addPage();
          yPosition = 20;
        }
        
        // Sender and timestamp
        doc.setFont(undefined, 'bold');
        doc.text(`${sender} (${timestamp}):`, margin, yPosition);
        yPosition += 5;
        
        // Message text
        doc.setFont(undefined, 'normal');
        const messageText = stripForPdf(typeof msg.text === 'string' ? msg.text : 'Formatted content');
        const lines = doc.splitTextToSize(messageText, textWidth);
        
        lines.forEach(line => {
          if (yPosition > 250) {
            doc.addPage();
            yPosition = 20;
          }
          doc.text(line, margin, yPosition);
          yPosition += 5;
        });
        
        yPosition += 10;
      });
      
      // Save the PDF
      const fileName = `chat-conversation-report-${new Date().toISOString().split('T')[0]}.pdf`;
      doc.save(fileName);
    } catch (error) {
      console.error('Error generating PDF:', error);
      alert('Failed to generate PDF report. Please try again.');
    } finally {
      setIsDownloading(false);
    }
  };

  const downloadSummaryReport = () => {
    setIsDownloading(true);
    
    try {
      const doc = new jsPDF();
      let yPosition = 20;
      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 20;
      const textWidth = pageWidth - (2 * margin);
      
      // Title
      doc.setFontSize(20);
      doc.setFont(undefined, 'bold');
      doc.text('Document Summary Report', pageWidth / 2, yPosition, { align: 'center' });
      yPosition += 15;
      
      // Document information
      doc.setFontSize(12);
      doc.setFont(undefined, 'normal');
      doc.text(`Documents Analyzed: ${documentNames.join(', ')}`, margin, yPosition);
      yPosition += 10;
      doc.text(`Generated on: ${new Date().toLocaleString()}`, margin, yPosition);
      yPosition += 20;
      
      // Summary section
      console.log('📋 Document summaries for summary PDF:', documentSummaries);
      
      if (documentSummaries.length > 0) {
        doc.setFontSize(14);
        doc.setFont(undefined, 'bold');
        doc.text('Document Summary:', margin, yPosition);
        yPosition += 10;
        
        doc.setFontSize(11);
        doc.setFont(undefined, 'normal');
        
        documentSummaries.forEach((summary) => {
          // Add document name as header
          doc.setFont(undefined, 'bold');
          doc.text(`${summary.name}:`, margin, yPosition);
          yPosition += 5;
          
          // Add summary content
          doc.setFont(undefined, 'normal');
          const summaryText = stripForPdf(summary.summary);
          const lines = doc.splitTextToSize(summaryText, textWidth);
          
          lines.forEach(line => {
            if (yPosition > 250) {
              doc.addPage();
              yPosition = 20;
            }
            doc.text(line, margin, yPosition);
            yPosition += 5;
          });
          
          yPosition += 10;
        });
      } else {
        // No summary found
        doc.setFontSize(11);
        doc.setFont(undefined, 'normal');
        doc.text('No document summary available. Please generate a summary first.', margin, yPosition);
      }
      
      // Save the PDF
      const fileName = `document-summary-report-${new Date().toISOString().split('T')[0]}.pdf`;
      doc.save(fileName);
    } catch (error) {
      console.error('Error generating summary PDF:', error);
      alert('Failed to generate summary PDF. Please try again.');
    } finally {
      setIsDownloading(false);
    }
  };

  const formatTime = (timestamp) => {
    return timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="chatbot-page">
      {/* Header */}
      <div className="chat-header">
        <div className="header-left">
          <button className="back-button" onClick={onBackToUpload}>
            <span>←</span>
            New Document
          </button>
          <h1 className="chat-title">Document Intelligence Hub</h1>
        </div>
                 <div className="header-right">
           {username && (
             <div className="user-info">
               <span className="user-avatar">👤</span>
               <span className="user-name">{username}</span>
             </div>
           )}
           {onLogout && (
             <button className="logout-button" onClick={onLogout} title="Log out">
               Log out
             </button>
           )}
           {(messages.length > 0 || documentSummaries.length > 0) && (
             <>
               {documentSummaries.length > 0 && (
                 <button 
                   className="download-button summary-download-button" 
                   onClick={downloadSummaryReport}
                   disabled={isDownloading}
                 >
                   {isDownloading ? (
                     <>
                       <div className="button-spinner"></div>
                       <span>Generating...</span>
                     </>
                   ) : (
                     <>
                       <span>📋</span>
                       <span>Download Summary</span>
                     </>
                   )}
                 </button>
               )}
               {messages.length > 0 && (
                 <button 
                   className="download-button" 
                   onClick={downloadChatReport}
                   disabled={isDownloading}
                 >
                   {isDownloading ? (
                     <>
                       <div className="button-spinner"></div>
                       <span>Generating...</span>
                     </>
                   ) : (
                     <>
                       <span>📄</span>
                       <span>Download Report</span>
                     </>
                   )}
                 </button>
               )}
             </>
           )}
         </div>
        {activeDocNames.length > 0 && (
          <div className="document-info">
            {activeDocNames.length === 1 ? (
              activeDocNames[0]
            ) : (
              <div className="multiple-docs">
                <span>📚 {activeDocNames.length} Documents</span>
                <div className="doc-list">
                  {activeDocNames.map((name, index) => (
                    <span key={index} className="doc-name">{name}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Main layout with three panels */}
      <div className="chatbot-main-container">
        {/* Far-left panel - Chat History Sidebar */}
        <ChatHistorySidebar
          sessions={sessions}
          activeSessionId={sessionId}
          onNewChat={handleNewChat}
          onSessionSelect={handleSessionSelect}
          onSessionDelete={handleSessionDelete}
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(c => !c)}
        />

        {/* Middle panel - Chatbot */}
        <div className="chatbot-container">
          <div className="chatbox" ref={chatboxRef}>
            {messages.length === 0 && activeDocIds.length === 0 ? (
              /* No documents loaded yet */
              <div className="empty-chat-state">
                <div className="empty-icon">📁</div>
                <div className="empty-title">No document loaded</div>
                <div className="empty-description">
                  Click the <strong>+</strong> button below to upload a document and start asking questions,
                  or select a previous conversation from the sidebar.
                </div>
                <button className="upload-cta-btn" onClick={onBackToUpload}>
                  Upload a Document
                </button>
              </div>
            ) : messages.length === 0 ? (
              /* Documents loaded, no messages yet */
              <div className="empty-chat-state">
                <div className="empty-icon">🤖</div>
                <div className="empty-title">Ready to analyze your documents!</div>
                <div className="empty-description">
                  Ask me anything about your documents. I can summarize, extract key information, answer questions, and provide detailed analysis.
                </div>
                <div className="suggestions-container">
                  {suggestions.map((suggestion, index) => (
                    <button
                      key={index}
                      className="suggestion-chip"
                      onClick={() => handleSuggestionClick(suggestion)}
                      disabled={isLoading}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {messages.map((msg, idx) => (
                  <div key={idx} className={`message ${msg.sender}`}>
                    <div className="message-content">
                      {msg.sender === 'bot' ? (
                        <div className="bot-markdown">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm, remarkMath]}
                            rehypePlugins={[rehypeKatex]}
                          >
                            {typeof msg.text === 'string' ? msg.text : ''}
                          </ReactMarkdown>
                        </div>
                      ) : msg.text}
                    </div>
                    <div className="message-time">
                      {formatTime(msg.timestamp)}
                    </div>
                  </div>
                ))}
                
                {isLoading && (
                  <div className="typing-message">
                    <div className="typing-indicator">
                      <span></span>
                      <span></span>
                      <span></span>
                    </div>
                    <span>Analyzing...</span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Input area */}
          <div className="input-area">
            {/* Hidden file picker for adding documents mid-conversation */}
            <input
              ref={addDocInputRef}
              type="file"
              accept=".pdf,.doc,.docx,.txt"
              multiple
              style={{ display: 'none' }}
              onChange={handleAddDocument}
            />
            <button
              className="add-doc-btn"
              onClick={() => addDocInputRef.current?.click()}
              disabled={isAddingDoc || isLoading}
              title="Add more documents to this conversation"
            >
              {isAddingDoc ? <div className="button-spinner small"></div> : '+'}
            </button>

            <div className="input-wrapper">
              <div className="input-icon">💬</div>
              <input
                ref={inputRef}
                type="text"
                placeholder="Ask something about your documents..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isLoading}
                maxLength={500}
              />
            </div>
            <button
              className="send-button"
              onClick={() => sendMessage()}
              disabled={isLoading || input.trim() === '' || activeDocIds.length === 0}
              title={activeDocIds.length === 0 ? 'Upload a document first' : ''}
            >
              {isLoading ? (
                <div className="button-spinner"></div>
              ) : (
                <>
                  <span>Send</span>
                  <span>➤</span>
                </>
              )}
            </button>
          </div>
        </div>

                 {/* Right panel - Document Summary */}
         <div className="document-summary-panel">
           <DocumentSummary
             documentIds={activeDocIds}
             documentNames={activeDocNames}
             onSummariesUpdate={handleSummariesUpdate}
           />
         </div>
      </div>
    </div>
  );
};

export default Chatbot;