const matrix = document.getElementById('matrix');
const palette = document.getElementById('palette');
const serialPanel = document.getElementById('serialPanel');
const sendPatternBtn = document.getElementById('sendPatternBtn');
const patternClearBtn = document.getElementById('patternClearBtn');
const clearSerialBtn = document.getElementById('clearSerialBtn');
const previewText = document.getElementById('previewText');
const pixelHighlight = document.getElementById('pixelHighlight');
const pixelDiagrams = document.querySelectorAll('.pixel-size-diagram');
const resolutionInputs = document.querySelectorAll('input[name="resolution"]');

let selectedColor = '#ff0000';
const colors = ['#ff0000', '#0000ff', '#00ff00', '#ffff00', '#ffffff'];
let port = null;
let reader = null;
let writer = null;
let readTask = null;
let keepReading = false;
let serialBuffer = '';
let serialReceiveCount = 0;
let lastSerialReceivedAt = 0;
const waiters = [];
let history = [];
let currentSession = null;

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

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
    throw new Error('このブラウザは Web Serial API をサポートしていません。');
  }
  port = await navigator.serial.requestPort();
  await port.open({ baudRate: 9600 });
  if (!port.readable || !port.writable) {
    throw new Error('シリアルポートの読み書きができません。');
  }
  writer = port.writable.getWriter();
  keepReading = true;
  readTask = readLoop();
  appendSerial('接続が完了しました\n');
  appendSerial('Arduinoの起動を待っています...\n');
  await delay(2000);
}

async function disconnectSerial() {
  keepReading = false;
  if (reader) {
    try {
      await reader.cancel();
    } catch (error) {
      appendSerial('読み取り停止エラー: ' + error + '\n', true);
    }
  }
  if (readTask) {
    await readTask;
    readTask = null;
  }
  if (writer) {
    writer.releaseLock();
    writer = null;
  }
  if (port) {
    try {
      await port.close();
    } catch (error) {
      appendSerial('切断エラー: ' + error + '\n', true);
    } finally {
      port = null;
    }
  }
}

async function readLoop() {
  const decoder = new TextDecoder();
  reader = port.readable.getReader();
  try {
    while (keepReading) {
      const result = await reader.read();
      if (result.done) break;
      if (result.value) {
        serialReceiveCount++;
        lastSerialReceivedAt = Date.now();
        appendSerial(decoder.decode(result.value, { stream: true }));
      }
    }
  } catch (error) {
    if (keepReading) appendSerial('読み取りエラー: ' + error + '\n', true);
  } finally {
    const remaining = decoder.decode();
    if (remaining) appendSerial(remaining);
    if (reader) {
      reader.releaseLock();
      reader = null;
    }
  }
}

function waitForString(pattern, timeout = 3000) {
  return new Promise((resolve, reject) => {
    if (serialBuffer.includes(pattern)) { resolve(serialBuffer); return; }
    const waiter = {
      pattern,
      resolve: value => {
        clearTimeout(timer);
        resolve(value);
      }
    };
    const timer = setTimeout(() => {
      const index = waiters.indexOf(waiter);
      if (index !== -1) waiters.splice(index, 1);
      reject(new Error(`Arduinoから「${pattern}」が返りませんでした（タイムアウト）。`));
    }, timeout);
    waiters.push(waiter);
  });
}

async function waitForSerialSilence(receiveCountAtStart, quietPeriod = 1500, maxWait = 60000) {
  const deadline = Date.now() + maxWait;
  while (Date.now() < deadline) {
    if (serialReceiveCount > receiveCountAtStart && Date.now() - lastSerialReceivedAt >= quietPeriod) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Arduinoからの応答が止まるのを確認できませんでした（60秒でタイムアウト）。');
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
  if (!port || !writer) throw new Error('シリアルポートに接続されていません。');
  try {
    await writer.write(new TextEncoder().encode(text + '\n'));
  } catch (error) {
    appendSerial('書き込みエラー: ' + error + '\n', true);
    throw error;
  }
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

  return directPattern.join('');
}

function updatePreview() {
  previewText.textContent = (getPatternString().match(/.{1,8}/g) || []).join(' ');
}

function updatePixelHighlight() {
  const blockSize = 8 / getSelectedResolution();
  const gridColor = selectedColor === '#ff0000' ? '#00ffff' : '#ff0000';
  pixelHighlight.style.setProperty('--grid-color', gridColor);
  pixelHighlight.replaceChildren();
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const cell = document.createElement('span');
      cell.className = 'pixel-highlight-cell';
      if (x % blockSize === 0) cell.style.borderLeft = '2px solid var(--grid-color)';
      if (y % blockSize === 0) cell.style.borderTop = '2px solid var(--grid-color)';
      if (x === 7) cell.style.borderRight = '2px solid var(--grid-color)';
      if (y === 7) cell.style.borderBottom = '2px solid var(--grid-color)';
      pixelHighlight.appendChild(cell);
    }
  }
}

function createPixelDiagrams() {
  pixelDiagrams.forEach(diagram => {
    const blockSize = Number(diagram.dataset.blockSize);
    diagram.style.setProperty('--grid-size', blockSize);
    for (let index = 0; index < blockSize * blockSize; index++) {
      const cell = document.createElement('span');
      cell.className = 'pixel-diagram-cell';
      diagram.appendChild(cell);
    }
  });
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
  updatePixelHighlight();
}

async function sendPattern() {
  const pattern = getPatternString();
  const resolution = getSelectedResolution();
  const sizeCommand = `size:${resolution}x${resolution}`;
  finalizeCurrentSession();
  clearSerial();
  serialBuffer = '';
  currentSession = { index: history.length + 1, startIndex: 0 };
  sendPatternBtn.disabled = true;
  try {
    await connectSerial();
    appendSerial('> ok?\n');
    await writeToSerial('ok?');
    await waitForString('OK!', 5000);
    appendSerial('[ハンドシェイク OK!] 送信を続行します\n');
    appendSerial('> ' + sizeCommand + '\n');
    await writeToSerial(sizeCommand);
    await waitForString('SIZE OK!', 5000);
    appendSerial('[解像度確認 OK!] ' + sizeCommand + '\n');
    appendSerial('> ' + pattern + '\n');
    const receiveCountAtStart = serialReceiveCount;
    await writeToSerial(pattern);
    appendSerial('Arduinoからの応答を待機しています...\n');
    await waitForSerialSilence(receiveCountAtStart);
    appendSerial('Arduinoからの受信が停止しました。切断します。\n');
    appendSerial('送信が完了しました\n');
  } catch (error) {
    appendSerial('送信エラー: ' + error.message + '\n', true);
  } finally {
    await disconnectSerial();
    finalizeCurrentSession();
    sendPatternBtn.disabled = false;
  }
}

sendPatternBtn.addEventListener('click', sendPattern);
clearSerialBtn.addEventListener('click', clearSerial);
patternClearBtn.addEventListener('click', () => {
  document.querySelectorAll('.cell').forEach(cell => { cell.dataset.color = '#000000'; cell.style.backgroundColor = '#000000'; });
  updatePreview();
});
resolutionInputs.forEach(input => input.addEventListener('change', () => {
  updatePreview();
  updatePixelHighlight();
}));

createMatrix();
createPalette();
selectColor(selectedColor, palette.children[0]);
updatePreview();
createPixelDiagrams();
updatePixelHighlight();
