// src/components/FileUploader.jsx
import React, { useState, useRef } from 'react';
import axios from 'axios';
import './FileUploader.css';

const FileUploader = ({ onUploadSuccess }) => {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploadMessage, setUploadMessage] = useState('');
  const [messageType, setMessageType] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef(null);
  const isSubmittingRef = useRef(false);

  const validateFiles = (files) => {
    const maxTotalSize = 10 * 1024 * 1024; // 10MB total
    const validExtensions = ['.pdf', '.docx', '.txt'];
    
    if (!files || files.length === 0) {
      return { isValid: false, message: 'No files selected' };
    }

    // Check total size
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > maxTotalSize) {
      return { isValid: false, message: 'Total file size exceeds 10MB.' };
    }

    // Check each file's type
    for (let file of files) {
      const ext = '.' + file.name.split('.').pop().toLowerCase();
      if (!validExtensions.includes(ext)) {
        return { isValid: false, message: `Invalid file type: ${file.name}. Please select PDF, DOCX, or TXT files only.` };
      }
    }

    return { isValid: true };
  };

  const handleFileSelect = (newFiles) => {
    if (!newFiles || newFiles.length === 0) return;

    const existingNames = new Set(selectedFiles.map(f => f.name));
    const deduped = newFiles.filter(f => !existingNames.has(f.name));
    const allFiles = [...selectedFiles, ...deduped];
    const validation = validateFiles(allFiles);

    if (!validation.isValid) {
      setUploadMessage(validation.message);
      setMessageType('error');
      return;
    }

    setSelectedFiles(allFiles);
    setUploadMessage('');
    setMessageType('');
    setUploadProgress(0);
  };

  const handleFileChange = (e) => {
    if (e.target.files.length) {
      handleFileSelect(Array.from(e.target.files));
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelect(Array.from(files));
    }
  };

  const handleDragDropClick = () => {
    if (!isUploading) {
      fileInputRef.current?.click();
    }
  };

  // This is now the form submission handler
  const handleUpload = async (e) => {
    e.preventDefault();

    // Prevent double-click / double-submit before React re-renders
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;

    if (selectedFiles.length === 0) {
      setUploadMessage('Please select at least one file');
      setMessageType('error');
      isSubmittingRef.current = false;
      return;
    }

    setIsUploading(true);
    setUploadMessage('Processing your documents...');
    setMessageType('info');
    setUploadProgress(0);

    const formData = new FormData();
    selectedFiles.forEach((file, index) => {
      formData.append(`file${index}`, file);
      console.log(`📤 Adding file${index}: ${file.name} (${file.size} bytes)`);
    });

    console.log(`📤 Sending ${selectedFiles.length} file(s) to backend`);

    try {
      // Simulate progress for better UX
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return 90;
          }
          return prev + Math.random() * 15;
        });
      }, 200);

      const response = await axios.post(`${import.meta.env.VITE_API_BASE_URL}/api/upload`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        timeout: 120000,
      });

      clearInterval(progressInterval);
      setUploadProgress(100);
      setUploadMessage('Upload successful! Redirecting to chat...');
      setMessageType('success');

      // Keep isUploading = true so button stays disabled until we navigate away
      setTimeout(() => {
        if (onUploadSuccess) {
          onUploadSuccess(response.data);
        }
      }, 1500);

    } catch (error) {
      console.error('Upload failed:', error);
      setUploadProgress(0);

      let errorMessage = 'Upload failed. Please try again.';
      if (error.code === 'ECONNABORTED') {
        errorMessage = 'Upload timeout. Please check your connection and try again.';
      } else if (error.response?.data?.error) {
        errorMessage = error.response.data.error;
      } else if (error.response?.data?.message) {
        errorMessage = error.response.data.message;
      } else if (error.message) {
        errorMessage = error.message;
      }

      setUploadMessage(errorMessage);
      setMessageType('error');
      setIsUploading(false);
      isSubmittingRef.current = false;
    }
  };

  const removeFile = (index) => {
    const updated = [...selectedFiles];
    updated.splice(index, 1);
    setSelectedFiles(updated);
    
    // Clear messages when files change
    if (updated.length === 0) {
      setUploadMessage('');
      setMessageType('');
      setUploadProgress(0);
    }
  };

  const resetUpload = () => {
    setSelectedFiles([]);
    setUploadMessage('');
    setMessageType('');
    setUploadProgress(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getTotalSize = () => {
    const total = selectedFiles.reduce((sum, file) => sum + file.size, 0);
    return formatFileSize(total);
  };

  return (
    <div className="file-uploader-container">
      <div className="main-container">
        <h1 className="main-title">Document Intelligence Hub</h1>
        <p className="subtitle">Transform your documents into interactive conversations</p>
        
        <div className="upload-section">
          <div 
            className={`drag-drop-zone ${isDragOver ? 'drag-over' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={handleDragDropClick}
          >
            <div className="upload-icon"></div>
            
            <div className="upload-content">
              <h2 className="upload-title">
                {isDragOver ? 'Drop Your Documents' : 'Upload Your Documents'}
              </h2>
              <p className="upload-description">
                {isDragOver 
                  ? 'Release to upload your files and unlock their potential' 
                  : 'Drag and drop your files here, or click below to browse and select'
                }
              </p>

              <div className="file-input-wrapper" onClick={e => e.stopPropagation()}>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  id="file-input"
                  accept=".pdf,.docx,.txt"
                  onChange={handleFileChange}
                  disabled={isUploading}
                />
                <label
                  htmlFor="file-input"
                  className="browse-button"
                >
                  <span>📁</span>
                  {selectedFiles.length > 0 ? 'Add More Files' : 'Browse Files'}
                </label>
              </div>
            </div>
          </div>

          <div className="supported-formats">
            Supported formats: PDF, DOCX, TXT files (10MB max total)
          </div>

          <div className="content-row">
            <div className="selected-files-container">
              <div className="files-header">
                Selected Files ({selectedFiles.length})
              </div>
              
              {selectedFiles.length > 0 ? (
                <>
                  {selectedFiles.map((file, idx) => (
                    <div key={idx} className="selected-file">
                      <div className="file-icon">📄</div>
                      <div className="file-info">
                        <div className="file-name">{file.name}</div>
                        <div className="file-size">{formatFileSize(file.size)}</div>
                      </div>
                      <button 
                        className="remove-file-btn" 
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFile(idx);
                        }}
                        disabled={isUploading}
                        title="Remove file"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  
                  <div className="total-size">
                    Total size: {getTotalSize()}
                  </div>
                </>
              ) : (
                <div className="empty-files-message">
                  No files selected yet. Choose files to get started!
                </div>
              )}
            </div>

            {/* >>>>>>>>>> CHANGED: Wrapped controls in a form <<<<<<<<<< */}
            <form className="upload-controls" onSubmit={handleUpload}>
              {isUploading && uploadProgress > 0 && (
                <div className="progress-container">
                  <div className="progress-bar">
                    <div 
                      className="progress-fill" 
                      style={{ width: `${uploadProgress}%` }}
                    ></div>
                  </div>
                </div>
              )}

              <button 
                // >>>>>>>>>> CHANGED: Changed back to type="submit" <<<<<<<<<<
                type="submit"
                className="upload-button" 
                // onClick handler is removed because the form handles it
                disabled={selectedFiles.length === 0 || isUploading}
              >
                {isUploading && <span className="loading-spinner"></span>}
                {isUploading 
                  ? 'Processing Documents...' 
                  : `Upload ${selectedFiles.length} File${selectedFiles.length !== 1 ? 's' : ''} & Start Chatting`}
              </button>

              {selectedFiles.length > 0 && !isUploading && (
                <button 
                  type="button" // Clear button should not submit form
                  className="browse-button"
                  onClick={resetUpload}
                  style={{ 
                    background: 'rgba(239, 68, 68, 0.2)', 
                    borderColor: 'rgba(239, 68, 68, 0.4)',
                    fontSize: '0.9rem',
                    padding: '0.8rem 1.5rem'
                  }}
                >
                  <span>🗑️</span>
                  Clear All Files
                </button>
              )}
            </form>
            {/* >>>>>>>>>> END CHANGED SECTION <<<<<<<<<< */}
          </div>

          {uploadMessage && (
            <div className={`upload-message ${messageType}`}>
              {uploadMessage}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FileUploader;