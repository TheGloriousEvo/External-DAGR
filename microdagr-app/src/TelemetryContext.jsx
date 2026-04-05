import React, { createContext, useContext, useState, useEffect, useRef } from 'react';

// Create the context for Live Arma 3 Data
const TelemetryContext = createContext();

const INITIAL_TELEMETRY = {
  time: '---',
  date: '---',
  heading: null,
  speed: null,
  asl: null,
  worldName: '',
  worldSize: 0,
  posX: null,
  posY: null,
  gridX: '---',
  gridY: '---',
  targetName: '---',
  targetRange: -1,
  targetHeading: -1,
  targetGrid: '---',
  targetGridX: '---',
  targetGridY: '---',
  targetSource: 'none',
  mapMarkers: [],
  waypoints: [],
};

const POSITION_LERP = 0.5;
const HEADING_LERP = 0.8;
const POSITION_EPSILON = 0.05;
const HEADING_EPSILON = 0.1;

function normalizeHeading(degrees) {
  let value = degrees % 360;
  if (value < 0) value += 360;
  return value;
}

function shortestHeadingDelta(from, to) {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

export function TelemetryProvider({ children }) {
  const [data, setData] = useState(INITIAL_TELEMETRY);

  const [connected, setConnected] = useState(false);
  const ws = useRef(null);
  const targetDataRef = useRef(INITIAL_TELEMETRY);
  const pendingMarkerResetRef = useRef(false);

  function updateTargetData(patch) {
    const current = targetDataRef.current;
    let next = { ...current };

    if (Array.isArray(patch.mapMarkers)) {
      next.mapMarkers = patch.mapMarkers;
      pendingMarkerResetRef.current = false;
    } else {
      if (patch.mapMarkersReset === true) {
        pendingMarkerResetRef.current = true;
      }

      if (Array.isArray(patch.mapMarkersChunk)) {
        const existing = pendingMarkerResetRef.current
          ? []
          : (Array.isArray(next.mapMarkers) ? next.mapMarkers : []);
        next.mapMarkers = [...existing, ...patch.mapMarkersChunk];
        pendingMarkerResetRef.current = false;
      }
    }

    const normalizedPatch = { ...patch };
    delete normalizedPatch.mapMarkersReset;
    delete normalizedPatch.mapMarkersChunk;

    next = { ...next, ...normalizedPatch };
    targetDataRef.current = next;
  }

  useEffect(() => {
    let rafId = 0;

    function tick() {
      setData((current) => {
        const target = targetDataRef.current;
        const next = { ...current, ...target };

        if (Number.isFinite(current.posX) && Number.isFinite(target.posX)) {
          const deltaX = target.posX - current.posX;
          next.posX = Math.abs(deltaX) <= POSITION_EPSILON
            ? target.posX
            : current.posX + (deltaX * POSITION_LERP);
        }

        if (Number.isFinite(current.posY) && Number.isFinite(target.posY)) {
          const deltaY = target.posY - current.posY;
          next.posY = Math.abs(deltaY) <= POSITION_EPSILON
            ? target.posY
            : current.posY + (deltaY * POSITION_LERP);
        }

        if (Number.isFinite(current.heading) && Number.isFinite(target.heading)) {
          const targetHeading = normalizeHeading(target.heading);
          const deltaHeading = shortestHeadingDelta(current.heading, targetHeading);
          next.heading = Math.abs(deltaHeading) <= HEADING_EPSILON
            ? targetHeading
            : normalizeHeading(current.heading + (deltaHeading * HEADING_LERP));
        }

        const changed = (
          next.time !== current.time ||
          next.date !== current.date ||
          next.heading !== current.heading ||
          next.speed !== current.speed ||
          next.asl !== current.asl ||
          next.worldName !== current.worldName ||
          next.worldSize !== current.worldSize ||
          next.posX !== current.posX ||
          next.posY !== current.posY ||
          next.gridX !== current.gridX ||
          next.gridY !== current.gridY ||
          next.targetName !== current.targetName ||
          next.targetRange !== current.targetRange ||
          next.targetHeading !== current.targetHeading ||
          next.targetGrid !== current.targetGrid ||
          next.targetGridX !== current.targetGridX ||
          next.targetGridY !== current.targetGridY ||
          next.targetSource !== current.targetSource ||
          next.mapMarkers !== current.mapMarkers ||
          next.waypoints !== current.waypoints
        );

        return changed ? next : current;
      });

      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // WEBSOCKET LOGIC
  useEffect(() => {
    // Determine the websocket URL dynamically so it works from mobile devices too
    const hostname = window.location.hostname;
    const wsUrl = `ws://${hostname}:8080`;
    let reconnectTimeout = null;

    const connectWS = () => {
      ws.current = new WebSocket(wsUrl);

      ws.current.onopen = () => {
        console.log('Connected to Arma Bridge');
        setConnected(true);
      };

      ws.current.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          updateTargetData(payload);
        } catch (e) {
          console.error('Failed to parse Arma Telemetry:', e);
        }
      };

      ws.current.onclose = () => {
        setConnected(false);
        // Attempt reconnect every 2s
        reconnectTimeout = setTimeout(connectWS, 2000);
      };

      ws.current.onerror = (err) => {
        // Silently fail if bridge is off
        ws.current.close();
      };
    };

    connectWS();

    return () => {
      if (ws.current) ws.current.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, []);

  return (
    <TelemetryContext.Provider value={{ data, connected }}>
      {children}
    </TelemetryContext.Provider>
  );
}

export function useTelemetry() {
  return useContext(TelemetryContext);
}
