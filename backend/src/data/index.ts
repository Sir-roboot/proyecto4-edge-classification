/**
 * Punto de entrada de la capa DATA.
 *
 * Maneja el acceso a MariaDB y al almacenamiento de archivos en un almacén
 * de objetos S3-compatible (MinIO en local, S3 en AWS).
 * Solo la capa Logic debe importar desde aquí.
 */
export { db, pool } from './db/client.js';
export type { Annotation, Category, EdgeCapture, Image, NewEdgeCapture } from './db/schema.js';
export * as schema from './db/schema.js';
export type { AnnotationWithCategory } from './repositories/annotation.repository.js';
export {
  countAnnotationsByImage,
  createAnnotationRow,
  deleteAnnotationRow,
  findAllAnnotationRows,
  findAnnotationById,
  listAnnotationsByImage,
  updateAnnotationRow,
} from './repositories/annotation.repository.js';
export { listCategories } from './repositories/category.repository.js';
export {
  findEdgeCaptureById,
  insertEdgeCapture,
  listEdgeCaptures,
} from './repositories/edge-capture.repository.js';
export type {
  ClassSearch,
  FindImagesOptions,
  FindImagesResult,
} from './repositories/image.repository.js';
export {
  countAllAnnotations,
  countAllCategories,
  countAnnotationsByCategory,
  countAnnotationsForImages,
  countImagesByStatus,
  createImageMetadata,
  deleteImageRow,
  findAllImages,
  findCategoriesForImages,
  findImageById,
  findImages,
  findRecentImages,
  updateImageStatus,
} from './repositories/image.repository.js';
// Funciones de almacenamiento en el object store (S3-compatible).
export {
  deleteImageObject,
  ensureObjectStoreBucket,
  getImageObjectStream,
  uploadImageObject,
} from './storage/object-store.storage.js';
