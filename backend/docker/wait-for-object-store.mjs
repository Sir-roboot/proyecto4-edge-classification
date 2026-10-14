import net from 'node:net';

/**
 * Espera a que el endpoint del object store acepte conexiones TCP.
 *
 * Se usa solo en local (MinIO): la URL del endpoint llega como argumento y se
 * parsea aquí, así el entrypoint no necesita variables extra. En AWS no hay
 * endpoint ni host que esperar, por lo que este script no se invoca.
 */

const [endpointUrl] = process.argv.slice(2);
const maxAttempts = 60;
const delayMs = 2000;

if (!endpointUrl) {
  console.error('[wait-for-object-store] falta OBJECT_STORE_ENDPOINT_URL.');
  process.exit(1);
}

let host;
let port;
try {
  const url = new URL(endpointUrl);
  host = url.hostname;
  port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
} catch {
  console.error(`[wait-for-object-store] URL inválida: ${endpointUrl}`);
  process.exit(1);
}

function tryConnect() {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port }, () => {
      socket.end();
      resolve();
    });
    socket.setTimeout(2000);
    socket.on('error', reject);
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('timeout'));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await tryConnect();
      console.log(`[wait-for-object-store] ${host}:${port} listo (intento ${attempt}).`);
      return;
    } catch {
      console.log(
        `[wait-for-object-store] esperando ${host}:${port}... (intento ${attempt}/${maxAttempts})`,
      );
      await sleep(delayMs);
    }
  }
  console.error(`[wait-for-object-store] ${host}:${port} no respondió tras ${maxAttempts} intentos.`);
  process.exit(1);
}

main();
