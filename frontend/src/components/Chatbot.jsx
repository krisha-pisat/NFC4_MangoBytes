// src/components/Chatbot.jsx
import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import jsPDF from 'jspdf';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import DocumentSummary from './DocumentSummary';
import './Chatbot.css';
import './Summary.css';

const Chatbot = ({ documentNames, documentIds, onBackToUpload }) => {
  console.log('🤖 Chatbot initialized with:', { documentNames, documentIds });
  
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [documentSummaries, setDocumentSummaries] = useState([]);
  const chatboxRef = useRef(null);
  const inputRef = useRef(null);

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
        // Send all document IDs for multi-document analysis
        document_ids: documentIds || []
      }, {
        timeout: 180000 // 180 second timeout for longer summaries
      });

      console.log('📥 Frontend received response:', response.data);
      console.log('🔍 Response keys:', Object.keys(response.data));
      console.log('📄 Answer field:', response.data.answer);
      console.log('📄 Reply field:', response.data.reply);
      const botReply = response.data.answer || response.data.reply || "I'm processing your request. Could you please try rephrasing your question?";
      console.log('💬 Bot reply:', botReply);
      setMessages((prev) => [...prev, { 
        sender: 'bot', 
        text: botReply, 
        timestamp: new Date() 
      }]);
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
        {documentNames && documentNames.length > 0 && (
          <div className="document-info">
            {documentNames.length === 1 ? (
              documentNames[0]
            ) : (
              <div className="multiple-docs">
                <span>📚 {documentNames.length} Documents</span>
                <div className="doc-list">
                  {documentNames.map((name, index) => (
                    <span key={index} className="doc-name">{name}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Main layout with two panels */}
      <div className="chatbot-main-container">
        {/* Left panel - Chatbot */}
        <div className="chatbot-container">
          <div className="chatbox" ref={chatboxRef}>
            {messages.length === 0 ? (
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
              disabled={isLoading || input.trim() === ''}
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
             documentIds={documentIds} 
             documentNames={documentNames} 
             onSummariesUpdate={handleSummariesUpdate}
           />
         </div>
      </div>
    </div>
  );
};

export default Chatbot;