// Serve the real UI modules with only the SillyTavern i18n bridge mocked.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const run = promisify(execFile);
const fixture = process.argv[2] || 'extblocks-prompts.html';
if (!/^[a-z0-9-]+\.html$/.test(fixture)) throw new Error('Invalid fixture name');
const root = fileURLToPath(new URL('../', import.meta.url));
const translations = JSON.parse(await readFile(new URL('../i18n/ru-ru.json', import.meta.url), 'utf8'));
let browser;
for (const candidate of [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean)) {
    try { await access(candidate); browser = candidate; break; } catch { /* next */ }
}
if (!browser) throw new Error('Set CHROME_PATH to Chromium.');
const server = createServer(async (req, res) => {
    try {
        const pathname = decodeURIComponent(new URL(req.url, 'http://local.test').pathname);
        if (pathname === '/i18n.js') {
            res.setHeader('Content-Type', 'text/javascript');
            res.end(`const dictionary=${JSON.stringify(translations)}; export function t(parts,...values){const key=parts.reduce((out,part,i)=>out+part+(i<values.length?'$'+'{'+i+'}':''),'');return (dictionary[key]||key).replace(/\$\{(\d+)\}/g,(_,i)=>String(values[i]??''));} export const translate=key=>dictionary[key]||key;`);
            return;
        }
        const path = resolve(root, '.' + pathname);
        if (!path.startsWith(root)) { res.writeHead(403).end(); return; }
        res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' })[extname(path)] || 'application/octet-stream');
        res.end(await readFile(path));
    } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
    for (const size of ['1280,900', '390,844', '320,650', '844,430']) {
        const profile = await mkdtemp(join(tmpdir(), 'iig-extblocks-test-'));
        const { stdout } = await run(browser, ['--headless', '--disable-gpu', '--no-first-run', '--disable-extensions',
            `--user-data-dir=${profile}`, `--window-size=${size}`, '--virtual-time-budget=1500', '--dump-dom',
            `http://127.0.0.1:${server.address().port}/tests/${fixture}?panelWidth=${size.split(',')[0]}`],
        { windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
        const result = stdout.match(/<pre id="result">([^<]+)<\/pre>/)?.[1];
        if (!result?.startsWith('PASS:')) throw new Error(`${size}: ${result || 'missing browser result'}`);
        console.log(`${size}: ${result}`);
    }
} finally {
    server.closeAllConnections();
    server.close();
}
