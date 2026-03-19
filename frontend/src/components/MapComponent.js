import React, { useState, useCallback, useRef } from "react";
import {
  useJsApiLoader,
  GoogleMap,
  DrawingManager,
} from "@react-google-maps/api";

const containerStyle = {
  position: 'fixed',
  top: 0,
  left: 0,
  width: '100vw',
  height: '100vh',
  zIndex: 0,
};

const center = {
  lat: 20.5937,
  lng: 78.9629,
};

const libraries = ["places", "drawing", "geometry"];

const MapComponent = ({ 
  onAreaSelected, 
  onLocationChange, 
  drawingMode, 
  setDrawingMode, 
  mapType = 'satellite', 
  showSearchInSidebar = false,
  onRoofPolygonComplete,
  onObstaclePolygonComplete,
  onMapLoad
}) => {
  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: process.env.REACT_APP_GOOGLE_MAPS_API_KEY,
    libraries,
  });

  const [map, setMap] = useState(null);
  const [roofArea, setRoofArea] = useState(0);
  const [obstacleAreas, setObstacleAreas] = useState([]);
  const [polygons, setPolygons] = useState([]);
  const [roofPolygonData, setRoofPolygonData] = useState(null);
  const [obstaclePolygonsData, setObstaclePolygonsData] = useState([]);
  const sidebarSearchBoxRef = useRef(null);
  const drawingManagerRef = useRef(null);

  const onLoad = useCallback((mapInstance) => {
    setMap(mapInstance);
    if (onMapLoad) {
      onMapLoad(mapInstance);
    }
  }, [onMapLoad]);

  const onUnmount = useCallback(() => {
    setMap(null);
  }, []);

  // Update map type when it changes
  React.useEffect(() => {
    if (map) {
      map.setMapTypeId(mapType);
    }
  }, [map, mapType]);

  // Setup sidebar search box
  React.useEffect(() => {
    if (!isLoaded || !showSearchInSidebar) return;

    const input = document.getElementById('sidebar-search');
    if (!input || !window.google) return;

    const searchBox = new window.google.maps.places.SearchBox(input);
    sidebarSearchBoxRef.current = searchBox;

    searchBox.addListener('places_changed', () => {
      const places = searchBox.getPlaces();
      if (!places || places.length === 0) return;

      const place = places[0];
      if (!place.geometry || !place.geometry.location) return;

      const lat = place.geometry.location.lat();
      const lng = place.geometry.location.lng();

      onLocationChange(lat, lng);

      if (map) {
        map.setCenter({ lat, lng });
        map.setZoom(18);
      }
    });

    return () => {
      if (sidebarSearchBoxRef.current) {
        window.google.maps.event.clearInstanceListeners(sidebarSearchBoxRef.current);
      }
    };
  }, [isLoaded, showSearchInSidebar, map, onLocationChange]);

  // Stop drawing function
  const stopDrawing = useCallback(() => {
    setDrawingMode(null);
    if (drawingManagerRef.current) {
      drawingManagerRef.current.setDrawingMode(null);
    }
  }, [setDrawingMode]);

  // Expose clear function to parent component
  React.useEffect(() => {
    window.clearMapPolygons = () => {
      polygons.forEach(polygon => polygon.setMap(null));
      setPolygons([]);
      setRoofArea(0);
      setObstacleAreas([]);
      setRoofPolygonData(null);
      setObstaclePolygonsData([]);
      onAreaSelected(0, 0);
    };

    window.stopDrawing = stopDrawing;

    window.getRoofPolygonData = () => roofPolygonData;
    window.getObstaclePolygonsData = () => obstaclePolygonsData;

    return () => {
      delete window.clearMapPolygons;
      delete window.stopDrawing;
      delete window.getRoofPolygonData;
      delete window.getObstaclePolygonsData;
    };
  }, [polygons, onAreaSelected, stopDrawing, roofPolygonData, obstaclePolygonsData]);

  const onPolygonComplete = (polygon) => {
    if (!window.google?.maps?.geometry) return;

    const path = polygon.getPath();
    const area = window.google.maps.geometry.spherical.computeArea(path);

    // Extract polygon coordinates
    const coordinates = [];
    for (let i = 0; i < path.getLength(); i++) {
      const point = path.getAt(i);
      coordinates.push({
        lat: point.lat(),
        lng: point.lng()
      });
    }

    // Store the polygon so we can clear it later
    setPolygons(prev => [...prev, polygon]);

    if (drawingMode === "roof") {
      setRoofArea(area);
      setRoofPolygonData(coordinates);
      if (onRoofPolygonComplete) {
        onRoofPolygonComplete(coordinates);
      }
      const usable = area - obstacleAreas.reduce((sum, a) => sum + a, 0);
      onAreaSelected(area, usable);
    } else if (drawingMode === "obstacle") {
      const updatedObstacles = [...obstacleAreas, area];
      setObstacleAreas(updatedObstacles);

      const updatedObstaclePolygons = [...obstaclePolygonsData, coordinates];
      setObstaclePolygonsData(updatedObstaclePolygons);
      
      if (onObstaclePolygonComplete) {
        onObstaclePolygonComplete(coordinates);
      }

      const usable = roofArea - updatedObstacles.reduce((sum, a) => sum + a, 0);
      onAreaSelected(roofArea, usable);
    }

    // Stop drawing mode after completing a polygon
    stopDrawing();
  };

  const onDrawingManagerLoad = (drawingManager) => {
    drawingManagerRef.current = drawingManager;
  };

  if (!isLoaded) {
    return <div>Loading map...</div>;
  }

  return (
    <div style={{ position: "relative" }}>
      {/* Google Map */}
      <GoogleMap
        mapContainerStyle={containerStyle}
        center={center}
        zoom={5}
        mapTypeId={mapType}
        onLoad={onLoad}
        onUnmount={onUnmount}
        options={{ fullscreenControl: true }}
      >
        {drawingMode && (
          <DrawingManager
            onLoad={onDrawingManagerLoad}
            onPolygonComplete={onPolygonComplete}
            options={{
              drawingControl: false,
              drawingMode: window.google.maps.drawing.OverlayType.POLYGON,
              polygonOptions: {
                fillColor: drawingMode === "roof" ? "#00ff00" : "#ff0000",
                fillOpacity: 0.5,
                strokeWeight: 2,
                strokeColor: drawingMode === "roof" ? "#008000" : "#800000",
                editable: true,
              },
            }}
          />
        )}
      </GoogleMap>

      {/* Cursor / Pan mode button — always visible when a drawing mode is active */}
      {drawingMode && (
        <button
          onClick={stopDrawing}
          title="Return to cursor / pan mode"
          style={{
            position: 'fixed',
            top: '16px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 200,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 18px',
            background: 'rgba(15,25,55,0.92)',
            border: '1px solid rgba(100,200,255,0.45)',
            borderRadius: '20px',
            color: '#fff',
            cursor: 'pointer',
            fontSize: '13px',
            fontWeight: '600',
            backdropFilter: 'blur(8px)',
            boxShadow: '0 4px 18px rgba(0,0,0,0.45)',
            transition: 'background 0.2s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(100,200,255,0.2)'}
          onMouseLeave={e => e.currentTarget.style.background = 'rgba(15,25,55,0.92)'}
        >
          {/* Cursor icon SVG */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 3l14 9-7 1-4 7z"/>
          </svg>
          Return to Cursor Mode
        </button>
      )}
    </div>
  );
};

export default MapComponent;