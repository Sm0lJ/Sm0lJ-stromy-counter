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
  countBtn.disabled = !hasCaptured || !cvReady;
  captureAndCountBtn.disabled = !stream || !cvReady;
}

function markCvReady() {
  if (cvReady) return;
  cvReady = true;
  if (cvInitTimer) {
    clearTimeout(cvInitTimer);
    cvInitTimer = null;
  }
  setStatus('OpenCV pripravené. Otvor kameru.');
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

function countCircles() {
  if (!cvReady || !hasCaptured) return;

  let src;
  let gray;
  let normalized;
  let blur;
  let circles;

  try {
    setStatus('Počítam kruhy…');

    src = cv.imread(canvas);
    gray = new cv.Mat();
    normalized = new cv.Mat();
    blur = new cv.Mat();
    circles = new cv.Mat();

    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.equalizeHist(gray, normalized);
    cv.GaussianBlur(normalized, blur, new cv.Size(7, 7), 1.5, 1.5, cv.BORDER_DEFAULT);

    const minDist = Math.max(18, Math.floor(canvas.width / 18));
    const param1 = 120;
    const param2 = Number(sensitivity.value);
    const minRadius = Number(minRadiusInput.value);
    const maxRadius = Number(maxRadiusInput.value);

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

    const count = circles.cols;

    for (let i = 0; i < circles.cols; i++) {
      const x = circles.data32F[i * 3];
      const y = circles.data32F[i * 3 + 1];
      const r = circles.data32F[i * 3 + 2];

      cv.circle(src, new cv.Point(x, y), r, [0, 255, 0, 255], 3);
      cv.circle(src, new cv.Point(x, y), 2, [255, 0, 0, 255], 3);
    }

    cv.imshow(canvas, src);
    resultEl.textContent = `Počet stromčekov: ${count}`;
    setStatus('Hotovo. Ak výsledok nesedí, dolaď citlivosť alebo polomer a skús znovu.');
  } catch (err) {
    setStatus('Chyba pri počítaní: ' + err.message);
  } finally {
    if (src) src.delete();
    if (gray) gray.delete();
    if (normalized) normalized.delete();
    if (blur) blur.delete();
    if (circles) circles.delete();
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
  cvInitTimer = window.setTimeout(() => {
    if (!cvReady) {
      setStatus('OpenCV sa nepodarilo načítať. Obnov stránku a skús znova.');
      enableIfReady();
    }
  }, 10000);
}

startBtn.addEventListener('click', async () => {
  try {
    setStatus('Žiadam prístup ku kamere…');
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false
    });
    video.srcObject = stream;

    await new Promise((resolve) => {
      video.onloadedmetadata = () => resolve();
    });

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    if (cvReady) {
      setStatus('Kamera otvorená. Odfotím po stlačení tlačidla.');
    } else {
      setStatus('Kamera otvorená. OpenCV sa ešte načítava, odfotiť môžeš už teraz.');
    }
    enableIfReady();
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
