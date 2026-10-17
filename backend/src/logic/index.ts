/**
 * Punto de entrada de la capa LOGIC.
 *
 * Responsabilidad: reglas de negocio, validaciones y (en fases
 * posteriores) procesamiento de imágenes/anotaciones.
 *
 * Regla de arquitectura: es la única capa que puede importar de `data`.
 * No debe contener código específico de UI (Express, HTTP, etc.).
 */

// P4-2.1 — Autenticación de la ingesta edge.
//
// Vive en `config/` porque define cuáles son las credenciales del proceso, no
// una regla de negocio del dominio; se reexporta desde Logic para que la capa
// UI tenga un único punto de importación (regla de arquitectura: la UI no
// importa `data`, y aquí tampoco se toca `data`).
export type { EdgeIngestAuthResult } from '../config/edge-auth.js';
export {
  authenticateEdgeIngest,
  EDGE_INGEST_TOKEN_MIN_LENGTH,
  parseBearerToken,
  tokensMatch,
} from '../config/edge-auth.js';
export type { AnnotationBoxInput } from './annotation.service.js';
export {
  createAnnotationForImage,
  deleteAnnotation,
  getAnnotationsForImage,
  updateAnnotation,
} from './annotation.service.js';
// Esquemas de la frontera HTTP (SPEC-VALID-001): la UI los usa para validar
// route params y query params antes de invocar a los servicios de arriba.
export type { ImageSearchInput } from './annotation.validation.js';
export { idParamSchema, imageSearchSchema } from './annotation.validation.js';
export { getCategories } from './category.service.js';
// Exportación COCO (SPEC-COCO-001)
export type {
  CocoAnnotation,
  CocoCategory,
  CocoDataset,
  CocoImage,
  CocoSourceData,
} from './coco-export.builder.js';
export { buildCocoDataset } from './coco-export.builder.js';
export { exportCocoDataset } from './coco-export.service.js';
// Dashboard (SPEC-DASH-001)
export type {
  AnnotationProgress,
  DashboardSourceData,
  DashboardSummary,
  ObjectPerClass,
  RecentUpload,
} from './dashboard.builder.js';
export { buildDashboardSummary, buildThumbnailUrl } from './dashboard.builder.js';
export { getDashboardSummary } from './dashboard.service.js';
// P4-2.1 — Ingesta de capturas edge (contrato docs/EDGE_CAPTURE_CONTRACT.md).

export {
  buildEdgeCaptureImageKey,
  createEdgeCaptureService,
  getEdgeCaptureDetail,
  getEdgeCaptureImage,
  getEdgeCaptureList,
  ingestEdgeCapture,
  toEdgeCaptureResponse,
} from './edge-capture.service.js';
export {
  computeImageSha256,
  EDGE_CAPTURE_MAX_IMAGE_BYTES,
  EDGE_CAPTURE_MAX_METADATA_BYTES,
  type EdgeCaptureCrop,
  type EdgeCaptureMetadata,
  edgeCaptureCropSchema,
  edgeCaptureMetadataSchema,
  edgeCaptureMimeSchema,
  validateEdgeCaptureImage,
  validateEdgeCaptureMetadata,
  validateImageSha256,
} from './edge-capture.validation.js';
// Errores tipados: la capa UI los mapea a códigos HTTP (SPEC-VALID-001 / P4-2.1).
export {
  EdgeCaptureBadRequestError,
  EdgeCaptureConflictError,
  EdgeCaptureError,
  EdgeCapturePayloadTooLargeError,
  EdgeCaptureUnprocessableEntityError,
  EdgeCaptureUnsupportedMediaTypeError,
  NotFoundError,
  ValidationError,
} from './errors.js';
export {
  getEvaluation,
  getPredictions,
  getPredictionsCsv,
  getSelection,
  getTestCropImage,
} from './evaluation.service.js';
export {
  getExperiment,
  getRunCurves,
  listExperiments,
} from './experiments.service.js';
export type { HealthStatus } from './health.service.js';
export { checkHealth } from './health.service.js';
export type { ImageFile } from './image-file.service.js';
export { getImageFile } from './image-file.service.js';
export type {
  ImageSearchItem,
  SearchImagesInput,
  SearchImagesResult,
  SearchResultCategory,
} from './image-search.service.js';
export { searchImages } from './image-search.service.js';
export { setImageStatus } from './image-status.service.js';
export { deleteImage, uploadImage } from './image-upload.service.js';
export type { InferenceFile, InferenceResult, QueuedInferenceResult } from './inference.service.js';
export { inferCrop, inferImage, queueCrop, queueImage } from './inference.service.js';
export { inferenceCropSchema } from './inference.validation.js';
export {
  downloadSelectedModel,
  getSelectedModel,
  listModels,
  listVersions,
  selectModel,
} from './models.service.js';
// Contratos de Data Quality: solo lectura (SPEC-PIPE-001)
export {
  getQualityReport,
  getSplitReport,
  getVersionHistory,
} from './pipeline-contracts.service.js';
// Política editable de la Quality Gate (SPEC-PIPE-001)
export type {
  QualityPolicyCheck,
  QualityPolicyEdit,
  QualityPolicyFile,
  QualityPolicyUpdateInput,
  Severity as QualityPolicySeverity,
} from './quality-policy.builder.js';
export { applyQualityPolicyUpdate } from './quality-policy.builder.js';
export { getQualityPolicy, updateQualityPolicy } from './quality-policy.service.js';
export type { QualityPolicyUpdateBody } from './quality-policy.validation.js';
export { qualityPolicyUpdateSchema } from './quality-policy.validation.js';
// Parser de operadores de búsqueda (SPEC-SEARCH-001)
export type { ParsedSearchQuery, SearchOperator } from './search-query.parser.js';
export { parseSearchQuery } from './search-query.parser.js';
export { initializeApplication } from './startup.service.js';
export type { TrainingConfig } from './training.service.js';
export {
  createTrainingRun,
  getLatestTrainingRun,
  getTrainingProvenance,
  getTrainingReleases,
  getTrainingRun,
  TrainingRejectedError,
  trainingConfigSchema,
} from './training.service.js';
