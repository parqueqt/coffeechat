// 로컬 미리보기. public/ 정적 파일과 api/ 의 실제 핸들러를 그대로 띄운다.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");
const PUBLIC_DIR = join(ROOT, "public");
const PORT = Number(process.env.PORT || 3000);
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

async function handleApi(req, res, pathname) {
  const file = join(ROOT, `${normalize(pathname)}.js`);
  if (!file.startsWith(join(ROOT, "api") + sep)) return send(res, 404, "Not found");
  const mod = await import(pathToFileURL(file).href).catch(() => null);
  const handler = mod?.[req.method];
  if (!handler) return send(res, mod ? 405 : 404, "Not handled");

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const response = await handler(
    new Request(`http://localhost:${PORT}${req.url}`, {
      method: req.method,
      headers: req.headers,
      body: hasBody ? Buffer.concat(chunks) : undefined,
    })
  );
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

async function handleStatic(res, pathname) {
  const relative = normalize(pathname === "/" ? "/index.html" : pathname);
  const file = join(PUBLIC_DIR, relative);
  if (!file.startsWith(PUBLIC_DIR + sep)) return send(res, 404, "Not found");
  const body = await readFile(file).catch(() => null);
  if (!body) return send(res, 404, "Not found");
  res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
  res.end(body);
}

function send(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  const work = pathname.startsWith("/api/") ? handleApi(req, res, pathname) : handleStatic(res, pathname);
  work.catch((err) => {
    console.error(err);
    send(res, 500, "Server error");
  });
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
