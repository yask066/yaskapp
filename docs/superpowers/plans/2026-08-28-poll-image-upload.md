# Poll Image Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users attach one validated image to a poll, store it safely in the existing S3-compatible storage, serve it through access-controlled API URLs, and display it in Flutter.

**Architecture:** Reuse the existing Fastify multipart and MinIO/S3 integration. `POST /polls` will accept multipart fields and an optional `image` file; the backend validates and normalizes the image before creating the poll, then removes the uploaded object if database creation fails. Poll responses expose `/media/polls/{pollId}` rather than a client-supplied storage key, and the Flutter create screen sends the selected image with `http.MultipartRequest`.

**Tech Stack:** Node.js 20, TypeScript, Fastify 5, `@fastify/multipart`, PostgreSQL/pg, AWS S3 SDK, `sharp`, Flutter/Dart, `image_picker`, `http`, Flutter test.

**Spec:** `docs/superpowers/specs/2026-08-28-poll-image-upload-design.md`

## Global Constraints

- A poll contains zero or one image.
- Accepted input types are JPEG, PNG, and WebP.
- Maximum request file size is 5 MiB.
- Animated images are rejected.
- Uploaded images are normalized to WebP by `sharp`; the original is not kept.
- The server generates the storage key; clients cannot choose `imageObjectKey`.
- Image retrieval applies the poll's visibility/access rules.
- Failed database creation removes the newly uploaded storage object.
- Existing avatar upload behavior must remain unchanged.

---

### Task 1: Create the poll-image validation and processing service

**Files:**
- Create: `services/api/src/modules/polls/poll-images.service.ts`
- Test: `services/api/src/modules/polls/poll-images.service.test.ts`

**Interfaces:**
- Consumes: `MultipartFile` from `@fastify/multipart`, `putObject`/`deleteObject` from `services/api/src/config/storage.ts`.
- Produces: `allowedPollImageMimeTypes`, `createPollImageObjectKey(authorId: string)`, and `processPollImage(authorId: string, part: MultipartFile): Promise<{ objectKey: string }>`.

- [ ] **Step 1: Write failing unit tests** for JPEG/PNG/WebP acceptance, signature mismatch rejection, animated PNG/WebP rejection, invalid image rejection, 5 MiB boundary behavior, normalized WebP upload, and generated keys matching `poll-images/{authorId}/{uuid}.webp`.
- [ ] **Step 2: Run the focused tests** with `npm test -- --test-name-pattern="poll image"` from `services/api`; confirm they fail because the service does not exist.
- [ ] **Step 3: Implement the service** by extracting the existing avatar signature/animation checks where appropriate, reading the multipart part once, running `sharp(body).rotate().webp().toBuffer()`, and calling `putObject` with `contentType: 'image/webp'`. Map invalid input to stable `PollImageUploadError` codes and storage failures to `PollImageStorageError`.
- [ ] **Step 4: Add cleanup on processing failure** so an object is not reported as created unless the S3 upload completed; expose `deletePollImageObject(objectKey: string)` for route/service cleanup.
- [ ] **Step 5: Run the focused tests** and confirm all image-service tests pass.
- [ ] **Step 6: Commit** with `git add services/api/src/modules/polls/poll-images.service.ts services/api/src/modules/polls/poll-images.service.test.ts` and `git commit -m "feat: add poll image processing"`.

### Task 2: Make poll creation accept multipart images safely

**Files:**
- Modify: `services/api/src/modules/polls/polls.routes.ts`
- Modify: `services/api/src/modules/polls/polls.service.ts`
- Modify: `services/api/src/modules/polls/polls.repository.ts`
- Test: `services/api/src/modules/polls/polls.integration.test.ts`

**Interfaces:**
- Consumes: `processPollImage` from Task 1 and existing `createPoll`/`createPollRecord`.
- Produces: multipart `POST /polls` with an optional `image` field; JSON creation remains supported for callers that do not attach an image.

- [ ] **Step 1: Add failing integration tests** for JSON creation without an image, multipart creation with an image, missing/invalid `options` JSON, wrong image field, unsupported type, signature mismatch, oversized input, and storage failure returning the documented status/error.
- [ ] **Step 2: Run the focused integration tests** with `npm test -- --test-name-pattern="poll creation.*image|multipart.*poll"`; confirm the multipart cases fail against the current JSON-only route.
- [ ] **Step 3: Implement a route parser** that detects `multipart/form-data`, iterates fields, parses `options` with JSON, converts boolean/date/visibility fields to the same types accepted by the existing Zod schema, and keeps the current JSON path unchanged.
- [ ] **Step 4: Remove `imageObjectKey` from the public create schema** and from the route input; the route must pass only the server-generated `objectKey` from `processPollImage` to the service.
- [ ] **Step 5: Update `createPoll` to accept the processed object key internally** and call the repository with it; if creation fails after upload, invoke `deletePollImageObject` and rethrow the original domain/storage error.
- [ ] **Step 6: Keep the existing PostgreSQL transaction in `createPollRecord`** and verify the persisted `polls.image_object_key` is the generated key, never a user-supplied path.
- [ ] **Step 7: Run the focused integration tests** and confirm JSON and multipart creation both pass, including cleanup assertions.
- [ ] **Step 8: Commit** with `git add services/api/src/modules/polls/polls.routes.ts services/api/src/modules/polls/polls.service.ts services/api/src/modules/polls/polls.repository.ts services/api/src/modules/polls/polls.integration.test.ts` and `git commit -m "feat: support poll image creation"`.

### Task 3: Add an access-controlled poll image endpoint and response URL

**Files:**
- Create: `services/api/src/modules/polls/poll-image.routes.ts`
- Modify: `services/api/src/modules/polls/polls.routes.ts`
- Modify: `services/api/src/modules/polls/polls.repository.ts`
- Modify: `services/api/src/modules/polls/polls.service.ts`
- Modify: `services/api/src/modules/polls/polls.integration.test.ts`

**Interfaces:**
- Consumes: poll lookup/access logic and `getObject` from storage.
- Produces: `GET /media/polls/:pollId`, returning the stored WebP only when the requester may view the poll; poll JSON contains nullable `imageUrl`.

- [ ] **Step 1: Add failing integration tests** for public image access without authentication, private image access by owner/non-owner, follower image access by follower/non-follower, missing image, deleted poll, invalid UUID, and a storage object miss.
- [ ] **Step 2: Run those tests** and confirm the route and `imageUrl` assertions fail.
- [ ] **Step 3: Implement a repository/service lookup** that returns only the poll image key plus visibility/author data and applies the existing feed visibility rules for an optional viewer.
- [ ] **Step 4: Implement `GET /media/polls/:pollId`** with the correct content type, cache headers, 404 behavior, and optional authentication; do not expose or accept a raw storage key.
- [ ] **Step 5: Add `imageUrl` to mapped poll responses** as `/media/polls/{id}` only when `image_object_key` is non-null; keep `imageObjectKey` out of the public API response used by clients.
- [ ] **Step 6: Run the focused integration tests** and confirm all visibility and response URL cases pass.
- [ ] **Step 7: Commit** with `git add services/api/src/modules/polls/poll-image.routes.ts services/api/src/modules/polls/polls.routes.ts services/api/src/modules/polls/polls.repository.ts services/api/src/modules/polls/polls.service.ts services/api/src/modules/polls/polls.integration.test.ts` and `git commit -m "feat: serve poll images with access checks"`.

### Task 4: Delete poll images and clean orphaned objects

**Files:**
- Modify: `services/api/src/modules/polls/polls.service.ts`
- Modify: `services/api/src/modules/polls/polls.repository.ts`
- Create: `services/api/src/jobs/cleanup-poll-image-objects.ts`
- Test: `services/api/src/modules/polls/polls.integration.test.ts`

**Interfaces:**
- Consumes: existing owner poll deletion, `deletePollImageObject`, `listObjects`, and `deleteObjects`.
- Produces: deletion removes the associated image object; cleanup job removes only unreferenced keys under `poll-images/`.

- [ ] **Step 1: Add failing integration tests** proving deletion removes the database reference and associated object, repeated deletion is safe, and storage deletion failure follows the existing deletion error contract.
- [ ] **Step 2: Implement deletion lookup and cleanup** so the image key is read before the existing delete operation, the poll deletion remains authoritative, and the associated object is removed after successful deletion without touching unrelated keys.
- [ ] **Step 3: Add the cleanup job** that lists `poll-images/`, loads all referenced keys from non-deleted polls, and batch-deletes only orphaned objects; make it callable as a one-shot Node script.
- [ ] **Step 4: Run the deletion/cleanup tests** and confirm they pass.
- [ ] **Step 5: Commit** with `git add services/api/src/modules/polls/polls.service.ts services/api/src/modules/polls/polls.repository.ts services/api/src/jobs/cleanup-poll-image-objects.ts services/api/src/modules/polls/polls.integration.test.ts` and `git commit -m "feat: clean up poll images"`.

### Task 5: Extend Flutter poll models and API client

**Files:**
- Modify: `apps/mobile/lib/src/features/polls/poll_summary.dart`
- Modify: `apps/mobile/lib/src/features/polls/polls_api_client.dart`
- Test: `apps/mobile/test/features/polls/polls_api_client_test.dart`

**Interfaces:**
- Consumes: API `imageUrl` and multipart poll creation.
- Produces: `PollSummary.imageUrl`, `PollsApiClient.createPoll(..., Uint8List? imageBytes, String? imageFilename, String? imageContentType)`, and response parsing for nullable image URLs.

- [ ] **Step 1: Add failing Dart tests** for parsing null/non-null `imageUrl`, JSON creation without an image, multipart creation with image bytes and fields, and omission of the image part when no file is selected.
- [ ] **Step 2: Run the focused Flutter tests** with `flutter test test/features/polls/polls_api_client_test.dart`; confirm the new assertions fail.
- [ ] **Step 3: Add `imageUrl` to `PollSummary`**, preserving compatibility with responses that omit or return null for the field.
- [ ] **Step 4: Update `createPoll`** to choose JSON for no-image requests and `http.MultipartRequest` for image requests, encode `options` as JSON, set authorization/content type, and convert API errors through the existing exception path.
- [ ] **Step 5: Run the focused Flutter tests** and confirm request bodies and parsing pass.
- [ ] **Step 6: Commit** with `git add apps/mobile/lib/src/features/polls/poll_summary.dart apps/mobile/lib/src/features/polls/polls_api_client.dart apps/mobile/test/features/polls/polls_api_client_test.dart` and `git commit -m "feat: send poll images from Flutter"`.

### Task 6: Add image selection, preview, removal, and poll-card rendering

**Files:**
- Modify: `apps/mobile/lib/src/features/polls/create_poll_screen.dart`
- Modify: `apps/mobile/lib/src/features/polls/poll_card.dart`
- Test: `apps/mobile/test/features/polls/create_poll_screen_test.dart`

**Interfaces:**
- Consumes: `image_picker`, the Task 5 API client signature, and `PollSummary.imageUrl`.
- Produces: an optional gallery image in the create flow, local preview/removal, retained selection after failed publish, and bounded poll-card image rendering.

- [ ] **Step 1: Add failing widget tests** for showing the add-image control, displaying/removing a selected preview, preventing duplicate publish, retaining the image after a failed request, and rendering a remote poll image with a loading-error fallback.
- [ ] **Step 2: Run the focused widget tests** with `flutter test test/features/polls/create_poll_screen_test.dart`; confirm they fail.
- [ ] **Step 3: Implement gallery selection** with the existing `ImagePicker`, `maxWidth/maxHeight` and image quality limits, JPEG/PNG/WebP extension/content checks, and the 5 MiB client-side guard; keep the selected bytes/filename/content type in state.
- [ ] **Step 4: Add preview and remove UI** without changing existing text/options controls; disable selection and publish while the request is active and show a clear validation/request error.
- [ ] **Step 5: Pass image data to `createPoll`** and preserve the selected image when the API request fails; clear it only after successful creation or explicit removal.
- [ ] **Step 6: Render `imageUrl` in `PollCard`** with a bounded aspect-ratio container, rounded corners, `Image.network`, and an error placeholder; leave cards without images unchanged.
- [ ] **Step 7: Run the focused widget tests** and then `flutter analyze` for the mobile app.
- [ ] **Step 8: Commit** with `git add apps/mobile/lib/src/features/polls/create_poll_screen.dart apps/mobile/lib/src/features/polls/poll_card.dart apps/mobile/test/features/polls/create_poll_screen_test.dart` and `git commit -m "feat: add poll image UI"`.

### Task 7: Full verification and compatibility checks

**Files:**
- Modify: `services/api/src/modules/polls/polls.integration.test.ts` only if a missing regression assertion is found.
- Modify: `apps/mobile/test/features/polls/polls_api_client_test.dart` only if a missing regression assertion is found.

- [ ] **Step 1: Run backend typecheck and tests** with `npm run typecheck -w @yaskapp/api` and `npm run test -w @yaskapp/api` using the restored PostgreSQL/Redis/MinIO test environment.
- [ ] **Step 2: Run Flutter static checks and tests** with `flutter analyze` and `flutter test` from `apps/mobile`.
- [ ] **Step 3: Build the mobile app** with the project’s existing Flutter build command and verify that the create-poll flow can publish both with and without an image against the configured API.
- [ ] **Step 4: Run `git diff --check` and inspect `git status --short`** to ensure no generated files or secrets were added.
- [ ] **Step 5: Commit any narrowly scoped regression-test additions** with `git commit -m "test: verify poll image flow"`.
