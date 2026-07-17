const startBtn = document.getElementById('startBtn');
const captureBtn = document.getElementById('captureBtn');
const countBtn = document.getElementById('countBtn');
const captureAndCountBtn = document.getElementById('captureAndCountBtn');
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');
const appVersionEl = document.getElementById('appVersion');
const sensitivity = document.getElementById('sensitivity');
const sensitivityValue = document.getElementById('sensitivityValue');
const minRadiusInput = document.getElementById('minRadius');
const minRadiusValue = document.getElementById('minRadiusValue');
const maxRadiusInput = document.getElementById('maxRadius');
const maxRadiusValue = document.getElementById('maxRadiusValue');

const ctx = canvas.getContext('2d');
let stream = null;
let cvReady = false;
let hasCaptured = false;
let cvInitTimer = null;
let cvProbeTimer = null;

function setVersionText(text) {
  if (appVersionEl) {
    appVersionEl.textContent = text;
  }
}

async function loadVersionInfo() {
  try {
    const response = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('version.json missing');
    }

    const versionInfo = await response.json();
    const short = versionInfo.version || 'unknown';
    const builtAt = versionInfo.builtAt || 'unknown time';
    setVersionText(`Verzia: ${short} | Nasadené: ${builtAt}`);
  } catch (_err) {
    setVersionText('Verzia: local/dev (nenasadené cez Pages)');
  }
}

loadVersionInfo();

sensitivity.addEventListener('input', () => {
  sensitivityValue.textContent = sensitivity.value;
});

minRadiusInput.addEventListener('input', () => {
  minRadiusValue.textContent = minRadiusInput.value;

  if (Number(minRadiusInput.value) >= Number(maxRadiusInput.value)) {
    maxRadiusInput.value = String(Number(minRadiusInput.value) + 1);
    maxRadiusValue.textContent = maxRadiusInput.value;
  }
});

maxRadiusInput.addEventListener('input', () => {
  maxRadiusValue.textContent = maxRadiusInput.value;

  if (Number(maxRadiusInput.value) <= Number(minRadiusInput.value)) {
    minRadiusInput.value = String(Math.max(5, Number(maxRadiusInput.value) - 1));
    minRadiusValue.textContent = minRadiusInput.value;
  }
});

function setStatus(text) {
  statusEl.textContent = text;
}

function enableIfReady() {
  captureBtn.disabled = !stream;
  countBtn.disabled = !hasCaptured;
  captureAndCountBtn.disabled = !stream;
}

function syncCanvasSizeFromVideo() {
  const width = video.videoWidth || 640;
  const height = video.videoHeight || 480;
  canvas.width = width;
  canvas.height = height;
}

function markCvReady() {
  if (cvReady) return;
  cvReady = true;

  if (cvProbeTimer) {
    clearInterval(cvProbeTimer);
    cvProbeTimer = null;
  }

  if (cvInitTimer) {
    clearTimeout(cvInitTimer);
    cvInitTimer = null;
  }

  if (stream) {
    setStatus('OpenCV pripravené. Môžeš spustiť počítanie.');
  } else {
    setStatus('OpenCV pripravené. Otvor kameru.');
  }

  enableIfReady();
}

function captureFrame() {
  if (!stream) return false;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  hasCaptured = true;
  resultEl.textContent = 'Počet stromčekov: –';
  setStatus('Fotka uložená. Spusť počítanie.');
  enableIfReady();
  return true;
}

function countCirclesFallback() {
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data, width, height } = imageData;
  const pixelCount = width * height;
  const gray = new Uint8Array(pixelCount);

  let sum = 0;
  for (let i = 0, p = 0; i < pixelCount; i++, p += 4) {
    const value = Math.round(0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]);
    gray[i] = value;
    sum += value;
  }

  const mean = sum / pixelCount;
  const sens = Number(sensitivity.value);
  const minRadius = Number(minRadiusInput.value);
  const maxRadius = Number(maxRadiusInput.value);
  const minArea = Math.PI * minRadius * minRadius;
  const maxArea = Math.PI * maxRadius * maxRadius;

  // Vyssia citlivost znizuje prah a pusti viac kandidatov.
  const threshold = Math.max(0, Math.min(255, mean - (sens - 30) * 1.8));
  const binary = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    binary[i] = gray[i] < threshold ? 1 : 0;
  }

  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  const detections = [];

  for (let start = 0; start < pixelCount; start++) {
    if (!binary[start] || visited[start]) continue;

    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;

    let area = 0;
    let sumX = 0;
    let sumY = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;

    while (head < tail) {
      const idx = queue[head++];
      const y = Math.floor(idx / width);
      const x = idx - y * width;

      area += 1;
      sumX += x;
      sumY += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      if (x > 0) {
        const left = idx - 1;
        if (binary[left] && !visited[left]) {
          visited[left] = 1;
          queue[tail++] = left;
        }
      }
      if (x < width - 1) {
        const right = idx + 1;
        if (binary[right] && !visited[right]) {
          visited[right] = 1;
          queue[tail++] = right;
        }
      }
      if (y > 0) {
        const up = idx - width;
        if (binary[up] && !visited[up]) {
          visited[up] = 1;
          queue[tail++] = up;
        }
      }
      if (y < height - 1) {
        const down = idx + width;
        if (binary[down] && !visited[down]) {
          visited[down] = 1;
          queue[tail++] = down;
        }
      }
    }

    if (area < minArea || area > maxArea) continue;

    const boxW = maxX - minX + 1;
    const boxH = maxY - minY + 1;
    const ratio = boxW / Math.max(1, boxH);
    if (ratio < 0.6 || ratio > 1.4) continue;

    const eqRadius = Math.sqrt(area / Math.PI);
    if (eqRadius < minRadius || eqRadius > maxRadius) continue;

    detections.push({
      x: sumX / area,
      y: sumY / area,
      r: eqRadius
    });
  }

  for (const d of detections) {
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(0,255,0,0.95)';
    ctx.lineWidth = 3;
    ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.fillStyle = 'rgba(255,0,0,0.95)';
    ctx.arc(d.x, d.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  return detections.length;
}

function mergeDetections(detections) {
  const sorted = detections.slice().sort((a, b) => b.score - a.score);
  const merged = [];

  for (const candidate of sorted) {
    const overlaps = merged.some((picked) => {
      const dx = picked.x - candidate.x;
      const dy = picked.y - candidate.y;
      const distance = Math.hypot(dx, dy);
      const minAllowed = Math.max(10, (picked.r + candidate.r) * 0.45);
      return distance < minAllowed;
    });

    if (!overlaps) {
      merged.push(candidate);
    }
  }

  return merged;
}

function countCircles() {
  if (!hasCaptured) {
    setStatus('Najprv odfoť záber.');
    return;
  }

  if (!cvReady || !window.cv || typeof window.cv.imread !== 'function') {
    try {
      setStatus('Počítam kruhy (fallback režim bez OpenCV)…');
      const fallbackCount = countCirclesFallback();
      resultEl.textContent = `Počet stromčekov: ${fallbackCount}`;
      setStatus('Hotovo (fallback). Ak výsledok nesedí, dolaď citlivosť alebo polomer.');
    } catch (err) {
      setStatus('Chyba pri počítaní (fallback): ' + err.message);
    }
    return;
  }

  let src;
  let gray;
  let blur;
  let edges;
  let contours;
  let hierarchy;
  let circles;
  let kernel;

  try {
    setStatus('Počítam rezy kmeňov…');

    src = cv.imread(canvas);
    gray = new cv.Mat();
    blur = new cv.Mat();
    edges = new cv.Mat();
    contours = new cv.MatVector();
    hierarchy = new cv.Mat();
    circles = new cv.Mat();
    kernel = cv.Mat.ones(5, 5, cv.CV_8U);

    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(7, 7), 1.6, 1.6, cv.BORDER_DEFAULT);
    cv.Canny(blur, edges, 50, 140);
    cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, kernel);
    cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const minDist = Math.max(18, Math.floor(canvas.width / 20));
    const param1 = 120;
    const param2 = Number(sensitivity.value);
    const minRadius = Number(minRadiusInput.value);
    const maxRadius = Number(maxRadiusInput.value);
    const minArea = Math.PI * minRadius * minRadius * 0.45;
    const maxArea = Math.PI * maxRadius * maxRadius * 2.4;
    const contourDetections = [];

    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);

      try {
        const area = cv.contourArea(contour);
        if (area < minArea || area > maxArea) {
          continue;
        }

        const perimeter = cv.arcLength(contour, true);
        if (perimeter < 1) {
          continue;
        }

        const circularity = (4 * Math.PI * area) / (perimeter * perimeter);
        if (circularity < 0.38) {
          continue;
        }

        const rect = cv.boundingRect(contour);
        const aspect = rect.width / Math.max(1, rect.height);
        if (aspect < 0.45 || aspect > 2.2) {
          continue;
        }

        const centerY = rect.y + rect.height / 2;
        if (centerY < canvas.height * 0.26) {
          continue;
        }

        let x;
        let y;
        let radius;

        if (contour.rows >= 5) {
          const ellipse = cv.fitEllipse(contour);
          const rx = ellipse.size.width / 2;
          const ry = ellipse.size.height / 2;
          radius = Math.sqrt(Math.max(1, rx * ry));
          x = ellipse.center.x;
          y = ellipse.center.y;
        } else {
          const moments = cv.moments(contour, false);
          if (moments.m00 === 0) {
            continue;
          }
          x = moments.m10 / moments.m00;
          y = moments.m01 / moments.m00;
          radius = Math.sqrt(area / Math.PI);
        }

        if (radius < minRadius * 0.75 || radius > maxRadius * 1.25) {
          continue;
        }

        contourDetections.push({
          x,
          y,
          r: radius,
          score: area * Math.max(0.3, circularity)
        });
      } finally {
        contour.delete();
      }
    }

    cv.HoughCircles(
      blur,
      circles,
      cv.HOUGH_GRADIENT,
      1,
      minDist,
      param1,
      param2,
      minRadius,
      maxRadius
    );

    const houghDetections = [];
    for (let i = 0; i < circles.cols; i++) {
      const x = circles.data32F[i * 3];
      const y = circles.data32F[i * 3 + 1];
      const r = circles.data32F[i * 3 + 2];
      if (y < canvas.height * 0.26) {
        continue;
      }
      houghDetections.push({ x, y, r, score: r * 120 });
    }

    const detections = mergeDetections(contourDetections.concat(houghDetections));

    if (detections.length === 0) {
      setStatus('OpenCV nič nenašlo, skúšam fallback režim…');
      const fallbackCount = countCirclesFallback();
      resultEl.textContent = `Počet stromčekov: ${fallbackCount}`;
      setStatus('Hotovo (fallback). Ak výsledok nesedí, dolaď citlivosť alebo polomer.');
      return;
    }

    for (const d of detections) {
      cv.circle(src, new cv.Point(d.x, d.y), d.r, [0, 255, 0, 255], 3);
      cv.circle(src, new cv.Point(d.x, d.y), 2, [255, 0, 0, 255], 3);
    }

    cv.imshow(canvas, src);
    resultEl.textContent = `Počet stromčekov: ${detections.length}`;
    setStatus('Hotovo. Ak výsledok nesedí, dolaď citlivosť alebo polomer a skús znovu.');
  } catch (err) {
    setStatus('Chyba pri počítaní: ' + err.message);
  } finally {
    if (src) src.delete();
    if (gray) gray.delete();
    if (blur) blur.delete();
    if (edges) edges.delete();
    if (contours) contours.delete();
    if (hierarchy) hierarchy.delete();
    if (circles) circles.delete();
    if (kernel) kernel.delete();
  }
}

window.Module = {
  onRuntimeInitialized() {
    markCvReady();
  }
};

if (window.cv && typeof window.cv.Mat === 'function') {
  markCvReady();
} else {
  cvProbeTimer = window.setInterval(() => {
    if (window.cv && typeof window.cv.Mat === 'function') {
      markCvReady();
    }
  }, 300);

  cvInitTimer = window.setTimeout(() => {
    if (!cvReady) {
      if (cvProbeTimer) {
        clearInterval(cvProbeTimer);
        cvProbeTimer = null;
      }
      setStatus('OpenCV sa nepodarilo načítať. Obnov stránku a skús znova.');
      enableIfReady();
    }
  }, 15000);
}

startBtn.addEventListener('click', async () => {
  try {
    setStatus('Žiadam prístup ku kamere…');
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false
    });
    video.srcObject = stream;
    enableIfReady();

    if (video.readyState >= 1) {
      syncCanvasSizeFromVideo();
    } else {
      video.addEventListener('loadedmetadata', syncCanvasSizeFromVideo, { once: true });
      video.addEventListener('loadeddata', syncCanvasSizeFromVideo, { once: true });
    }

    if (cvReady) {
      setStatus('Kamera otvorená. Odfotím po stlačení tlačidla.');
    } else {
      setStatus('Kamera otvorená. OpenCV sa ešte načítava, odfotiť môžeš už teraz.');
    }
  } catch (err) {
    setStatus('Nepodarilo sa otvoriť kameru: ' + err.message);
  }
});

captureBtn.addEventListener('click', () => {
  captureFrame();
});

countBtn.addEventListener('click', () => {
  countCircles();
});

captureAndCountBtn.addEventListener('click', () => {
  const captured = captureFrame();
  if (captured) {
    countCircles();
  }
});
