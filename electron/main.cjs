const { app, BrowserWindow, ipcMain, shell } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
};

// In production the built assets sit next to this file inside the asar/resources.
const distDir = path.join(__dirname, '..', 'dist');
const dataFileName = 'workspace.json';
let workspaceWriteQueue = Promise.resolve();

function getWorkspacePaths() {
  const storagePath = path.join(app.getPath('userData'), 'data');
  return {
    storagePath,
    dataFilePath: path.join(storagePath, dataFileName),
  };
}

async function ensureWorkspaceDir() {
  const { storagePath } = getWorkspacePaths();
  await fs.promises.mkdir(storagePath, { recursive: true });
}

async function readWorkspaceFile() {
  const { dataFilePath } = getWorkspacePaths();
  try {
    const content = await fs.promises.readFile(dataFilePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeWorkspaceFile(data) {
  await ensureWorkspaceDir();
  const { storagePath, dataFilePath } = getWorkspacePaths();
  const tempPath = path.join(storagePath, `${dataFileName}.${process.pid}.tmp`);
  await fs.promises.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8');
  await fs.promises.rename(tempPath, dataFilePath);
}

function queueWorkspaceWrite(data) {
  workspaceWriteQueue = workspaceWriteQueue.then(
    () => writeWorkspaceFile(data),
    () => writeWorkspaceFile(data),
  );
  return workspaceWriteQueue;
}

ipcMain.handle('corpseal:read-app-data', async () => {
  await ensureWorkspaceDir();
  return readWorkspaceFile();
});

ipcMain.handle('corpseal:write-app-data', async (_event, data) => {
  await queueWorkspaceWrite(data);
  return { ok: true };
});

ipcMain.handle('corpseal:get-storage-info', async () => {
  await ensureWorkspaceDir();
  return getWorkspacePaths();
});

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
        let filePath = path.normalize(path.join(distDir, urlPath));
        // Prevent path traversal outside distDir.
        if (!filePath.startsWith(distDir)) {
          res.writeHead(403);
          res.end('Forbidden');
          return;
        }
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          filePath = path.join(distDir, 'index.html');
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        fs.createReadStream(filePath).pipe(res);
      } catch (err) {
        res.writeHead(500);
        res.end(String(err));
      }
    });
    server.listen(0, '127.0.0.1', () => {
      resolve(server.address().port);
    });
  });
}

async function createWindow() {
  const port = await startServer();
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: 'CorpSeals',
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  // Open external links in the system browser instead of inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.loadURL(`http://127.0.0.1:${port}/`);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
