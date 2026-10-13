const matrix = document.getElementById('matrix');
const palette = document.getElementById('palette');
const serialPanel = document.getElementById('serialPanel');
const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const sendPatternBtn = document.getElementById('sendPatternBtn');
const patternClearBtn = document.getElementById('patternClearBtn');
const clearSerialBtn = document.getElementById('clearSerialBtn');
const connStatus = document.getElementById('connStatus');
const previewText = document.getElementById('previewText');
const resolutionInputs = document.querySelectorAll('input[name="resolution"]');

let selectedColor = '#ff0000';
const colors = ['#ff0000', '#0000ff', '#00ff00', '#ffff00', '#ffffff'];
let port = null;
let reader = null;
let writer = null;
let keepReading = false;
let serialBuffer = '';
const waiters = [];
let history = [];
let currentSession = null;

function appendSerial(text, isError = false) {
  const span = document.createElement('span');
  if (isError) span.className = 'serial-error';
  span.textContent = text;
  serialPanel.appendChild(span);
  serialPanel.scrollTop = serialPanel.scrollHeight;
  serialBuffer += text;
  waiters.slice().forEach(waiter => {
    if (serialBuffer.includes(waiter.pattern)) {
      waiter.resolve(serialBuffer);
      const index = waiters.indexOf(waiter);
      if (index !== -1) waiters.splice(index, 1);
    }
  });
}

function clearSerial() { serialPanel.textContent = ''; }

async function connectSerial() {
  if (!('serial' in navigator)) {
    appendSerial('このブラウザは Web Serial API をサポートしていません。\n', true);
    return;
  }
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 9600 });
    connStatus.textContent = '接続中';
    writer = port.writable.getWriter();
    keepReading = true;
    readLoop();
  } catch (error) {
    appendSerial('接続エラー: ' + error + '\n', true);
    connStatus.textContent = '接続していません';
  }
}

async function disconnectSerial() {
  keepReading = false;
  try {
    if (reader) { await reader.cancel(); reader.releaseLock(); reader = null; }
    if (writer) { writer.releaseLock(); writer = null; }
    if (port) { await port.close(); port = null; }
    connStatus.textContent = '接続していません';
  } catch (error) {
    appendSerial('切断エラー: ' + error + '\n', true);
    connStatus.textContent = '接続していません';
  }
}

async function readLoop() {
  const decoder = new TextDecoderStream();
  port.readable.pipeTo(decoder.writable);
  reader = decoder.readable.getReader();
  try {
    while (keepReading) {
      const result = await reader.read();
      if (result.done) break;
      if (result.value) appendSerial(result.value);
    }
  } catch (error) {
    appendSerial('読み取りエラー: ' + error + '\n', true);
  }
}

function waitForString(pattern, timeout = 3000) {
  return new Promise((resolve, reject) => {
    if (serialBuffer.includes(pattern)) { resolve(serialBuffer); return; }
    const timer = setTimeout(() => reject(new Error('timeout')), timeout);
    waiters.push({ pattern, resolve: value => { clearTimeout(timer); resolve(value); } });
  });
}

function escapeHtml(text) { return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function renderHistory() {
  const container = document.getElementById('historyContainer');
  container.innerHTML = '';
  history.forEach(entry => {
    const item = document.createElement('div');
    item.className = 'history-entry';
    const header = document.createElement('div');
    header.className = 'history-header';
    const toggle = document.createElement('div');
    toggle.className = 'history-toggle';
    toggle.textContent = '∨';
    const title = document.createElement('div');
    title.textContent = '送信 #' + entry.index;
    header.append(toggle, title);
    const body = document.createElement('div');
    body.className = 'history-body';
    body.textContent = entry.content;
    header.addEventListener('click', () => {
      const opened = body.style.display === 'block';
      body.style.display = opened ? 'none' : 'block';
      toggle.textContent = opened ? '∨' : '∧';
    });
    item.append(header, body);
    container.appendChild(item);
  });
}

function finalizeCurrentSession() {
  if (!currentSession) return;
  history.push({ index: currentSession.index, content: serialBuffer.slice(currentSession.startIndex) });
  currentSession = null;
  renderHistory();
}

async function writeToSerial(text) {
  if (!port || !writer) { appendSerial('シリアルが未接続です。\n', true); return; }
  try { await writer.write(new TextEncoder().encode(text + '\n')); }
  catch (error) { appendSerial('書き込みエラー: ' + error + '\n', true); }
}

function getDisplayPattern() {
  return Array.from(document.querySelectorAll('.cell')).map(cell => cell.dataset.color !== '#000000' ? 1 : 0);
}

function getSelectedResolution() {
  const selected = document.querySelector('input[name="resolution"]:checked');
  return selected ? Number(selected.value) : 8;
}

function getPatternString() {
  const source = getDisplayPattern();
  const resolution = getSelectedResolution();
  const blockSize = 8 / resolution;
  const directPattern = [];

  // Always average directly from the original 8x8 pattern.
  for (let targetY = 0; targetY < resolution; targetY++) {
    for (let targetX = 0; targetX < resolution; targetX++) {
      let sum = 0;
      for (let offsetY = 0; offsetY < blockSize; offsetY++) {
        for (let offsetX = 0; offsetX < blockSize; offsetX++) {
          const sourceX = targetX * blockSize + offsetX;
          const sourceY = targetY * blockSize + offsetY;
          sum += source[sourceY * 8 + sourceX];
        }
      }
      directPattern.push(sum / (blockSize * blockSize) > 0.5 ? 1 : 0);
    }
  }

  const transmission = [];
  for (let displayY = 0; displayY < 8; displayY++) {
    for (let displayX = 0; displayX < 8; displayX++) {
      const targetX = Math.floor(displayX / blockSize);
      const targetY = Math.floor(displayY / blockSize);
      transmission.push(directPattern[targetY * resolution + targetX]);
    }
  }
  return transmission.join('');
}

function updatePreview() {
  previewText.textContent = (getPatternString().match(/.{1,8}/g) || []).join(' ');
}

function createMatrix() {
  for (let index = 0; index < 64; index++) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.dataset.color = '#000000';
    cell.addEventListener('click', () => {
      const nextColor = cell.dataset.color === selectedColor ? '#000000' : selectedColor;
      cell.dataset.color = nextColor;
      cell.style.backgroundColor = nextColor;
      updatePreview();
    });
    matrix.appendChild(cell);
  }
}

function createPalette() {
  colors.forEach(color => {
    const button = document.createElement('button');
    button.className = 'color-btn';
    button.style.backgroundColor = color;
    button.addEventListener('click', () => selectColor(color, button));
    palette.appendChild(button);
  });
}

function selectColor(color, button) {
  const oldColor = selectedColor;
  selectedColor = color;
  document.querySelectorAll('.color-btn').forEach(item => item.classList.remove('active'));
  button.classList.add('active');
  document.querySelectorAll('.cell').forEach(cell => {
    if (cell.dataset.color === oldColor) {
      cell.dataset.color = color;
      cell.style.backgroundColor = color;
    }
  });
  updatePreview();
}

async function sendPattern() {
  const pattern = getPatternString();
  finalizeCurrentSession();
  clearSerial();
  serialBuffer = '';
  currentSession = { index: history.length + 1, startIndex: 0 };
  appendSerial('> ok?\n');
  await writeToSerial('ok?');
  try {
    await waitForString('OK!');
    appendSerial('[ハンドシェイク OK!] 送信を続行します\n');
  } catch (error) {
    appendSerial('[ハンドシェイク失敗] ArduinoからOK!が返りませんでした\n', true);
    finalizeCurrentSession();
    return;
  }
  appendSerial('> ' + pattern + '\n');
  await writeToSerial(pattern);
}

connectBtn.addEventListener('click', () => port ? disconnectSerial() : connectSerial());
disconnectBtn.addEventListener('click', disconnectSerial);
sendPatternBtn.addEventListener('click', sendPattern);
clearSerialBtn.addEventListener('click', clearSerial);
patternClearBtn.addEventListener('click', () => {
  document.querySelectorAll('.cell').forEach(cell => { cell.dataset.color = '#000000'; cell.style.backgroundColor = '#000000'; });
  updatePreview();
});
resolutionInputs.forEach(input => input.addEventListener('change', updatePreview));

createMatrix();
createPalette();
selectColor(selectedColor, palette.children[0]);
updatePreview();
