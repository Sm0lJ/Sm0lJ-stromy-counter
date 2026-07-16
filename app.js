const startBtn = document.getElementById('startBtn');
const captureBtn = document.getElementById('captureBtn');
const countBtn = document.getElementById('countBtn');
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');
const sensitivity = document.getElementById('sensitivity');
const sensitivityValue = document.getElementById('sensitivityValue');

const ctx = canvas.getContext('2d');
let stream = null;
let cvReady = false;
let hasCaptured = false;

sensitivity.addEventListener('input', () => {
  sensitivityValue.textContent = sensitivity.value;
});

function setStatus(text) {
  statusEl.textContent = text;
}

function enableIfReady() {
  captureBtn.disabled = !(stream && cvReady);
  countBtn.disabled = !hasCaptured || !cvReady;
}

window.Module = {
  onRuntimeInitialized() {
    cvReady = true;
    setStatus('OpenCV pripravené. Otvor kameru.');
    enableIfReady();
  }
};

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
    setStatus('Kamera otvorená. Odfotím po stlačení tlačidla.');
    enableIfReady();
  } catch (err) {
    setStatus('Nepodarilo sa otvoriť kameru: ' + err.message);
  }
});

captureBtn.addEventListener('click', () => {
  if (!stream) return;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  hasCaptured = true;
  resultEl.textContent = 'Počet stromčekov: –';
  setStatus('Fotka uložená. Spusť počítanie.');
  enableIfReady();
});

countBtn.addEventListener('click', () => {
  if (!cvReady || !hasCaptured) return;

  try {
    setStatus('Počítam kruhy…');

    const src = cv.imread(canvas);
    const gray = new cv.Mat();
    const blur = new cv.Mat();
    const circles = new cv.Mat();

    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.medianBlur(gray, blur, 5);

    const minDist = Math.max(20, Math.floor(canvas.width / 16));
    const param1 = 120;
    const param2 = Number(sensitivity.value);
    const minRadius = 10;
    const maxRadius = 120;

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
    setStatus('Hotovo. Ak výsledok nesedí, skús upraviť citlivosť a znovu spustiť počítanie.');

    src.delete();
    gray.delete();
    blur.delete();
    circles.delete();
  } catch (err) {
    setStatus('Chyba pri počítaní: ' + err.message);
  }
});
