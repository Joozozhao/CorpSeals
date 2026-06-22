import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AlertTriangle,
  BadgeCheck,
  Building2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Layers3,
  LogOut,
  Maximize2,
  Minus,
  Settings,
  Plus,
  RotateCcw,
  Redo2,
  Save,
  Scissors,
  Stamp,
  Trash2,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import './styles.css';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

function BrandLogo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="CorpSeals" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="60" height="60" rx="15" fill="var(--seal)" />
      <rect x="2" y="2" width="60" height="60" rx="15" fill="none" stroke="var(--seal-dark)" strokeWidth="2" />
      <text
        x="32"
        y="33"
        fill="#ffffff"
        fontSize="34"
        fontWeight="700"
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="'STSong', 'SimSun', 'Songti SC', serif"
      >
        印
      </text>
    </svg>
  );
}

type SealKind = 'official' | 'contract' | 'financial' | 'legal';
type StampMode = 'batch' | 'specific' | 'seam';
type SideView = 'subjects' | 'records' | 'settings' | 'qualifications';
type ColorTheme = 'red' | 'green' | 'purple';

type LoginCredentials = {
  username: string;
  password: string;
};

type Subject = {
  id: string;
  name: string;
  seals: Partial<Record<SealKind, string>>;
  sealSizes?: Partial<Record<SealKind, number>>;
  qualifications?: Qualification[];
};

type SealPosition = 'tl' | 'tr' | 'bl' | 'br' | 'center';

type Qualification = {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  purpose: string;
  addSeal: boolean;
  addWatermark: boolean;
  sealPosition?: SealPosition;
};

type MaterialSealEntry = {
  kind: SealKind;
  file: string;
  mimeType: string;
  sizeMm?: number;
};

type MaterialQualificationEntry = {
  file: string;
  name: string;
  mimeType: string;
  purpose: string;
  addSeal: boolean;
  addWatermark: boolean;
  sealPosition?: SealPosition;
};

type MaterialSubjectEntry = {
  name: string;
  sealSizes?: Partial<Record<SealKind, number>>;
  seals: MaterialSealEntry[];
  qualifications: MaterialQualificationEntry[];
};

type MaterialPackageManifest = {
  app: 'CorpSeals';
  version: 1;
  exportedAt: string;
  subjects: MaterialSubjectEntry[];
};

type ZipFileEntry = {
  path: string;
  data: Uint8Array;
};

const SEAL_POSITION_LABELS: Record<SealPosition, string> = {
  tl: '左上',
  tr: '右上',
  center: '居中',
  bl: '左下',
  br: '右下',
};

type NormalStamp = {
  id: string;
  type: 'normal';
  pages: number[];
  sealKind: SealKind;
  xPercent: number;
  yPercent: number;
  sizePercent: number;
  pageOverrides?: Record<number, PagePositionOverride>;
};

type PagePositionOverride = {
  xPercent: number;
  yPercent: number;
};

type SeamStamp = {
  id: string;
  type: 'seam';
  pages: number[];
  splitCount: number;
  yPercent: number;
  heightPercent: number;
  rightInsetPercent: number;
};

type StampAction = NormalStamp | SeamStamp;

type RenderPage = {
  width: number;
  height: number;
  scale: number;
};

type ExportRecord = {
  id: string;
  kind?: 'export' | 'workflow';
  name: string;
  subjectName: string;
  pageCount: number;
  actionCount: number;
  createdAt: string;
  dataUrl?: string;
  sourcePdfName?: string;
  sourcePdfDataUrl?: string;
  activeSubjectId?: string;
  actions?: StampAction[];
  exportName?: string;
  currentPage?: number;
};

type PersistedAppData = {
  subjects: Subject[];
  activeSubjectId: string;
  actions: StampAction[];
  exportName: string;
  records?: ExportRecord[];
  colorTheme?: ColorTheme;
  loginCredentials?: LoginCredentials;
};

type StorageInfo = {
  storagePath: string;
  dataFilePath: string;
};

type CorpSealStorageBridge = {
  readAppData: () => Promise<PersistedAppData | null>;
  writeAppData: (data: PersistedAppData) => Promise<void>;
  getStorageInfo: () => Promise<StorageInfo>;
};

type ConfirmDialogState = {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  tone?: 'danger' | 'default';
};

declare global {
  interface Window {
    corpSealStorage?: CorpSealStorageBridge;
  }
}

const DEFAULT_LOGIN_CREDENTIALS: LoginCredentials = {
  username: 'joozo',
  password: '7777',
};
const REMEMBER_LOGIN_KEY = 'corp-seals.remember-login';
const REMEMBER_LOGIN_DAYS = 7;
const STORAGE_KEY = 'pdf-seal-studio.subjects';
const DB_NAME = 'corp-seal-studio-db';
const DB_VERSION = 1;
const DB_STORE = 'workspace';
const DB_DATA_KEY = 'app-data';
const sealLabels: Record<SealKind, string> = {
  official: '公章',
  contract: '合同章',
  financial: '财务章',
  legal: '法人章',
};
const sealKindList = Object.keys(sealLabels) as SealKind[];
const colorThemeLabels: Record<ColorTheme, string> = {
  red: '红色',
  green: '深绿',
  purple: '紫色',
};
const colorThemeList = Object.keys(colorThemeLabels) as ColorTheme[];
const A4_WIDTH_MM = 210;
const MIN_SEAL_MM = 5;
const MAX_SEAL_MM = 80;
const DEFAULT_SEAL_MM: Record<SealKind, number> = {
  official: 40,
  contract: 40,
  financial: 40,
  legal: 18,
};
const SEAL_SIZE_PRESETS = [42, 40, 36, 22, 18];
const MAX_ACTION_HISTORY = 50;

type SealSizes = Partial<Record<SealKind, number>>;
type ActionHistoryUpdater = StampAction[] | ((list: StampAction[]) => StampAction[]);

function sealMm(kind: SealKind, sizes?: SealSizes) {
  const value = sizes?.[kind];
  return value && value > 0 ? value : DEFAULT_SEAL_MM[kind];
}

function clampSealMm(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_SEAL_MM.official;
  return Math.min(MAX_SEAL_MM, Math.max(MIN_SEAL_MM, Math.round(value)));
}

function sealSizePercent(kind: SealKind, _fallbackPercent: number, sizes?: SealSizes) {
  return (sealMm(kind, sizes) / A4_WIDTH_MM) * 100;
}

function sealSizeText(kind: SealKind, sizes?: SealSizes) {
  const mm = sealMm(kind, sizes);
  return `${mm}mm × ${mm}mm`;
}

function cloneStampActions(list: StampAction[]) {
  return list.map((action) => {
    if (action.type === 'seam') {
      return { ...action, pages: [...action.pages] };
    }
    return {
      ...action,
      pages: [...action.pages],
      pageOverrides: action.pageOverrides
        ? Object.fromEntries(
          Object.entries(action.pageOverrides).map(([page, position]) => [page, { ...position }]),
        )
        : undefined,
    };
  });
}

function sameActionSnapshots(left: StampAction[], right: StampAction[]) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isEditableShortcutTarget(target: EventTarget | null) {
  return target instanceof HTMLElement
    && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

function defaultSeamSplitCount(totalPages: number) {
  return Math.max(1, totalPages || 1);
}

// 骑缝章按 splitCount 为一组循环覆盖范围内所有页面。
// 返回该页在所属分组内的切片下标，以及该分组实际的切片数量（末组可能更少）。
function seamSliceInfo(pagesInRange: number, splitCount: number, localIndex: number) {
  const group = Math.max(1, splitCount);
  const groupStart = Math.floor(localIndex / group) * group;
  const groupSize = Math.min(group, pagesInRange - groupStart);
  return { sliceIndex: localIndex - groupStart, groupSize: Math.max(1, groupSize) };
}

function readLegacySubjects(): Subject[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as Subject[];
    return Array.isArray(parsed)
      ? parsed.map((subject) => ({ ...subject, qualifications: subject.qualifications || [] }))
      : [];
  } catch {
    return [];
  }
}

function openAppDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error || new Error('无法打开本地数据库'));
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DB_STORE)) {
        database.createObjectStore(DB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function normalizePersistedAppData(value: PersistedAppData | null | undefined): PersistedAppData | null {
  if (!value || typeof value !== 'object') return null;
  const colorTheme = colorThemeList.includes(value.colorTheme as ColorTheme)
    ? value.colorTheme
    : 'red';
  const savedCredentials = value.loginCredentials;
  const loginCredentials = savedCredentials?.username?.trim() && savedCredentials.password
    ? { username: savedCredentials.username.trim(), password: savedCredentials.password }
    : DEFAULT_LOGIN_CREDENTIALS;
  return {
    subjects: Array.isArray(value.subjects)
      ? value.subjects.map((subject) => ({ ...subject, qualifications: subject.qualifications || [] }))
      : [],
    activeSubjectId: value.activeSubjectId || '',
    actions: Array.isArray(value.actions) ? value.actions : [],
    exportName: value.exportName || '已盖章文件_已电子签章.pdf',
    records: Array.isArray(value.records) ? value.records : [],
    colorTheme,
    loginCredentials,
  };
}

async function readBrowserPersistedAppData() {
  const database = await openAppDatabase();
  return new Promise<PersistedAppData | null>((resolve, reject) => {
    const transaction = database.transaction(DB_STORE, 'readonly');
    const request = transaction.objectStore(DB_STORE).get(DB_DATA_KEY);
    request.onerror = () => reject(request.error || new Error('无法读取本地数据库'));
    request.onsuccess = () => {
      const value = request.result as PersistedAppData | undefined;
      if (!value) {
        resolve(null);
        return;
      }
      resolve(normalizePersistedAppData(value));
    };
    transaction.oncomplete = () => database.close();
  });
}

async function writeBrowserPersistedAppData(data: PersistedAppData) {
  const database = await openAppDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(DB_STORE, 'readwrite');
    const request = transaction.objectStore(DB_STORE).put(data, DB_DATA_KEY);
    request.onerror = () => reject(request.error || new Error('无法写入本地数据库'));
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error('无法写入本地数据库'));
    };
  });
}

async function readPersistedAppData() {
  if (window.corpSealStorage) {
    return normalizePersistedAppData(await window.corpSealStorage.readAppData());
  }
  return readBrowserPersistedAppData();
}

async function writePersistedAppData(data: PersistedAppData) {
  if (window.corpSealStorage) {
    await window.corpSealStorage.writeAppData(data);
    return;
  }
  await writeBrowserPersistedAppData(data);
}

async function readStorageInfo() {
  return window.corpSealStorage ? window.corpSealStorage.getStorageInfo() : null;
}

function rememberLoginUntil() {
  return Date.now() + REMEMBER_LOGIN_DAYS * 24 * 60 * 60 * 1000;
}

function readRememberedLogin(credentials: LoginCredentials) {
  try {
    const parsed = JSON.parse(localStorage.getItem(REMEMBER_LOGIN_KEY) || 'null') as { username?: string; expiresAt?: number } | null;
    if (!parsed || parsed.username !== credentials.username || !parsed.expiresAt || parsed.expiresAt <= Date.now()) {
      localStorage.removeItem(REMEMBER_LOGIN_KEY);
      return null;
    }
    return parsed;
  } catch {
    localStorage.removeItem(REMEMBER_LOGIN_KEY);
    return null;
  }
}

function writeRememberedLogin(username: string) {
  localStorage.setItem(REMEMBER_LOGIN_KEY, JSON.stringify({
    username,
    expiresAt: rememberLoginUntil(),
  }));
}

function clearRememberedLogin() {
  localStorage.removeItem(REMEMBER_LOGIN_KEY);
}

function uid(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function safeFileName(name: string) {
  return name.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || '文件';
}

function timestampText(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function downloadBlob(blob: Blob, fileName: string) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function canvasToPngDataUrl(canvas: HTMLCanvasElement) {
  return new Promise<string>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('无法生成印章图片'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    }, 'image/png');
  });
}

function clampByte(value: number) {
  return Math.min(255, Math.max(0, Math.round(value)));
}

async function generateSealFromScan(file: File, squareOutput: boolean) {
  const source = await fileToDataUrl(file);
  const image = await imageElement(source);
  const maxSourceSide = 1800;
  const scale = Math.min(1, maxSourceSide / Math.max(image.naturalWidth, image.naturalHeight));
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  sourceCanvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
  if (!sourceContext) throw new Error('无法读取扫描件');
  sourceContext.drawImage(image, 0, 0, sourceCanvas.width, sourceCanvas.height);

  const imageData = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const { data, width, height } = imageData;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let inkPixels = 0;

  for (let index = 0; index < data.length; index += 4) {
    const x = (index / 4) % width;
    const y = Math.floor(index / 4 / width);
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max ? (max - min) / max : 0;
    const redDominance = r - Math.max(g, b);
    const redInk = r > 70 && saturation > 0.16 && redDominance > 14 && r > g * 1.08 && r > b * 1.04;
    const darkRedInk = r > 95 && g < 135 && b < 135 && r > g * 1.18 && r > b * 1.12;
    const keep = redInk || darkRedInk;
    if (keep) {
      const alpha = clampByte((redDominance + saturation * 130 - 20) * 1.7);
      data[index] = clampByte(178 + (r - 130) * 0.22);
      data[index + 1] = clampByte(g * 0.34);
      data[index + 2] = clampByte(b * 0.38 + 18);
      data[index + 3] = Math.max(95, alpha);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      inkPixels += 1;
    } else {
      data[index + 3] = 0;
    }
  }

  const minInkPixels = Math.max(80, (width * height) * 0.0004);
  if (inkPixels < minInkPixels) {
    throw new Error('未识别到足够清晰的红色印文');
  }

  const rowCounts = new Array<number>(height).fill(0);
  const colCounts = new Array<number>(width).fill(0);
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] < 50) continue;
    const x = (index / 4) % width;
    const y = Math.floor(index / 4 / width);
    rowCounts[y] += 1;
    colCounts[x] += 1;
  }
  const edgeThreshold = Math.max(2, Math.round(Math.min(width, height) * 0.0015));
  const tightMinX = colCounts.findIndex((count) => count >= edgeThreshold);
  const tightMaxX = colCounts.length - 1 - [...colCounts].reverse().findIndex((count) => count >= edgeThreshold);
  const tightMinY = rowCounts.findIndex((count) => count >= edgeThreshold);
  const tightMaxY = rowCounts.length - 1 - [...rowCounts].reverse().findIndex((count) => count >= edgeThreshold);
  if (tightMinX >= 0 && tightMinY >= 0 && tightMaxX >= tightMinX && tightMaxY >= tightMinY) {
    minX = tightMinX;
    maxX = tightMaxX;
    minY = tightMinY;
    maxY = tightMaxY;
  }

  sourceContext.putImageData(imageData, 0, 0);
  const padding = Math.min(10, Math.max(2, Math.round(Math.max(maxX - minX, maxY - minY) * 0.012)));
  minX = Math.max(0, minX - padding);
  minY = Math.max(0, minY - padding);
  maxX = Math.min(width - 1, maxX + padding);
  maxY = Math.min(height - 1, maxY + padding);
  const cropWidth = Math.max(1, maxX - minX + 1);
  const cropHeight = Math.max(1, maxY - minY + 1);
  const outputSize = squareOutput ? Math.max(cropWidth, cropHeight) : 0;
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = squareOutput ? outputSize : cropWidth;
  outputCanvas.height = squareOutput ? outputSize : cropHeight;
  const outputContext = outputCanvas.getContext('2d');
  if (!outputContext) throw new Error('无法生成透明印章');
  const dx = squareOutput ? Math.round((outputSize - cropWidth) / 2) : 0;
  const dy = squareOutput ? Math.round((outputSize - cropHeight) / 2) : 0;
  outputContext.drawImage(sourceCanvas, minX, minY, cropWidth, cropHeight, dx, dy, cropWidth, cropHeight);
  return canvasToPngDataUrl(outputCanvas);
}

// 平铺水印：45° 斜度、20px 宋体、灰色、透明度 20%。
function drawTiledWatermark(
  context: CanvasRenderingContext2D,
  text: string,
  width: number,
  height: number,
  fontPx = 20,
) {
  context.save();
  context.font = `${fontPx}px "SimSun", "STSong", "Songti SC", "宋体", serif`;
  context.fillStyle = 'rgba(120, 120, 120, 0.2)';
  context.textAlign = 'left';
  context.textBaseline = 'middle';
  const textWidth = Math.max(fontPx * 4, context.measureText(text).width);
  const stepX = textWidth + fontPx * 4;
  const stepY = fontPx * 6;
  const diag = Math.ceil(Math.sqrt(width * width + height * height));
  context.translate(width / 2, height / 2);
  context.rotate(-Math.PI / 4);
  for (let y = -diag; y < diag; y += stepY) {
    for (let x = -diag; x < diag; x += stepX) {
      context.fillText(text, x, y);
    }
  }
  context.restore();
}

function createPageWatermarkCanvas(text: string, width: number, height: number, fontPx = 20) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法生成水印');
  drawTiledWatermark(context, text, canvas.width, canvas.height, fontPx);
  return canvas;
}

function isWordMime(mimeType: string, name: string) {
  return (
    mimeType.includes('word') ||
    mimeType === 'application/msword' ||
    /\.(docx?|rtf)$/i.test(name)
  );
}

function qualificationWatermarkText(qualification: Qualification) {
  const purpose = qualification.purpose.trim() || '未填写用途';
  return `用途：${purpose}  ${timestampText()}`;
}

async function downloadQualificationFile(qualification: Qualification, subject: Subject) {
  const baseName = safeFileName(qualification.name.replace(/\.[^.]+$/, ''));
  const watermarkText = qualificationWatermarkText(qualification);
  const shouldSeal = Boolean(qualification.addSeal && subject.seals.official);
  const shouldWatermark = qualification.addWatermark;

  if (qualification.mimeType === 'application/pdf') {
    const pdfDoc = await PDFDocument.load(dataUrlToBytes(qualification.dataUrl));
    const pdfPages = pdfDoc.getPages();
    const sealImage = shouldSeal && subject.seals.official
      ? await embedImage(pdfDoc, subject.seals.official)
      : null;

    for (const page of pdfPages) {
      const { width, height } = page.getSize();
      if (shouldWatermark) {
        const watermarkCanvas = createPageWatermarkCanvas(watermarkText, width * 2, height * 2, 40);
        const watermarkImage = await embedImage(pdfDoc, await canvasToPngDataUrl(watermarkCanvas));
        page.drawImage(watermarkImage, { x: 0, y: 0, width, height });
      }
      if (sealImage) {
        const sealWidth = (width * sealSizePercent('official', 19, subject.sealSizes)) / 100;
        // PDF 坐标系原点在左下角，y 轴向上。
        const marginX = width * 0.08;
        const marginY = height * 0.08;
        const pos = qualification.sealPosition ?? 'br';
        const isLeft = pos === 'tl' || pos === 'bl';
        const isTop = pos === 'tl' || pos === 'tr';
        const isCenter = pos === 'center';
        const x = isCenter
          ? (width - sealWidth) / 2
          : isLeft
            ? marginX
            : width - sealWidth - marginX;
        const y = isCenter
          ? (height - sealWidth) / 2
          : isTop
            ? height - sealWidth - marginY
            : marginY;
        page.drawImage(sealImage, { x, y, width: sealWidth, height: sealWidth });
      }
    }

    const result = await pdfDoc.save();
    const buffer = new ArrayBuffer(result.byteLength);
    new Uint8Array(buffer).set(result);
    downloadBlob(new Blob([buffer], { type: 'application/pdf' }), `${baseName}-已处理.pdf`);
    return;
  }

  if (qualification.mimeType.startsWith('image/')) {
    const image = await imageElement(qualification.dataUrl);
    const canvas = document.createElement('canvas');
    const maxSide = 2400;
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法处理资质图片');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    if (shouldWatermark) {
      // 按画布尺寸缩放字号，使视觉接近 20px 宋体的密度。
      const fontPx = Math.max(20, Math.round(canvas.width * 0.018));
      drawTiledWatermark(context, watermarkText, canvas.width, canvas.height, fontPx);
    }
    if (shouldSeal && subject.seals.official) {
      const seal = await imageElement(subject.seals.official);
      const sealWidth = Math.min(canvas.width * 0.2, Math.max(96, canvas.width * 0.14));
      // Canvas 坐标系原点在左上角，y 轴向下。
      const marginX = canvas.width * 0.06;
      const marginY = canvas.height * 0.06;
      const pos = qualification.sealPosition ?? 'br';
      const isLeft = pos === 'tl' || pos === 'bl';
      const isTop = pos === 'tl' || pos === 'tr';
      const isCenter = pos === 'center';
      const sealX = isCenter
        ? (canvas.width - sealWidth) / 2
        : isLeft
          ? marginX
          : canvas.width - sealWidth - marginX;
      const sealY = isCenter
        ? (canvas.height - sealWidth) / 2
        : isTop
          ? marginY
          : canvas.height - sealWidth - marginY;
      context.globalAlpha = 0.88;
      context.drawImage(seal, sealX, sealY, sealWidth, sealWidth);
      context.globalAlpha = 1;
    }
    const result = await canvasToPngDataUrl(canvas);
    downloadBlob(new Blob([dataUrlToBytes(result)], { type: 'image/png' }), `${baseName}-已处理.png`);
    return;
  }

  // Word 等其它格式：无法在浏览器内渲染叠加，直接下载原始文件。
  downloadBlob(new Blob([dataUrlToBytes(qualification.dataUrl)], { type: qualification.mimeType || 'application/octet-stream' }), qualification.name);
}

function dataUrlToBytes(dataUrl: string) {
  const [, base64 = ''] = dataUrl.split(',');
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes;
}

function dataUrlMime(dataUrl: string) {
  return dataUrl.match(/^data:([^;,]+)/)?.[1] || 'application/octet-stream';
}

function bytesToDataUrl(bytes: Uint8Array, mimeType: string) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }
  return `data:${mimeType || 'application/octet-stream'};base64,${btoa(binary)}`;
}

function fileExtensionFromMime(mimeType: string) {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'application/pdf') return 'pdf';
  return 'bin';
}

function sanitizeFileSegment(value: string, fallback: string) {
  const cleaned = value
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
}

function uniquePath(path: string, used: Set<string>) {
  if (!used.has(path)) {
    used.add(path);
    return path;
  }
  const dotIndex = path.lastIndexOf('.');
  const base = dotIndex > -1 ? path.slice(0, dotIndex) : path;
  const extension = dotIndex > -1 ? path.slice(dotIndex) : '';
  let index = 2;
  let next = `${base}-${index}${extension}`;
  while (used.has(next)) {
    index += 1;
    next = `${base}-${index}${extension}`;
  }
  used.add(next);
  return next;
}

function makeCrc32Table() {
  return Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    return value >>> 0;
  });
}

const CRC32_TABLE = makeCrc32Table();

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concatBytes(chunks: Uint8Array[]) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    result.set(chunk, offset);
    offset += chunk.length;
  });
  return result;
}

function createZip(files: ZipFileEntry[]) {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const centralDirectory: Uint8Array[] = [];
  let offset = 0;

  files.forEach((file) => {
    const nameBytes = encoder.encode(file.path);
    const crc = crc32(file.data);
    const localHeader = new Uint8Array(30);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, file.data.length, true);
    localView.setUint32(22, file.data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    chunks.push(localHeader, nameBytes, file.data);

    const centralHeader = new Uint8Array(46);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, file.data.length, true);
    centralView.setUint32(24, file.data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    centralDirectory.push(centralHeader, nameBytes);
    offset += localHeader.length + nameBytes.length + file.data.length;
  });

  const centralOffset = offset;
  const centralBytes = concatBytes(centralDirectory);
  chunks.push(centralBytes);
  const endHeader = new Uint8Array(22);
  const endView = new DataView(endHeader.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralBytes.length, true);
  endView.setUint32(16, centralOffset, true);
  chunks.push(endHeader);
  return concatBytes(chunks);
}

function parseZip(bytes: Uint8Array) {
  const decoder = new TextDecoder();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let endOffset = -1;
  for (let offset = bytes.length - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error('无法识别资料包，请选择本工具导出的 ZIP。');
  const entryCount = view.getUint16(endOffset + 10, true);
  let centralOffset = view.getUint32(endOffset + 16, true);
  const entries = new Map<string, Uint8Array>();

  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(centralOffset, true) !== 0x02014b50) throw new Error('资料包目录损坏。');
    const method = view.getUint16(centralOffset + 10, true);
    if (method !== 0) throw new Error('暂不支持压缩格式，请使用本工具导出的资料包。');
    const compressedSize = view.getUint32(centralOffset + 20, true);
    const nameLength = view.getUint16(centralOffset + 28, true);
    const extraLength = view.getUint16(centralOffset + 30, true);
    const commentLength = view.getUint16(centralOffset + 32, true);
    const localOffset = view.getUint32(centralOffset + 42, true);
    const name = decoder.decode(bytes.slice(centralOffset + 46, centralOffset + 46 + nameLength));
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    entries.set(name, bytes.slice(dataStart, dataStart + compressedSize));
    centralOffset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function parsePageList(input: string, pageCount: number) {
  const pages = new Set<number>();
  input
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      if (part.includes('-')) {
        const [startRaw, endRaw] = part.split('-');
        const start = Number(startRaw);
        const end = Number(endRaw);
        if (Number.isFinite(start) && Number.isFinite(end)) {
          const low = Math.max(1, Math.min(start, end));
          const high = Math.min(pageCount, Math.max(start, end));
          for (let page = low; page <= high; page += 1) pages.add(page);
        }
      } else {
        const page = Number(part);
        if (Number.isInteger(page) && page >= 1 && page <= pageCount) pages.add(page);
      }
    });
  return [...pages].sort((a, b) => a - b);
}

function rangePages(start: number, end: number, pageCount: number) {
  const low = Math.max(1, Math.min(start, end));
  const high = Math.min(pageCount, Math.max(start, end));
  return Array.from({ length: high - low + 1 }, (_, index) => low + index);
}

function pagesToRangeText(pages: number[]) {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const ranges: string[] = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const start = sorted[index];
    let end = start;
    while (sorted[index + 1] === end + 1) {
      index += 1;
      end = sorted[index];
    }
    ranges.push(start === end ? String(start) : `${start}-${end}`);
  }
  return ranges.join(',');
}

function areContinuousPages(pages: number[]) {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  return sorted.length > 1 && sorted.every((page, index) => index === 0 || page === sorted[index - 1] + 1);
}

const EXPORT_SUFFIX = '_已电子签章';

function defaultExportName(fileName: string) {
  const baseName = fileName.replace(/\.pdf$/i, '').trim();
  return `${baseName || '已盖章文件'}${EXPORT_SUFFIX}.pdf`;
}

function normalizeExportName(input: string, fallback: string) {
  const trimmed = input.trim();
  if (!trimmed) return fallback;
  return trimmed.toLowerCase().endsWith('.pdf') ? trimmed : `${trimmed}.pdf`;
}

function samePages(left: number[], right: number[]) {
  if (left.length !== right.length) return false;
  return left.every((page, index) => page === right[index]);
}

function actionTitle(action: StampAction) {
  return action.type === 'seam' ? '骑缝章' : sealLabels[action.sealKind];
}

function dedupeSeamActions(list: StampAction[]) {
  const seen = new Set<string>();
  const normalized: StampAction[] = [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const action = list[index];
    const key = action.type === 'seam' ? `seam:${action.pages.join(',')}` : action.id;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.unshift(action);
  }
  return normalized;
}

function clampPercent(value: number, min = 0, max = 90) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function pagePosition(action: NormalStamp, pageNumber: number) {
  return action.pageOverrides?.[pageNumber] || { xPercent: action.xPercent, yPercent: action.yPercent };
}

function normalizePageOverrides(
  pages: number[],
  overrides: Record<number, PagePositionOverride>,
  baseXPercent: number,
  baseYPercent: number,
) {
  const pageSet = new Set(pages);
  const normalized: Record<number, PagePositionOverride> = {};
  Object.entries(overrides).forEach(([pageText, override]) => {
    const pageNumber = Number(pageText);
    if (!pageSet.has(pageNumber)) return;
    const x = clampPercent(override.xPercent);
    const y = clampPercent(override.yPercent);
    if (x === baseXPercent && y === baseYPercent) return;
    normalized[pageNumber] = { xPercent: x, yPercent: y };
  });
  return Object.keys(normalized).length ? normalized : undefined;
}

function imageElement(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

async function splitImageVertically(src: string, splitCount: number) {
  const image = await imageElement(src);
  const sliceWidth = image.naturalWidth / splitCount;
  return Promise.all(
    Array.from({ length: splitCount }, (_, index) => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(sliceWidth);
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('无法处理骑缝章图片');
      context.drawImage(
        image,
        index * sliceWidth,
        0,
        sliceWidth,
        image.naturalHeight,
        0,
        0,
        canvas.width,
        canvas.height,
      );
      return new Promise<string>((resolve) => canvas.toBlob((blob) => {
        if (!blob) return resolve('');
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(blob);
      }, 'image/png'));
    }),
  );
}

async function embedImage(pdfDoc: PDFDocument, dataUrl: string) {
  const bytes = dataUrlToBytes(dataUrl);
  if (dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg')) {
    return pdfDoc.embedJpg(bytes);
  }
  return pdfDoc.embedPng(bytes);
}

function PageCanvas({
  pdfDocument,
  pageNumber,
  zoom,
  fitWidth,
  onRendered,
}: {
  pdfDocument: pdfjs.PDFDocumentProxy | null;
  pageNumber: number;
  zoom: number;
  fitWidth: boolean;
  onRendered: (page: RenderPage) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [fitVersion, setFitVersion] = useState(0);

  useEffect(() => {
    if (!fitWidth) return;
    function handleResize() {
      setFitVersion((version) => version + 1);
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [fitWidth]);

  useEffect(() => {
    let cancelled = false;
    async function render() {
      if (!pdfDocument || !canvasRef.current) return;
      const page = await pdfDocument.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const stage = document.querySelector<HTMLElement>('.document-stage');
      const stageStyle = stage ? window.getComputedStyle(stage) : null;
      const horizontalPadding = stageStyle
        ? Number.parseFloat(stageStyle.paddingLeft) + Number.parseFloat(stageStyle.paddingRight)
        : 60;
      const verticalPadding = stageStyle
        ? Number.parseFloat(stageStyle.paddingTop) + Number.parseFloat(stageStyle.paddingBottom)
        : 60;
      const availableWidth = Math.max(240, (stage?.clientWidth || window.innerWidth) - horizontalPadding);
      const availableHeight = Math.max(240, (stage?.clientHeight || window.innerHeight) - verticalPadding);
      const fitScale = Math.min(
        4,
        Math.max(0.2, Math.min(availableWidth / baseViewport.width, availableHeight / baseViewport.height)),
      );
      const scale = fitWidth ? fitScale : Math.min(4, Math.max(0.2, zoom));
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      if (!context) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: context, viewport }).promise;
      if (!cancelled) onRendered({ width: viewport.width, height: viewport.height, scale });
    }
    render();
    return () => {
      cancelled = true;
    };
  }, [pdfDocument, pageNumber, zoom, fitWidth, fitVersion, onRendered]);

  return <canvas className="pdf-canvas" ref={canvasRef} />;
}

function PdfThumb({ dataUrl }: { dataUrl: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function render() {
      try {
        const document = await pdfjs.getDocument({ data: dataUrlToBytes(dataUrl).slice() }).promise;
        const page = await document.getPage(1);
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = Math.min(2, Math.max(0.4, 360 / baseViewport.width));
        const viewport = page.getViewport({ scale });
        const canvas = window.document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const context = canvas.getContext('2d');
        if (!context) return;
        await page.render({ canvasContext: context, viewport }).promise;
        if (!cancelled) setSrc(canvas.toDataURL('image/png'));
        document.destroy?.();
      } catch {
        if (!cancelled) setSrc(null);
      }
    }
    render();
    return () => {
      cancelled = true;
    };
  }, [dataUrl]);

  if (!src) {
    return (
      <span className="qualification-thumb-icon pdf">
        <FileText size={26} />
        <em>PDF</em>
      </span>
    );
  }
  return <img src={src} alt="PDF 预览" />;
}

const SEAL_PREVIEW_LAYOUT: Record<SealPosition, React.CSSProperties> = {
  tl: { top: '8%', left: '8%' },
  tr: { top: '8%', right: '8%' },
  center: { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' },
  bl: { bottom: '8%', left: '8%' },
  br: { bottom: '8%', right: '8%' },
};

// 下载弹窗中的公章位置预览：在文件缩略图上叠加公章，直观显示盖章位置。
function SealPositionPreview({
  qualification,
  sealDataUrl,
  position,
}: {
  qualification: Qualification;
  sealDataUrl?: string;
  position: SealPosition;
}) {
  const isImage = qualification.mimeType.startsWith('image/');
  const isPdf = qualification.mimeType === 'application/pdf';

  if (!isImage && !isPdf) {
    return (
      <div className="seal-preview-box seal-preview-unsupported">
        <FileText size={26} />
        <span>该格式暂不支持位置预览，下载后公章将置于所选位置。</span>
      </div>
    );
  }

  return (
    <div className="seal-preview-box">
      <div className="seal-preview-doc">
        {isImage ? <img src={qualification.dataUrl} alt="文件预览" /> : <PdfThumb dataUrl={qualification.dataUrl} />}
        {sealDataUrl ? (
          <img className="seal-preview-stamp" src={sealDataUrl} alt="公章位置" style={SEAL_PREVIEW_LAYOUT[position]} />
        ) : (
          <span className="seal-preview-stamp seal-preview-stamp-empty" style={SEAL_PREVIEW_LAYOUT[position]}>
            公章
          </span>
        )}
      </div>
    </div>
  );
}

function SealUpload({
  label,
  value,
  sizeMm,
  onChange,
  onSizeChange,
  onDelete,
  onGenerated,
}: {
  kind: SealKind;
  label: string;
  value?: string;
  sizeMm: number;
  onChange: (dataUrl: string) => void;
  onSizeChange: (mm: number) => void;
  onDelete: () => void;
  onGenerated: (message: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const sizePopRef = useRef<HTMLDivElement | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [dims, setDims] = useState<{ width: number; height: number } | null>(null);
  const [isSizeOpen, setIsSizeOpen] = useState(false);
  const [sizeDraft, setSizeDraft] = useState(String(sizeMm));

  useEffect(() => {
    setSizeDraft(String(sizeMm));
  }, [sizeMm]);

  useEffect(() => {
    if (!isSizeOpen) return;
    function handlePointerDown(event: MouseEvent) {
      if (sizePopRef.current && !sizePopRef.current.contains(event.target as Node)) {
        setIsSizeOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsSizeOpen(false);
    }
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isSizeOpen]);

  useEffect(() => {
    let cancelled = false;
    if (!value) {
      setDims(null);
      return;
    }
    imageElement(value)
      .then((image) => {
        if (!cancelled) setDims({ width: image.naturalWidth, height: image.naturalHeight });
      })
      .catch(() => {
        if (!cancelled) setDims(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value]);

  async function handleSealFile(file: File) {
    setIsGenerating(true);
    try {
      const generated = await generateSealFromScan(file, true);
      onChange(generated);
      onGenerated(`已生成并裁剪${label}透明 PNG，可直接用于盖章。`);
    } catch (error) {
      const fallback = await fileToDataUrl(file);
      onChange(fallback);
      onGenerated(error instanceof Error
        ? `${error.message}，已先保留原图。建议使用白底、红色清晰的扫描件。`
        : '未能自动生成透明印章，已先保留原图。');
    } finally {
      setIsGenerating(false);
    }
  }

  function applySize(mm: number) {
    const next = clampSealMm(mm);
    setSizeDraft(String(next));
    if (next !== sizeMm) onSizeChange(next);
  }

  function commitCustomSize() {
    applySize(Number(sizeDraft));
    setIsSizeOpen(false);
  }

  return (
    <div className={`seal-card ${isGenerating ? 'processing' : ''} ${value ? 'has-seal' : ''}`}>
      <div className="seal-card-head">
        <span className="seal-card-name">{label}</span>
        <span className={`seal-badge ${value ? 'on' : 'off'}`}>{value ? '已上传' : '未上传'}</span>
        {value && (
          <button className="seal-card-delete" type="button" title="删除印章" onClick={onDelete}>
            <Trash2 size={14} />
          </button>
        )}
      </div>

      <div className="seal-card-body">
        <button
          className="seal-thumb"
          type="button"
          onClick={() => inputRef.current?.click()}
          title={value ? '点击替换印章' : '点击上传印章'}
        >
          {value ? <img src={value} alt={label} /> : <Upload size={18} />}
        </button>
        <div className="seal-card-meta">
          {value && dims && <div className="seal-file-info">PNG · {dims.width} × {dims.height}</div>}
          <div className="seal-size-field">
            <span className="seal-size-label">尺寸</span>
            <div className="seal-size-pop-wrap" ref={sizePopRef}>
              <button
                type="button"
                className={`seal-size-trigger ${isSizeOpen ? 'open' : ''}`}
                onClick={() => setIsSizeOpen((open) => !open)}
              >
                <span>{sizeMm} × {sizeMm} mm</span>
                <ChevronDown size={14} />
              </button>
              {isSizeOpen && (
                <div className="seal-size-pop">
                  <div className="seal-size-pop-title">选择印章尺寸</div>
                  <div className="seal-size-grid">
                    {SEAL_SIZE_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        className={`seal-size-option ${preset === sizeMm ? 'active' : ''}`}
                        onClick={() => {
                          applySize(preset);
                          setIsSizeOpen(false);
                        }}
                      >
                        {preset} × {preset} mm
                      </button>
                    ))}
                  </div>
                  <div className="seal-size-custom">
                    <span className="seal-size-input">
                      <input
                        type="number"
                        min={MIN_SEAL_MM}
                        max={MAX_SEAL_MM}
                        value={sizeDraft}
                        onChange={(event) => setSizeDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') commitCustomSize();
                        }}
                      />
                      <em>mm</em>
                    </span>
                    <button type="button" className="seal-size-apply" onClick={commitCustomSize}>确定</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) await handleSealFile(file);
        }}
      />
    </div>
  );
}

function ConfirmDialog({
  dialog,
  onResolve,
}: {
  dialog: ConfirmDialogState;
  onResolve: (confirmed: boolean) => void;
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onResolve(false);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onResolve]);

  const isDanger = dialog.tone !== 'default';

  return (
    <div className="confirm-layer" role="presentation" onMouseDown={() => onResolve(false)}>
      <section
        className={`confirm-dialog ${isDanger ? 'danger' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="confirm-close" type="button" aria-label="关闭" onClick={() => onResolve(false)}>
          <X size={16} />
        </button>
        <div className="confirm-icon">
          <AlertTriangle size={22} />
        </div>
        <div className="confirm-copy">
          <h3 id="confirm-dialog-title">{dialog.title}</h3>
          <p>{dialog.message}</p>
        </div>
        <div className="confirm-actions">
          <button className="button" type="button" onClick={() => onResolve(false)}>
            {dialog.cancelText || '取消'}
          </button>
          <button className={`button ${isDanger ? 'danger-confirm' : 'primary'}`} type="button" onClick={() => onResolve(true)}>
            {dialog.confirmText || '确认'}
          </button>
        </div>
      </section>
    </div>
  );
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isDatabaseReady, setIsDatabaseReady] = useState(false);
  const [loginName, setLoginName] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [rememberLogin, setRememberLogin] = useState(false);
  const [loginCredentials, setLoginCredentials] = useState<LoginCredentials>(DEFAULT_LOGIN_CREDENTIALS);
  const [loginUsernameDraft, setLoginUsernameDraft] = useState(DEFAULT_LOGIN_CREDENTIALS.username);
  const [loginPasswordDraft, setLoginPasswordDraft] = useState(DEFAULT_LOGIN_CREDENTIALS.password);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [sideView, setSideView] = useState<SideView>('subjects');
  const [activeSubjectId, setActiveSubjectId] = useState('');
  const [draftName, setDraftName] = useState('');
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [pdfName, setPdfName] = useState('');
  const [pdfDocument, setPdfDocument] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [renderPage, setRenderPage] = useState<RenderPage>({ width: 1, height: 1, scale: 1 });
  const [zoom, setZoom] = useState(1);
  const [fitWidth, setFitWidth] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [mode, setMode] = useState<StampMode>('batch');
  const [actions, setActions] = useState<StampAction[]>([]);
  const [undoStack, setUndoStack] = useState<StampAction[][]>([]);
  const [redoStack, setRedoStack] = useState<StampAction[][]>([]);
  const [editingActionId, setEditingActionId] = useState<string | null>(null);
  const [exportName, setExportName] = useState('已盖章文件_已电子签章.pdf');
  const [records, setRecords] = useState<ExportRecord[]>([]);
  const [colorTheme, setColorTheme] = useState<ColorTheme>('red');
  const [previewQualification, setPreviewQualification] = useState<Qualification | null>(null);
  const [downloadConfig, setDownloadConfig] = useState<{ id: string; name: string; purpose: string; addSeal: boolean; addWatermark: boolean; sealPosition: SealPosition } | null>(null);
  const [isPositioningStamp, setIsPositioningStamp] = useState(false);
  const [batchStart, setBatchStart] = useState(1);
  const [batchEnd, setBatchEnd] = useState(1);
  const [specificPages, setSpecificPages] = useState('1');
  const [selectedSealKind, setSelectedSealKind] = useState<SealKind>('official');
  const [manageSealKind, setManageSealKind] = useState<SealKind>('official');
  const [isSealDropActive, setIsSealDropActive] = useState(false);
  const [xPercent, setXPercent] = useState(72);
  const [yPercent, setYPercent] = useState(74);
  const [pagePositionOverrides, setPagePositionOverrides] = useState<Record<number, PagePositionOverride>>({});
  const [overridePage, setOverridePage] = useState(1);
  const [overrideXPercent, setOverrideXPercent] = useState(72);
  const [overrideYPercent, setOverrideYPercent] = useState(74);
  const [overrideDraftTouched, setOverrideDraftTouched] = useState(false);
  const [positionTarget, setPositionTarget] = useState<'default' | 'page'>('default');
  const [sizePercent, setSizePercent] = useState(17);
  const [seamStart, setSeamStart] = useState(1);
  const [seamEnd, setSeamEnd] = useState(4);
  const [splitCount, setSplitCount] = useState(4);
  const [seamY, setSeamY] = useState(28);
  const [seamHeight, setSeamHeight] = useState(34);
  const [seamInset, setSeamInset] = useState(0);
  const [status, setStatus] = useState('请先添加主体并上传 PDF。');
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const qualificationInputRef = useRef<HTMLInputElement | null>(null);
  const sealDropInputRef = useRef<HTMLInputElement | null>(null);
  const materialImportInputRef = useRef<HTMLInputElement | null>(null);
  const documentStageRef = useRef<HTMLElement | null>(null);
  const pageWrapRef = useRef<HTMLDivElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const confirmResolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const actionsRef = useRef<StampAction[]>([]);
  const lastWheelPageTurnRef = useRef(0);

  const activeSubject = useMemo(
    () => subjects.find((subject) => subject.id === activeSubjectId) || subjects[0],
    [subjects, activeSubjectId],
  );

  useEffect(() => {
    const remembered = readRememberedLogin();
    if (!remembered) return;
    setLoginName(remembered.username || LOGIN_USERNAME);
    setRememberLogin(true);
    setIsAuthenticated(true);
  }, []);

  useEffect(() => {
    actionsRef.current = actions;
  }, [actions]);

  function replaceActions(nextActions: StampAction[]) {
    const cloned = cloneStampActions(nextActions);
    actionsRef.current = cloned;
    setActions(cloned);
  }

  function resetActionHistory(nextActions: StampAction[] = []) {
    replaceActions(nextActions);
    setUndoStack([]);
    setRedoStack([]);
  }

  function commitActions(updater: ActionHistoryUpdater) {
    const current = cloneStampActions(actionsRef.current);
    const nextValue = typeof updater === 'function' ? updater(cloneStampActions(current)) : updater;
    const normalized = dedupeSeamActions(cloneStampActions(nextValue));
    if (sameActionSnapshots(current, normalized)) return false;
    setUndoStack((stack) => [...stack.slice(-(MAX_ACTION_HISTORY - 1)), current]);
    setRedoStack([]);
    replaceActions(normalized);
    return true;
  }

  function clearInvalidEditingAction(nextActions: StampAction[]) {
    setEditingActionId((id) => (id && !nextActions.some((action) => action.id === id) ? null : id));
  }

  function undoActions() {
    if (!undoStack.length) {
      setStatus('没有可撤销的盖章操作。');
      return;
    }
    const previous = cloneStampActions(undoStack[undoStack.length - 1]);
    const current = cloneStampActions(actionsRef.current);
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [...stack.slice(-(MAX_ACTION_HISTORY - 1)), current]);
    replaceActions(previous);
    clearInvalidEditingAction(previous);
    setStatus('已撤销上一步盖章操作。');
  }

  function redoActions() {
    if (!redoStack.length) {
      setStatus('没有可恢复的盖章操作。');
      return;
    }
    const next = cloneStampActions(redoStack[redoStack.length - 1]);
    const current = cloneStampActions(actionsRef.current);
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => [...stack.slice(-(MAX_ACTION_HISTORY - 1)), current]);
    replaceActions(next);
    clearInvalidEditingAction(next);
    setStatus('已恢复下一步盖章操作。');
  }

  function resolveConfirmDialog(confirmed: boolean) {
    confirmResolverRef.current?.(confirmed);
    confirmResolverRef.current = null;
    setConfirmDialog(null);
  }

  function requestConfirm(dialog: ConfirmDialogState) {
    return new Promise<boolean>((resolve) => {
      confirmResolverRef.current?.(false);
      confirmResolverRef.current = resolve;
      setConfirmDialog(dialog);
    });
  }

  useEffect(() => {
    if (!isAuthenticated) return;
    let isCancelled = false;

    async function hydrateWorkspace() {
      setIsDatabaseReady(false);
      try {
        const persisted = await readPersistedAppData();
        const nextStorageInfo = await readStorageInfo();
        const legacySubjects = readLegacySubjects();
        const nextSubjects = persisted?.subjects?.length ? persisted.subjects : legacySubjects;
        const nextActiveId = nextSubjects.some((subject) => subject.id === persisted?.activeSubjectId)
          ? persisted?.activeSubjectId || ''
          : nextSubjects[0]?.id || '';
        if (isCancelled) return;
        setSubjects(nextSubjects);
        setActiveSubjectId(nextActiveId);
        resetActionHistory(persisted?.actions || []);
        setRecords(persisted?.records || []);
        setExportName(persisted?.exportName || '已盖章文件_已电子签章.pdf');
        setColorTheme(persisted?.colorTheme || 'red');
        setStorageInfo(nextStorageInfo);
        setEditingActionId(null);
        setIsDatabaseReady(true);
        setStatus(persisted
          ? '已从应用数据载入工作区。'
          : legacySubjects.length
            ? '已迁移旧本地数据到应用数据。'
            : '已登录，请先添加主体并上传 PDF。');
      } catch {
        if (isCancelled) return;
        const legacySubjects = readLegacySubjects();
        setSubjects(legacySubjects);
        setActiveSubjectId(legacySubjects[0]?.id || '');
        resetActionHistory();
        setColorTheme('red');
        setStorageInfo(null);
        setEditingActionId(null);
        setIsDatabaseReady(true);
        setStatus('应用数据读取失败，已使用临时本地数据。');
      }
    }

    hydrateWorkspace();
    return () => {
      isCancelled = true;
    };
  }, [isAuthenticated]);

  useEffect(() => {
    document.documentElement.dataset.theme = colorTheme;
  }, [colorTheme]);

  useEffect(() => {
    if (!isAuthenticated || !isDatabaseReady) return;
    if (!activeSubjectId && subjects[0]) {
      setActiveSubjectId(subjects[0].id);
      return;
    }
    writePersistedAppData({ subjects, activeSubjectId, actions, exportName, records, colorTheme }).catch(() => {
      setStatus('应用数据写入失败，部分大文件可能仅在本次页面会话中可用。');
    });
  }, [isAuthenticated, isDatabaseReady, subjects, activeSubjectId, actions, exportName, records, colorTheme]);

  useEffect(() => {
    setBatchEnd(pageCount || 1);
    setSeamStart(1);
    setSeamEnd(pageCount || 1);
    setSplitCount(defaultSeamSplitCount(pageCount));
    setSpecificPages(pageCount ? '1' : '');
    setOverridePage(1);
    setPagePositionOverrides({});
    setOverrideDraftTouched(false);
    setPositionTarget('default');
  }, [pageCount]);

  useEffect(() => {
    const minPage = Math.min(batchStart, batchEnd);
    const maxPage = Math.max(batchStart, batchEnd);
    setOverridePage((page) => clampPercent(page, minPage || 1, maxPage || pageCount || 1));
  }, [batchStart, batchEnd, pageCount]);

  useEffect(() => {
    const savedOverride = pagePositionOverrides[overridePage];
    setOverrideXPercent(savedOverride?.xPercent ?? xPercent);
    setOverrideYPercent(savedOverride?.yPercent ?? yPercent);
    setOverrideDraftTouched(false);
  }, [overridePage, pagePositionOverrides, xPercent, yPercent]);

  useEffect(() => {
    const normalized = dedupeSeamActions(actions);
    if (normalized.length === actions.length) return;
    replaceActions(normalized);
  }, [actions]);

  // 指定页模式下，切换预览页时让目标页码跟随当前页（编辑已有操作时除外）。
  useEffect(() => {
    if (mode !== 'specific' || editingActionId || !pageCount) return;
    setSpecificPages((current) => (current === String(currentPage) ? current : String(currentPage)));
  }, [mode, currentPage, editingActionId, pageCount]);

  useEffect(() => {
    if (!isAuthenticated) return;
    function handleKeyDown(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      const isUndo = (event.ctrlKey || event.metaKey) && key === 'z' && !event.shiftKey;
      const isRedo = (event.ctrlKey || event.metaKey) && (key === 'y' || (key === 'z' && event.shiftKey));
      if (!isUndo && !isRedo) return;
      if (isEditableShortcutTarget(event.target) || confirmDialog || previewQualification || downloadConfig) return;
      event.preventDefault();
      if (isUndo) undoActions();
      if (isRedo) redoActions();
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAuthenticated, confirmDialog, previewQualification, downloadConfig, undoStack, redoStack]);

  const currentActions = useMemo(
    () => actions.filter((action) => action.pages.includes(currentPage)),
    [actions, currentPage],
  );
  const canUndoActions = undoStack.length > 0;
  const canRedoActions = redoStack.length > 0;
  const isEditingBatchAction = Boolean(editingActionId && mode === 'batch');
  const batchDraftPages = useMemo(
    () => (mode === 'batch' ? rangePages(batchStart, batchEnd, pageCount) : []),
    [mode, batchStart, batchEnd, pageCount],
  );
  const isCurrentPageInBatchDraft = mode !== 'batch' || batchDraftPages.includes(currentPage);

  const currentSealSizePercent = sealSizePercent(selectedSealKind, sizePercent, activeSubject?.sealSizes);
  const draftSealSrc = mode !== 'seam' ? activeSubject?.seals[selectedSealKind] : undefined;
  const savedDraftPageOverride = mode === 'batch' ? pagePositionOverrides[currentPage] : undefined;
  const pendingDraftPageOverride = mode === 'batch' && positionTarget === 'page' && currentPage === overridePage && overrideDraftTouched
    ? { xPercent: overrideXPercent, yPercent: overrideYPercent }
    : undefined;
  const effectiveDraftXPercent = pendingDraftPageOverride?.xPercent ?? savedDraftPageOverride?.xPercent ?? xPercent;
  const effectiveDraftYPercent = pendingDraftPageOverride?.yPercent ?? savedDraftPageOverride?.yPercent ?? yPercent;
  const draftSeamPages = mode === 'seam'
    ? rangePages(seamStart, seamEnd, pageCount)
    : [];
  const draftSeamPageIndex = draftSeamPages.indexOf(currentPage);
  const draftSeamSlice = draftSeamPageIndex >= 0
    ? seamSliceInfo(draftSeamPages.length, Math.max(1, splitCount), draftSeamPageIndex)
    : null;
  const shouldShowDraftSeam = mode === 'seam' && Boolean(activeSubject?.seals.official) && draftSeamPageIndex >= 0;
  const draftSeamHeight = (renderPage.width * sealSizePercent('official', seamHeight, activeSubject?.sealSizes)) / 100;
  const draftSeamWidth = Math.max(12, draftSeamHeight / Math.max(1, draftSeamSlice?.groupSize || splitCount));
  const canPositionOnPage = mode === 'seam' ? shouldShowDraftSeam : Boolean(draftSealSrc && isCurrentPageInBatchDraft);
  const isDraftDuplicate = mode !== 'seam' && currentActions.some((action) => (
    (() => {
      if (action.type !== 'normal' || action.id === editingActionId || action.sealKind !== selectedSealKind) return false;
      const position = pagePosition(action, currentPage);
      return position.xPercent === effectiveDraftXPercent
        && position.yPercent === effectiveDraftYPercent
        && Math.abs(sealSizePercent(action.sealKind, action.sizePercent, activeSubject?.sealSizes) - currentSealSizePercent) < 0.01;
    })()
  ));
  const shouldShowDraftStamp = Boolean(draftSealSrc && isCurrentPageInBatchDraft && !isDraftDuplicate);

  useEffect(() => {
    if (!isEditingBatchAction || !pageCount) return;
    if (!batchDraftPages.includes(currentPage)) return;
    setOverridePage(currentPage);
    setPositionTarget('page');
  }, [isEditingBatchAction, currentPage, pageCount, batchDraftPages]);

  async function loadPdfWorkspace(options: {
    bytes: Uint8Array;
    name: string;
    actions?: StampAction[];
    exportName?: string;
    currentPage?: number;
    resetProgress?: boolean;
  }) {
    const bytes = options.bytes;
    const loaded = await pdfjs.getDocument({ data: bytes.slice() }).promise;
    setPdfBytes(bytes);
    setPdfName(options.name);
    setPdfDocument(loaded);
    setPageCount(loaded.numPages);
    setCurrentPage(clampPercent(options.currentPage || 1, 1, loaded.numPages));
    resetActionHistory(options.actions || []);
    setEditingActionId(null);
    setPagePositionOverrides({});
    setOverridePage(1);
    setOverrideDraftTouched(false);
    setPositionTarget('default');
    setExportName(options.exportName || defaultExportName(options.name));
    setFitWidth(true);
    setZoom(1);
    setStatus(`${options.resetProgress ? '已载入' : '已恢复'} ${options.name}，共 ${loaded.numPages} 页。`);
  }

  async function openPdf(file: File) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await loadPdfWorkspace({ bytes, name: file.name, resetProgress: true });
  }

  async function clearPdf() {
    if (!pdfDocument) return;
    const confirmed = await requestConfirm({
      title: '移除当前 PDF',
      message: `确定移除“${pdfName}”？已添加的盖章操作会一并清空，可重新上传 PDF。`,
      confirmText: '移除',
      tone: 'danger',
    });
    if (!confirmed) return;
    setPdfBytes(null);
    setPdfName('');
    setPdfDocument(null);
    setPageCount(0);
    setCurrentPage(1);
    resetActionHistory();
    setEditingActionId(null);
    setPagePositionOverrides({});
    setRenderPage({ width: 1, height: 1, scale: 1 });
    setStatus('已移除当前 PDF，可重新上传。');
  }

  async function closeCurrentWorkflow() {
    if (!pdfBytes || !pdfDocument || !activeSubject) {
      setStatus('当前没有可关闭保存的 PDF 流程。');
      return;
    }
    const confirmed = await requestConfirm({
      title: '关闭并保存流程',
      message: `关闭“${pdfName}”并保存当前用章进度？之后可在“记录”中继续此文件的用章流程。`,
      confirmText: '关闭并保存',
    });
    if (!confirmed) return;
    const sourcePdfDataUrl = await blobToDataUrl(new Blob([pdfBytes.slice()], { type: 'application/pdf' }));
    const workflowActions = actionsWithPendingEdit();
    const workflowRecord: ExportRecord = {
      id: uid('workflow'),
      kind: 'workflow',
      name: `${pdfName || '未命名文件'} · 用章流程`,
      subjectName: activeSubject.name,
      pageCount,
      actionCount: workflowActions.length,
      createdAt: timestampText(),
      sourcePdfName: pdfName,
      sourcePdfDataUrl,
      activeSubjectId: activeSubject.id,
      actions: workflowActions,
      exportName,
      currentPage,
    };
    setRecords((list) => [workflowRecord, ...list].slice(0, 50));
    setPdfBytes(null);
    setPdfName('');
    setPdfDocument(null);
    setPageCount(0);
    setCurrentPage(1);
    resetActionHistory();
    setEditingActionId(null);
    setPagePositionOverrides({});
    setRenderPage({ width: 1, height: 1, scale: 1 });
    setSideView('records');
    setStatus(`已关闭并保存用章流程：${pdfName}`);
  }

  function updateSubjectSeal(subjectId: string, kind: SealKind, dataUrl: string) {
    setSubjects((list) =>
      list.map((subject) =>
        subject.id === subjectId
          ? { ...subject, seals: { ...subject.seals, [kind]: dataUrl } }
          : subject,
      ),
    );
  }

  function updateSubjectSealSize(subjectId: string, kind: SealKind, mm: number) {
    setSubjects((list) =>
      list.map((subject) =>
        subject.id === subjectId
          ? { ...subject, sealSizes: { ...subject.sealSizes, [kind]: clampSealMm(mm) } }
          : subject,
      ),
    );
    setStatus(`已将${sealLabels[kind]}尺寸设为 ${clampSealMm(mm)}mm × ${clampSealMm(mm)}mm。`);
  }

  async function deleteSubjectSeal(subjectId: string, kind: SealKind) {
    const subject = subjects.find((item) => item.id === subjectId);
    if (!subject?.seals[kind]) return;
    const confirmed = await requestConfirm({
      title: `删除${sealLabels[kind]}`,
      message: `确定删除当前主体的${sealLabels[kind]}？删除后需重新上传。`,
      confirmText: '删除',
      tone: 'danger',
    });
    if (!confirmed) return;
    setSubjects((list) =>
      list.map((item) => {
        if (item.id !== subjectId) return item;
        const seals = { ...item.seals };
        delete seals[kind];
        return { ...item, seals };
      }),
    );
    setStatus(`已删除${sealLabels[kind]}。`);
  }

  async function importSealForKind(kind: SealKind, file: File) {
    if (!activeSubject) {
      setStatus('请先添加并选择主体。');
      return;
    }
    try {
      const generated = await generateSealFromScan(file, true);
      updateSubjectSeal(activeSubject.id, kind, generated);
      setStatus(`已生成并裁剪${sealLabels[kind]}透明 PNG，可直接用于盖章。`);
    } catch (error) {
      const fallback = await fileToDataUrl(file);
      updateSubjectSeal(activeSubject.id, kind, fallback);
      setStatus(error instanceof Error
        ? `${error.message}，已先保留原图。建议使用白底、红色清晰的扫描件。`
        : '未能自动生成透明印章，已先保留原图。');
    }
  }

  function updateSubjectQualifications(subjectId: string, updater: (items: Qualification[]) => Qualification[]) {
    setSubjects((list) =>
      list.map((subject) =>
        subject.id === subjectId
          ? { ...subject, qualifications: updater(subject.qualifications || []) }
          : subject,
      ),
    );
  }

  async function addQualificationFile(file: File) {
    if (!activeSubject) {
      setStatus('请先添加主体。');
      return;
    }
    const dataUrl = await fileToDataUrl(file);
    const nextQualification: Qualification = {
      id: uid('qualification'),
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      dataUrl,
      purpose: '',
      addSeal: true,
      addWatermark: true,
    };
    updateSubjectQualifications(activeSubject.id, (items) => [nextQualification, ...items]);
    setStatus(`已添加主体资质：${file.name}`);
  }

  function updateQualification(qualificationId: string, patch: Partial<Qualification>) {
    if (!activeSubject) return;
    updateSubjectQualifications(activeSubject.id, (items) =>
      items.map((item) => (item.id === qualificationId ? { ...item, ...patch } : item)),
    );
  }

  async function deleteQualification(qualificationId: string) {
    if (!activeSubject) return;
    const target = activeSubject.qualifications?.find((item) => item.id === qualificationId);
    if (!target) return;
    const confirmed = await requestConfirm({
      title: '删除资质文件',
      message: `确定删除“${target.name}”？删除后不可从列表中恢复。`,
      confirmText: '删除',
      tone: 'danger',
    });
    if (!confirmed) return;
    updateSubjectQualifications(activeSubject.id, (items) => items.filter((item) => item.id !== qualificationId));
    setStatus(`已删除资质文件：${target.name}`);
  }

  function openDownloadConfig(qualification: Qualification) {
    setPreviewQualification(null);
    setDownloadConfig({
      id: qualification.id,
      name: qualification.name,
      purpose: qualification.purpose,
      addSeal: qualification.addSeal,
      addWatermark: qualification.addWatermark,
      sealPosition: qualification.sealPosition ?? 'br',
    });
  }

  async function confirmDownloadConfig() {
    if (!downloadConfig || !activeSubject) return;
    const target = activeSubject.qualifications?.find((item) => item.id === downloadConfig.id);
    if (!target) {
      setDownloadConfig(null);
      return;
    }
    const updated: Qualification = {
      ...target,
      purpose: downloadConfig.purpose,
      addSeal: downloadConfig.addSeal,
      addWatermark: downloadConfig.addWatermark,
      sealPosition: downloadConfig.sealPosition,
    };
    updateQualification(downloadConfig.id, {
      purpose: downloadConfig.purpose,
      addSeal: downloadConfig.addSeal,
      addWatermark: downloadConfig.addWatermark,
      sealPosition: downloadConfig.sealPosition,
    });
    setDownloadConfig(null);
    try {
      await downloadQualificationFile(updated, activeSubject);
      setStatus(`已按设置下载资质文件：${updated.name}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '下载资质文件失败。');
    }
  }

  function addSubject() {
    const name = draftName.trim();
    if (!name) return;
    const next: Subject = { id: uid('subject'), name, seals: {} };
    setSubjects((list) => [next, ...list]);
    setActiveSubjectId(next.id);
    setSideView('subjects');
    setDraftName('');
  }

  async function deleteSubject(subjectId: string) {
    const target = subjects.find((subject) => subject.id === subjectId);
    if (!target) return;
    const confirmed = await requestConfirm({
      title: '删除主体',
      message: `确定删除“${target.name}”？已上传的印章和主体资质也会一并删除。`,
      confirmText: '删除',
      tone: 'danger',
    });
    if (!confirmed) return;
    const nextSubjects = subjects.filter((subject) => subject.id !== subjectId);
    setSubjects(nextSubjects);
    if (activeSubject?.id === subjectId) {
      setActiveSubjectId(nextSubjects[0]?.id || '');
      resetActionHistory();
      setEditingActionId(null);
    }
    setStatus(`已删除主体：${target.name}`);
  }

  async function clearActions() {
    if (!actions.length) return;
    const confirmed = await requestConfirm({
      title: '清空盖章记录',
      message: '确定清空已添加的全部盖章操作？当前 PDF 文件不会被删除。',
      confirmText: '清空',
      tone: 'danger',
    });
    if (!confirmed) return;
    commitActions([]);
    setEditingActionId(null);
    setStatus('已清空盖章记录。');
  }

  async function clearSubjects() {
    if (!subjects.length) return;
    const confirmed = await requestConfirm({
      title: '删除全部主体',
      message: '确定删除全部主体、印章和主体资质？此操作不会删除当前 PDF。',
      confirmText: '全部删除',
      tone: 'danger',
    });
    if (!confirmed) return;
    setSubjects([]);
    setActiveSubjectId('');
    resetActionHistory();
    setEditingActionId(null);
    setStatus('已删除全部主体。');
  }

  function selectAction(action: StampAction) {
    setEditingActionId(action.id);
    setCurrentPage(action.pages[0] || 1);
    if (action.type === 'normal') {
      setSelectedSealKind(action.sealKind);
      setXPercent(action.xPercent);
      setYPercent(action.yPercent);
      setSizePercent(action.sizePercent);
      setSpecificPages(pagesToRangeText(action.pages));
      setPagePositionOverrides(action.pageOverrides || {});
      setOverridePage(action.pages[0] || 1);
      const firstOverride = action.pageOverrides?.[action.pages[0] || 1];
      setOverrideXPercent(firstOverride?.xPercent ?? action.xPercent);
      setOverrideYPercent(firstOverride?.yPercent ?? action.yPercent);
      setOverrideDraftTouched(false);
      setPositionTarget('default');
      if (areContinuousPages(action.pages)) {
        setMode('batch');
        setBatchStart(action.pages[0]);
        setBatchEnd(action.pages[action.pages.length - 1]);
      } else {
        setMode('specific');
      }
      setStatus(`正在调整第 ${pagesToRangeText(action.pages)} 页${sealLabels[action.sealKind]}。`);
      return;
    }
    setMode('seam');
    setPagePositionOverrides({});
    setOverrideDraftTouched(false);
    setPositionTarget('default');
    setSeamStart(action.pages[0] || 1);
    setSeamEnd(action.pages[action.pages.length - 1] || 1);
    setSplitCount(action.splitCount);
    setSeamY(action.yPercent);
    setSeamHeight(action.heightPercent);
    setSeamInset(action.rightInsetPercent);
    setStatus(`正在调整第 ${pagesToRangeText(action.pages)} 页骑缝章。`);
  }

  function switchMode(nextMode: StampMode) {
    setMode(nextMode);
    setEditingActionId(null);
    setIsPositioningStamp(false);
    if (nextMode === 'seam') {
      setPagePositionOverrides({});
      setOverrideDraftTouched(false);
      setPositionTarget('default');
      setSeamStart(1);
      setSeamEnd(pageCount || 1);
      setSplitCount(defaultSeamSplitCount(pageCount));
      setStatus(activeSubject?.seals.official
        ? '骑缝章默认覆盖全部页面，可在页面上拖动调整位置。'
        : '骑缝章需要先上传当前主体的公章。');
      return;
    }
    if (nextMode === 'specific') {
      setPagePositionOverrides({});
      setOverrideDraftTouched(false);
      setPositionTarget('default');
      setSpecificPages(pageCount ? String(currentPage) : '');
      setStatus(pageCount ? `已切换到指定页盖章，默认第 ${currentPage} 页。` : '已切换到指定页盖章。');
      return;
    }
    setOverridePage(currentPage || 1);
    setPositionTarget('default');
    setStatus('已切换到批量盖章，可为某一页单独设置印章位置。');
  }

  function updateSeamPositionFromPointer(event: React.PointerEvent<HTMLDivElement>) {
    updateSeamPositionFromClientPoint(event.clientX, event.clientY);
  }

  function normalPositionFromClientPoint(clientX: number, clientY: number) {
    const rect = pageWrapRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = ((clientX - rect.left) / rect.width) * 100;
    const y = ((clientY - rect.top) / rect.height) * 100;
    return { xPercent: clampPercent(x), yPercent: clampPercent(y) };
  }

  function updateSeamPositionFromClientPoint(clientX: number, clientY: number) {
    if (mode !== 'seam' || !activeSubject?.seals.official || draftSeamPageIndex < 0) return;
    const rect = pageWrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pointerX = clientX - rect.left;
    const pointerY = clientY - rect.top;
    const previewHeight = (rect.width * sealSizePercent('official', seamHeight, activeSubject?.sealSizes)) / 100;
    const previewWidth = Math.max(12, previewHeight / Math.max(1, splitCount));
    const maxY = Math.max(0, 100 - (previewHeight / rect.height) * 100);
    const nextInset = ((pointerX - rect.width + previewWidth / 2) / rect.width) * 100;
    setSeamY(clampPercent((pointerY / rect.height) * 100, 0, maxY));
    setSeamInset(clampPercent(nextInset, -8, 10));
  }

  function updateNormalPositionFromPointer(event: React.PointerEvent<HTMLDivElement>) {
    updateNormalPositionFromClientPoint(event.clientX, event.clientY);
  }

  function updateNormalPositionFromClientPoint(clientX: number, clientY: number) {
    if (mode === 'seam' || !draftSealSrc) return;
    const position = normalPositionFromClientPoint(clientX, clientY);
    if (!position) return;
    const nextX = position.xPercent;
    const nextY = position.yPercent;
    if (mode === 'batch' && (positionTarget === 'page' || isEditingBatchAction)) {
      setOverridePage(currentPage || 1);
      setOverrideXPercent(nextX);
      setOverrideYPercent(nextY);
      setOverrideDraftTouched(true);
      setPositionTarget('page');
      return;
    }
    setXPercent(nextX);
    setYPercent(nextY);
  }

  function updatePagePositionFromPointer(event: React.PointerEvent<HTMLDivElement>) {
    if (mode === 'seam') {
      updateSeamPositionFromPointer(event);
      return;
    }
    updateNormalPositionFromPointer(event);
  }

  function startPagePositioning(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !canPositionOnPage) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    updatePagePositionFromPointer(event);
    setIsPositioningStamp(true);
    setStatus(mode === 'seam'
      ? '已更新骑缝章位置，确认后添加或保存。'
      : mode === 'batch' && (positionTarget === 'page' || isEditingBatchAction)
        ? `已调整第 ${currentPage} 页印章位置，保存调整后生效。`
        : '已更新印章位置，确认后添加或保存。');
  }

  function startExistingStampPositioning(event: React.PointerEvent<HTMLImageElement>, action: NormalStamp) {
    if (event.button !== 0 || !action.pages.includes(currentPage)) return;
    event.preventDefault();
    event.stopPropagation();
    const pointerPosition = normalPositionFromClientPoint(event.clientX, event.clientY);
    const pageElement = pageWrapRef.current;
    if (!pointerPosition || !pageElement) return;
    try {
      pageElement.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best-effort; the initial drag still enters edit mode.
    }
    setEditingActionId(action.id);
    setSelectedSealKind(action.sealKind);
    setXPercent(action.xPercent);
    setYPercent(action.yPercent);
    setSizePercent(action.sizePercent);
    setSpecificPages(pagesToRangeText(action.pages));
    setPagePositionOverrides(action.pageOverrides || {});
    if (areContinuousPages(action.pages)) {
      setMode('batch');
      setBatchStart(action.pages[0]);
      setBatchEnd(action.pages[action.pages.length - 1]);
      setOverridePage(currentPage);
      setOverrideXPercent(pointerPosition.xPercent);
      setOverrideYPercent(pointerPosition.yPercent);
      setOverrideDraftTouched(true);
      setPositionTarget('page');
      setStatus(`正在调整第 ${currentPage} 页${sealLabels[action.sealKind]}，保存调整后生效。`);
    } else {
      setMode('specific');
      setXPercent(pointerPosition.xPercent);
      setYPercent(pointerPosition.yPercent);
      setStatus(`正在调整第 ${pagesToRangeText(action.pages)} 页${sealLabels[action.sealKind]}。`);
    }
    setIsPositioningStamp(true);
  }

  function savePagePositionOverride() {
    const minPage = Math.min(batchStart, batchEnd);
    const maxPage = Math.max(batchStart, batchEnd);
    const pageNumber = clampPercent(overridePage, minPage || 1, maxPage || pageCount || 1);
    setPagePositionOverrides((list) => ({
      ...list,
      [pageNumber]: {
        xPercent: clampPercent(overrideXPercent),
        yPercent: clampPercent(overrideYPercent),
      },
    }));
    setCurrentPage(pageNumber);
    setPositionTarget('page');
    setOverrideDraftTouched(false);
    setStatus(`已为第 ${pageNumber} 页保存单独印章位置。`);
  }

  function persistPendingPagePositionOverride() {
    if (mode !== 'batch' || positionTarget !== 'page' || !overrideDraftTouched) return false;
    const minPage = Math.min(batchStart, batchEnd);
    const maxPage = Math.max(batchStart, batchEnd);
    const pageNumber = clampPercent(overridePage, minPage || 1, maxPage || pageCount || 1);
    setPagePositionOverrides((list) => ({
      ...list,
      [pageNumber]: {
        xPercent: clampPercent(overrideXPercent),
        yPercent: clampPercent(overrideYPercent),
      },
    }));
    setOverrideDraftTouched(false);
    return true;
  }

  function goToPage(pageNumber: number) {
    const nextPage = clampPercent(pageNumber, 1, pageCount || 1);
    const saved = persistPendingPagePositionOverride();
    setCurrentPage(nextPage);
    if (saved) setStatus(`已自动保存第 ${overridePage} 页的单独印章位置。`);
  }

  function handleDocumentWheel(event: React.WheelEvent<HTMLElement>) {
    if (!pdfDocument || Math.abs(event.deltaY) < 8) return;
    event.preventDefault();
    const now = Date.now();
    if (now - lastWheelPageTurnRef.current < 360) return;
    lastWheelPageTurnRef.current = now;
    goToPage(currentPage + (event.deltaY > 0 ? 1 : -1));
  }

  function clearPagePositionOverride() {
    setPagePositionOverrides((list) => {
      const next = { ...list };
      delete next[overridePage];
      return next;
    });
    setOverrideXPercent(xPercent);
    setOverrideYPercent(yPercent);
    setOverrideDraftTouched(false);
    setPositionTarget('default');
    setStatus(`已清除第 ${overridePage} 页的单独印章位置。`);
  }

  function pageOverridesWithPendingDrag(pages: number[]) {
    const nextOverrides = { ...pagePositionOverrides };
    if (positionTarget === 'page' && overrideDraftTouched) {
      const minPage = Math.min(batchStart, batchEnd);
      const maxPage = Math.max(batchStart, batchEnd);
      const pageNumber = clampPercent(overridePage, minPage || 1, maxPage || pageCount || 1);
      if (pages.includes(pageNumber)) {
        nextOverrides[pageNumber] = {
          xPercent: clampPercent(overrideXPercent),
          yPercent: clampPercent(overrideYPercent),
        };
      }
    }
    return nextOverrides;
  }

  function actionsWithPendingEdit() {
    const current = cloneStampActions(actions);
    if (!editingActionId) return current;
    if (mode === 'batch') {
      const pages = rangePages(batchStart, batchEnd, pageCount);
      if (!pages.length) return current;
      const nextOverrides = normalizePageOverrides(pages, pageOverridesWithPendingDrag(pages), xPercent, yPercent);
      const nextAction: StampAction = {
        id: editingActionId,
        type: 'normal',
        pages,
        sealKind: selectedSealKind,
        xPercent,
        yPercent,
        sizePercent: currentSealSizePercent,
        pageOverrides: nextOverrides,
      };
      return current.map((action) => (action.id === editingActionId ? nextAction : action));
    }
    if (mode === 'specific') {
      const pages = parsePageList(specificPages, pageCount);
      if (!pages.length) return current;
      const nextAction: StampAction = {
        id: editingActionId,
        type: 'normal',
        pages,
        sealKind: selectedSealKind,
        xPercent,
        yPercent,
        sizePercent: currentSealSizePercent,
      };
      return current.map((action) => (action.id === editingActionId ? nextAction : action));
    }
    const pages = rangePages(seamStart, seamEnd, pageCount);
    if (!pages.length) return current;
    const nextAction: StampAction = {
      id: editingActionId,
      type: 'seam',
      pages,
      splitCount: Math.max(1, Math.min(splitCount, pages.length)),
      yPercent: seamY,
      heightPercent: sealSizePercent('official', seamHeight, activeSubject?.sealSizes),
      rightInsetPercent: seamInset,
    };
    return current.map((action) => (action.id === editingActionId ? nextAction : action));
  }

  function addStampAction() {
    if (!pageCount) {
      setStatus('请先上传 PDF。');
      return;
    }
    const requiredSealKind = mode === 'seam' ? 'official' : selectedSealKind;
    if (!activeSubject?.seals[requiredSealKind]) {
      setStatus(`当前主体还没有上传${sealLabels[requiredSealKind]}。`);
      return;
    }
    if (mode === 'batch') {
      const pages = rangePages(batchStart, batchEnd, pageCount);
      const id = editingActionId || uid('stamp');
      const nextOverrides = normalizePageOverrides(pages, pageOverridesWithPendingDrag(pages), xPercent, yPercent);
      const nextAction: StampAction = { id, type: 'normal', pages, sealKind: selectedSealKind, xPercent, yPercent, sizePercent: currentSealSizePercent, pageOverrides: nextOverrides };
      commitActions((list) => (editingActionId
        ? list.map((action) => (action.id === editingActionId ? nextAction : action))
        : [...list, nextAction]));
      setEditingActionId(null);
      setStatus(`${editingActionId ? '已更新' : '已添加'} ${pages.length} 页${sealLabels[selectedSealKind]}，其中 ${nextOverrides ? Object.keys(nextOverrides).length : 0} 页使用单独位置。`);
    }
    if (mode === 'specific') {
      const pages = parsePageList(specificPages, pageCount);
      if (!pages.length) {
        setStatus('请输入有效页码，例如 1,3,5-8。');
        return;
      }
      const id = editingActionId || uid('stamp');
      const nextAction: StampAction = { id, type: 'normal', pages, sealKind: selectedSealKind, xPercent, yPercent, sizePercent: currentSealSizePercent };
      commitActions((list) => (editingActionId
        ? list.map((action) => (action.id === editingActionId ? nextAction : action))
        : [...list, nextAction]));
      setEditingActionId(null);
      setStatus(`已${editingActionId ? '更新' : '添加'}第 ${pages.join('、')} 页${sealLabels[selectedSealKind]}。`);
    }
    if (mode === 'seam') {
      const pages = rangePages(seamStart, seamEnd, pageCount);
      if (!pages.length) {
        setStatus('请输入有效的骑缝章页码范围。');
        return;
      }
      const nextSplitCount = Math.max(1, Math.min(splitCount, pages.length));
      const existingSameRange = actions.find((action) => action.type === 'seam' && samePages(action.pages, pages));
      const id = editingActionId || existingSameRange?.id || uid('seam');
      const nextAction: StampAction = { id, type: 'seam', pages, splitCount: nextSplitCount, yPercent: seamY, heightPercent: sealSizePercent('official', seamHeight, activeSubject?.sealSizes), rightInsetPercent: seamInset };
      commitActions((list) => (editingActionId
        ? list.map((action) => (action.id === editingActionId ? nextAction : action))
        : existingSameRange
          ? [...list.filter((action) => !(action.type === 'seam' && samePages(action.pages, pages))), nextAction]
        : [...list, nextAction]));
      setEditingActionId(null);
      setStatus(`已${editingActionId || existingSameRange ? '更新' : '添加'} ${pages.length} 份骑缝章。`);
    }
  }

  async function exportPdf() {
    if (!pdfBytes || !activeSubject) {
      setStatus('请先上传 PDF，并选择主体。');
      return;
    }
    if (!actions.length) {
      setStatus('还没有添加任何盖章操作。');
      return;
    }
    const pdfDoc = await PDFDocument.load(pdfBytes.slice());
    const pages = pdfDoc.getPages();
    const imageCache = new Map<string, Awaited<ReturnType<typeof embedImage>>>();
    const getImage = async (key: string, dataUrl: string) => {
      const cached = imageCache.get(key);
      if (cached) return cached;
      const embedded = await embedImage(pdfDoc, dataUrl);
      imageCache.set(key, embedded);
      return embedded;
    };

    for (const action of actions) {
      if (action.type === 'normal') {
        const dataUrl = activeSubject.seals[action.sealKind];
        if (!dataUrl) {
          setStatus(`当前主体缺少${sealLabels[action.sealKind]}，无法导出。`);
          return;
        }
        const image = await getImage(action.sealKind, dataUrl);
        action.pages.forEach((pageNumber) => {
          const page = pages[pageNumber - 1];
          if (!page) return;
          const { width, height } = page.getSize();
          const stampWidth = (width * sealSizePercent(action.sealKind, action.sizePercent, activeSubject.sealSizes)) / 100;
          const stampHeight = stampWidth;
          const position = pagePosition(action, pageNumber);
          // 预览用 translate(-50%,-50%) 把印章中心对齐到 (xPercent, yPercent)，
          // 因此导出也必须把中心放在该点，保证预览与导出一致。
          const centerX = (width * position.xPercent) / 100;
          const centerYFromTop = (height * position.yPercent) / 100;
          page.drawImage(image, {
            x: centerX - stampWidth / 2,
            y: height - centerYFromTop - stampHeight / 2,
            width: stampWidth,
            height: stampHeight,
          });
        });
      } else {
        const source = activeSubject.seals.official;
        if (!source) {
          setStatus('当前主体缺少公章，无法导出骑缝章。');
          return;
        }
        const sliceCache = new Map<number, string[]>();
        const getSlices = async (count: number) => {
          const cached = sliceCache.get(count);
          if (cached) return cached;
          const generated = await splitImageVertically(source, count);
          sliceCache.set(count, generated);
          return generated;
        };
        for (let index = 0; index < action.pages.length; index += 1) {
          const pageNumber = action.pages[index];
          const page = pages[pageNumber - 1];
          if (!page) continue;
          const { sliceIndex, groupSize } = seamSliceInfo(action.pages.length, action.splitCount, index);
          const slices = await getSlices(groupSize);
          const slice = slices[sliceIndex];
          if (!slice) continue;
          const image = await getImage(`${action.id}_${groupSize}_${sliceIndex}`, slice);
          const { width, height } = page.getSize();
          const targetHeight = (width * sealSizePercent('official', action.heightPercent, activeSubject.sealSizes)) / 100;
          const targetWidth = targetHeight / groupSize;
          const x = width - targetWidth + (width * action.rightInsetPercent) / 100;
          const y = height - (height * action.yPercent) / 100 - targetHeight;
          page.drawImage(image, { x, y, width: targetWidth, height: targetHeight });
        }
      }
    }

    const result = await pdfDoc.save();
    const arrayBuffer = new ArrayBuffer(result.byteLength);
    new Uint8Array(arrayBuffer).set(result);
    const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    const fallbackName = pdfName ? defaultExportName(pdfName) : '已盖章文件_已电子签章.pdf';
    const downloadName = normalizeExportName(exportName, fallbackName);
    link.download = downloadName;
    link.click();
    URL.revokeObjectURL(link.href);
    setExportName(downloadName);

    const recordDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    const newRecord: ExportRecord = {
      id: uid('record'),
      kind: 'export',
      name: downloadName,
      subjectName: activeSubject.name,
      pageCount,
      actionCount: actions.length,
      createdAt: timestampText(),
      dataUrl: recordDataUrl,
    };
    setRecords((list) => [newRecord, ...list].slice(0, 50));
    setStatus(`已导出并记录：${downloadName}`);
  }

  function redownloadRecord(record: ExportRecord) {
    if (!record.dataUrl) {
      setStatus('这条记录是用章流程，请点击继续恢复编辑。');
      return;
    }
    downloadBlob(new Blob([dataUrlToBytes(record.dataUrl)], { type: 'application/pdf' }), record.name);
    setStatus(`已重新下载：${record.name}`);
  }

  async function resumeWorkflowRecord(record: ExportRecord) {
    if (!record.sourcePdfDataUrl || record.kind !== 'workflow') {
      setStatus('这条记录没有可恢复的用章流程。');
      return;
    }
    if (pdfDocument) {
      const confirmed = await requestConfirm({
        title: '恢复用章流程',
        message: `恢复“${record.sourcePdfName || record.name}”会替换当前正在处理的 PDF，是否继续？`,
        confirmText: '恢复',
      });
      if (!confirmed) return;
    }
    const bytes = dataUrlToBytes(record.sourcePdfDataUrl);
    if (record.activeSubjectId && subjects.some((subject) => subject.id === record.activeSubjectId)) {
      setActiveSubjectId(record.activeSubjectId);
    }
    await loadPdfWorkspace({
      bytes,
      name: record.sourcePdfName || record.name.replace(/\s*·\s*用章流程$/, ''),
      actions: record.actions || [],
      exportName: record.exportName,
      currentPage: record.currentPage,
    });
    setSideView('subjects');
    setStatus(`已恢复用章流程：${record.sourcePdfName || record.name}`);
  }

  async function deleteRecord(record: ExportRecord) {
    const confirmed = await requestConfirm({
      title: '删除记录',
      message: `确定删除${record.kind === 'workflow' ? '用章流程' : '导出记录'}“${record.name}”？删除后无法恢复。`,
      confirmText: '删除',
      tone: 'danger',
    });
    if (!confirmed) return;
    setRecords((list) => list.filter((item) => item.id !== record.id));
    setStatus(`已删除记录：${record.name}`);
  }

  function exportSubjectMaterials() {
    if (!subjects.length) {
      setStatus('暂无主体可导出。');
      return;
    }

    const encoder = new TextEncoder();
    const usedPaths = new Set<string>(['corpseals-materials.json']);
    const usedFolders = new Set<string>();
    const files: ZipFileEntry[] = [];
    const manifest: MaterialPackageManifest = {
      app: 'CorpSeals',
      version: 1,
      exportedAt: new Date().toISOString(),
      subjects: [],
    };

    subjects.forEach((subject, subjectIndex) => {
      const baseFolder = sanitizeFileSegment(subject.name, `主体-${subjectIndex + 1}`);
      let folder = baseFolder;
      let folderIndex = 2;
      while (usedFolders.has(folder)) {
        folder = `${baseFolder}-${folderIndex}`;
        folderIndex += 1;
      }
      usedFolders.add(folder);

      const subjectEntry: MaterialSubjectEntry = {
        name: subject.name,
        sealSizes: subject.sealSizes,
        seals: [],
        qualifications: [],
      };

      sealKindList.forEach((kind) => {
        const dataUrl = subject.seals[kind];
        if (!dataUrl) return;
        const mimeType = dataUrlMime(dataUrl);
        const extension = fileExtensionFromMime(mimeType);
        const file = uniquePath(`${folder}/印章/${sealLabels[kind]}.${extension}`, usedPaths);
        files.push({ path: file, data: dataUrlToBytes(dataUrl) });
        subjectEntry.seals.push({
          kind,
          file,
          mimeType,
          sizeMm: subject.sealSizes?.[kind],
        });
      });

      (subject.qualifications || []).forEach((qualification, qualificationIndex) => {
        const mimeType = qualification.mimeType || dataUrlMime(qualification.dataUrl);
        const extension = fileExtensionFromMime(mimeType);
        const fallbackName = `主体资质-${qualificationIndex + 1}.${extension}`;
        const name = sanitizeFileSegment(qualification.name, fallbackName);
        const file = uniquePath(`${folder}/主体资质/${name}`, usedPaths);
        files.push({ path: file, data: dataUrlToBytes(qualification.dataUrl) });
        subjectEntry.qualifications.push({
          file,
          name: qualification.name,
          mimeType,
          purpose: qualification.purpose,
          addSeal: qualification.addSeal,
          addWatermark: qualification.addWatermark,
          sealPosition: qualification.sealPosition,
        });
      });

      manifest.subjects.push(subjectEntry);
    });

    files.unshift({
      path: 'corpseals-materials.json',
      data: encoder.encode(JSON.stringify(manifest, null, 2)),
    });

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    downloadBlob(new Blob([createZip(files)], { type: 'application/zip' }), `CorpSeals主体资料包_${today}.zip`);
    setStatus(`已导出 ${manifest.subjects.length} 个主体资料包，可在其他电脑导入。`);
  }

  async function importSubjectMaterials(file: File) {
    try {
      const entries = parseZip(new Uint8Array(await file.arrayBuffer()));
      const manifestBytes = entries.get('corpseals-materials.json');
      if (!manifestBytes) throw new Error('资料包缺少清单文件。');

      const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as MaterialPackageManifest;
      if (manifest.app !== 'CorpSeals' || manifest.version !== 1 || !Array.isArray(manifest.subjects)) {
        throw new Error('资料包格式不匹配，请选择 CorpSeals 导出的主体资料包。');
      }

      const importedSubjects: Subject[] = manifest.subjects.map((entry, index) => {
        const seals: Partial<Record<SealKind, string>> = {};
        const sealSizes: Partial<Record<SealKind, number>> = {};

        entry.seals.forEach((seal) => {
          if (!sealKindList.includes(seal.kind)) return;
          const bytes = entries.get(seal.file);
          if (!bytes) throw new Error(`资料包缺少印章文件：${seal.file}`);
          seals[seal.kind] = bytesToDataUrl(bytes, seal.mimeType);
          if (seal.sizeMm) sealSizes[seal.kind] = seal.sizeMm;
        });

        const qualifications = entry.qualifications.map((qualification) => {
          const bytes = entries.get(qualification.file);
          if (!bytes) throw new Error(`资料包缺少主体资质文件：${qualification.file}`);
          return {
            id: uid('qualification'),
            name: qualification.name,
            mimeType: qualification.mimeType,
            dataUrl: bytesToDataUrl(bytes, qualification.mimeType),
            purpose: qualification.purpose,
            addSeal: qualification.addSeal,
            addWatermark: qualification.addWatermark,
            sealPosition: qualification.sealPosition,
          };
        });

        return {
          id: uid('subject'),
          name: entry.name || `导入主体-${index + 1}`,
          seals,
          sealSizes: Object.keys(sealSizes).length ? sealSizes : undefined,
          qualifications,
        };
      });

      if (!importedSubjects.length) {
        setStatus('资料包中没有可导入的主体。');
        return;
      }

      setSubjects((list) => {
        const byName = new Map(list.map((subject) => [subject.name, subject]));
        importedSubjects.forEach((subject) => byName.set(subject.name, subject));
        return Array.from(byName.values());
      });
      setActiveSubjectId(importedSubjects[0].id);
      setSideView('subjects');
      setStatus(`已导入 ${importedSubjects.length} 个主体资料，可继续快速用章。`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '导入主体资料包失败。');
    }
  }

  function changeZoom(delta: number) {
    const base = fitWidth ? 1 : zoom;
    const next = Math.min(4, Math.max(0.2, Math.round((base + delta) * 100) / 100));
    setFitWidth(false);
    setZoom(next);
  }

  async function toggleFullscreen() {
    const element = documentStageRef.current;
    if (!element) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await element.requestFullscreen();
      }
    } catch {
      setStatus('当前环境不支持全屏预览。');
    }
  }

  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loginName.trim() === LOGIN_USERNAME && loginPassword === LOGIN_PASSWORD) {
      if (rememberLogin) {
        writeRememberedLogin();
      } else {
        clearRememberedLogin();
      }
      setLoginError('');
      setLoginPassword('');
      setIsAuthenticated(true);
      return;
    }
    setLoginError('用户名或密码错误。');
  }

  function handleLogout() {
    setIsAuthenticated(false);
    setIsDatabaseReady(false);
    setLoginName('');
    setLoginPassword('');
    setLoginError('');
    setRememberLogin(false);
    clearRememberedLogin();
  }

  if (!isAuthenticated) {
    return (
      <main className="login-shell">
        <section className="login-card" aria-label="登录印章工作台">
          <div className="login-brand">
            <div className="brand-mark"><BrandLogo size={36} /></div>
            <div>
              <h1>CorpSeals</h1>
              <p>请输入账号密码后继续使用</p>
            </div>
          </div>
          <form className="login-form" onSubmit={handleLogin}>
            <label>
              <span>用户名</span>
              <input
                value={loginName}
                autoComplete="username"
                onChange={(event) => setLoginName(event.target.value)}
                placeholder="请输入用户名"
              />
            </label>
            <label>
              <span>密码</span>
              <input
                value={loginPassword}
                autoComplete="current-password"
                onChange={(event) => setLoginPassword(event.target.value)}
                placeholder="请输入密码"
                type="password"
              />
            </label>
            <label className="remember-login">
              <input
                type="checkbox"
                checked={rememberLogin}
                onChange={(event) => setRememberLogin(event.target.checked)}
              />
              <span>记住密码，7 天内免登录</span>
            </label>
            {loginError && <div className="login-error">{loginError}</div>}
            <button className="button primary login-submit" type="submit">
              <Stamp size={16} />
              登录
            </button>
          </form>
        </section>
      </main>
    );
  }

  if (!isDatabaseReady) {
    return (
      <main className="login-shell">
        <section className="login-card loading-card" aria-label="正在载入工作区">
          <div className="login-brand">
            <div className="brand-mark"><Save size={22} /></div>
            <div>
              <h1>正在载入</h1>
              <p>正在读取应用数据内容</p>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-brand">
          <div className="brand-mark"><BrandLogo size={34} /></div>
          <div>
            <h1>CorpSeals</h1>
            <p>PDF 电子签章工具</p>
          </div>
        </div>

        <label className="topbar-select">
          <span>当前主体</span>
          <select value={activeSubject?.id || ''} onChange={(event) => setActiveSubjectId(event.target.value)}>
            {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
          </select>
        </label>

        <label className="topbar-export">
          <span>导出文件名</span>
          <input value={exportName} onChange={(event) => setExportName(event.target.value)} placeholder="已盖章文件.pdf" />
        </label>

        <button className="button primary" onClick={exportPdf}>
          <Download size={17} />
          导出 PDF
        </button>

        <button className="button topbar-logout" onClick={handleLogout}>
          <LogOut size={16} />
          退出
        </button>
      </header>

      <aside className="sidebar">
        <nav className="side-rail" aria-label="工作区导航">
          <button className={`rail-item ${sideView === 'subjects' ? 'active' : ''}`} title="主体与印章" onClick={() => setSideView('subjects')}>
            <Building2 size={18} />
            <span>主体与印章</span>
          </button>
          <button className={`rail-item ${sideView === 'records' ? 'active' : ''}`} title="文档记录" onClick={() => setSideView('records')}>
            <FileText size={18} />
            <span>记录</span>
          </button>
          <button className={`rail-item ${sideView === 'settings' ? 'active' : ''}`} title="设置" onClick={() => setSideView('settings')}>
            <Settings size={18} />
            <span>设置</span>
          </button>
          <button className={`rail-item ${sideView === 'qualifications' ? 'active' : ''}`} title="主体资质管理" onClick={() => setSideView('qualifications')}>
            <BadgeCheck size={18} />
            <span>主体资质管理</span>
          </button>
        </nav>

        <div className="side-main">
          {sideView === 'subjects' && (
            <>
              <section className="panel subject-panel">
                <div className="section-title">
                  <Building2 size={16} />
                  <span>签章主体</span>
                </div>
                <div className="inline-form">
                  <input value={draftName} onChange={(event) => setDraftName(event.target.value)} placeholder="搜索或新建主体" />
                  <button className="icon-button primary" onClick={addSubject} title="添加主体"><Plus size={17} /></button>
                </div>
              </section>

	              <section className="subject-list">
	                {subjects.map((subject) => (
                  <div
                    className={`subject-row ${subject.id === activeSubject?.id ? 'active' : ''}`}
                    key={subject.id}
                    onClick={() => setActiveSubjectId(subject.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') setActiveSubjectId(subject.id);
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <span>{subject.name}</span>
                    <small>{Object.keys(subject.seals).length}/{sealKindList.length}</small>
                    <button
                      className="row-delete-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        deleteSubject(subject.id);
                      }}
                      title="删除主体"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                {!subjects.length && <div className="empty">还没有主体。先添加一个主体，再上传印章。</div>}
              </section>

	              {activeSubject && (
                <section className="panel seal-panel">
                  <div className="section-title">
                    <BadgeCheck size={16} />
                    <span>印章管理</span>
                    <small>当前主体</small>
                  </div>
                  <div className="active-subject-name">{activeSubject.name}</div>
                  <div className="seal-generator-tip">上传清晰红色扫描件，系统会自动去白底、裁剪多余边缘并生成透明 PNG。可在下方设定每枚印章尺寸，单位 mm。</div>
                  <div className="seal-card-list">
                    {sealKindList.map((kind) => (
                      <SealUpload
                        key={kind}
                        kind={kind}
                        label={sealLabels[kind]}
                        value={activeSubject.seals[kind]}
                        sizeMm={sealMm(kind, activeSubject.sealSizes)}
                        onChange={(dataUrl) => updateSubjectSeal(activeSubject.id, kind, dataUrl)}
                        onSizeChange={(mm) => updateSubjectSealSize(activeSubject.id, kind, mm)}
                        onDelete={() => deleteSubjectSeal(activeSubject.id, kind)}
                        onGenerated={setStatus}
                      />
                    ))}
                  </div>

                  <div className="seal-drop-target">
                    <label className="seal-drop-kind">
                      <span>上传到</span>
                      <select
                        value={manageSealKind}
                        onChange={(event) => setManageSealKind(event.target.value as SealKind)}
                      >
                        {sealKindList.map((kind) => (
                          <option key={kind} value={kind}>{sealLabels[kind]}</option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className={`seal-dropzone ${isSealDropActive ? 'active' : ''}`}
                      onClick={() => sealDropInputRef.current?.click()}
                      onDragOver={(event) => {
                        event.preventDefault();
                        setIsSealDropActive(true);
                      }}
                      onDragLeave={() => setIsSealDropActive(false)}
                      onDrop={async (event) => {
                        event.preventDefault();
                        setIsSealDropActive(false);
                        const file = event.dataTransfer.files?.[0];
                        if (file) await importSealForKind(manageSealKind, file);
                      }}
                    >
                      <Upload size={22} />
                      <strong>点击或拖拽上传印章</strong>
                      <small>支持 PNG / JPG 格式，建议 512px 以上</small>
                    </button>
                    <input
                      ref={sealDropInputRef}
                      type="file"
                      accept="image/png,image/jpeg"
                      onChange={async (event) => {
                        const file = event.target.files?.[0];
                        event.target.value = '';
                        if (file) await importSealForKind(manageSealKind, file);
                      }}
                    />
                  </div>
                </section>
              )}
            </>
          )}

          {sideView === 'records' && (
            <section className="panel records-panel">
              <div className="section-title">
                <FileText size={16} />
                <span>用章文件记录</span>
                <small>{records.length} 条</small>
              </div>
              <div className="record-intro">
                导出的盖章 PDF 和关闭保存的用章流程都会留存在这里。最多保留最近 50 条。
              </div>
              <div className="record-file-list">
                {records.map((record) => (
                  <div className="record-file-card" key={record.id}>
                    <div className="record-file-main">
                      <FileText size={16} />
                      <div className="record-file-text">
                        <strong title={record.name}>{record.name}</strong>
                        <span>
                          {record.kind === 'workflow' ? '用章流程' : '导出文件'} · {record.subjectName} · {record.pageCount} 页 · {record.actionCount} 个用章
                        </span>
                        <small>{record.createdAt}</small>
                      </div>
                    </div>
                    <div className="record-file-actions">
                      {record.kind === 'workflow' ? (
                        <button className="button" onClick={() => resumeWorkflowRecord(record)}>
                          <FileText size={14} />
                          继续
                        </button>
                      ) : (
                        <button className="button" onClick={() => redownloadRecord(record)}>
                          <Download size={14} />
                          下载
                        </button>
                      )}
                      <button className="icon-button danger-action" title="删除记录" onClick={() => deleteRecord(record)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
                {!records.length && <div className="empty">暂无用章文件记录。导出 PDF 或关闭保存流程后会显示在这里。</div>}
	              </div>
            </section>
          )}

          {sideView === 'settings' && (
            <section className="panel settings-panel">
              <div className="section-title">
                <Settings size={16} />
                <span>设置</span>
              </div>
              <div className="settings-list">
                <div className="settings-row">
                  <div>
                    <strong>界面配色</strong>
                    <span>选择侧边栏、按钮和高亮色，红色为默认配色</span>
                  </div>
                  <div className="theme-options" role="group" aria-label="界面配色">
                    {colorThemeList.map((theme) => (
                      <button
                        key={theme}
                        type="button"
                        className={`theme-option theme-option-${theme} ${colorTheme === theme ? 'active' : ''}`}
                        onClick={() => setColorTheme(theme)}
                        aria-pressed={colorTheme === theme}
                      >
                        <span className="theme-dot" />
                        {colorThemeLabels[theme]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="settings-row">
                  <div>
                    <strong>主体资料包</strong>
                    <span>{subjects.length ? `可导出 ${subjects.length} 个主体的印章和资质材料` : '暂无主体可导出'}</span>
                  </div>
                  <div className="settings-actions">
                    <button className="button" disabled={!subjects.length} onClick={exportSubjectMaterials}>
                      <Download size={15} />
                      导出
                    </button>
                    <button className="button" onClick={() => materialImportInputRef.current?.click()}>
                      <Upload size={15} />
                      导入
                    </button>
                    <input
                      ref={materialImportInputRef}
                      type="file"
                      accept=".zip,application/zip"
                      style={{ display: 'none' }}
                      onChange={async (event) => {
                        const file = event.target.files?.[0];
                        event.target.value = '';
                        if (file) await importSubjectMaterials(file);
                      }}
                    />
                  </div>
                </div>
                <div className="settings-row">
                  <div>
                    <strong>数据保存位置</strong>
                    <span title={storageInfo?.dataFilePath || '浏览器本地数据'}>
                      {storageInfo?.dataFilePath || '浏览器本地数据'}
                    </span>
                  </div>
                </div>
                <div className="settings-row settings-danger-row">
                  <div>
                    <strong>危险区</strong>
                    <span>{subjects.length ? `删除全部 ${subjects.length} 个主体、印章和资质材料` : '暂无主体数据'}</span>
                  </div>
                  <button className="button danger-action" disabled={!subjects.length} onClick={clearSubjects}>
                    <Trash2 size={15} />
                    全部删除主体
                  </button>
                </div>
              </div>

              <div className="qualification-manager settings-qualification-shortcut">
                <div className="section-title">
                  <BadgeCheck size={16} />
                  <span>主体资质管理</span>
                  <small>{activeSubject?.qualifications?.length || 0} 份</small>
                </div>
                <div className="qualification-intro">
                  上传营业执照、授权书等主体资料。下载时可自动添加公章和水印，水印会写入下载时间戳，用途由你手动填写。
                </div>
                <button
                  className="button full qualification-upload-button"
                  onClick={() => setSideView('qualifications')}
                >
                  <ChevronRight size={16} />
                  进入主体资质管理
                </button>
              </div>
            </section>
          )}

          {sideView === 'qualifications' && (
            <section className="panel qualification-panel">
              <div className="qualification-manager">
                <div className="section-title">
                  <BadgeCheck size={16} />
                  <span>主体资质管理</span>
                  <small>{activeSubject?.qualifications?.length || 0} 份</small>
                </div>
                <div className="qualification-intro">
                  这里调用“主体与印章”中的同一批主体公司。点击主体后，中间区域会显示该主体名下的全部资质文件。
                </div>
                <div className="qualification-subject-list">
                  {subjects.map((subject) => (
                    <div
                      className={`subject-row ${subject.id === activeSubject?.id ? 'active' : ''}`}
                      key={subject.id}
                      onClick={() => setActiveSubjectId(subject.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') setActiveSubjectId(subject.id);
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <span>{subject.name}</span>
                      <small>{subject.qualifications?.length || 0} 份</small>
                    </div>
                  ))}
                  {!subjects.length && <div className="empty">请先在“主体与印章”中添加主体公司。</div>}
                </div>
              </div>
            </section>
          )}
        </div>
      </aside>

      <main className={`workspace ${sideView === 'qualifications' ? 'qualification-workspace' : ''}`}>
        {sideView === 'qualifications' ? (
          <>
            <div className="qualification-toolbar">
              <div className="qualification-title-block">
                <span>当前主体</span>
                <strong>{activeSubject?.name || '暂无主体'}</strong>
              </div>
              <button
                className="button primary"
                disabled={!activeSubject}
                onClick={() => qualificationInputRef.current?.click()}
              >
                <Upload size={16} />
                上传主体资料
              </button>
              <input
                ref={qualificationInputRef}
                className="qualification-file-input"
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.doc,.docx,.rtf"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) await addQualificationFile(file);
                }}
              />
            </div>
            <section className="qualification-stage">
              <div className="qualification-stage-head">
                <div>
                  <h2>资质文件</h2>
                  <p>下载时可添加公章和用途水印，水印会自动写入下载时间戳。</p>
                </div>
                <span>{activeSubject?.qualifications?.length || 0} 份</span>
              </div>
              <div className="qualification-file-grid">
                {(activeSubject?.qualifications || []).map((qualification) => {
                  const isImage = qualification.mimeType.startsWith('image/');
                  const isPdf = qualification.mimeType === 'application/pdf';
                  const isWord = isWordMime(qualification.mimeType, qualification.name);
                  const typeLabel = isImage ? '图片' : isPdf ? 'PDF' : isWord ? 'Word' : '文件';
                  return (
                    <div className="qualification-file-card" key={qualification.id}>
                      <button
                        className="qualification-thumb"
                        type="button"
                        title="点击预览"
                        onClick={() => setPreviewQualification(qualification)}
                      >
                        <span className={`qualification-type-badge ${isImage ? 'image' : isPdf ? 'pdf' : isWord ? 'word' : 'file'}`}>
                          {typeLabel}
                        </span>
                        {isImage ? (
                          <img src={qualification.dataUrl} alt={qualification.name} />
                        ) : isPdf ? (
                          <PdfThumb dataUrl={qualification.dataUrl} />
                        ) : (
                          <span className={`qualification-thumb-icon ${isWord ? 'word' : 'file'}`}>
                            <FileText size={26} />
                            <em>{typeLabel}</em>
                          </span>
                        )}
                        <span className="qualification-thumb-hover">
                          <Maximize2 size={20} />
                          点击预览
                        </span>
                        <span className="qualification-thumb-name" title={qualification.name}>
                          {qualification.name}
                        </span>
                      </button>
                      <div className="qualification-actions">
                        <button className="button" onClick={() => openDownloadConfig(qualification)}>
                          <Download size={14} />
                          下载
                        </button>
                        <button className="button danger-action" title="删除资质" onClick={() => deleteQualification(qualification.id)}>
                          <Trash2 size={14} />
                          删除
                        </button>
                      </div>
                    </div>
                  );
                })}
                {activeSubject && !(activeSubject.qualifications || []).length && (
                  <div className="qualification-empty-state">
                    <BadgeCheck size={30} />
                    <strong>暂无主体资质</strong>
                    <span>为当前主体上传营业执照、授权书等资料后，会在这里集中管理。</span>
                  </div>
                )}
                {!activeSubject && (
                  <div className="qualification-empty-state">
                    <Building2 size={30} />
                    <strong>请先添加主体</strong>
                    <span>主体资质会关联到“主体与印章”中的公司数据。</span>
                  </div>
                )}
              </div>
            </section>
          </>
        ) : (
          <>
            <div className="document-toolbar">
              <div className="toolbar-button-group" aria-label="翻页控制">
                <button className="icon-button" onClick={() => goToPage(currentPage - 1)} title="上一页">
                  <ChevronLeft size={15} />
                </button>
                <button className="icon-button" onClick={() => goToPage(currentPage + 1)} title="下一页">
                  <ChevronRight size={15} />
                </button>
              </div>
              <div className="page-counter">
                <input
                  type="number"
                  min={1}
                  max={pageCount || 1}
                  value={currentPage}
                  onChange={(event) => goToPage(Number(event.target.value))}
                />
                <span>/ {pageCount || 0}</span>
              </div>
              <span className="toolbar-divider" />
              <button className="icon-button" title="撤销 Ctrl+Z" disabled={!canUndoActions} onClick={undoActions}>
                <Undo2 size={16} />
              </button>
              <button className="icon-button" title="恢复 Ctrl+Y" disabled={!canRedoActions} onClick={redoActions}>
                <Redo2 size={16} />
              </button>
              <div className="document-title-chip" title={pdfName || '未选择 PDF'}>
                <FileText size={15} />
                <span>{pdfName || '未选择 PDF'}</span>
              </div>
              {pdfDocument && (
                <>
                  <button className="icon-button" title="更换 PDF" onClick={() => replaceInputRef.current?.click()}>
                    <Upload size={15} />
                  </button>
                  <button className="icon-button danger-action" title="移除 PDF" onClick={clearPdf}>
                    <Trash2 size={15} />
                  </button>
                  <input
                    ref={replaceInputRef}
                    type="file"
                    accept="application/pdf"
                    style={{ display: 'none' }}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = '';
                      if (file) openPdf(file);
                    }}
                  />
                </>
              )}
              <span className="toolbar-divider" />
              <div className="toolbar-button-group" aria-label="缩放控制">
                <button className="icon-button zoom-step-button" title="缩小" disabled={!pdfDocument} onClick={() => changeZoom(-0.1)}><Minus size={15} /></button>
                <button className="icon-button zoom-step-button" title="放大" disabled={!pdfDocument} onClick={() => changeZoom(0.1)}><Plus size={15} /></button>
              </div>
              <button className={`button toolbar-fit ${fitWidth ? 'active' : ''}`} type="button" disabled={!pdfDocument} onClick={() => setFitWidth(true)}>Auto</button>
              <button className="icon-button" title={isFullscreen ? '退出全屏' : '全屏预览'} disabled={!pdfDocument} onClick={toggleFullscreen}><Maximize2 size={16} /></button>
            </div>

            <div className="viewer-area">
              <nav className="thumbnail-rail">
                {Array.from({ length: pageCount }, (_, index) => index + 1).map((page) => (
                  <button
                    key={page}
                    className={page === currentPage ? 'active' : ''}
                    onClick={() => goToPage(page)}
                  >
                    <span>{page}</span>
                  </button>
                ))}
              </nav>

              <section className="document-stage" ref={documentStageRef} onWheel={handleDocumentWheel}>
                {!pdfDocument ? (
                  <div className="drop-zone" onClick={() => fileInputRef.current?.click()}>
                    <span className="drop-zone-icon">
                      <Upload size={34} />
                    </span>
                    <strong>上传 PDF 后开始盖章</strong>
                    <span>支持批量、指定页、多类型印章和骑缝章</span>
                    <em>PDF</em>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="application/pdf"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) openPdf(file);
                      }}
                    />
                  </div>
                ) : (
                  <div
                    className={`page-wrap ${canPositionOnPage ? 'can-position-stamp' : ''} ${shouldShowDraftSeam ? 'can-position-seam' : ''}`}
                    ref={pageWrapRef}
                    onPointerDown={startPagePositioning}
                    onPointerMove={(event) => {
                      if (isPositioningStamp) updatePagePositionFromPointer(event);
                    }}
                    onPointerUp={() => setIsPositioningStamp(false)}
                    onPointerCancel={() => setIsPositioningStamp(false)}
                  >
                    <PageCanvas pdfDocument={pdfDocument} pageNumber={currentPage} zoom={zoom} fitWidth={fitWidth} onRendered={setRenderPage} />
                    {currentActions.filter((action) => action.id !== editingActionId).map((action) => {
                      if (!activeSubject) return null;
                      if (action.type === 'normal') {
                        const sealSrc = activeSubject.seals[action.sealKind];
                        if (!sealSrc) return null;
                        const width = (renderPage.width * sealSizePercent(action.sealKind, action.sizePercent, activeSubject.sealSizes)) / 100;
                        const height = width;
                        const position = pagePosition(action, currentPage);
                        return (
                          <img
                            key={action.id}
                            className="stamp-preview interactive-stamp-preview"
                            src={sealSrc}
                            alt="stamp"
                            draggable={false}
                            onPointerDown={(event) => startExistingStampPositioning(event, action)}
                            style={{
                              width,
                              height,
                              left: `${position.xPercent}%`,
                              top: `${position.yPercent}%`,
                            }}
                          />
                        );
                      }
                      if (!activeSubject.seals.official) return null;
                      const localIndex = action.pages.indexOf(currentPage);
                      if (localIndex < 0) return null;
                      const slice = seamSliceInfo(action.pages.length, action.splitCount, localIndex);
                      const previewHeight = (renderPage.width * sealSizePercent('official', action.heightPercent, activeSubject.sealSizes)) / 100;
                      const width = Math.max(12, previewHeight / slice.groupSize);
                      return (
                        <div
                          key={action.id}
                          className="seam-preview"
                          style={{
                            width,
                            height: previewHeight,
                            top: `${action.yPercent}%`,
                            right: `${-action.rightInsetPercent}%`,
                            backgroundImage: `url(${activeSubject.seals.official})`,
                            backgroundSize: `${slice.groupSize * 100}% 100%`,
                            backgroundPosition: `${(slice.sliceIndex / Math.max(1, slice.groupSize - 1)) * 100}% 0`,
                          }}
                        />
                      );
                    })}
                    {shouldShowDraftSeam && activeSubject?.seals.official && draftSeamSlice && (
                      <div
                        className="seam-preview draft-seam-preview"
                        style={{
                          width: draftSeamWidth,
                          height: draftSeamHeight,
                          top: `${seamY}%`,
                          right: `${-seamInset}%`,
                          backgroundImage: `url(${activeSubject.seals.official})`,
                          backgroundSize: `${draftSeamSlice.groupSize * 100}% 100%`,
                          backgroundPosition: `${(draftSeamSlice.sliceIndex / Math.max(1, draftSeamSlice.groupSize - 1)) * 100}% 0`,
                        }}
                      />
                    )}
                    {shouldShowDraftStamp && (
                      <img
                        className="stamp-preview draft-stamp-preview"
                        src={draftSealSrc}
                        alt="stamp draft"
                        style={{
                          width: (renderPage.width * currentSealSizePercent) / 100,
                          height: (renderPage.width * currentSealSizePercent) / 100,
                          left: `${effectiveDraftXPercent}%`,
                          top: `${effectiveDraftYPercent}%`,
                        }}
                      />
                    )}
                  </div>
            )}
          </section>
        </div>
          </>
        )}
      </main>

      <aside className="inspector">
        <div className="mode-tabs">
          <button className={mode === 'batch' ? 'active' : ''} onClick={() => switchMode('batch')}>
            <Layers3 size={15} />
            批量
          </button>
          <button className={mode === 'specific' ? 'active' : ''} onClick={() => switchMode('specific')}>
            <Stamp size={15} />
            指定页
          </button>
          <button className={mode === 'seam' ? 'active' : ''} onClick={() => switchMode('seam')}>
            <Scissors size={15} />
            骑缝章
          </button>
        </div>

        {mode !== 'seam' ? (
          <div className="form-stack">
            {mode === 'batch' ? (
              <div className="two-col">
                <label>开始页<input type="number" min={1} max={pageCount || 1} value={batchStart} onChange={(event) => setBatchStart(Number(event.target.value))} /></label>
                <label>结束页<input type="number" min={1} max={pageCount || 1} value={batchEnd} onChange={(event) => setBatchEnd(Number(event.target.value))} /></label>
              </div>
            ) : (
              <label>页码<input value={specificPages} onChange={(event) => setSpecificPages(event.target.value)} placeholder="1,3,5-8" /></label>
            )}
            <div className="seal-kind-picker" aria-label="印章类型">
              <div className="field-label">印章类型</div>
              <div className="seal-kind-grid">
                {sealKindList.map((kind) => {
                  const sealSource = activeSubject?.seals[kind];
                  const isSelected = selectedSealKind === kind;
                  return (
                    <button
                      className={`seal-kind-option ${isSelected ? 'active' : ''}`}
                      key={kind}
                      type="button"
                      aria-label={sealLabels[kind]}
                      aria-pressed={isSelected}
                      onClick={() => setSelectedSealKind(kind)}
                    >
                      <span className="seal-kind-thumb">
                        {sealSource ? <img src={sealSource} alt="" /> : <small>未上传</small>}
                      </span>
                      <span className="seal-kind-name">{sealLabels[kind]}</span>
                      {isSelected && <BadgeCheck className="seal-kind-check" size={15} />}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="position-readout">
              <span>{mode === 'batch' ? '批量默认位置' : '印章位置'}</span>
              <b>{xPercent}% / {yPercent}%</b>
            </div>
            {mode === 'batch' && (
              <div className="page-override-panel">
                <div className="page-override-head">
                  <strong>单页位置微调</strong>
                  <span>{Object.keys(pagePositionOverrides).length} 页已设置</span>
                </div>
                <div className="position-target-tabs">
                  <button className={positionTarget === 'default' ? 'active' : ''} type="button" onClick={() => setPositionTarget('default')}>
                    默认位置
                  </button>
                  <button className={positionTarget === 'page' ? 'active' : ''} type="button" onClick={() => { setPositionTarget('page'); goToPage(overridePage); }}>
                    本页位置
                  </button>
                </div>
                <label>
                  微调页
                  <input
                    type="number"
                    min={Math.min(batchStart, batchEnd) || 1}
                    max={Math.max(batchStart, batchEnd) || pageCount || 1}
                    value={overridePage}
                    onChange={(event) => {
                      const minPage = Math.min(batchStart, batchEnd) || 1;
                      const maxPage = Math.max(batchStart, batchEnd) || pageCount || 1;
                      const pageNumber = clampPercent(Number(event.target.value), minPage, maxPage);
                      setOverridePage(pageNumber);
                      goToPage(pageNumber);
                      setPositionTarget('page');
                    }}
                  />
                </label>
                <div className="position-readout compact">
                  <span>本页位置</span>
                  <b>{overrideXPercent}% / {overrideYPercent}%</b>
                </div>
                <div className="page-override-actions">
                  <button className="button" type="button" onClick={savePagePositionOverride}>
                    <Save size={15} />
                    保存本页位置
                  </button>
                  <button className="button danger-action" type="button" disabled={!pagePositionOverrides[overridePage]} onClick={clearPagePositionOverride}>
                    <RotateCcw size={15} />
                    清除
                  </button>
                </div>
              </div>
            )}
            <div className="fixed-size-field">
              <span>印章尺寸</span>
              <b>{sealSizeText(selectedSealKind, activeSubject?.sealSizes)}</b>
            </div>
          </div>
        ) : (
          <div className="form-stack">
            <div className="two-col">
              <label>开始页<input type="number" min={1} max={pageCount || 1} value={seamStart} onChange={(event) => setSeamStart(Number(event.target.value))} /></label>
              <label>结束页<input type="number" min={1} max={pageCount || 1} value={seamEnd} onChange={(event) => setSeamEnd(Number(event.target.value))} /></label>
            </div>
            <label>拆分份数 <b>{splitCount}</b><input type="range" min={pageCount > 1 ? 2 : 1} max={Math.max(pageCount > 1 ? 2 : 1, pageCount || 12)} value={splitCount} onChange={(event) => setSplitCount(Number(event.target.value))} /></label>
            <div className="fixed-size-field">
              <span>当前位置</span>
              <b>纵向 {seamY}% · 右侧 {seamInset}%</b>
            </div>
            <div className="fixed-size-field">
              <span>骑缝章尺寸</span>
              <b>{sealSizeText('official', activeSubject?.sealSizes)}</b>
            </div>
          </div>
        )}

        <button className="button primary full" onClick={addStampAction}>
          <Save size={17} />
          {editingActionId ? '保存调整' : mode === 'seam' ? '添加骑缝章' : '添加到 PDF'}
        </button>
        {editingActionId && (
          <button className="button full secondary-action" onClick={() => setEditingActionId(null)}>
            取消调整
          </button>
        )}

	        <section className="history op-list">
	          <div className="section-title op-list-head">
	            <Stamp size={16} />
	            <span>已添加操作</span>
            {actions.length > 0 && <small>{actions.length} 条</small>}
            {actions.length > 0 && (
              <button className="op-clear-button" type="button" onClick={clearActions} title="清除所有操作">
                <RotateCcw size={13} />
                清除所有操作
              </button>
            )}
          </div>
          {actions.map((action) => {
            const seam = action.type === 'seam';
            const iconClass = seam ? 'seam' : action.sealKind;
            return (
              <div
                className={`op-row ${editingActionId === action.id ? 'active' : ''}`}
                key={action.id}
                onClick={() => selectAction(action)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') selectAction(action);
                }}
                role="button"
                tabIndex={0}
              >
                <span className={`op-icon ${iconClass}`}>
                  {seam ? <Scissors size={16} /> : <Stamp size={16} />}
                </span>
                <div className="op-body">
                  <span className="op-title">{actionTitle(action)}</span>
                  <span className="op-meta">
                    第 {pagesToRangeText(action.pages)} 页 · 共 {action.pages.length} 页
                  </span>
                </div>
                <button
                  className="op-del"
                  onClick={(event) => {
                    event.stopPropagation();
                    commitActions((list) => list.filter((item) => item.id !== action.id));
                    if (editingActionId === action.id) setEditingActionId(null);
                  }}
                  title="删除"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
          {!actions.length && <div className="empty">暂无盖章操作。</div>}
        </section>

        {pdfDocument && (
          <section className="history workflow-panel">
            <div className="section-title">
              <FileText size={16} />
              <span>当前用章流程</span>
              <small>{actions.length} 条操作</small>
            </div>
            <div className="workflow-file-name" title={pdfName}>{pdfName || '未命名 PDF'}</div>
            <button className="button full secondary-action" onClick={closeCurrentWorkflow}>
              <X size={15} />
              关闭并保存流程
            </button>
          </section>
        )}

        <div className="status">{status}</div>
      </aside>
      {confirmDialog && (
        <ConfirmDialog dialog={confirmDialog} onResolve={resolveConfirmDialog} />
      )}
      {previewQualification && (
        <div className="preview-layer" role="presentation" onMouseDown={() => setPreviewQualification(null)}>
          <section className="preview-dialog" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <header className="preview-head">
              <strong title={previewQualification.name}>{previewQualification.name}</strong>
              <div className="preview-head-actions">
                <button className="button" onClick={() => openDownloadConfig(previewQualification)}>
                  <Download size={14} />
                  下载
                </button>
                <button className="icon-button" aria-label="关闭" onClick={() => setPreviewQualification(null)}>
                  <X size={16} />
                </button>
              </div>
            </header>
            <div className="preview-body">
              {previewQualification.mimeType.startsWith('image/') ? (
                <img src={previewQualification.dataUrl} alt={previewQualification.name} />
              ) : previewQualification.mimeType === 'application/pdf' ? (
                <iframe title={previewQualification.name} src={previewQualification.dataUrl} />
              ) : (
                <div className="preview-unsupported">
                  <FileText size={40} />
                  <strong>该格式暂不支持在线预览</strong>
                  <span>Word 等文档请点击上方“下载”后在本地打开查看。</span>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
      {downloadConfig && (() => {
        const downloadTarget = activeSubject?.qualifications?.find((item) => item.id === downloadConfig.id);
        return (
        <div className="preview-layer" role="presentation" onMouseDown={() => setDownloadConfig(null)}>
          <section className="download-dialog" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <header className="download-dialog-head">
              <strong>下载设置</strong>
              <button className="icon-button" aria-label="关闭" onClick={() => setDownloadConfig(null)}>
                <X size={16} />
              </button>
            </header>
            <div className="download-dialog-body">
              <div className="download-file-name" title={downloadConfig.name}>{downloadConfig.name}</div>
              <label className="download-field">
                <span>用途（自定义内容）</span>
                <textarea
                  rows={3}
                  value={downloadConfig.purpose}
                  onChange={(event) => setDownloadConfig((config) => (config ? { ...config, purpose: event.target.value } : config))}
                  placeholder="例如：仅用于合同签署资质核验"
                />
              </label>
              <label className="download-toggle">
                <input
                  type="checkbox"
                  checked={downloadConfig.addSeal}
                  onChange={(event) => setDownloadConfig((config) => (config ? { ...config, addSeal: event.target.checked } : config))}
                />
                <span>加公章</span>
              </label>
              {downloadConfig.addSeal && (
                <div className="download-field download-seal-position">
                  <span>公章位置</span>
                  <div className="seal-position-grid">
                    {(['tl', 'tr', 'center', 'bl', 'br'] as SealPosition[]).map((pos) => (
                      <button
                        key={pos}
                        type="button"
                        className={`seal-position-option ${downloadConfig.sealPosition === pos ? 'active' : ''}`}
                        onClick={() => setDownloadConfig((config) => (config ? { ...config, sealPosition: pos } : config))}
                      >
                        {SEAL_POSITION_LABELS[pos]}
                      </button>
                    ))}
                  </div>
                  {downloadTarget && (
                    <>
                      <span className="seal-preview-hint">位置预览（仅示意，公章为半透明叠加）</span>
                      <SealPositionPreview
                        qualification={downloadTarget}
                        sealDataUrl={activeSubject?.seals.official}
                        position={downloadConfig.sealPosition}
                      />
                      {!activeSubject?.seals.official && (
                        <span className="seal-preview-warning">当前主体尚未上传公章，下载时不会盖章。</span>
                      )}
                    </>
                  )}
                </div>
              )}
              <label className="download-toggle">
                <input
                  type="checkbox"
                  checked={downloadConfig.addWatermark}
                  onChange={(event) => setDownloadConfig((config) => (config ? { ...config, addWatermark: event.target.checked } : config))}
                />
                <span>加水印（用途内容 + 时间戳）</span>
              </label>
            </div>
            <footer className="download-dialog-foot">
              <button className="button" onClick={() => setDownloadConfig(null)}>取消</button>
              <button className="button primary" onClick={confirmDownloadConfig}>
                <Download size={15} />
                确认下载
              </button>
            </footer>
          </section>
        </div>
        );
      })()}
    </div>
  );
}

const rootElement = document.getElementById('root')!;
const rootStore = window as Window & { __corpSealRoot?: ReturnType<typeof createRoot> };
rootStore.__corpSealRoot ||= createRoot(rootElement);
rootStore.__corpSealRoot.render(<App />);
