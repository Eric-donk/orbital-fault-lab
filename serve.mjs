import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const types = {
  "index.html": "text/html; charset=utf-8",
  "site.css": "text/css; charset=utf-8",
  "app.mjs": "text/javascript; charset=utf-8",
  "model.mjs": "text/javascript; charset=utf-8",
  "orbit.png": "image/png",
};

createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  const name = pathname === "/" ? "index.html" : pathname.slice(1);
  if (!Object.hasOwn(types, name)) {
    response.writeHead(404).end();
    return;
  }
  try {
    const body = await readFile(new URL(name, import.meta.url));
    response.writeHead(200, { "Content-Type": types[name] }).end(body);
  } catch (error) {
    response.writeHead(error.code === "ENOENT" ? 404 : 500).end();
  }
}).listen(4173, "127.0.0.1", () => {
  process.stdout.write("http://127.0.0.1:4173\n");
});
