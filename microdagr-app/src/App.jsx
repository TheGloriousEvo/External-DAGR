import React, { useEffect, useRef, useState } from 'react';
import { useTelemetry } from './TelemetryContext';

const WORLD_MAPS = {
  altis: { label: 'Altis', worldSize: 30720 },
  stratis: { label: 'Stratis', worldSize: 8192 },
  tanoa: { label: 'Tanoa', worldSize: 15360 },
  malden: { label: 'Malden', worldSize: 12800 },
};

const MAP_ZOOM_DEFAULT = 8.5;
const MAP_ZOOM_MIN = 0.6;
const MAP_ZOOM_MAX = 10;
const MAP_ZOOM_STEP = 0.1;
const MAP_ZOOM_HIGH_END_BOOST = 2.4;
const ATLAS_RENDER_SCALE = 1.0;
const ATLAS_SHIFT_METERS_X = 0;
const ATLAS_SHIFT_METERS_Y = 0;
const MAP_LAYER_OPTIONS = [
  { id: 'atlas', label: 'TOP' },
  { id: 'native', label: 'SAT' },
];

function createEmptyLayerMapInfo(message = 'Waiting for bridge map data...') {
  return {
    loading: false,
    available: false,
    url: '',
    message,
    source: '',
    fileName: '',
    imageWidth: null,
    imageHeight: null,
    status: '',
    progress: 0,
    updatedAt: 0,
    transform: null,
  };
}

function createInitialLayerMapState(message = 'Waiting for bridge map data...') {
  return MAP_LAYER_OPTIONS.reduce((acc, layer) => {
    acc[layer.id] = createEmptyLayerMapInfo(message);
    return acc;
  }, {});
}

function createInitialLayerImageSizeState() {
  return MAP_LAYER_OPTIONS.reduce((acc, layer) => {
    acc[layer.id] = { width: 0, height: 0 };
    return acc;
  }, {});
}
const MAP_WORLD_CALIBRATION = {
  offsetX: 0,
  offsetY: 0,
  scaleX: 1,
  scaleY: 1,
};
const COMPASS_TICK_DEGREES = Array.from({ length: 180 }, (_, idx) => idx * 2);
const COMPASS_LABEL_DEGREES = Array.from({ length: 36 }, (_, idx) => idx * 10);

function getTouchDistance(touches) {
  if (!touches || touches.length < 2) return 0;
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatMeters(value) {
  if (!Number.isFinite(value)) return '---';
  return Math.round(value).toString();
}

function formatHeadingDisplay(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '---';
  return `${num.toFixed(1)}deg`;
}

function formatSpeedDisplay(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '---';
  return Math.round(num).toString();
}

function formatAslDisplay(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '---';
  return `${num >= 0 ? '+' : ''}${Math.round(num)}`;
}

function toGridPart(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length >= 5) return digits.slice(-5);
  return digits;
}

function toGridPartFixed(rawNumber) {
  const num = Number(rawNumber);
  if (!Number.isFinite(num)) return null;
  const bounded = Math.max(0, Math.min(99999, Math.floor(num)));
  return String(bounded).padStart(5, '0');
}

function calibrateWorldCoordinate(x, y, worldSize) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(worldSize) || worldSize <= 0) {
    return { x, y };
  }

  const center = worldSize * 0.5;
  return {
    x: center + ((x - center) * MAP_WORLD_CALIBRATION.scaleX) + MAP_WORLD_CALIBRATION.offsetX,
    y: center + ((y - center) * MAP_WORLD_CALIBRATION.scaleY) + MAP_WORLD_CALIBRATION.offsetY,
  };
}

function normalizeMapTransform(rawTransform) {
  const scaleX = Number(rawTransform?.scaleX);
  const scaleY = Number(rawTransform?.scaleY);
  const offsetX = Number(rawTransform?.offsetX);
  const offsetY = Number(rawTransform?.offsetY);
  const sizeInMeters = Number(rawTransform?.sizeInMeters);
  const sizeX = Number(rawTransform?.sizeX);
  const sizeY = Number(rawTransform?.sizeY);
  const originX = Number(rawTransform?.originX);
  const originY = Number(rawTransform?.originY);

  return {
    scaleX: Number.isFinite(scaleX) ? scaleX : 1,
    scaleY: Number.isFinite(scaleY) ? scaleY : 1,
    offsetX: Number.isFinite(offsetX) ? offsetX : 0,
    offsetY: Number.isFinite(offsetY) ? offsetY : 0,
    sizeInMeters: Number.isFinite(sizeInMeters) && sizeInMeters > 0 ? sizeInMeters : null,
    sizeX: Number.isFinite(sizeX) && sizeX > 0 ? sizeX : null,
    sizeY: Number.isFinite(sizeY) && sizeY > 0 ? sizeY : null,
    originX: Number.isFinite(originX) ? originX : 0,
    originY: Number.isFinite(originY) ? originY : 0,
  };
}

function projectWorldToMapNormalized(x, y, worldSize, mapTransform) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(worldSize) || worldSize <= 0) {
    return { x: 0.5, y: 0.5 };
  }

  const uniformSize = Number.isFinite(mapTransform.sizeInMeters) && mapTransform.sizeInMeters > 0
    ? mapTransform.sizeInMeters
    : worldSize;
  const baseSizeX = Number.isFinite(mapTransform.sizeX) && mapTransform.sizeX > 0
    ? (mapTransform.sizeInMeters || mapTransform.sizeX)
    : uniformSize;
  const baseSizeY = Number.isFinite(mapTransform.sizeY) && mapTransform.sizeY > 0
    ? (mapTransform.sizeInMeters || mapTransform.sizeY)
    : uniformSize;
  const baseX = (x - mapTransform.originX) / baseSizeX;
  const baseY = 1 - ((y - mapTransform.originY) / baseSizeY);
  return {
    x: (baseX * mapTransform.scaleX) + mapTransform.offsetX,
    y: (baseY * mapTransform.scaleY) + mapTransform.offsetY,
  };
}

function rgbaArrayToCss(rgba, fallback = 'rgba(255, 211, 79, 0.95)') {
  if (!Array.isArray(rgba) || rgba.length < 3) return fallback;
  const r = Math.round(clamp(Number(rgba[0]) || 0, 0, 1) * 255);
  const g = Math.round(clamp(Number(rgba[1]) || 0, 0, 1) * 255);
  const b = Math.round(clamp(Number(rgba[2]) || 0, 0, 1) * 255);
  const a = clamp(Number(rgba[3]) || 1, 0.12, 1);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function isNeutralMarkerRgb(r, g, b) {
  const maxV = Math.max(r, g, b);
  const minV = Math.min(r, g, b);
  const spread = maxV - minV;
  const avg = (r + g + b) / 3;
  return spread < 0.08 || avg < 0.12 || avg > 0.9;
}

function markerSideTint(typeKey) {
  const value = String(typeKey || '').toLowerCase();
  if (!value) return null;
  if (value.startsWith('b_')) return [0.29, 0.61, 1.0];
  if (value.startsWith('o_')) return [0.95, 0.34, 0.34];
  if (value.startsWith('n_')) return [0.35, 0.83, 0.35];
  if (value.startsWith('c_')) return [0.92, 0.92, 0.92];
  if (value.startsWith('u_')) return [1.0, 0.83, 0.31];
  return null;
}

function normalizeColorKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function shouldPreferSideTint(typeKey, colorName) {
  const key = String(typeKey || '').toLowerCase();
  const color = normalizeColorKey(colorName);
  const isSideScoped = key.startsWith('b_') || key.startsWith('o_') || key.startsWith('n_') || key.startsWith('respawn_');
  if (!isSideScoped) return false;

  return color === ''
    || color === 'default'
    || color === 'colorwhite'
    || color === 'colorblack'
    || color === 'colorgrey'
    || color === 'colorgray'
    || color === 'colorunknown'
    || color === 'unknown'
    || color === 'lado'
    || color === 'ladodesconocido';
}

function markerColorToCss(marker, markerType = '', markerIconPath = '') {
  const typeKey = markerTypeKey(markerType, markerIconPath);
  const sideTint = markerSideTint(typeKey);
  const markerAlpha = Number(marker?.a);
  const alphaMultiplier = Number.isFinite(markerAlpha) ? clamp(markerAlpha, 0.05, 1) : 1;
  const colorRaw = String(marker?.c || marker?.color || '');
  const colorName = normalizeColorKey(colorRaw);
  const preferSideTint = shouldPreferSideTint(typeKey, colorName);
  const colorMap = {
    default: [0.0, 0.0, 0.0, 1.0],
    colorblack: [0.0, 0.0, 0.0, 1.0],
    colorgrey: [0.5, 0.5, 0.5, 1.0],
    colorgray: [0.5, 0.5, 0.5, 1.0],
    colorred: [0.9, 0.0, 0.0, 1.0],
    colorbrown: [0.5, 0.25, 0.0, 1.0],
    colororange: [0.85, 0.4, 0.0, 1.0],
    coloryellow: [0.85, 0.85, 0.0, 1.0],
    colorkhaki: [0.5, 0.6, 0.4, 1.0],
    colorgreen: [0.0, 0.8, 0.0, 1.0],
    colorblue: [0.0, 0.0, 1.0, 1.0],
    colorpink: [1.0, 0.3, 0.4, 1.0],
    colorwhite: [1.0, 1.0, 1.0, 1.0],
    colorwest: [0.0, 0.3, 0.6, 1.0],
    coloreast: [0.5, 0.0, 0.0, 1.0],
    colorguer: [0.0, 0.5, 0.0, 1.0],
    colorciv: [0.4, 0.0, 0.5, 1.0],
    colorunknown: [0.7, 0.6, 0.0, 1.0],
    colorblufor: [0.0, 0.3, 0.6, 1.0],
    coloropfor: [0.5, 0.0, 0.0, 1.0],
    colorindependent: [0.0, 0.5, 0.0, 1.0],
    colorcivilian: [0.4, 0.0, 0.5, 1.0],
    colorresistance: [0.0, 0.5, 0.0, 1.0],
    color1_fd_f: [0.69, 0.2, 0.22, 1.0],
    color2_fd_f: [0.68, 0.75, 0.51, 1.0],
    color3_fd_f: [0.94, 0.51, 0.19, 1.0],
    color4_fd_f: [0.4, 0.55, 0.61, 1.0],
    color5_fd_f: [0.69, 0.25, 0.65, 1.0],
    color6_fd_f: [0.35, 0.35, 0.35, 1.0],

    // Common non-class aliases seen in mission scripts/localized UIs.
    blufor: [0.0, 0.3, 0.6, 1.0],
    opfor: [0.5, 0.0, 0.0, 1.0],
    independent: [0.0, 0.5, 0.0, 1.0],
    independient: [0.0, 0.5, 0.0, 1.0],
    independiente: [0.0, 0.5, 0.0, 1.0],
    civ: [0.4, 0.0, 0.5, 1.0],
    civil: [0.4, 0.0, 0.5, 1.0],
    civilian: [0.4, 0.0, 0.5, 1.0],
    unknown: [0.7, 0.6, 0.0, 1.0],
    ladodesconocido: [0.7, 0.6, 0.0, 1.0],
  };

  const mapped = colorMap[colorName] || null;

  const directRgba = [marker?.cr, marker?.cg, marker?.cb, marker?.ca];
  if (directRgba.every((value) => Number.isFinite(Number(value)))) {
    const r = clamp(Number(directRgba[0]), 0, 1);
    const g = clamp(Number(directRgba[1]), 0, 1);
    const b = clamp(Number(directRgba[2]), 0, 1);
    const a = clamp(Number(directRgba[3]) * alphaMultiplier, 0.05, 1);

    if (mapped && isNeutralMarkerRgb(r, g, b) && !isNeutralMarkerRgb(mapped[0], mapped[1], mapped[2])) {
      return rgbaArrayToCss([mapped[0], mapped[1], mapped[2], a]);
    }

    if (sideTint && preferSideTint && isNeutralMarkerRgb(r, g, b)) {
      return rgbaArrayToCss([sideTint[0], sideTint[1], sideTint[2], a]);
    }

    const combinedRgba = [
      r,
      g,
      b,
      a,
    ];
    return rgbaArrayToCss(combinedRgba);
  }

  if (Array.isArray(marker?.rgba)) {
    const rgba = [...marker.rgba];
    const r = clamp(Number(rgba[0]) || 0, 0, 1);
    const g = clamp(Number(rgba[1]) || 0, 0, 1);
    const b = clamp(Number(rgba[2]) || 0, 0, 1);
    rgba[0] = r;
    rgba[1] = g;
    rgba[2] = b;
    rgba[3] = clamp((Number(rgba[3]) || 1) * alphaMultiplier, 0.05, 1);

    if (mapped && isNeutralMarkerRgb(r, g, b) && !isNeutralMarkerRgb(mapped[0], mapped[1], mapped[2])) {
      return rgbaArrayToCss([mapped[0], mapped[1], mapped[2], rgba[3]]);
    }

    if (sideTint && preferSideTint && isNeutralMarkerRgb(r, g, b)) {
      return rgbaArrayToCss([sideTint[0], sideTint[1], sideTint[2], rgba[3]]);
    }
    return rgbaArrayToCss(rgba);
  }

  if (mapped) {
    if (sideTint && preferSideTint && isNeutralMarkerRgb(mapped[0], mapped[1], mapped[2])) {
      return rgbaArrayToCss([sideTint[0], sideTint[1], sideTint[2], clamp((Number(mapped[3]) || 1) * alphaMultiplier, 0.05, 1)]);
    }

    return rgbaArrayToCss([
      mapped[0],
      mapped[1],
      mapped[2],
      clamp((Number(mapped[3]) || 0.95) * alphaMultiplier, 0.05, 1),
    ]);
  }

  if (sideTint) {
    return rgbaArrayToCss([sideTint[0], sideTint[1], sideTint[2], clamp(0.95 * alphaMultiplier, 0.05, 1)]);
  }

  return 'rgba(255, 211, 79, 0.95)';
}

function markerTypeKey(typeName, iconPath) {
  const typeKey = String(typeName || '').trim().toLowerCase();
  if (typeKey) return typeKey;

  const icon = String(iconPath || '').trim().toLowerCase();
  if (!icon) return '';

  const iconFile = icon.split(/[\\/]/).pop() || '';
  const base = iconFile.replace(/\.[a-z0-9]+$/i, '');
  return base.replace(/_ca$/i, '');
}

function markerTypeFallbackCode(typeKey) {
  const normalized = String(typeKey || '').trim().toLowerCase();
  if (!normalized) return '';

  const tokens = normalized
    .split(/[^a-z0-9]+/)
    .filter((token) => token && !['marker', 'markers', 'contact', 'respawn', 'groundsupport', 'loc', 'mil', 'hd'].includes(token));
  if (tokens.length === 0) return normalized.slice(0, 3).toUpperCase();

  if (tokens.length === 1) return tokens[0].slice(0, 3).toUpperCase();
  return `${tokens[0][0] || ''}${tokens[1][0] || ''}`.toUpperCase();
}

function markerTypeToIconFrame(typeKey) {
  const key = String(typeKey || '').toLowerCase();
  if (!key) return 'none';
  if (/^o_/.test(key)) return 'diamond';
  if (/^(b|n|c|u)_/.test(key)) return 'square';
  if (key.startsWith('respawn_')) return 'square';
  if (key.startsWith('selector_') || key === 'select') return 'ring';
  return 'none';
}

function markerTypeToIconShape(typeKey) {
  const key = String(typeKey || '').toLowerCase();
  if (!key) return 'dot';

  const natoPrefix = /^(b|o|n|c|u)_/.exec(key);
  if (natoPrefix) {
    const suffix = key.slice(2);
    const natoShape = {
      air: 'air',
      antiair: 'antiair',
      armor: 'armor',
      art: 'artillery',
      hq: 'hq',
      inf: 'inf',
      installation: 'installation',
      maint: 'maint',
      mech_inf: 'mech',
      med: 'med',
      mortar: 'mortar',
      motor_inf: 'motor',
      naval: 'naval',
      ordnance: 'ordnance',
      plane: 'plane',
      recon: 'recon',
      service: 'service',
      support: 'support',
      uav: 'uav',
      unknown: 'unknown',
    }[suffix];
    if (natoShape) return natoShape;
  }

  if (key.includes('warning')) return 'warning';
  if (key.includes('destroy')) return 'destroy';
  if (key.includes('objective')) return 'objective';
  if (key.includes('pickup')) return 'pickup';
  if (key.includes('join')) return 'plus';
  if (key.includes('arrow') || key === 'waypoint') return 'arrow';
  if (key.includes('circle')) return 'circle';
  if (key.includes('triangle')) return 'triangle';
  if (key.includes('box')) return 'box';
  if (key.includes('flag')) return 'flag';
  if (key.includes('dot') || key === 'empty' || key === 'emptyicon') return 'dot';
  if (key.includes('start')) return 'start';
  if (key.includes('end')) return 'end';
  if (key.includes('ambush')) return 'ambush';
  if (key.startsWith('respawn_')) return 'respawn';
  if (key.startsWith('selector_') || key === 'select') return 'selector';
  if (key.startsWith('flag_')) return 'flag';
  if (key.startsWith('group_')) return 'group';
  if (key.startsWith('loc_letter')) return 'letter';

  return 'dot';
}

function buildMarkerVisual(typeKey, glyph = '', fallbackCode = '') {
  return {
    glyph,
    fallbackCode,
    iconShape: markerTypeToIconShape(typeKey),
    iconFrame: markerTypeToIconFrame(typeKey),
  };
}

function MarkerTypeIcon({ shape, frame, color, glyph }) {
  const stroke = color || 'rgba(255, 211, 79, 0.95)';
  const common = { stroke, strokeWidth: 1.7, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' };

  return (
    <svg className="map-user-marker-icon" viewBox="0 0 24 24" aria-hidden="true">
      {frame === 'square' ? <rect x="3.5" y="3.5" width="17" height="17" rx="2.4" {...common} /> : null}
      {frame === 'diamond' ? <polygon points="12,2.8 21.2,12 12,21.2 2.8,12" {...common} /> : null}
      {frame === 'ring' ? <circle cx="12" cy="12" r="8.6" {...common} /> : null}

      {shape === 'dot' ? <circle cx="12" cy="12" r="2.6" fill={stroke} stroke="none" /> : null}
      {shape === 'arrow' ? <polyline points="5.5,15.5 12,8.5 18.5,15.5" {...common} /> : null}
      {shape === 'line' ? <line x1="5" y1="12" x2="19" y2="12" {...common} /> : null}
      {shape === 'circle' ? <circle cx="12" cy="12" r="4.6" {...common} /> : null}
      {shape === 'triangle' ? <polygon points="12,7 17.2,16.2 6.8,16.2" {...common} /> : null}
      {shape === 'box' ? <rect x="7.2" y="7.2" width="9.6" height="9.6" {...common} /> : null}
      {shape === 'destroy' || shape === 'ambush' ? (
        <>
          <line x1="7" y1="7" x2="17" y2="17" {...common} />
          <line x1="17" y1="7" x2="7" y2="17" {...common} />
        </>
      ) : null}
      {shape === 'plus' || shape === 'med' ? (
        <>
          <line x1="12" y1="6.6" x2="12" y2="17.4" {...common} />
          <line x1="6.6" y1="12" x2="17.4" y2="12" {...common} />
        </>
      ) : null}
      {shape === 'objective' ? (
        <>
          <circle cx="12" cy="12" r="5.1" {...common} />
          <line x1="8.5" y1="8.5" x2="15.5" y2="15.5" {...common} />
          <line x1="15.5" y1="8.5" x2="8.5" y2="15.5" {...common} />
        </>
      ) : null}
      {shape === 'warning' ? (
        <>
          <polygon points="12,6.2 17.2,16.6 6.8,16.6" {...common} />
          <line x1="12" y1="9.4" x2="12" y2="13.2" {...common} />
          <circle cx="12" cy="15.2" r="0.9" fill={stroke} stroke="none" />
        </>
      ) : null}
      {shape === 'flag' || shape === 'hq' ? (
        <>
          <line x1="8" y1="6" x2="8" y2="18" {...common} />
          <polygon points="8,6.2 16.5,8.4 8,10.6" fill={stroke} stroke="none" />
        </>
      ) : null}
      {shape === 'plane' ? <polygon points="12,6.2 15.5,12 12,10.8 8.5,12" fill={stroke} stroke="none" /> : null}
      {shape === 'air' ? (
        <>
          <line x1="7" y1="12" x2="17" y2="12" {...common} />
          <line x1="12" y1="9" x2="12" y2="15" {...common} />
        </>
      ) : null}
      {shape === 'antiair' ? (
        <>
          <line x1="12" y1="7" x2="12" y2="16" {...common} />
          <polyline points="9.5,10 12,7 14.5,10" {...common} />
          <line x1="7.5" y1="16" x2="16.5" y2="16" {...common} />
        </>
      ) : null}
      {shape === 'armor' ? <ellipse cx="12" cy="12" rx="5.8" ry="4.1" {...common} /> : null}
      {shape === 'artillery' ? (
        <>
          <line x1="12" y1="6.7" x2="12" y2="17.3" {...common} />
          <line x1="6.7" y1="12" x2="17.3" y2="12" {...common} />
          <line x1="8.1" y1="8.1" x2="15.9" y2="15.9" {...common} />
          <line x1="15.9" y1="8.1" x2="8.1" y2="15.9" {...common} />
        </>
      ) : null}
      {shape === 'inf' ? (
        <>
          <line x1="8" y1="8" x2="16" y2="16" {...common} />
          <line x1="16" y1="8" x2="8" y2="16" {...common} />
        </>
      ) : null}
      {shape === 'installation' ? <rect x="7.2" y="7.2" width="9.6" height="9.6" {...common} /> : null}
      {shape === 'maint' || shape === 'service' ? (
        <>
          <circle cx="9" cy="15" r="2" {...common} />
          <line x1="10.4" y1="13.6" x2="16.2" y2="7.8" {...common} />
        </>
      ) : null}
      {shape === 'mech' ? (
        <>
          <rect x="7.4" y="7.4" width="9.2" height="9.2" {...common} />
          <line x1="8.4" y1="8.4" x2="15.6" y2="15.6" {...common} />
          <line x1="15.6" y1="8.4" x2="8.4" y2="15.6" {...common} />
        </>
      ) : null}
      {shape === 'mortar' ? (
        <>
          <circle cx="12" cy="12" r="4.8" {...common} />
          <circle cx="12" cy="12" r="1.1" fill={stroke} stroke="none" />
        </>
      ) : null}
      {shape === 'motor' ? (
        <>
          <circle cx="12" cy="12" r="4.7" {...common} />
          <line x1="7.8" y1="12" x2="16.2" y2="12" {...common} />
        </>
      ) : null}
      {shape === 'naval' ? (
        <>
          <line x1="12" y1="6" x2="12" y2="16" {...common} />
          <path d="M8 14 C8 17.5 16 17.5 16 14" {...common} />
        </>
      ) : null}
      {shape === 'ordnance' ? (
        <>
          <circle cx="12" cy="13" r="3.6" {...common} />
          <line x1="12" y1="6.5" x2="12" y2="9.2" {...common} />
        </>
      ) : null}
      {shape === 'recon' ? (
        <>
          <ellipse cx="12" cy="12" rx="5.4" ry="3.2" {...common} />
          <circle cx="12" cy="12" r="1.1" fill={stroke} stroke="none" />
        </>
      ) : null}
      {shape === 'support' ? (
        <>
          <line x1="7" y1="10" x2="17" y2="10" {...common} />
          <line x1="7" y1="14" x2="17" y2="14" {...common} />
        </>
      ) : null}
      {shape === 'uav' ? <polyline points="7.2,14.5 12,9.3 16.8,14.5" {...common} /> : null}
      {shape === 'start' ? <polyline points="8.2,13.8 12,9.3 15.8,13.8" {...common} /> : null}
      {shape === 'end' ? <polyline points="8.2,10.2 12,14.7 15.8,10.2" {...common} /> : null}
      {shape === 'respawn' ? (
        <>
          <path d="M8 8 C12 4 18 7 18 12" {...common} />
          <polyline points="16.8,9.2 18,12 15.1,11.8" {...common} />
        </>
      ) : null}
      {shape === 'selector' ? (
        <>
          <circle cx="12" cy="12" r="5.1" {...common} />
          <circle cx="12" cy="12" r="1.3" fill={stroke} stroke="none" />
        </>
      ) : null}

      {shape === 'group' || shape === 'letter' || shape === 'unknown' ? (
        <text x="12" y="15" textAnchor="middle" fill={stroke} style={{ fontWeight: 800, fontSize: '8px', fontFamily: 'monospace' }}>
          {glyph || '?'}
        </text>
      ) : null}
    </svg>
  );
}

function markerTypeToVisual(typeName, iconPath = '') {
  const value = markerTypeKey(typeName, iconPath);
  if (!value) return buildMarkerVisual('', '', '');

  if (value.startsWith('contact_')) {
    const contactGlyph = {
      contact_arrow1: '>',
      contact_arrow2: '>',
      contact_arrow3: '>',
      contact_arrowleft: '<',
      contact_arrowright: '>',
      contact_arrowsmall1: '>',
      contact_arrowsmall2: '>',
      contact_art1: 'AT',
      contact_art2: 'AT',
      contact_circle1: 'O',
      contact_circle2: 'O',
      contact_circle3: 'O',
      contact_circle4: 'O',
      contact_dashedline1: '--',
      contact_dashedline2: '--',
      contact_dashedline3: '--',
      contact_defenseline: 'DL',
      contact_defenselineover: 'DL',
      contact_dot1: '.',
      contact_dot2: '.',
      contact_dot3: '.',
      contact_dot4: '.',
      contact_dot5: '.',
      contact_pencilcircle1: 'O',
      contact_pencilcircle2: 'O',
      contact_pencilcircle3: 'O',
      contact_pencildoodle1: '~~',
      contact_pencildoodle2: '~~',
      contact_pencildoodle3: '~~',
      contact_pencildot1: '.',
      contact_pencildot2: '.',
      contact_pencildot3: '.',
      contact_penciltask1: 'X',
      contact_penciltask2: 'X',
      contact_penciltask3: 'X',
    }[value];
    if (contactGlyph !== undefined) return buildMarkerVisual(value, '', '');
  }

  const natoPrefix = /^(b|o|n|c|u)_/.exec(value);
  if (natoPrefix) {
    const suffix = value.slice(2);
    const natoGlyph = {
      air: 'H',
      antiair: 'AA',
      armor: 'AR',
      art: 'AT',
      hq: 'HQ',
      inf: 'IN',
      installation: 'IS',
      maint: 'MT',
      mech_inf: 'ME',
      med: '+',
      mortar: 'MO',
      motor_inf: 'MI',
      naval: 'N',
      ordnance: 'OD',
      plane: 'P',
      recon: 'R',
      service: 'SV',
      support: 'SP',
      uav: 'U',
      unknown: '?',
    }[suffix];

    if (natoGlyph) return buildMarkerVisual(value, '', '');
  }

  if (value.startsWith('hd_')) {
    const hdGlyph = {
      hd_ambush: 'A',
      hd_ambush_noshadow: 'A',
      hd_arrow: '>',
      hd_arrow_noshadow: '>',
      hd_destroy: 'X',
      hd_destroy_noshadow: 'X',
      hd_dot: '.',
      hd_dot_noshadow: '.',
      hd_end: 'E',
      hd_end_noshadow: 'E',
      hd_flag: 'F',
      hd_flag_noshadow: 'F',
      hd_join: '+',
      hd_join_noshadow: '+',
      hd_objective: 'O',
      hd_objective_noshadow: 'O',
      hd_pickup: 'P',
      hd_pickup_noshadow: 'P',
      hd_start: 'S',
      hd_start_noshadow: 'S',
      hd_unknown: '?',
      hd_unknown_noshadow: '?',
      hd_warning: '!',
      hd_warning_noshadow: '!',
    }[value];
    if (hdGlyph !== undefined) return buildMarkerVisual(value, '', '');
  }

  if (value.startsWith('mil_')) {
    const milGlyph = {
      mil_ambush: 'A',
      mil_ambush_noshadow: 'A',
      mil_arrow: '>',
      mil_arrow_noshadow: '>',
      mil_arrow2: '>>',
      mil_arrow2_noshadow: '>>',
      mil_box: 'B',
      mil_box_noshadow: 'B',
      mil_circle: 'O',
      mil_circle_noshadow: 'O',
      mil_destroy: 'X',
      mil_destroy_noshadow: 'X',
      mil_dot: '.',
      mil_dot_noshadow: '.',
      mil_end: 'E',
      mil_end_noshadow: 'E',
      mil_flag: 'F',
      mil_flag_noshadow: 'F',
      mil_join: '+',
      mil_join_noshadow: '+',
      mil_marker: 'M',
      mil_marker_noshadow: 'M',
      mil_objective: 'O',
      mil_objective_noshadow: 'O',
      mil_pickup: 'P',
      mil_pickup_noshadow: 'P',
      mil_start: 'S',
      mil_start_noshadow: 'S',
      mil_triangle: 'T',
      mil_triangle_noshadow: 'T',
      mil_unknown: '?',
      mil_unknown_noshadow: '?',
      mil_warning: '!',
      mil_warning_noshadow: '!',
    }[value];
    if (milGlyph !== undefined) return buildMarkerVisual(value, '', '');
  }

  const groupMatch = /^group_(\d{1,2})$/.exec(value);
  if (groupMatch) return buildMarkerVisual(value, groupMatch[1], '');

  const letterMatch = /^loc_letter([a-z])$/i.exec(value);
  if (letterMatch) return buildMarkerVisual(value, letterMatch[1].toUpperCase(), '');

  if (value.startsWith('flag_')) return buildMarkerVisual(value, '', '');
  if (value.startsWith('respawn_')) return buildMarkerVisual(value, '', '');
  if (value.startsWith('selector_')) return buildMarkerVisual(value, '', '');
  if (value === 'select') return buildMarkerVisual(value, '', '');
  if (value === 'waypoint') return buildMarkerVisual(value, '', '');
  if (value === 'u_installation') return buildMarkerVisual(value, '', '');
  if (value.includes('warning')) return buildMarkerVisual(value, '', '');
  if (value.includes('destroy')) return buildMarkerVisual(value, '', '');
  if (value.includes('objective')) return buildMarkerVisual(value, '', '');
  if (value.includes('pickup') || value.includes('join') || value.includes('med')) return buildMarkerVisual(value, '', '');
  if (value.includes('arrow') || value.includes('waypoint')) return buildMarkerVisual(value, '', '');
  if (value.includes('circle')) return buildMarkerVisual(value, '', '');
  if (value.includes('triangle')) return buildMarkerVisual(value, '', '');
  if (value.includes('box')) return buildMarkerVisual(value, '', '');
  if (value.includes('dot') || value === 'empty' || value === 'emptyicon') return buildMarkerVisual(value, '', '');

  return buildMarkerVisual(value, '', markerTypeFallbackCode(value));
}

function markerBrushToBorderStyle(brushName) {
  const value = String(brushName || '').toLowerCase();
  if (!value || value === 'solid' || value === 'solidfull') return 'solid';
  if (value.includes('dash')) return 'dashed';
  return 'dotted';
}

function markerBrushToDashArray(brushName) {
  const value = String(brushName || '').toLowerCase();
  if (!value || value === 'solid' || value === 'solidfull') return undefined;
  if (value.includes('dash')) return '0.75 0.5';
  return '0.35 0.35';
}

function formatTargetBearing(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return '---';
  return `${num.toFixed(1)} deg`;
}

function formatTargetRange(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return '---';
  if (num < 1) return `${Math.round(num * 1000)} m`;
  return `${num.toFixed(3)} km`;
}

function formatTargetGrid(data) {
  const raw = String(data.targetGrid || '').trim();
  const match = raw.match(/(\d{5})\D+(\d{5})/);
  if (match) {
    const rawX = toGridPart(match[1]);
    const rawY = toGridPart(match[2]);
    if (rawX && rawY) return `${rawX}-${rawY}`;
  }

  const rawDigits = raw.replace(/\D/g, '');
  if (rawDigits.length >= 10) {
    return `${rawDigits.slice(0, 5)}-${rawDigits.slice(5, 10)}`;
  }

  const gx = toGridPart(data.targetGridX);
  const gy = toGridPart(data.targetGridY);
  if (gx && gy && gx.length >= 5 && gy.length >= 5) return `${gx}-${gy}`;

  // Legacy payload fallback: estimate target world coordinate from heading/range.
  const posX = Number(data.posX);
  const posY = Number(data.posY);
  const headingDeg = Number(data.targetHeading);
  const rangeKm = Number(data.targetRange);
  if (Number.isFinite(posX) && Number.isFinite(posY) && Number.isFinite(headingDeg) && Number.isFinite(rangeKm) && rangeKm >= 0) {
    const rangeMeters = rangeKm * 1000;
    const headingRad = (headingDeg * Math.PI) / 180;
    const estX = posX + (Math.sin(headingRad) * rangeMeters);
    const estY = posY + (Math.cos(headingRad) * rangeMeters);
    const fx = toGridPartFixed(estX);
    const fy = toGridPartFixed(estY);
    if (fx && fy) return `${fx}-${fy}`;
  }

  return '---';
}

function vectorTextStyle(data) {
  return data.targetSource === 'vector21' ? { color: 'var(--color-danger)' } : undefined;
}

function InfoTab() {
  const { data } = useTelemetry();
  const isVectorTarget = data.targetSource === 'vector21';

  return (
    <div className="tab-info">
      <div className="data-row">
        <div className="data-label">Easting/Northing</div>
        <div className="data-value">{data.gridX}e / {data.gridY}n</div>
      </div>
      <div className="data-row">
        <div className="data-label">Elevation</div>
        <div className="data-value">{formatAslDisplay(data.asl)} <span className="data-unit">MSL</span></div>
      </div>
      <div className="data-row">
        <div className="data-label">Heading</div>
        <div className="data-value">{formatHeadingDisplay(data.heading).replace('deg', '\u00b0')}</div>
      </div>
      <div className="data-row">
        <div className="data-label">Speed</div>
        <div className="data-value">{formatSpeedDisplay(data.speed)} <span className="data-unit">kph</span></div>
      </div>
      {isVectorTarget ? (
        <>
          <div className="data-row" style={{marginTop: '26px', borderBottom: 'none'}}>
            <div className="data-label" style={{ ...vectorTextStyle(data), fontSize: '1rem', fontWeight: 700 }}>Vector 21</div>
            <div className="data-value" style={vectorTextStyle(data)}>ACTIVE</div>
          </div>
          <div className="data-row" style={{borderBottom: 'none'}}>
            <div className="data-label" style={vectorTextStyle(data)}>Coordinates</div>
            <div className="data-value" style={{fontSize: '1.1rem', ...(vectorTextStyle(data) || {})}}>{formatTargetGrid(data)}</div>
          </div>
          <div className="data-row" style={{borderBottom: 'none'}}>
            <div className="data-label" style={vectorTextStyle(data)}>Target Bearing</div>
            <div className="data-value" style={{fontSize: '1.1rem', ...(vectorTextStyle(data) || {})}}>{formatTargetBearing(data.targetHeading)}</div>
          </div>
          <div className="data-row" style={{borderBottom: 'none'}}>
            <div className="data-label" style={vectorTextStyle(data)}>Target Range</div>
            <div className="data-value" style={{fontSize: '1.1rem', ...(vectorTextStyle(data) || {})}}>{formatTargetRange(data.targetRange)}</div>
          </div>
        </>
      ) : (
        <div className="data-row" style={{marginTop: '30px', borderBottom: 'none'}}>
          <div className="data-label">Target Name</div>
          <div className="data-value" style={{fontSize: '1.2rem'}}>{data.targetName}</div>
        </div>
      )}
    </div>
  );
}

function CompassTab() {
  const { data } = useTelemetry();
  const isVectorTarget = data.targetSource === 'vector21';
  const cardinalByDegree = {
    0: 'N',
    90: 'E',
    180: 'S',
    270: 'W',
  };
  
  return (
    <div className="tab-compass" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%' }}>
      
      {/* Compass Dial */}
      <div style={{ position: 'relative', width: '250px', height: '250px', margin: '20px 0 30px' }}>
        <div style={{
          position: 'absolute', width: '100%', height: '100%', borderRadius: '50%',
          border: '2px solid rgba(133, 235, 133, 0.65)',
          background: 'radial-gradient(circle at center, rgba(2, 13, 2, 0.98) 0%, rgba(0, 7, 0, 0.96) 68%, rgba(0, 0, 0, 1) 100%)',
          boxShadow: '0 0 18px rgba(90, 190, 90, 0.2), inset 0 0 22px rgba(85, 170, 85, 0.2)',
          display: 'flex', justifyContent: 'center', alignItems: 'center',
          transition: 'transform 0.05s linear',
          transform: `rotate(${-data.heading}deg)`
        }}>
          <div style={{
            position: 'absolute',
            width: '226px',
            height: '226px',
            borderRadius: '50%',
            border: '1px solid rgba(133, 235, 133, 0.6)',
          }} />

          {COMPASS_TICK_DEGREES.map((deg) => {
            const isMajor = deg % 10 === 0;
            const isMedium = !isMajor && (deg % 5 === 0);
            return (
              <div
                key={`tick-${deg}`}
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  width: isMajor ? '2px' : '1px',
                  height: isMajor ? '13px' : (isMedium ? '8px' : '5px'),
                  borderRadius: '1px',
                  background: isMajor ? 'var(--color-text-primary)' : 'rgba(133, 235, 133, 0.55)',
                  transform: `translate(-50%, -50%) rotate(${deg}deg) translateY(-112px)`,
                }}
              />
            );
          })}

          {COMPASS_LABEL_DEGREES.map((deg) => {
            return (
              <div
                key={`label-${deg}`}
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  transform: `translate(-50%, -50%) rotate(${deg}deg) translateY(-96px)`,
                  zIndex: 2,
                }}
              >
                <span
                  style={{
                    display: 'block',
                    transform: 'none',
                    fontSize: '0.52rem',
                    fontWeight: 700,
                    letterSpacing: '0',
                    color: 'rgba(133, 235, 133, 0.9)',
                    textShadow: 'none',
                  }}
                >
                  {deg}
                </span>
              </div>
            );
          })}

          {Object.entries(cardinalByDegree).map(([degKey, label]) => {
            const deg = Number(degKey);
            return (
              <div
                key={`cardinal-${deg}`}
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  transform: `translate(-50%, -50%) rotate(${deg}deg) translateY(-142px)`,
                  zIndex: 4,
                }}
              >
                <span
                  style={{
                    display: 'block',
                    transform: `rotate(${-deg}deg)`,
                    fontSize: '1.45rem',
                    fontWeight: 900,
                    letterSpacing: '0.5px',
                    color: 'var(--color-accent)',
                    textShadow: '0 0 10px rgba(39, 217, 39, 0.4)',
                  }}
                >
                  {label}
                </span>
              </div>
            );
          })}

          <div style={{
            position: 'absolute',
            width: '154px',
            height: '154px',
            borderRadius: '50%',
            border: '1px solid rgba(133, 235, 133, 0.45)',
          }} />

          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '26px',
            height: '26px',
            borderRadius: '50%',
            border: '1px solid rgba(133, 235, 133, 0.75)',
            background: 'rgba(0, 16, 0, 0.95)',
            boxShadow: '0 0 8px rgba(39, 217, 39, 0.18)',
          }} />
        </div>
        
        {/* Fixed Center Pointer */}
        <div style={{
          position: 'absolute', top: '-8px', left: '50%', transform: 'translateX(-50%)',
          width: '0', height: '0',
          borderLeft: '8px solid transparent', borderRight: '8px solid transparent',
          borderTop: '13px solid var(--color-danger)'
        }} />
      </div>

      <div className="data-value" style={{fontSize: '2.5rem'}}>{formatHeadingDisplay(data.heading).replace('deg', '\u00b0')}</div>

      <div style={{ width: '100%', marginTop: 'auto' }}>
        <div className="data-row">
          <div className="data-label">Speed</div>
          <div className="data-value" style={{fontSize: '1.2rem'}}>{formatSpeedDisplay(data.speed)} kph</div>
        </div>
        {!isVectorTarget ? (
          <div className="data-row">
            <div className="data-label">Target</div>
            <div className="data-value" style={{fontSize: '1.2rem'}}>{data.targetName}</div>
          </div>
        ) : null}
        <div className="data-row">
          <div className="data-label" style={vectorTextStyle(data)}>Bearing</div>
          <div className="data-value" style={{fontSize: '1.2rem', ...(vectorTextStyle(data) || {})}}>{formatTargetBearing(data.targetHeading)}</div>
        </div>
        <div className="data-row">
          <div className="data-label" style={vectorTextStyle(data)}>Coordinates</div>
          <div className="data-value" style={{fontSize: '1.2rem', ...(vectorTextStyle(data) || {})}}>{formatTargetGrid(data)}</div>
        </div>
        <div className="data-row">
          <div className="data-label" style={vectorTextStyle(data)}>Range</div>
          <div className="data-value" style={{fontSize: '1.2rem', ...(vectorTextStyle(data) || {})}}>{formatTargetRange(data.targetRange)}</div>
        </div>
      </div>

    </div>
  );
}

function WaypointsTab() {
  const { data } = useTelemetry();
  return (
    <div className="tab-waypoints" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <h3 style={{ borderBottom: '1px solid var(--color-accent)', paddingBottom: '5px', marginBottom: '10px' }}>WAYPOINTS</h3>
      {data.waypoints.length === 0 ? (
        <div style={{ color: 'var(--color-text-secondary)', textAlign: 'center', marginTop: '20px' }}>WORK IN PROGRESS</div>
      ) : (
        <ul style={{ listStyle: 'none', overflowY: 'auto' }}>
          {data.waypoints.map((wp, i) => (
            <li key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #1a331a' }}>
              <span>{wp.name}</span>
              <span className="data-value" style={{ fontSize: '1rem' }}>{wp.distance}km</span>
            </li>
          ))}
        </ul>
      )}
      <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between' }}>
        <button className="hw-button" style={{ width: '45%' }}>ADD WP</button>
        <button className="hw-button" style={{ width: '45%', borderColor: 'var(--color-danger)', color: 'var(--color-danger)' }}>DEL</button>
      </div>
    </div>
  );
}

function MapTab({ isActive }) {
  const { data } = useTelemetry();
  const [activeLayer, setActiveLayer] = useState('atlas');
  const [zoom, setZoom] = useState(MAP_ZOOM_DEFAULT);
  const [followPlayer, setFollowPlayer] = useState(true);
  const [freePanCenter, setFreePanCenter] = useState({ x: 0.5, y: 0.5 });
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [mapInfoByLayer, setMapInfoByLayer] = useState(() => createInitialLayerMapState());
  const [mapImageSizeByLayer, setMapImageSizeByLayer] = useState(() => createInitialLayerImageSizeState());
  const [viewportSize, setViewportSize] = useState({ width: 1, height: 1 });
  const viewportRef = useRef(null);
  const pinchRef = useRef({
    active: false,
    startDistance: 0,
    startZoom: MAP_ZOOM_DEFAULT,
    startCenterX: 0,
    startCenterY: 0,
  });
  const touchPanRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    startPanX: 0,
    startPanY: 0,
  });
  const mousePanRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    startPanX: 0,
    startPanY: 0,
  });
  const worldKey = String(data.worldName || '').toLowerCase();
  const mapDef = WORLD_MAPS[worldKey] || null;
  const worldSize = Number(data.worldSize) > 0 ? Number(data.worldSize) : (mapDef?.worldSize || 0);
  const activeMapInfo = mapInfoByLayer[activeLayer] || createEmptyLayerMapInfo();
  const activeLayerImageSize = mapImageSizeByLayer[activeLayer] || { width: 0, height: 0 };
  const mapTransform = normalizeMapTransform(activeMapInfo.transform);
  const posX = Number(data.posX);
  const posY = Number(data.posY);
  const calibratedPlayerPos = calibrateWorldCoordinate(posX, posY, worldSize);
  const calibratedPosX = Number(calibratedPlayerPos.x);
  const calibratedPosY = Number(calibratedPlayerPos.y);
  const hasPosition = Number.isFinite(calibratedPosX) && Number.isFinite(calibratedPosY) && worldSize > 0;
  const playerProjected = projectWorldToMapNormalized(calibratedPosX, calibratedPosY, worldSize, mapTransform);
  const normalizedX = hasPosition ? playerProjected.x : 0.5;
  const normalizedY = hasPosition ? playerProjected.y : 0.5;

  const viewportRatio = viewportSize.height > 0 ? (viewportSize.width / viewportSize.height) : 1;
  const fallbackAspect = Number(activeMapInfo.imageWidth) > 0 && Number(activeMapInfo.imageHeight) > 0
    ? (Number(activeMapInfo.imageWidth) / Number(activeMapInfo.imageHeight))
    : 1;
  const activeAspect = activeLayerImageSize.width > 0 && activeLayerImageSize.height > 0
    ? (activeLayerImageSize.width / activeLayerImageSize.height)
    : fallbackAspect;
  const safeAspect = activeAspect > 0 ? activeAspect : 1;
  const zoomProgress = clamp((zoom - MAP_ZOOM_MIN) / (MAP_ZOOM_MAX - MAP_ZOOM_MIN), 0, 1);
  const zoomBoost = 1 + ((zoomProgress * zoomProgress) * MAP_ZOOM_HIGH_END_BOOST);
  const layerRenderScale = activeLayer === 'atlas' ? ATLAS_RENDER_SCALE : 1;
  const mapWidthPct = zoom * 100 * zoomBoost * layerRenderScale;
  const mapHeightPct = mapWidthPct * (viewportRatio / safeAspect);
  const uniformMapSize = Number.isFinite(mapTransform.sizeInMeters) && mapTransform.sizeInMeters > 0
    ? mapTransform.sizeInMeters
    : worldSize;
  const mapBaseSizeX = Number.isFinite(mapTransform.sizeX) && mapTransform.sizeX > 0
    ? (mapTransform.sizeInMeters || mapTransform.sizeX)
    : uniformMapSize;
  const mapBaseSizeY = Number.isFinite(mapTransform.sizeY) && mapTransform.sizeY > 0
    ? (mapTransform.sizeInMeters || mapTransform.sizeY)
    : uniformMapSize;
  const atlasShiftXPct = activeLayer === 'atlas' && mapBaseSizeX > 0
    ? ((ATLAS_SHIFT_METERS_X / mapBaseSizeX) * mapWidthPct * Math.abs(mapTransform.scaleX || 1))
    : 0;
  const atlasShiftYPct = activeLayer === 'atlas' && mapBaseSizeY > 0
    ? ((ATLAS_SHIFT_METERS_Y / mapBaseSizeY) * mapHeightPct * Math.abs(mapTransform.scaleY || 1))
    : 0;

  const centerNormalizedX = followPlayer ? normalizedX : freePanCenter.x;
  const centerNormalizedY = followPlayer ? normalizedY : freePanCenter.y;

  const mapOffsetX = 50 - (centerNormalizedX * mapWidthPct);
  const mapOffsetY = 50 - (centerNormalizedY * mapHeightPct);
  const effectivePanX = followPlayer ? 0 : panOffset.x;
  const effectivePanY = followPlayer ? 0 : panOffset.y;
  const playerViewportXPct = mapOffsetX + (normalizedX * mapWidthPct);
  const playerViewportYPct = mapOffsetY + (normalizedY * mapHeightPct);
  const rawMapMarkers = Array.isArray(data.mapMarkers) ? data.mapMarkers : [];
  const mapMarkerVisuals = worldSize > 0
    ? rawMapMarkers.reduce((acc, marker, idx) => {
      const markerId = String(marker?.id || marker?.name || `marker-${idx}`).trim();
      const markerText = String(marker?.t || marker?.text || marker?.name || '').trim();
      const markerShape = String(marker?.s || marker?.shape || '').toUpperCase();
      const markerType = String(marker?.k || marker?.type || '');
      const markerIconPath = String(marker?.i || marker?.iconPath || '');
      const markerColor = markerColorToCss(marker, markerType, markerIconPath);
      const markerTypeVisual = markerTypeToVisual(markerType, markerIconPath);
      const markerBrush = String(marker?.b || marker?.brush || '');
      const markerDir = Number(marker?.d ?? marker?.dir ?? 0);
      const markerSizeX = Number(marker?.sx ?? (Array.isArray(marker?.size) ? marker.size[0] : NaN));
      const markerSizeY = Number(marker?.sy ?? (Array.isArray(marker?.size) ? marker.size[1] : NaN));

      const markerXRaw = Array.isArray(marker) ? Number(marker[0]) : Number(marker?.x);
      const markerYRaw = Array.isArray(marker) ? Number(marker[1]) : Number(marker?.y);
      const calibratedMarkerPos = calibrateWorldCoordinate(markerXRaw, markerYRaw, worldSize);
      const markerX = Number(calibratedMarkerPos.x);
      const markerY = Number(calibratedMarkerPos.y);

      const rawPoints = Array.isArray(marker?.p)
        ? marker.p
        : (Array.isArray(marker?.points) ? marker.points : []);
      const pointPairs = [];

      if (rawPoints.length > 0) {
        if (Array.isArray(rawPoints[0])) {
          rawPoints.forEach((point) => {
            if (Array.isArray(point) && point.length >= 2) {
              pointPairs.push([Number(point[0]), Number(point[1])]);
            }
          });
        } else {
          for (let i = 0; i < rawPoints.length - 1; i += 2) {
            pointPairs.push([Number(rawPoints[i]), Number(rawPoints[i + 1])]);
          }
        }
      }

      const isPolyline = markerShape === 'POLYLINE'
        ? pointPairs.length >= 2
        : (markerShape === '' && pointPairs.length >= 2);

      if (isPolyline) {
        const svgPoints = pointPairs
          .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
          .map(([x, y]) => {
            const calibratedPoint = calibrateWorldCoordinate(x, y, worldSize);
            const calibratedX = calibratedPoint.x;
            const calibratedY = calibratedPoint.y;
            const pointProjected = projectWorldToMapNormalized(calibratedX, calibratedY, worldSize, mapTransform);
            const xPct = pointProjected.x * 100;
            const yPct = pointProjected.y * 100;
            return `${xPct},${yPct}`;
          })
          .join(' ');

        if (svgPoints.length > 0) {
          acc.lines.push({
            key: `${markerId}-line`,
            points: svgPoints,
            color: markerColor,
            dashArray: markerBrushToDashArray(markerBrush),
          });
        }
      }

      if (Number.isFinite(markerX) && Number.isFinite(markerY)) {
        const markerProjected = projectWorldToMapNormalized(markerX, markerY, worldSize, mapTransform);
        const markerNormalizedX = markerProjected.x;
        const markerNormalizedY = markerProjected.y;
        const centerXPct = mapOffsetX + (markerNormalizedX * mapWidthPct);
        const centerYPct = mapOffsetY + (markerNormalizedY * mapHeightPct);

        const isArea = markerShape === 'ELLIPSE' || markerShape === 'RECTANGLE';
        const hasAreaSize = Number.isFinite(markerSizeX) && Number.isFinite(markerSizeY) && markerSizeX > 0 && markerSizeY > 0;

        if (isArea && hasAreaSize) {
          const uniformSize = Number.isFinite(mapTransform.sizeInMeters) && mapTransform.sizeInMeters > 0
            ? mapTransform.sizeInMeters
            : worldSize;
          const baseSizeX = Number.isFinite(mapTransform.sizeX) && mapTransform.sizeX > 0
            ? (mapTransform.sizeInMeters || mapTransform.sizeX)
            : uniformSize;
          const baseSizeY = Number.isFinite(mapTransform.sizeY) && mapTransform.sizeY > 0
            ? (mapTransform.sizeInMeters || mapTransform.sizeY)
            : uniformSize;
          const widthPct = ((markerSizeX * 2) / baseSizeX) * mapWidthPct * Math.abs(mapTransform.scaleX);
          const heightPct = ((markerSizeY * 2) / baseSizeY) * mapHeightPct * Math.abs(mapTransform.scaleY);

          acc.areas.push({
            key: `${markerId}-area`,
            xPct: centerXPct,
            yPct: centerYPct,
            widthPct,
            heightPct,
            dirDeg: Number.isFinite(markerDir) ? markerDir : 0,
            shapeClass: markerShape === 'ELLIPSE' ? 'ellipse' : 'rectangle',
            color: markerColor,
            borderStyle: markerBrushToBorderStyle(markerBrush),
          });
        } else if (!isPolyline) {
          acc.points.push({
            key: markerId,
            xPct: centerXPct,
            yPct: centerYPct,
            color: markerColor,
            label: markerText,
            glyph: markerTypeVisual.glyph,
            typeCode: markerTypeVisual.fallbackCode,
            iconShape: markerTypeVisual.iconShape,
            iconFrame: markerTypeVisual.iconFrame,
          });
        }
      }

      return acc;
    }, { points: [], lines: [], areas: [] })
    : { points: [], lines: [], areas: [] };
  const bridgeHost = window.location.hostname || '127.0.0.1';
  const bridgeBaseUrl = `http://${bridgeHost}:8080`;

  useEffect(() => {
    if (isActive) {
      setActiveLayer('atlas');
    }
  }, [isActive]);

  useEffect(() => {
    let ignore = false;

    async function loadLayerMapInfo(layerId) {
      const response = await fetch(`${bridgeBaseUrl}/api/map/${encodeURIComponent(worldKey)}?layer=${encodeURIComponent(layerId)}`);
      const payload = await response.json();

      if (response.ok && payload.available && payload.url) {
        return {
          layerId,
          info: {
            loading: false,
            available: true,
            url: `${bridgeBaseUrl}${payload.url}?v=${payload.updatedAt || Date.now()}`,
            message: payload.message || 'Map ready',
            source: payload.source || 'cache',
            fileName: payload.fileName || '',
            imageWidth: Number.isFinite(Number(payload.imageWidth)) ? Number(payload.imageWidth) : null,
            imageHeight: Number.isFinite(Number(payload.imageHeight)) ? Number(payload.imageHeight) : null,
            status: payload.status || 'ready',
            progress: Number.isFinite(Number(payload.progress)) ? Number(payload.progress) : 100,
            updatedAt: payload.updatedAt || Date.now(),
            transform: payload.mapTransform || null,
          },
        };
      }

      return {
        layerId,
        info: {
          loading: false,
          available: false,
          url: '',
          message: payload.message || 'Map unavailable',
          source: payload.source || '',
          fileName: payload.fileName || '',
          imageWidth: Number.isFinite(Number(payload.imageWidth)) ? Number(payload.imageWidth) : null,
          imageHeight: Number.isFinite(Number(payload.imageHeight)) ? Number(payload.imageHeight) : null,
          status: payload.status || 'unavailable',
          progress: Number.isFinite(Number(payload.progress)) ? Number(payload.progress) : 0,
          updatedAt: payload.updatedAt || Date.now(),
          transform: payload.mapTransform || null,
        },
      };
    }

    async function loadMapInfo() {
      if (!worldKey) {
        setMapInfoByLayer(createInitialLayerMapState('World not available yet from telemetry'));
        setMapImageSizeByLayer(createInitialLayerImageSizeState());
        return;
      }

      setMapInfoByLayer((prev) => {
        const next = { ...prev };
        MAP_LAYER_OPTIONS.forEach((layer) => {
          next[layer.id] = {
            ...(prev[layer.id] || createEmptyLayerMapInfo()),
            loading: true,
          };
        });
        return next;
      });

      try {
        const layerResults = await Promise.all(
          MAP_LAYER_OPTIONS.map((layer) => loadLayerMapInfo(layer.id))
        );

        if (ignore) return;

        setMapInfoByLayer((prev) => {
          const next = { ...prev };
          layerResults.forEach(({ layerId, info }) => {
            next[layerId] = info;
          });
          return next;
        });

        layerResults.forEach(({ layerId, info }) => {
          if (!info.available || !info.url) {
            setMapImageSizeByLayer((prev) => ({
              ...prev,
              [layerId]: { width: 0, height: 0 },
            }));
            return;
          }

          const preloader = new window.Image();
          preloader.onload = () => {
            if (ignore) return;
            const width = Number(preloader.naturalWidth) || 0;
            const height = Number(preloader.naturalHeight) || 0;
            setMapImageSizeByLayer((prev) => ({
              ...prev,
              [layerId]: { width, height },
            }));
          };
          preloader.src = info.url;
        });
      } catch (error) {
        if (ignore) return;
        setMapInfoByLayer(createInitialLayerMapState('Bridge map API not reachable on port 8080'));
        setMapImageSizeByLayer(createInitialLayerImageSizeState());
      }
    }

    loadMapInfo();
    const timer = setInterval(loadMapInfo, 5000);

    return () => {
      ignore = true;
      clearInterval(timer);
    };
  }, [worldKey, bridgeBaseUrl]);

  useEffect(() => {
    setFollowPlayer(true);
    setFreePanCenter({ x: normalizedX, y: normalizedY });
    setPanOffset({ x: 0, y: 0 });
    setIsPanning(false);
    setMapInfoByLayer(createInitialLayerMapState(
      worldKey ? 'Loading map for current world...' : 'World not available yet from telemetry'
    ));
    setMapImageSizeByLayer(createInitialLayerImageSizeState());
    pinchRef.current.active = false;
    touchPanRef.current.active = false;
    mousePanRef.current.active = false;
  }, [worldKey]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;

    function updateSize() {
      const rect = viewport.getBoundingClientRect();
      setViewportSize({
        width: Math.max(rect.width, 1),
        height: Math.max(rect.height, 1),
      });
    }

    updateSize();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateSize);
      return () => window.removeEventListener('resize', updateSize);
    }

    const observer = new ResizeObserver(updateSize);
    observer.observe(viewport);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isPanning || !mousePanRef.current.active) return undefined;

    function onMouseMove(event) {
      const pan = mousePanRef.current;
      if (!pan.active) return;

      const nextX = pan.startPanX + (event.clientX - pan.startX);
      const nextY = pan.startPanY + (event.clientY - pan.startY);
      setPanOffset({ x: nextX, y: nextY });
    }

    function onMouseUp() {
      mousePanRef.current.active = false;
      setIsPanning(false);
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isPanning]);

  function setClampedZoom(nextZoom) {
    setZoom(clamp(nextZoom, MAP_ZOOM_MIN, MAP_ZOOM_MAX));
  }

  function computeMapSizePct(zoomValue) {
    const zoomProgressLocal = clamp((zoomValue - MAP_ZOOM_MIN) / (MAP_ZOOM_MAX - MAP_ZOOM_MIN), 0, 1);
    const zoomBoostLocal = 1 + ((zoomProgressLocal * zoomProgressLocal) * MAP_ZOOM_HIGH_END_BOOST);
    const widthPct = zoomValue * 100 * zoomBoostLocal * layerRenderScale;
    const heightPct = widthPct * (viewportRatio / safeAspect);
    return { widthPct, heightPct };
  }

  function buildMapGeometry(zoomValue, centerX, centerY, panX, panY) {
    const { widthPct, heightPct } = computeMapSizePct(zoomValue);
    const offsetXPct = 50 - (centerX * widthPct);
    const offsetYPct = 50 - (centerY * heightPct);
    const widthPx = (viewportSize.width * widthPct) / 100;
    const heightPx = (viewportSize.height * heightPct) / 100;
    const leftBasePx = (viewportSize.width * offsetXPct) / 100;
    const topBasePx = (viewportSize.height * offsetYPct) / 100;

    return {
      widthPx,
      heightPx,
      leftBasePx,
      topBasePx,
      leftPx: leftBasePx + panX,
      topPx: topBasePx + panY,
    };
  }

  function applyZoomAtClientPoint(nextZoom, clientX, clientY) {
    const nextClampedZoom = clamp(nextZoom, MAP_ZOOM_MIN, MAP_ZOOM_MAX);
    const viewport = viewportRef.current;
    if (!viewport) {
      setZoom(nextClampedZoom);
      return;
    }

    const rect = viewport.getBoundingClientRect();
    const pointX = clientX - rect.left;
    const pointY = clientY - rect.top;

    const centerX = followPlayer ? normalizedX : freePanCenter.x;
    const centerY = followPlayer ? normalizedY : freePanCenter.y;
    const panX = followPlayer ? 0 : panOffset.x;
    const panY = followPlayer ? 0 : panOffset.y;

    const current = buildMapGeometry(zoom, centerX, centerY, panX, panY);
    if (current.widthPx <= 0 || current.heightPx <= 0) {
      setZoom(nextClampedZoom);
      return;
    }

    const u = clamp((pointX - current.leftPx) / current.widthPx, 0, 1);
    const v = clamp((pointY - current.topPx) / current.heightPx, 0, 1);
    const next = buildMapGeometry(nextClampedZoom, centerX, centerY, panX, panY);

    const nextPanX = pointX - (next.leftBasePx + (u * next.widthPx));
    const nextPanY = pointY - (next.topBasePx + (v * next.heightPx));

    if (followPlayer) {
      setFreePanCenter({ x: centerX, y: centerY });
      setFollowPlayer(false);
    }

    setPanOffset({ x: nextPanX, y: nextPanY });
    setZoom(nextClampedZoom);
  }

  function handleWheelZoom(event) {
    if (!canRenderMap) return;
    event.preventDefault();
    const direction = event.deltaY < 0 ? 1 : -1;
    const nextZoom = zoom + (direction * MAP_ZOOM_STEP);
    applyZoomAtClientPoint(nextZoom, event.clientX, event.clientY);
  }

  function handleMousePanStart(event) {
    if (event.button !== 0 || !canRenderMap) return;
    event.preventDefault();

    mousePanRef.current = {
      active: true,
      startX: event.clientX,
      startY: event.clientY,
      startPanX: followPlayer ? 0 : panOffset.x,
      startPanY: followPlayer ? 0 : panOffset.y,
    };

    if (followPlayer) {
      setFreePanCenter({ x: normalizedX, y: normalizedY });
      setFollowPlayer(false);
    }

    setIsPanning(true);
  }

  function handleTouchStart(event) {
    if (!canRenderMap) return;

    if (event.touches.length >= 2) {
      const startDistance = getTouchDistance(event.touches);
      if (!startDistance) return;

      const centerX = (event.touches[0].clientX + event.touches[1].clientX) * 0.5;
      const centerY = (event.touches[0].clientY + event.touches[1].clientY) * 0.5;

      pinchRef.current = {
        active: true,
        startDistance,
        startZoom: zoom,
        startCenterX: centerX,
        startCenterY: centerY,
      };

      touchPanRef.current.active = false;
      return;
    }

    if (event.touches.length === 1) {
      const touch = event.touches[0];
      touchPanRef.current = {
        active: true,
        startX: touch.clientX,
        startY: touch.clientY,
        startPanX: followPlayer ? 0 : panOffset.x,
        startPanY: followPlayer ? 0 : panOffset.y,
      };

      if (followPlayer) {
        setFreePanCenter({ x: normalizedX, y: normalizedY });
        setFollowPlayer(false);
      }

      setIsPanning(true);
    }
  }

  function handleTouchMove(event) {
    const pinch = pinchRef.current;
    if (pinch.active && event.touches.length >= 2) {
      const distance = getTouchDistance(event.touches);
      if (!distance || !pinch.startDistance) return;

      event.preventDefault();
      const scale = distance / pinch.startDistance;
      const centerX = (event.touches[0].clientX + event.touches[1].clientX) * 0.5;
      const centerY = (event.touches[0].clientY + event.touches[1].clientY) * 0.5;
      applyZoomAtClientPoint(pinch.startZoom * scale, centerX, centerY);
      return;
    }

    const touchPan = touchPanRef.current;
    if (!touchPan.active || event.touches.length !== 1) return;

    const touch = event.touches[0];
    event.preventDefault();
    const nextX = touchPan.startPanX + (touch.clientX - touchPan.startX);
    const nextY = touchPan.startPanY + (touch.clientY - touchPan.startY);
    setPanOffset({ x: nextX, y: nextY });
  }

  function handleTouchEnd(event) {
    if (event.touches.length >= 2) return;
    pinchRef.current.active = false;

    if (event.touches.length === 1) {
      const touch = event.touches[0];
      touchPanRef.current = {
        active: true,
        startX: touch.clientX,
        startY: touch.clientY,
        startPanX: followPlayer ? 0 : panOffset.x,
        startPanY: followPlayer ? 0 : panOffset.y,
      };
      return;
    }

    touchPanRef.current.active = false;
    setIsPanning(false);
  }

  function handleFollowPlayer() {
    setPanOffset({ x: 0, y: 0 });
    setFreePanCenter({ x: normalizedX, y: normalizedY });
    setFollowPlayer(true);
    setIsPanning(false);
    pinchRef.current.active = false;
    touchPanRef.current.active = false;
    mousePanRef.current.active = false;
  }

  const canRenderMap = activeMapInfo.available && Boolean(activeMapInfo.url);
  const mapProgress = Math.max(0, Math.min(100, Math.round(Number(activeMapInfo.progress) || 0)));

  return (
    <div className="tab-map">
      <div className="map-meta-row">
        <span>WORLD: {mapDef?.label || data.worldName || 'UNKNOWN'}</span>
        <span>COORD: {formatMeters(posX)}-{formatMeters(posY)}</span>
      </div>

      <div
        className={`map-viewport${isPanning ? ' is-panning' : ''}`}
        ref={viewportRef}
        onWheel={handleWheelZoom}
        onMouseDown={handleMousePanStart}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        {canRenderMap ? (
          MAP_LAYER_OPTIONS.map((layer) => {
            const layerInfo = mapInfoByLayer[layer.id] || createEmptyLayerMapInfo();
            if (!layerInfo.available || !layerInfo.url) return null;

            return (
              <img
                key={`map-layer-${layer.id}`}
                src={layerInfo.url}
                alt={`${mapDef?.label || data.worldName || 'Arma'} terrain map ${layer.id}`}
                className="map-layer"
                style={{
                  width: `${mapWidthPct}%`,
                  height: 'auto',
                  left: `${mapOffsetX + (layer.id === 'atlas' ? atlasShiftXPct : 0)}%`,
                  top: `${mapOffsetY - (layer.id === 'atlas' ? atlasShiftYPct : 0)}%`,
                  transform: `translate(${effectivePanX}px, ${effectivePanY}px)`,
                  opacity: layer.id === activeLayer ? 1 : 0,
                  visibility: layer.id === activeLayer ? 'visible' : 'hidden',
                }}
                draggable={false}
                onLoad={(event) => {
                  const width = Number(event.currentTarget.naturalWidth) || 0;
                  const height = Number(event.currentTarget.naturalHeight) || 0;
                  setMapImageSizeByLayer((prev) => ({
                    ...prev,
                    [layer.id]: { width, height },
                  }));
                }}
                onError={() => {
                  setMapImageSizeByLayer((prev) => ({
                    ...prev,
                    [layer.id]: { width: 0, height: 0 },
                  }));
                  setMapInfoByLayer((prev) => ({
                    ...prev,
                    [layer.id]: {
                      ...(prev[layer.id] || createEmptyLayerMapInfo()),
                      available: false,
                      message: 'Map image failed to load from bridge cache',
                    },
                  }));
                }}
              />
            );
          })
        ) : (
          <div className="map-placeholder">
            <strong>{activeMapInfo.loading ? 'PREPARING MAP...' : 'MAP NOT READY'}</strong>
            <span>{mapProgress}%</span>
            <div style={{ width: '70%', maxWidth: '320px', height: '8px', border: '1px solid var(--color-text-secondary)', borderRadius: '999px', overflow: 'hidden', marginTop: '2px' }}>
              <div style={{ width: `${mapProgress}%`, height: '100%', background: 'var(--color-accent)', transition: 'width 240ms ease' }} />
            </div>
            <span>{activeMapInfo.message}</span>
            {activeMapInfo.source ? <span>Source: {activeMapInfo.source}</span> : null}
          </div>
        )}

        {activeLayer === 'atlas' ? <div className="map-grid-overlay" /> : null}

        {canRenderMap ? (
          <>
            {mapMarkerVisuals.areas.map((area) => (
              <div
                key={area.key}
                className={`map-user-marker-area ${area.shapeClass}`}
                style={{
                  left: `calc(${area.xPct}% + ${effectivePanX}px)`,
                  top: `calc(${area.yPct}% + ${effectivePanY}px)`,
                  width: `${area.widthPct}%`,
                  height: `${area.heightPct}%`,
                  borderColor: area.color,
                  borderStyle: area.borderStyle,
                  transform: `translate(-50%, -50%) rotate(${area.dirDeg}deg)`,
                }}
              />
            ))}

            <svg
              className="map-marker-lines"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              style={{
                left: `calc(${mapOffsetX + (activeLayer === 'atlas' ? atlasShiftXPct : 0)}% + ${effectivePanX}px)`,
                top: `calc(${mapOffsetY - (activeLayer === 'atlas' ? atlasShiftYPct : 0)}% + ${effectivePanY}px)`,
                width: `${mapWidthPct}%`,
                height: `${mapHeightPct}%`,
              }}
            >
              {mapMarkerVisuals.lines.map((line) => (
                <polyline
                  key={line.key}
                  className="map-marker-line"
                  points={line.points}
                  stroke={line.color}
                  strokeDasharray={line.dashArray}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>

            {mapMarkerVisuals.points.map((marker) => (
              <div
                key={marker.key}
                className="map-user-marker"
                style={{
                  left: `calc(${marker.xPct}% + ${effectivePanX}px)`,
                  top: `calc(${marker.yPct}% + ${effectivePanY}px)`,
                }}
                title={marker.label}
              >
                <MarkerTypeIcon
                  shape={marker.iconShape}
                  frame={marker.iconFrame}
                  color={marker.color}
                  glyph={marker.glyph}
                />
                {marker.typeCode ? (
                  <div
                    className="map-user-marker-type"
                    style={{ color: marker.color }}
                  >
                    {marker.typeCode}
                  </div>
                ) : null}
                {marker.label ? (
                  <div
                    className="map-user-marker-label"
                    style={{ color: marker.color }}
                  >
                    {marker.label}
                  </div>
                ) : null}
              </div>
            ))}

            <div
              className="map-player-marker"
              style={{
                left: `calc(${playerViewportXPct}% + ${effectivePanX}px)`,
                top: `calc(${playerViewportYPct}% + ${effectivePanY}px)`,
              }}
            >
              <div className="map-player-dot" />
              <div
                className="map-player-arrow"
                style={{ transform: `translate(-50%, -50%) rotate(${data.heading}deg)` }}
              />
            </div>
          </>
        ) : null}
      </div>

      <div className="map-footer-row">
        <div className="map-zoom-controls">
          <div className="map-layer-switch">
            {MAP_LAYER_OPTIONS.map((layer) => (
              <button
                key={layer.id}
                className={`map-zoom-btn map-layer-btn ${activeLayer === layer.id ? 'active' : ''}`}
                onClick={() => setActiveLayer(layer.id)}
              >
                {layer.label}
              </button>
            ))}
          </div>
          <button
            className="map-zoom-btn"
            onClick={() => setZoom((current) => clamp(current - MAP_ZOOM_STEP, MAP_ZOOM_MIN, MAP_ZOOM_MAX))}
          >
            -
          </button>
          <span>{zoom.toFixed(1)}x</span>
          <button
            className="map-zoom-btn"
            onClick={() => setZoom((current) => clamp(current + MAP_ZOOM_STEP, MAP_ZOOM_MIN, MAP_ZOOM_MAX))}
          >
            +
          </button>
          <button
            className="map-zoom-btn map-zoom-reset"
            onClick={() => setZoom(MAP_ZOOM_DEFAULT)}
          >
            RST
          </button>
          <button
            className="map-zoom-btn map-zoom-follow"
            onClick={handleFollowPlayer}
          >
            FOL
          </button>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState('INFO');
  const { data } = useTelemetry();

  return (
    <div className="dagr-shell">
      {/* Screen Frame */}
      <div className="dagr-screen-bezel">
        <div className="dagr-screen">
          
          <div className="status-bar">
            <span>{activeTab} MODE</span>
            <span>{data.time}</span>
          </div>

          <div className="content-area">
            <div style={{ display: activeTab === 'INFO' ? 'block' : 'none', height: '100%' }}>
              <InfoTab />
            </div>
            <div style={{ display: activeTab === 'COMPASS' ? 'block' : 'none', height: '100%' }}>
              <CompassTab />
            </div>
            <div style={{ display: activeTab === 'WPTS' ? 'block' : 'none', height: '100%' }}>
              <WaypointsTab />
            </div>
            <div style={{ display: activeTab === 'MAP' ? 'block' : 'none', height: '100%' }}>
              <MapTab isActive={activeTab === 'MAP'} />
            </div>
          </div>

        </div>
      </div>

      {/* Hardware Buttons */}
      <div className="dagr-controls">
        <button className={`hw-button ${activeTab === 'INFO' ? 'active' : ''}`} onClick={() => setActiveTab('INFO')}>INFO</button>
        <button className={`hw-button ${activeTab === 'COMPASS' ? 'active' : ''}`} onClick={() => setActiveTab('COMPASS')}>CMP</button>
        <button className={`hw-button ${activeTab === 'WPTS' ? 'active' : ''}`} onClick={() => setActiveTab('WPTS')}>WPT</button>
        <button className={`hw-button ${activeTab === 'MAP' ? 'active' : ''}`} onClick={() => setActiveTab('MAP')}>MAP</button>
      </div>
    </div>
  );
}

export default App;
