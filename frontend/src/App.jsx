import React, { useState, useEffect } from 'react';
import axios from 'axios';
import AuthPage from './components/AuthPage';
import FileUploader from './components/FileUploader';
import Chatbot from './components/Chatbot';
import './App.css';

function App() {
  const [currentPage, setCurrentPage] = useState('chat');
  const [uploadedDocuments, setUploadedDocuments] = useState([]);
  const [user, setUser] = useState(null); // { token, username, email }

  // Restore session from localStorage on load
  useEffect(() => {
    const stored = localStorage.getItem('mb_user');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setUser(parsed);
        axios.defaults.headers.common['Authorization'] = `Bearer ${parsed.token}`;
      } catch {
        localStorage.removeItem('mb_user');
      }
    }
  }, []);

  const handleAuthSuccess = ({ token, username, email }) => {
    const userData = { token, username, email };
    localStorage.setItem('mb_user', JSON.stringify(userData));
    axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    setUser(userData);
  };

  const handleLogout = () => {
    localStorage.removeItem('mb_user');
    delete axios.defaults.headers.common['Authorization'];
    setUser(null);
    setUploadedDocuments([]);
    setCurrentPage('upload');
  };

  const handleUploadSuccess = (uploadResponse) => {
    if (uploadResponse.documentIds && uploadResponse.filenames) {
      const newDocuments = uploadResponse.documentIds.map((docId, index) => ({
        name: uploadResponse.filenames[index] || `Document ${index + 1}`,
        id:   docId,
      }));
      setUploadedDocuments((prev) => {
        const existingIds = new Set(prev.map((doc) => doc.id));
        return [...prev, ...newDocuments.filter((doc) => !existingIds.has(doc.id))];
      });
    } else {
      const documentInfo = {
        name: uploadResponse.filename || 'Document',
        id:   uploadResponse.documentId || 'unknown',
      };
      setUploadedDocuments((prev) => {
        if (prev.find((doc) => doc.id === documentInfo.id)) return prev;
        return [...prev, documentInfo];
      });
    }
    setCurrentPage('chat');
  };

  const handleBackToUpload = () => {
    setUploadedDocuments([]);
    setCurrentPage('upload');
  };

  const documentIds   = uploadedDocuments.map((doc) => doc.id);
  const documentNames = uploadedDocuments.map((doc) => doc.name);

  // Show auth page if not logged in
  if (!user) {
    return <AuthPage onAuthSuccess={handleAuthSuccess} />;
  }

  return (
    <div className="App">
      {currentPage === 'upload' ? (
        <div className="upload-page">
          <FileUploader
            onUploadSuccess={handleUploadSuccess}
            username={user.username}
            onLogout={handleLogout}
          />
        </div>
      ) : (
        <div className="chat-layout">
          <div className="chat-section">
            <Chatbot
              documentNames={documentNames}
              documentIds={documentIds}
              onBackToUpload={handleBackToUpload}
              username={user.username}
              onLogout={handleLogout}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
