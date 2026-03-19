import React, { useState } from 'react';

const BlueprintUploader = ({ onBlueprintUploaded }) => {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFileChange = (uploadedFile) => {
    if (uploadedFile) {
      setFile(uploadedFile);
      
      // Create preview
      const reader = new FileReader();
      reader.onload = (event) => {
        setPreview(event.target.result);
        onBlueprintUploaded(event.target.result, uploadedFile.name);
      };
      reader.readAsDataURL(uploadedFile);
    }
  };

  const handleInputChange = (e) => {
    const uploadedFile = e.target.files[0];
    handleFileChange(uploadedFile);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const uploadedFile = e.dataTransfer.files[0];
    handleFileChange(uploadedFile);
  };

  const handleRemove = () => {
    setFile(null);
    setPreview(null);
    onBlueprintUploaded(null, null);
  };

  return (
    <div className="blueprint-uploader">
      <div 
        className="upload-area"
        style={{
          border: `2px dashed ${isDragging ? '#64c8ff' : 'rgba(255, 255, 255, 0.3)'}`,
          borderRadius: '8px',
          padding: '30px',
          textAlign: 'center',
          cursor: 'pointer',
          transition: 'all 0.3s',
          background: isDragging ? 'rgba(100, 200, 255, 0.1)' : 'transparent'
        }}
        onClick={() => !preview && document.getElementById('blueprint-input').click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          id="blueprint-input"
          type="file"
          accept="image/*,.pdf"
          onChange={handleInputChange}
          style={{ display: 'none' }}
        />
        
        {!preview ? (
          <>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>📄</div>
            <h3 style={{ color: '#fff', margin: '0 0 8px 0', fontSize: '16px' }}>
              Upload Blueprint or Floor Plan
            </h3>
            <p style={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: '13px', margin: '8px 0' }}>
              Click to browse or drag & drop
            </p>
            <p style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: '11px', margin: '4px 0' }}>
              Supports: JPG, PNG, PDF
            </p>
          </>
        ) : (
          <div>
            <img 
              src={preview} 
              alt="Blueprint preview"
              style={{
                maxWidth: '100%',
                maxHeight: '300px',
                borderRadius: '4px',
                marginBottom: '12px',
                border: '1px solid rgba(255, 255, 255, 0.2)'
              }}
            />
            <p style={{ color: '#64c8ff', fontSize: '13px', fontWeight: '500', marginBottom: '12px' }}>
              ✓ Blueprint loaded: {file?.name}
            </p>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleRemove();
              }}
              style={{
                padding: '8px 16px',
                background: 'rgba(255, 100, 100, 0.2)',
                border: '1px solid rgba(255, 100, 100, 0.3)',
                borderRadius: '6px',
                color: '#fff',
                cursor: 'pointer',
                fontSize: '13px'
              }}
            >
              Remove
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default BlueprintUploader;
