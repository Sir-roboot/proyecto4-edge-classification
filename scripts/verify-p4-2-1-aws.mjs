#!/usr/bin/env node
/**
 * P4-2.1 — Verificación de la ingesta edge contra un endpoint YA DESPLEGADO.
 *
 * Reproduce los tres envíos del contrato (`docs/EDGE_CAPTURE_CONTRACT.md`,
 * sección 6) contra el `POST /api/edge-captures` de un host real:
 *
 *   1. `capture_id` nuevo + bytes reales             → se espera `201`.
 *   2. Reintento idéntico (mismos bytes y metadata)  → se espera `200`.
 *   3. Mismo `capture_id` con otra `confidence`      → se espera `409`.
 *
 * Después valida en las respuestas positivas que `capture_id`, `image_sha256`
 * e `image_key` coincidan con lo enviado, y emite un resumen JSON **sin
 * secretos** por `stdout`.
 *
 * Solo usa módulos integrados de Node 20 (`node:crypto`, `node:fs/promises`,
 * `node:path`, `node:process`) y los globales `fetch`, `FormData`, `Blob` y
 * `AbortSignal`. No importa dependencias del backend para poder correr desde
 * un clon limpio contra AWS sin instalar nada.
 *
 * El token (`EDGE_INGEST_TOKEN`) viaja únicamente en el encabezado
 * `Authorization: Bearer …`: nunca se imprime, ni en el resumen ni en los
 * errores.
 *
 * Variables de entorno obligatorias:
 *   - `EDGE_API_BASE_URL`  raíz del servicio (por ejemplo `https://host` o
 *                          `https://host/api`). El script agrega la ruta del
 *                          contrato `/api/edge-captures` cuando falta.
 *   - `EDGE_INGEST_TOKEN`  token compartido (mínimo 32 caracteres en real).
 *   - `EDGE_TEST_IMAGE`    ruta a una imagen real `image/jpeg` o `image/png`,
 *                          de máximo 10 MiB.
 *
 * Variables de entorno opcionales:
 *   - `EDGE_DEVICE_ID`     `device_id` de la metadata (por defecto
 *                          `p4-2-1-verifier`).
 *   - `EDGE_MODEL_VERSION` `model_version` de la metadata.
 *   - `EDGE_TIMEOUT_MS`    tiempo de espera por petición (por defecto 15000).
 *
 * Uso (bash):
 *   EDGE_API_BASE_URL="https://<host>" \
 *   EDGE_INGEST_TOKEN="<token fuera de Git>" \
 *   EDGE_TEST_IMAGE="pipeline/reports/classifier/confusion_matrix.png" \
 *   node scripts/verify-p4-2-1-aws.mjs
 *
 * Uso (PowerShell):
 *   $env:EDGE_API_BASE_URL="https://<host>"
 *   $env:EDGE_INGEST_TOKEN="<token fuera de Git>"
 *   $env:EDGE_TEST_IMAGE="pipeline/reports/classifier/confusion_matrix.png"
 *   node scripts/verify-p4-2-1-aws.mjs
 *
 * Códigos de salida:
 *   0  las tres comprobaciones pasaron.
 *   1  falló una comprobación (status, `capture_id`, hash, `image_key`).
 *   2  uso inválido (falta una variable, la imagen no existe/está vacía/
 *      excede 10 MiB o no es JPEG/PNG).
 *   3  error de red o tiempo de espera agotado.
 */

import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import process from "node:process";

/** Ruta del contrato de ingesta edge. */
const CAPTURE_PATH = "/api/edge-captures";
/** Límite de la parte `image` fijado por el contrato (10 MiB). */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** Tiempo de espera por petición cuando no se configura `EDGE_TIMEOUT_MS`. */
const DEFAULT_TIMEOUT_MS = 15_000;
/** Confianza base del evento; el tercer envío la cambia para forzar el 409. */
const BASE_CONFIDENCE = 0.5;
const CONFLICT_CONFIDENCE = 0.6;
/** Clase congelada del Proyecto 3 usada como predicción del fixture. */
const PREDICTED_CLASS = "person";

const EXIT_OK = 0;
const EXIT_CHECK_FAILED = 1;
const EXIT_USAGE = 2;
const EXIT_TRANSPORT = 3;

/** Error de uso/configuración: no llega a emitir un resumen de red. */
class UsageError extends Error {}

/** Error de red o de tiempo de espera: sí emite un resumen parcial. */
class TransportError extends Error {}

/** Ayuda de línea de comandos. */
function printUsage() {
	process.stdout.write(
		"Uso: node scripts/verify-p4-2-1-aws.mjs [--report <ruta>]\n\n" +
			"Requiere EDGE_API_BASE_URL, EDGE_INGEST_TOKEN y EDGE_TEST_IMAGE.\n" +
			"--report <ruta>  guarda el resumen JSON (sin secretos) en esa ruta.\n",
	);
}

/** Parsea los argumentos opcionales; solo `--help` y `--report` están definidos. */
function parseArgs(argv) {
	const options = { report: null, help: false };
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--help" || arg === "-h") {
			options.help = true;
		} else if (arg === "--report") {
			options.report = argv[index + 1] ?? null;
			index += 1;
		} else if (arg.startsWith("--report=")) {
			options.report = arg.slice("--report=".length);
		} else {
			throw new UsageError(`Argumento no reconocido: ${arg}.`);
		}
	}
	if (options.report !== null && options.report.trim().length === 0) {
		throw new UsageError("--report necesita una ruta no vacía.");
	}
	return options;
}

/** Entero positivo de una variable de entorno, o el valor por defecto. */
function readPositiveInt(raw, fallback, name) {
	if (raw === undefined || raw.trim().length === 0) {
		return fallback;
	}
	const value = Number(raw);
	if (!Number.isInteger(value) || value <= 0) {
		throw new UsageError(
			`${name} debe ser un entero positivo de milisegundos.`,
		);
	}
	return value;
}

/** Lee y valida las variables de entorno obligatorias y opcionales. */
function readConfig(env) {
	const baseUrl = (env.EDGE_API_BASE_URL ?? "").trim();
	const token = env.EDGE_INGEST_TOKEN ?? "";
	const imagePath = (env.EDGE_TEST_IMAGE ?? "").trim();

	const missing = [];
	if (baseUrl.length === 0) missing.push("EDGE_API_BASE_URL");
	if (token.length === 0) missing.push("EDGE_INGEST_TOKEN");
	if (imagePath.length === 0) missing.push("EDGE_TEST_IMAGE");
	if (missing.length > 0) {
		throw new UsageError(
			`Faltan variables de entorno obligatorias: ${missing.join(", ")}.`,
		);
	}

	return {
		baseUrl,
		token,
		imagePath: resolve(process.cwd(), imagePath),
		deviceId: (env.EDGE_DEVICE_ID ?? "").trim() || "p4-2-1-verifier",
		modelVersion:
			(env.EDGE_MODEL_VERSION ?? "").trim() ||
			"p4-2-1-verifier+sha256:unspecified",
		timeoutMs: readPositiveInt(
			env.EDGE_TIMEOUT_MS,
			DEFAULT_TIMEOUT_MS,
			"EDGE_TIMEOUT_MS",
		),
	};
}

/**
 * Construye la URL absoluta del endpoint. Acepta la raíz del host
 * (`https://host`) o una base que ya termine en `/api`; en cualquier caso
 * apunta a `POST /api/edge-captures`.
 */
function buildEndpoint(baseUrl) {
	const base = baseUrl.replace(/\/+$/, "");
	return base.endsWith("/api")
		? `${base}/edge-captures`
		: `${base}${CAPTURE_PATH}`;
}

/** SHA-256 en hexadecimal minúsculas (exactamente lo que exige el contrato). */
function sha256Hex(buffer) {
	return createHash("sha256").update(buffer).digest("hex");
}

/** Comprueba que un valor sea un objeto JSON (no null ni array). */
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Extensión del objeto determinista que usa el backend según el MIME. */
function extensionForMime(mimeType) {
	return mimeType === "image/png" ? "png" : "jpg";
}

/**
 * Detecta el MIME real por firma de bytes y cae a la extensión como respaldo.
 * Devuelve `null` si no es un JPEG ni un PNG reconocible.
 */
function detectImageMime(buffer, filePath) {
	if (
		buffer.length >= 8 &&
		buffer[0] === 0x89 &&
		buffer[1] === 0x50 &&
		buffer[2] === 0x4e &&
		buffer[3] === 0x47 &&
		buffer[4] === 0x0d &&
		buffer[5] === 0x0a &&
		buffer[6] === 0x1a &&
		buffer[7] === 0x0a
	) {
		return "image/png";
	}
	if (
		buffer.length >= 3 &&
		buffer[0] === 0xff &&
		buffer[1] === 0xd8 &&
		buffer[2] === 0xff
	) {
		return "image/jpeg";
	}

	const extension = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
	if (extension === ".png") return "image/png";
	if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
	return null;
}

/**
 * Lee los bytes reales de la imagen del fixture y falla temprano si no es
 * utilizable por el contrato (ausente, vacía o mayor a 10 MiB).
 */
async function readImage(imagePath) {
	let buffer;
	try {
		buffer = await readFile(imagePath);
	} catch {
		throw new UsageError(`No se pudo leer EDGE_TEST_IMAGE en ${imagePath}.`);
	}
	if (buffer.length === 0) {
		throw new UsageError(`EDGE_TEST_IMAGE está vacía (${imagePath}).`);
	}
	if (buffer.length > MAX_IMAGE_BYTES) {
		throw new UsageError(
			`EDGE_TEST_IMAGE pesa ${buffer.length} bytes y excede el límite de ${MAX_IMAGE_BYTES} bytes (10 MiB).`,
		);
	}
	return buffer;
}

/**
 * Envía un evento con `FormData` (metadata como campo de texto, imagen como
 * `Blob` de bytes reales) y devuelve status + cuerpo JSON. Lanza
 * `TransportError` en fallo de red o tiempo de espera agotado; nunca incluye el
 * token en el mensaje.
 */
async function postCapture({
	endpoint,
	token,
	metadata,
	imageBuffer,
	mimeType,
	filename,
	timeoutMs,
}) {
	const form = new FormData();
	// La parte `metadata` debe ser un campo de texto (no un Blob con filename):
	// así Multer la coloca en `req.body.metadata`, exactamente como el handler.
	form.append("metadata", JSON.stringify(metadata));
	form.append("image", new Blob([imageBuffer], { type: mimeType }), filename);

	let response;
	try {
		response = await fetch(endpoint, {
			method: "POST",
			headers: { Authorization: `Bearer ${token}` },
			body: form,
			signal: AbortSignal.timeout(timeoutMs),
		});
	} catch (error) {
		const timedOut =
			error instanceof Error &&
			(error.name === "TimeoutError" ||
				(error.cause instanceof Error && error.cause.name === "TimeoutError"));
		if (timedOut) {
			throw new TransportError(
				`Tiempo de espera agotado tras ${timeoutMs} ms al llamar a ${endpoint}.`,
			);
		}
		const reason = error instanceof Error ? error.message : String(error);
		throw new TransportError(`Fallo de red al llamar a ${endpoint}: ${reason}`);
	}

	const raw = await response.text();
	let body = null;
	if (raw.length > 0) {
		try {
			body = JSON.parse(raw);
		} catch {
			body = null;
		}
	}
	return { status: response.status, body };
}

/**
 * Compara una respuesta positiva con lo enviado. Registra el resultado de cada
 * verificación en `checks` (nombres estables, útiles para el resumen).
 */
function assertPositiveResponse(checks, label, response, expected) {
	const { captureId, imageSha256, imageKey } = expected;
	const body = response.body;
	checks[`${label}_response_ok`] = response.status === expected.status;
	checks[`${label}_capture_id_matches`] =
		isRecord(body) && body.capture_id === captureId;
	checks[`${label}_image_sha256_matches`] =
		isRecord(body) && body.image_sha256 === imageSha256;
	checks[`${label}_image_key_matches`] =
		isRecord(body) && body.image_key === imageKey;
}

/**
 * Ejecuta el recorrido completo (tres envíos) y devuelve el resumen y el
 * código de salida. Nunca devuelve el token: el resumen solo describe lo
 * enviado y lo observado.
 */
async function runCheck(config) {
	const endpoint = buildEndpoint(config.baseUrl);
	const captureId = randomUUID();
	const imageBuffer = await readImage(config.imagePath);
	const mimeType = detectImageMime(imageBuffer, config.imagePath);
	if (mimeType === null) {
		throw new UsageError(
			`EDGE_TEST_IMAGE no es image/jpeg ni image/png (${config.imagePath}).`,
		);
	}

	const imageSha256 = sha256Hex(imageBuffer);
	const imageKey = `edge-captures/${captureId}/${imageSha256}.${extensionForMime(mimeType)}`;

	// El mismo evento se reutiliza en el reintento; `captured_at` se fija una vez
	// para que el segundo envío sea idéntico byte a byte en su metadata.
	const metadata = {
		capture_id: captureId,
		captured_at: new Date().toISOString(),
		device_id: config.deviceId,
		model_version: config.modelVersion,
		predicted_class: PREDICTED_CLASS,
		confidence: BASE_CONFIDENCE,
		image_sha256: imageSha256,
	};

	const summary = {
		base_url: config.baseUrl.replace(/\/+$/, ""),
		endpoint,
		capture_id: captureId,
		image_sha256: imageSha256,
		image_key: null,
		image: {
			file: basename(config.imagePath),
			mime_type: mimeType,
			size_bytes: imageBuffer.length,
		},
		request: {
			device_id: config.deviceId,
			model_version: config.modelVersion,
			predicted_class: PREDICTED_CLASS,
			base_confidence: BASE_CONFIDENCE,
			conflict_confidence: CONFLICT_CONFIDENCE,
			timeout_ms: config.timeoutMs,
		},
		status_codes: { created: null, idempotent_repeat: null, conflict: null },
		checks: {},
		passed: false,
		generated_at: new Date().toISOString(),
	};

	const transport = {
		endpoint,
		token: config.token,
		imageBuffer,
		mimeType,
		filename: basename(config.imagePath),
		timeoutMs: config.timeoutMs,
	};

	try {
		const created = await postCapture({ ...transport, metadata });
		summary.status_codes.created = created.status;
		assertPositiveResponse(summary.checks, "first", created, {
			status: 201,
			captureId,
			imageSha256,
			imageKey,
		});
		summary.image_key =
			isRecord(created.body) && typeof created.body.image_key === "string"
				? created.body.image_key
				: null;

		const repeated = await postCapture({ ...transport, metadata });
		summary.status_codes.idempotent_repeat = repeated.status;
		assertPositiveResponse(summary.checks, "repeat", repeated, {
			status: 200,
			captureId,
			imageSha256,
			imageKey,
		});
		summary.checks.repeat_reuses_same_image_key =
			isRecord(repeated.body) && repeated.body.image_key === summary.image_key;
		if (summary.image_key === null && isRecord(repeated.body)) {
			summary.image_key =
				typeof repeated.body.image_key === "string"
					? repeated.body.image_key
					: null;
		}

		const conflict = await postCapture({
			...transport,
			metadata: { ...metadata, confidence: CONFLICT_CONFIDENCE },
		});
		summary.status_codes.conflict = conflict.status;
		summary.checks.conflict_response_ok = conflict.status === 409;
		summary.checks.conflict_reports_error =
			isRecord(conflict.body) &&
			typeof conflict.body.error === "string" &&
			conflict.body.error.length > 0;

		summary.passed = Object.values(summary.checks).every(Boolean);
		return { summary, exitCode: summary.passed ? EXIT_OK : EXIT_CHECK_FAILED };
	} catch (error) {
		if (error instanceof TransportError) {
			summary.error = error.message;
			summary.passed = false;
			return { summary, exitCode: EXIT_TRANSPORT };
		}
		throw error;
	}
}

/** Imprime el resumen JSON (sin secretos) y, si se pide, lo guarda en disco. */
async function emitSummary(summary, reportPath) {
	const text = `${JSON.stringify(summary, null, 2)}\n`;
	process.stdout.write(text);
	if (reportPath) {
		await writeFile(resolve(process.cwd(), reportPath), text, "utf8");
	}
}

/** Punto de entrada: parsea argumentos, corre la comprobación y resume. */
async function main(argv) {
	const options = parseArgs(argv);
	if (options.help) {
		printUsage();
		return EXIT_OK;
	}

	const config = readConfig(process.env);
	const { summary, exitCode } = await runCheck(config);
	await emitSummary(summary, options.report);

	// El resumen JSON va a stdout (parseable); los diagnósticos, a stderr.
	if (exitCode === EXIT_TRANSPORT && typeof summary.error === "string") {
		process.stderr.write(`${summary.error}\n`);
	} else if (exitCode === EXIT_CHECK_FAILED) {
		const failed = Object.entries(summary.checks)
			.filter(([, ok]) => !ok)
			.map(([name]) => name);
		process.stderr.write(`Comprobaciones fallidas: ${failed.join(", ")}\n`);
	}
	return exitCode;
}

try {
	process.exitCode = await main(process.argv.slice(2));
} catch (error) {
	if (error instanceof UsageError) {
		process.stderr.write(`Error de uso: ${error.message}\n`);
		process.exitCode = EXIT_USAGE;
	} else {
		const detail =
			error instanceof Error ? (error.stack ?? error.message) : String(error);
		process.stderr.write(`Error inesperado: ${detail}\n`);
		process.exitCode = EXIT_CHECK_FAILED;
	}
}
