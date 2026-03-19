import React, { useState } from 'react';
import {
  EnvironmentOutlined,
  DragOutlined,
  SunOutlined,
  SearchOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import { Layout } from 'antd';

import MapComponent from '../components/MapComponent';
import Calculator from '../components/Calculator';
import EnhancedSolarPanel3D from '../components/EnhancedSolarPanel3D';
import BlueprintUploader from '../components/BlueprintUploader';
import EnhancedBlueprintTracer from '../components/EnhancedBlueprintTracer';
import AutoRoofDetector from '../components/AutoRoofDetector';

import './App.css';

const { Sider } = Layout;

const Home = () => {
  const [collapsed, setCollapsed] = useState(false);
  const [activeStep, setActiveStep] = useState('locate');
  const [drawingMode, setDrawingMode] = useState(null);
  const [mapType, setMapType] = useState('satellite');
  const [show3D, setShow3D] = useState(false);
  const [mapInstance, setMapInstance] = useState(null);

  const [usableArea, setUsableArea] = useState(0);
  const [totalArea, setTotalArea] = useState(0);
  const [solarIrradiance, setSolarIrradiance] = useState(5);
  
  const [roofPolygon, setRoofPolygon] = useState(null);
  const [obstaclePolygons, setObstaclePolygons] = useState([]);
  
  
  // Blueprint upload state
  const [inputMethod, setInputMethod] = useState('map'); // 'map' or 'blueprint'
  const [blueprintImage, setBlueprintImage] = useState(null);
  const [blueprintData, setBlueprintData] = useState(null);

  const handleAreaSelected = (total, usable) => {
    setTotalArea(total);
    setUsableArea(usable);
  };

  const handleLocationChange = async (lat, lng) => {
    try {
      const res = await fetch(
        `http://localhost:5000/api/solar/irradiance?latitude=${lat}&longitude=${lng}`
      );
      const data = await res.json();
      setSolarIrradiance(data.irradiance || 5);
    } catch (error) {
      console.log('Using default irradiance value');
      setSolarIrradiance(5);
    }
  };

  // Enhanced Blueprint handler
  const handleBlueprintUploaded = (image, filename) => {
    console.log('Blueprint uploaded:', filename);
    setBlueprintImage(image);
  };

  // Enhanced Blueprint complete handler with full data structure
  const handleBlueprintComplete = (data) => {
    console.log(' Blueprint processing complete:', data);
    setBlueprintData(data);
    
    // Calculate area from dimensions (convert sq ft to sq m)
    const areaInSqFt = data.dimensions.width * data.dimensions.length;
    const areaInSqM = areaInSqFt * 0.092903;
    
    // Account for detected features (chimneys, skylights, vents)
    let obstacleAreaSqM = 0;
    if (data.features) {
      // Chimneys: typically 0.8m x 0.8m = 0.64 sq m each
      obstacleAreaSqM += (data.features.chimneys?.length || 0) * 0.64;
      
      // Skylights: use actual dimensions if available
      if (data.features.skylights) {
        data.features.skylights.forEach(skylight => {
          const widthM = (skylight.width || 3) * 0.3048;
          const lengthM = (skylight.length || 4) * 0.3048;
          obstacleAreaSqM += widthM * lengthM;
        });
      }
      
      // Vents: typically 0.3m x 0.3m = 0.09 sq m each
      obstacleAreaSqM += (data.features.vents?.length || 0) * 0.09;
    }
    
    const usableAreaSqM = Math.max(0, areaInSqM - obstacleAreaSqM);
    
    setTotalArea(areaInSqM);
    setUsableArea(usableAreaSqM);
    
    console.log(' Area calculations:', {
      totalSqFt: areaInSqFt,
      totalSqM: areaInSqM,
      obstacleSqM: obstacleAreaSqM,
      usableSqM: usableAreaSqM,
      roofPitch: data.roofPitch,
      roofType: data.roofType
    });
  };

  // Clear drawing function for map-based input
  const handleClearDrawing = () => {
    if (window.clearMapPolygons) {
      window.clearMapPolygons();
    }
    setRoofPolygon(null);
    setObstaclePolygons([]);
    setTotalArea(0);
    setUsableArea(0);
  };

  // Clear blueprint data
  const handleClearBlueprint = () => {
    setBlueprintImage(null);
    setBlueprintData(null);
    setTotalArea(0);
    setUsableArea(0);
  };

  // Auto-detect roof handler
  const handleAutoDetectRoof = (polygon) => {
    console.log(' Auto-detected roof:', polygon);
    setRoofPolygon(polygon);
    
    // Calculate area
    if (window.google?.maps?.geometry) {
      const path = polygon.map(p => new window.google.maps.LatLng(p.lat, p.lng));
      const area = window.google.maps.geometry.spherical.computeArea(path);
      setTotalArea(area);
      setUsableArea(area);
    }
  };

  // Switch input method
  const handleInputMethodChange = (method) => {
    setInputMethod(method);
    
    // Clear previous data when switching
    if (method === 'map') {
      handleClearBlueprint();
    } else {
      handleClearDrawing();
    }
  };

  return (
    <Layout className="main-layout">
      {/* FULLSCREEN MAP */}
      <MapComponent
        onAreaSelected={handleAreaSelected}
        onLocationChange={handleLocationChange}
        drawingMode={drawingMode}
        setDrawingMode={setDrawingMode}
        mapType={mapType}
        showSearchInSidebar={!collapsed && activeStep === 'locate'}
        onRoofPolygonComplete={setRoofPolygon}
        onObstaclePolygonComplete={(polygon) => setObstaclePolygons(prev => [...prev, polygon])}
        onMapLoad={setMapInstance}
      />

      {/* ENHANCED 3D SOLAR PANEL VIEW — only mount when data exists AND user clicked View 3D */}
      {show3D && (blueprintData || roofPolygon) && (
        <EnhancedSolarPanel3D
          blueprintData={blueprintData}
          roofPolygon={roofPolygon}
          obstacles={obstaclePolygons}
          show3D={show3D}
          onClose={() => setShow3D(false)}
        />
      )}

      {/* GLASS SIDEBAR WITH INTEGRATED CONTENT */}
      <Sider
        trigger={null}
        collapsible
        collapsed={collapsed}
        width={inputMethod === 'blueprint' && blueprintImage && activeStep === 'define' ? 600 : 400}
        collapsedWidth={80}
        className="glass-sider"
      >
        {/* LOGO */}
        <div className={`logo-container ${collapsed ? 'collapsed' : ''}`} style={{ position: 'relative' }}>
          <img 
            src="/voltera.png" 
            alt="Logo" 
            className="logo-img"
            style={{ width: '35px', height: '35px' }}
          />
          {!collapsed && <span className="logo-text">Voltera</span>}
          {/* Manual collapse/expand toggle */}
          <div
            onClick={() => setCollapsed(c => !c)}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            style={{
              position: 'absolute', right: collapsed ? '50%' : 12,
              transform: collapsed ? 'translateX(50%)' : 'none',
              top: '50%', marginTop: -14,
              width: 28, height: 28, borderRadius: '50%',
              background: 'rgba(100,200,255,0.15)',
              border: '1px solid rgba(100,200,255,0.35)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', fontSize: 13, color: '#64c8ff',
              transition: 'all 0.3s',
              flexShrink: 0,
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(100,200,255,0.3)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(100,200,255,0.15)'}
          >
            {collapsed ? '›' : '‹'}
          </div>
        </div>

        {/* MENU ICONS WITH DIVIDERS */}
        <div className="menu-icons-container">
          <div className="menu-icon-wrapper" data-tooltip="Locate">
            <div
              className={`menu-icon ${activeStep === 'locate' ? 'active' : ''}`}
              onClick={() => setActiveStep('locate')}
            >
              <EnvironmentOutlined />
            </div>
          </div>

          <div className="menu-icon-wrapper" data-tooltip="Define">
            <div
              className={`menu-icon ${activeStep === 'define' ? 'active' : ''}`}
              onClick={() => setActiveStep('define')}
            >
              <DragOutlined />
            </div>
          </div>

          <div className="menu-icon-wrapper" data-tooltip="Optimize">
            <div
              className={`menu-icon ${activeStep === 'optimize' ? 'active' : ''}`}
              onClick={() => setActiveStep('optimize')}
            >
              <SunOutlined />
            </div>
          </div>

          <div className="menu-icon-wrapper" data-tooltip="View 3D">
            <div
              className={`menu-icon ${show3D ? 'active' : ''}`}
              onClick={() => (roofPolygon || blueprintData) && setShow3D(true)}
              style={{ 
                opacity: (roofPolygon || blueprintData) ? 1 : 0.5, 
                cursor: (roofPolygon || blueprintData) ? 'pointer' : 'not-allowed' 
              }}
            >
              <EyeOutlined />
            </div>
          </div>
        </div>

        {/* SEPARATOR */}
        {!collapsed && activeStep !== 'locate' && (
          <div className="sidebar-separator" />
        )}

        {/* INTEGRATED CONTENT */}
        {!collapsed && (
          <div className="sidebar-content">
            {activeStep === 'locate' && (
              <div className="content-section welcome-section">
                <div className="welcome-icon">
                  <SearchOutlined />
                </div>
                <h2>Welcome to Voltera</h2>
                <p>
                  Find your location to start your solar energy assessment
                </p>
                
                <div className="instruction-list">
                  <h3>Quick Start Guide</h3>
                  <ol>
                    <li>Search for your location below</li>
                    <li>Zoom in to see your building clearly</li>
                    <li>Switch to Define tab to mark your roof</li>
                    <li>View solar potential in Optimize tab</li>
                  </ol>
                </div>

                {/* Search Box */}
                <div className="map-controls">
                  <input
                    id="sidebar-search"
                    type="text"
                    placeholder=" Search location (e.g., Mumbai, India)"
                    style={{
                      width: '100%',
                      padding: '12px',
                      background: 'rgba(255, 255, 255, 0.1)',
                      border: '1px solid rgba(255, 255, 255, 0.2)',
                      borderRadius: '6px',
                      color: '#fff',
                      fontSize: '14px'
                    }}
                  />

                  {/* Map View Toggle */}
                  <div className="map-view-toggle">
                    <button
                      onClick={() => setMapType('satellite')}
                      className={mapType === 'satellite' ? 'active' : ''}
                    >
                       Satellite
                    </button>
                    <button
                      onClick={() => setMapType('roadmap')}
                      className={mapType === 'roadmap' ? 'active' : ''}
                    >
                       Map
                    </button>
                    <button
                      onClick={() => setMapType('hybrid')}
                      className={mapType === 'hybrid' ? 'active' : ''}
                    >
                       Hybrid
                    </button>
                  </div>
                </div>

                {/* Location Info */}
                <div className="info-card" style={{ marginTop: '16px' }}>
                  <p className="info-item">
                    <strong>Solar Irradiance:</strong> {solarIrradiance.toFixed(2)} kWh/m²/day
                  </p>
                  <p className="info-item" style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.7)' }}>
                    This value updates automatically when you search for a new location
                  </p>
                </div>
              </div>
            )}

            {activeStep === 'define' && (
              <div className="content-section">
                <h2 className="content-title">Define Roof Area</h2>

                {/* INPUT METHOD SELECTOR - ENHANCED */}
                <div style={{
                  display: 'flex',
                  gap: '10px',
                  marginBottom: '20px',
                  padding: '4px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  borderRadius: '8px',
                  border: '1px solid rgba(255, 255, 255, 0.1)'
                }}>
                  <button
                    onClick={() => handleInputMethodChange('map')}
                    style={{
                      flex: 1,
                      padding: '12px',
                      background: inputMethod === 'map' 
                        ? 'linear-gradient(135deg, rgba(100, 200, 255, 0.3), rgba(100, 150, 255, 0.4))' 
                        : 'transparent',
                      border: inputMethod === 'map' 
                        ? '2px solid rgba(100, 200, 255, 0.6)' 
                        : '2px solid transparent',
                      borderRadius: '6px',
                      color: '#fff',
                      cursor: 'pointer',
                      fontSize: '14px',
                      fontWeight: '600',
                      transition: 'all 0.3s',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <span style={{ fontSize: '20px' }}></span>
                    <span>Map Drawing</span>
                  </button>
                  
                  <button
                    onClick={() => handleInputMethodChange('blueprint')}
                    style={{
                      flex: 1,
                      padding: '12px',
                      background: inputMethod === 'blueprint' 
                        ? 'linear-gradient(135deg, rgba(100, 200, 255, 0.3), rgba(100, 150, 255, 0.4))' 
                        : 'transparent',
                      border: inputMethod === 'blueprint' 
                        ? '2px solid rgba(100, 200, 255, 0.6)' 
                        : '2px solid transparent',
                      borderRadius: '6px',
                      color: '#fff',
                      cursor: 'pointer',
                      fontSize: '14px',
                      fontWeight: '600',
                      transition: 'all 0.3s',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <span style={{ fontSize: '20px' }}></span>
                    <span>Blueprint Upload</span>
                  </button>
                </div>

                {/* MAP DRAWING METHOD */}
                {inputMethod === 'map' && (
                  <>
                    {/* AUTO-DETECT ROOF FEATURE */}
                    <AutoRoofDetector 
                      map={mapInstance}
                      onRoofDetected={handleAutoDetectRoof}
                      onError={(error) => console.error('Auto-detect error:', error)}
                    />

                    {/* ACTIVE DRAWING BANNER — visible only while drawing */}
                    {drawingMode && (
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 14px',
                        marginBottom: '10px',
                        background: drawingMode === 'roof'
                          ? 'rgba(0, 220, 80, 0.15)'
                          : 'rgba(255, 60, 60, 0.15)',
                        border: drawingMode === 'roof'
                          ? '1px solid rgba(0, 220, 80, 0.45)'
                          : '1px solid rgba(255, 80, 80, 0.45)',
                        borderRadius: '7px',
                        animation: 'pulse-border 1.5s ease-in-out infinite',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {/* Pulsing dot */}
                          <span style={{
                            display: 'inline-block',
                            width: '9px', height: '9px',
                            borderRadius: '50%',
                            background: drawingMode === 'roof' ? '#00dd55' : '#ff4444',
                            boxShadow: drawingMode === 'roof'
                              ? '0 0 6px rgba(0,220,80,0.8)'
                              : '0 0 6px rgba(255,60,60,0.8)',
                            animation: 'blink 1s step-start infinite',
                          }} />
                          <span style={{ fontSize: '13px', fontWeight: '600', color: '#fff' }}>
                            {drawingMode === 'roof' ? 'Drawing Roof...' : 'Drawing Obstacle...'}
                          </span>
                          <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.55)' }}>
                            Click map to place points
                          </span>
                        </div>

                        <button
                          onClick={() => {
                            setDrawingMode(null);
                            if (window.stopDrawing) window.stopDrawing();
                          }}
                          style={{
                            padding: '5px 12px',
                            background: 'rgba(255,255,255,0.12)',
                            border: '1px solid rgba(255,255,255,0.3)',
                            borderRadius: '5px',
                            color: '#fff',
                            cursor: 'pointer',
                            fontSize: '12px',
                            fontWeight: '700',
                            letterSpacing: '0.2px',
                            transition: 'background 0.2s',
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.22)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'}
                        >
                          Stop Drawing
                        </button>
                      </div>
                    )}

                    <div className="drawing-tools">
                      <button
                        onClick={() => {
                          if (drawingMode === 'roof') {
                            setDrawingMode(null);
                            if (window.stopDrawing) window.stopDrawing();
                          } else {
                            setDrawingMode('roof');
                          }
                        }}
                        className={drawingMode === 'roof' ? 'active' : ''}
                        style={{
                          background: drawingMode === 'roof'
                            ? 'rgba(0, 220, 80, 0.25)'
                            : 'rgba(255, 255, 255, 0.1)',
                          borderColor: drawingMode === 'roof'
                            ? 'rgba(0, 220, 80, 0.5)'
                            : 'rgba(255, 255, 255, 0.2)',
                          opacity: drawingMode === 'obstacle' ? 0.45 : 1,
                          cursor: drawingMode === 'obstacle' ? 'not-allowed' : 'pointer',
                        }}
                        disabled={drawingMode === 'obstacle'}
                      >
                        Draw Roof Area
                      </button>

                      <button
                        onClick={() => {
                          if (drawingMode === 'obstacle') {
                            setDrawingMode(null);
                            if (window.stopDrawing) window.stopDrawing();
                          } else {
                            setDrawingMode('obstacle');
                          }
                        }}
                        className={drawingMode === 'obstacle' ? 'active' : ''}
                        style={{
                          background: drawingMode === 'obstacle'
                            ? 'rgba(255, 60, 60, 0.25)'
                            : 'rgba(255, 255, 255, 0.1)',
                          borderColor: drawingMode === 'obstacle'
                            ? 'rgba(255, 80, 80, 0.5)'
                            : 'rgba(255, 255, 255, 0.2)',
                          opacity: drawingMode === 'roof' ? 0.45 : 1,
                          cursor: drawingMode === 'roof' ? 'not-allowed' : 'pointer',
                        }}
                        disabled={drawingMode === 'roof'}
                      >
                        Mark Obstacles
                      </button>

                      <button
                        onClick={handleClearDrawing}
                        className="danger"
                        disabled={!!drawingMode || (!roofPolygon && obstaclePolygons.length === 0)}
                        style={{
                          opacity: (drawingMode || (!roofPolygon && obstaclePolygons.length === 0)) ? 0.45 : 1,
                          cursor: (drawingMode || (!roofPolygon && obstaclePolygons.length === 0)) ? 'not-allowed' : 'pointer',
                        }}
                      >
                        Clear All
                      </button>
                    </div>

                    <style>{`
                      @keyframes blink {
                        0%, 100% { opacity: 1; }
                        50% { opacity: 0.2; }
                      }
                      @keyframes pulse-border {
                        0%, 100% { box-shadow: 0 0 0 0 rgba(100,200,255,0); }
                        50% { box-shadow: 0 0 0 3px rgba(100,200,255,0.12); }
                      }
                    `}</style>

                    {/* AREA INFO */}
                    {totalArea > 0 && (
                      <div className="info-card">
                        <p className="info-item">
                          Total Roof Area: <b>{totalArea.toFixed(2)} m²</b>
                        </p>
                        <p className="info-item">
                          Usable Area: <b>{usableArea.toFixed(2)} m²</b>
                        </p>
                        {obstaclePolygons.length > 0 && (
                          <p className="info-item">
                            Obstacles Marked: <b>{obstaclePolygons.length}</b>
                          </p>
                        )}
                      </div>
                    )}

                  </>
                )}

                {/* BLUEPRINT METHOD - ENHANCED */}
                {inputMethod === 'blueprint' && (
                  <>
                    {!blueprintImage ? (
                      <BlueprintUploader onBlueprintUploaded={handleBlueprintUploaded} />
                    ) : (
                      <EnhancedBlueprintTracer 
                        blueprintImage={blueprintImage}
                        onComplete={handleBlueprintComplete}
                      />
                    )}

                    {/* BLUEPRINT INFO - Enhanced with detected features */}
                    {blueprintData && (
                      <div className="info-card" style={{ marginTop: '16px' }}>
                        <h3 style={{ 
                          margin: '0 0 12px 0', 
                          fontSize: '15px',
                          color: '#00ff64',
                          borderBottom: '1px solid rgba(0, 255, 100, 0.3)',
                          paddingBottom: '8px'
                        }}>
                           Blueprint Information
                        </h3>
                        
                        {blueprintData.dimensions && (
                          <p className="info-item">
                            <strong> Dimensions:</strong> {blueprintData.dimensions.width}' × {blueprintData.dimensions.length}'
                          </p>
                        )}
                        
                        {blueprintData.roofPitchNotation && (
                          <p className="info-item">
                            <strong> Roof Pitch:</strong> {blueprintData.roofPitchNotation} ({(Math.atan(blueprintData.roofPitch) * 180 / Math.PI).toFixed(1)}°)
                          </p>
                        )}
                        
                        {blueprintData.roofType && (
                          <p className="info-item">
                            <strong> Roof Type:</strong> {blueprintData.roofType.charAt(0).toUpperCase() + blueprintData.roofType.slice(1)}
                          </p>
                        )}
                        
                        {blueprintData.buildingType && (
                          <p className="info-item">
                            <strong> Building:</strong> {blueprintData.buildingType.charAt(0).toUpperCase() + blueprintData.buildingType.slice(1)}
                          </p>
                        )}
                        
                        {blueprintData.wallHeight && (
                          <p className="info-item">
                            <strong> Wall Height:</strong> {blueprintData.wallHeight}'
                          </p>
                        )}
                        
                        <p className="info-item">
                          <strong> Total Area:</strong> {totalArea.toFixed(2)} m² ({(totalArea * 10.764).toFixed(0)} sq ft)
                        </p>
                        
                        <p className="info-item">
                          <strong> Usable Area:</strong> {usableArea.toFixed(2)} m²
                        </p>

                        {/* Detected Features */}
                        {blueprintData.features && (
                          <div style={{ 
                            marginTop: '12px',
                            padding: '10px',
                            background: 'rgba(255, 165, 0, 0.1)',
                            borderRadius: '6px',
                            border: '1px solid rgba(255, 165, 0, 0.3)'
                          }}>
                            <p style={{ 
                              margin: '0 0 8px 0', 
                              fontSize: '13px', 
                              fontWeight: 'bold',
                              color: '#ffa500'
                            }}>
                               Detected Features:
                            </p>
                            {blueprintData.features.chimneys?.length > 0 && (
                              <p className="info-item" style={{ fontSize: '12px', margin: '4px 0' }}>
                                • {blueprintData.features.chimneys.length} Chimney{blueprintData.features.chimneys.length > 1 ? 's' : ''}
                              </p>
                            )}
                            {blueprintData.features.skylights?.length > 0 && (
                              <p className="info-item" style={{ fontSize: '12px', margin: '4px 0' }}>
                                • {blueprintData.features.skylights.length} Skylight{blueprintData.features.skylights.length > 1 ? 's' : ''}
                              </p>
                            )}
                            {blueprintData.features.vents?.length > 0 && (
                              <p className="info-item" style={{ fontSize: '12px', margin: '4px 0' }}>
                                • {blueprintData.features.vents.length} Vent{blueprintData.features.vents.length > 1 ? 's' : ''}
                              </p>
                            )}
                            {(!blueprintData.features.chimneys?.length && 
                              !blueprintData.features.skylights?.length && 
                              !blueprintData.features.vents?.length) && (
                              <p className="info-item" style={{ fontSize: '12px', margin: '4px 0', opacity: 0.7 }}>
                                No features detected
                              </p>
                            )}
                          </div>
                        )}

                        {/* Clear Blueprint Button */}
                        <button
                          onClick={handleClearBlueprint}
                          style={{
                            marginTop: '12px',
                            width: '100%',
                            padding: '10px',
                            background: 'rgba(255, 100, 100, 0.2)',
                            border: '1px solid rgba(255, 100, 100, 0.3)',
                            borderRadius: '6px',
                            color: '#fff',
                            cursor: 'pointer',
                            fontSize: '13px',
                            fontWeight: '500',
                            transition: 'all 0.3s'
                          }}
                        >
                           Clear Blueprint & Start Over
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {activeStep === 'optimize' && (
              <div className="content-section">
                <h2 className="content-title">Solar Optimization</h2>
                
                {(usableArea > 0 || blueprintData) ? (
                  <>
                    <Calculator
                      usableArea={usableArea}
                      solarIrradiance={solarIrradiance}
                    />

                    {/* Enhanced 3D View Button */}
                    {(roofPolygon || blueprintData) && (
                      <div style={{ marginTop: '24px' }}>
                        <button
                          onClick={() => setShow3D(true)}
                          style={{
                            width: '100%',
                            padding: '14px',
                            background: 'linear-gradient(135deg, rgba(100, 200, 255, 0.3), rgba(100, 150, 255, 0.4))',
                            border: '2px solid rgba(100, 200, 255, 0.5)',
                            borderRadius: '8px',
                            color: '#fff',
                            fontSize: '15px',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                            transition: 'all 0.3s',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '10px',
                            boxShadow: '0 4px 12px rgba(100, 200, 255, 0.2)'
                          }}
                          onMouseEnter={(e) => {
                            e.target.style.background = 'linear-gradient(135deg, rgba(100, 200, 255, 0.5), rgba(100, 150, 255, 0.6))';
                            e.target.style.transform = 'translateY(-2px)';
                            e.target.style.boxShadow = '0 6px 20px rgba(100, 200, 255, 0.4)';
                          }}
                          onMouseLeave={(e) => {
                            e.target.style.background = 'linear-gradient(135deg, rgba(100, 200, 255, 0.3), rgba(100, 150, 255, 0.4))';
                            e.target.style.transform = 'translateY(0)';
                            e.target.style.boxShadow = '0 4px 12px rgba(100, 200, 255, 0.2)';
                          }}
                        >
                          <EyeOutlined style={{ fontSize: '20px' }} />
                          {blueprintData ? ' View Realistic 3D Building' : ' View 3D Solar Layout'}
                        </button>
                        <p style={{ 
                          margin: '12px 0 0 0', 
                          fontSize: '12px', 
                          color: 'rgba(255, 255, 255, 0.7)',
                          textAlign: 'center',
                          lineHeight: '1.5'
                        }}>
                          {blueprintData 
                            ? ' See your building with realistic materials, lighting, and solar panels'
                            : ' Visualize your solar panel installation in 3D'
                          }
                        </p>
                      </div>
                    )}

                    {/* Blueprint Info Summary */}
                    {blueprintData && (
                      <div style={{
                        marginTop: '20px',
                        padding: '14px',
                        background: 'rgba(0, 255, 100, 0.1)',
                        borderRadius: '8px',
                        border: '1px solid rgba(0, 255, 100, 0.3)'
                      }}>
                        <p style={{ 
                          margin: '0 0 8px 0', 
                          fontSize: '13px', 
                          fontWeight: 'bold',
                          color: '#00ff64'
                        }}>
                           Blueprint Data Active
                        </p>
                        <p style={{ 
                          margin: '4px 0', 
                          fontSize: '12px', 
                          color: 'rgba(255, 255, 255, 0.8)' 
                        }}>
                          Using: {blueprintData.buildingType || 'Building'} • {blueprintData.roofType || 'Standard'} roof • {blueprintData.dimensions?.width}' × {blueprintData.dimensions?.length}'
                        </p>
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ 
                    padding: '20px', 
                    background: 'rgba(255, 200, 100, 0.1)', 
                    borderRadius: '8px',
                    border: '1px solid rgba(255, 200, 100, 0.3)',
                    textAlign: 'center'
                  }}>
                    <p style={{ 
                      margin: 0, 
                      fontSize: '14px', 
                      color: 'rgba(255, 255, 255, 0.9)',
                      lineHeight: '1.6'
                    }}>
                      ℹ Please define your roof area in the <strong>"Define"</strong> section first
                      <br/><br/>
                      Choose either:
                      <br/>
                       Draw on map
                      <br/>
                       Upload blueprint
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Sider>
    </Layout>
  );
};

export default Home;