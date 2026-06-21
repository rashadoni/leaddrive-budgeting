/**
 * Single source of truth for the import-upload size cap.
 *
 * Why this exists: the cap used to be a private `const MAX_FILE_SIZE = 10*1024*
 * 1024` copy-pasted into ~8 import routes (classify / analyze / apply, single +
 * multi). They drifted and a large file would clear one route then 413 at the
 * next ("passes step 1, blocked at step 2" — hit live 2026-06-21 with a 26MB
 * Reporting 2026.xlsx). Every import route now imports THIS, so the whole
 * pipeline accepts the same size end-to-end.
 *
 * MUST stay ≤ `experimental.proxyClientMaxBodySize` in next.config.ts (the Next
 * 16 proxy buffers the request body to that cap; a larger upload is silently
 * TRUNCATED before any `file.size` check can run — an opaque 500). Keep the
 * proxy cap comfortably above this so a max-size file plus its multipart
 * boundaries/form-fields still fits in the proxy buffer.
 *
 * Enterprise reporting packs legitimately reach 26MB+ (mostly pivot-cache /
 * data-model sheets). 64MB gives ~2.5x headroom over the largest real file
 * seen. Files beyond this get a clean 413; truly huge files need a
 * streaming-to-disk redesign rather than formData() buffering.
 */
export const MAX_IMPORT_UPLOAD_BYTES = 64 * 1024 * 1024

/** Human-readable cap (MB) for error messages / UI copy. */
export const MAX_IMPORT_UPLOAD_MB = MAX_IMPORT_UPLOAD_BYTES / 1024 / 1024
