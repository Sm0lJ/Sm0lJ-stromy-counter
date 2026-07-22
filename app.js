'use strict';

const pickBtn = document.getElementById('pickBtn');
const fileInput = document.getElementById('fileInput');
const cameraBtn = document.getElementById('cameraBtn');
const shutterBtn = document.getElementById('shutterBtn');
const closeCameraBtn = document.getElementById('closeCameraBtn');
const cameraWrap = document.getElementById('cameraWrap');
const recountBtn = document.getElementById('recountBtn');
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const placeholder = document.getElementById('placeholder');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');
const resultCountEl = document.getElementById('resultCount');
const appVersionEl = document.getElementById('appVersion');
const minDiamInput = document.getElementById('minDiam');
const minDiamValue = document.getElementById('minDiamValue');
const biasInput = document.getElementById('bias');
const biasValue = document.getElementById('biasValue');
const showMaskInput = document.getElementById('showMask');

const MAX_DIM = 1100;

const ctx = canvas.getContext('2d', { willReadFrequently: true });
// Original photo without markers, so we can redraw after manual corrections.
const sourceCanvas = document.createElement('canvas');
const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });

let stream = null;
let detections = [];
let lastMask = null;
let medianRadius = 14;

async function loadVersionInfo() {
  try {
    const response = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('version.json missing');
    const info = await response.json();
    appVersionEl.textContent = `Verzia: ${info.version || '?'} | Nasadené: ${info.builtAt || '?'}`;
  } catch {
    appVersionEl.textContent = 'Verzia: local/dev';
  }
}
loadVersionInfo();

function setStatus(text) {
  statusEl.textContent = text;
}

function showCanvas() {
  placeholder.hidden = true;
  cameraWrap.hidden = true;
  canvas.hidden = false;
}

function showVideo() {
  placeholder.hidden = true;
  canvas.hidden = true;
  cameraWrap.hidden = false;
}

function setResult(count) {
  resultEl.hidden = false;
  resultCountEl.textContent = String(count);
}

// ---------- Image loading ----------

async function loadImageSource(source, width, height) {
  const scale = Math.min(1, MAX_DIM / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  sourceCanvas.width = w;
  sourceCanvas.height = h;
  sourceCtx.drawImage(source, 0, 0, w, h);
  canvas.width = w;
  canvas.height = h;
  ctx.drawImage(sourceCanvas, 0, 0);
  showCanvas();
}

async function loadFile(file) {
  try {
    let bitmap;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      bitmap = await createImageBitmap(file);
    }
    await loadImageSource(bitmap, bitmap.width, bitmap.height);
    bitmap.close();
    analyze();
  } catch (err) {
    setStatus('Fotku sa nepodarilo načítať: ' + err.message);
  }
}

// ---------- Analysis pipeline ----------
// 1. "Drevo skóre" na pixel (svetlé teplé odtiene čiel kmeňov).
// 2. Automatický prah (Otsu) + ručná korekcia citlivosťou.
// 3. Morfologické uzavretie/otvorenie masky (zalepí praskliny, zmaže šum).
// 4. Dištančná transformácia masky.
// 5. Lokálne maximá vzdialenosti = stredy polien (oddelí aj dotýkajúce sa).

function woodScore(data, n) {
  const score = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    let s = 0.5 * r + 0.4 * g - 0.35 * b;
    if (s < 0) s = 0;
    else if (s > 255) s = 255;
    score[i] = s | 0;
  }
  return score;
}

function otsuThreshold(score, n) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) hist[score[i]]++;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];

  let sumB = 0;
  let wB = 0;
  let best = 127;
  let bestVar = -1;

  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = n - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) {
      bestVar = between;
      best = t;
    }
  }
  return best;
}

function erode(src, dst, width, height) {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!src[i]) { dst[i] = 0; continue; }
      const up = y > 0 ? src[i - width] : 0;
      const down = y < height - 1 ? src[i + width] : 0;
      const left = x > 0 ? src[i - 1] : 0;
      const right = x < width - 1 ? src[i + 1] : 0;
      dst[i] = (up & down & left & right) ? 1 : 0;
    }
  }
}

function dilate(src, dst, width, height) {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (src[i]) { dst[i] = 1; continue; }
      const up = y > 0 ? src[i - width] : 0;
      const down = y < height - 1 ? src[i + width] : 0;
      const left = x > 0 ? src[i - 1] : 0;
      const right = x < width - 1 ? src[i + 1] : 0;
      dst[i] = (up | down | left | right) ? 1 : 0;
    }
  }
}

// Chamfer 3-4 distance transform; result in thirds of a pixel.
function distanceTransform(mask, width, height) {
  const n = width * height;
  const dist = new Int32Array(n);
  const INF = 1 << 29;

  for (let i = 0; i < n; i++) dist[i] = mask[i] ? INF : 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (dist[i] === 0) continue;
      let d = dist[i];
      if (x > 0 && dist[i - 1] + 3 < d) d = dist[i - 1] + 3;
      if (y > 0) {
        if (dist[i - width] + 3 < d) d = dist[i - width] + 3;
        if (x > 0 && dist[i - width - 1] + 4 < d) d = dist[i - width - 1] + 4;
        if (x < width - 1 && dist[i - width + 1] + 4 < d) d = dist[i - width + 1] + 4;
      }
      dist[i] = d;
    }
  }

  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (dist[i] === 0) continue;
      let d = dist[i];
      if (x < width - 1 && dist[i + 1] + 3 < d) d = dist[i + 1] + 3;
      if (y < height - 1) {
        if (dist[i + width] + 3 < d) d = dist[i + width] + 3;
        if (x < width - 1 && dist[i + width + 1] + 4 < d) d = dist[i + width + 1] + 4;
        if (x > 0 && dist[i + width - 1] + 4 < d) d = dist[i + width - 1] + 4;
      }
      dist[i] = d;
    }
  }
  return dist;
}

function findPeaks(dist, width, height, minRadiusPx) {
  const minDist3 = minRadiusPx * 3;
  const candidates = [];

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const d = dist[i];
      if (d < minDist3) continue;
      if (
        d >= dist[i - 1] && d >= dist[i + 1] &&
        d >= dist[i - width] && d >= dist[i + width] &&
        d >= dist[i - width - 1] && d >= dist[i - width + 1] &&
        d >= dist[i + width - 1] && d >= dist[i + width + 1]
      ) {
        candidates.push({ x, y, r: d / 3 });
      }
    }
  }

  candidates.sort((a, b) => b.r - a.r);

  const picked = [];
  for (const c of candidates) {
    let overlaps = false;
    for (const p of picked) {
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      const limit = Math.max(1.2 * Math.max(p.r, c.r), minRadiusPx * 1.4);
      if (dx * dx + dy * dy < limit * limit) {
        overlaps = true;
        break;
      }
    }
    if (!overlaps) picked.push(c);
  }
  return picked;
}

function analyze() {
  if (canvas.hidden || !sourceCanvas.width) {
    setStatus('Najprv vyber alebo odfoť fotku.');
    return;
  }

  const started = performance.now();
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  const n = width * height;
  const imageData = sourceCtx.getImageData(0, 0, width, height);

  const score = woodScore(imageData.data, n);
  const threshold = Math.max(5, Math.min(250, otsuThreshold(score, n) - Number(biasInput.value)));

  let mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = score[i] >= threshold ? 1 : 0;

  // Close (seal cracks in log faces), then open (drop tiny specks).
  let tmp = new Uint8Array(n);
  dilate(mask, tmp, width, height);
  erode(tmp, mask, width, height);
  erode(mask, tmp, width, height);
  dilate(tmp, mask, width, height);

  const dist = distanceTransform(mask, width, height);
  const minRadiusPx = Math.max(3, Number(minDiamInput.value) / 2);
  detections = findPeaks(dist, width, height, minRadiusPx);

  const radii = detections.map((d) => d.r).sort((a, b) => a - b);
  medianRadius = radii.length ? radii[Math.floor(radii.length / 2)] : minRadiusPx * 1.5;

  lastMask = mask;
  redraw();
  setResult(detections.length);
  const elapsed = Math.round(performance.now() - started);
  setStatus(`Hotovo za ${elapsed} ms. Nesedí? Dolaď nastavenia alebo opravuj ťuknutím do obrázka.`);
  recountBtn.hidden = false;
}

// ---------- Drawing & manual corrections ----------

function redraw() {
  ctx.drawImage(sourceCanvas, 0, 0);

  if (showMaskInput.checked && lastMask) {
    const overlay = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = overlay.data;
    for (let i = 0; i < lastMask.length; i++) {
      if (lastMask[i]) {
        const p = i * 4;
        data[p + 1] = Math.min(255, data[p + 1] + 90);
      }
    }
    ctx.putImageData(overlay, 0, 0);
  }

  const lineW = Math.max(2, canvas.width / 400);
  for (const d of detections) {
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(34, 255, 90, 0.95)';
    ctx.lineWidth = lineW;
    ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.fillStyle = 'rgba(255, 40, 40, 0.95)';
    ctx.arc(d.x, d.y, lineW * 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

canvas.addEventListener('click', (event) => {
  if (canvas.hidden || !detections) return;
  const rect = canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
  const y = ((event.clientY - rect.top) / rect.height) * canvas.height;

  let hitIndex = -1;
  let hitDist = Infinity;
  for (let i = 0; i < detections.length; i++) {
    const d = detections[i];
    const dd = Math.hypot(d.x - x, d.y - y);
    if (dd <= Math.max(d.r, 12) && dd < hitDist) {
      hitDist = dd;
      hitIndex = i;
    }
  }

  if (hitIndex >= 0) {
    detections.splice(hitIndex, 1);
    setStatus('Označenie zmazané.');
  } else {
    detections.push({ x, y, r: medianRadius, manual: true });
    setStatus('Označenie pridané.');
  }
  redraw();
  setResult(detections.length);
});

// ---------- Inputs ----------

pickBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', () => {
  const file = fileInput.files && fileInput.files[0];
  if (file) {
    stopCamera();
    setStatus('Načítavam fotku…');
    loadFile(file);
  }
  fileInput.value = '';
});

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  cameraWrap.hidden = true;
  cameraBtn.textContent = '🎥 Živý náhľad';
}

cameraBtn.addEventListener('click', async () => {
  if (stream) {
    stopCamera();
    if (!sourceCanvas.width) placeholder.hidden = false;
    else showCanvas();
    return;
  }
  try {
    setStatus('Žiadam prístup ku kamere…');
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } },
      audio: false
    });
    video.srcObject = stream;
    showVideo();
    cameraBtn.textContent = 'Zavrieť kameru';
    setStatus('Namier na polená a stlač spúšť.');
  } catch (err) {
    setStatus('Nepodarilo sa otvoriť kameru: ' + err.message);
  }
});

shutterBtn.addEventListener('click', async () => {
  if (!stream) return;
  await loadImageSource(video, video.videoWidth || 640, video.videoHeight || 480);
  stopCamera();
  analyze();
});

closeCameraBtn.addEventListener('click', () => {
  stopCamera();
  if (sourceCanvas.width) showCanvas();
  else placeholder.hidden = false;
  setStatus('');
});

recountBtn.addEventListener('click', analyze);

minDiamInput.addEventListener('input', () => {
  minDiamValue.textContent = minDiamInput.value;
});
minDiamInput.addEventListener('change', () => {
  if (sourceCanvas.width) analyze();
});

biasInput.addEventListener('input', () => {
  biasValue.textContent = biasInput.value;
});
biasInput.addEventListener('change', () => {
  if (sourceCanvas.width) analyze();
});

showMaskInput.addEventListener('change', () => {
  if (sourceCanvas.width) redraw();
});

// Exposed for automated testing.
window.__app = {
  analyze,
  loadImageSource,
  getDetections: () => detections
};
