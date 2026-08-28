# Poll image upload design

## Goal

Allow a user to attach one optional image when creating a poll. The image is
validated and normalized by the API, stored in the existing S3-compatible
storage, and displayed through an access-controlled API URL.

## Scope and defaults

- A poll can contain zero or one image.
- Accepted input types: JPEG, PNG, and WebP.
- Maximum request file size: 5 MiB, matching the existing multipart limit.
- Animated images are rejected.
- Images are normalized to WebP by `sharp`; the original upload is not kept.
- Flutter provides gallery selection, local preview, removal before publish,
  and a publish progress/failed state.
- The existing poll text/options/visibility behavior remains unchanged.

## Architecture

The mobile client sends `POST /polls` as `multipart/form-data`. Text fields are
encoded as strings; `options` is encoded as JSON; the optional file uses the
`image` field. The API parses the multipart stream, validates all fields with
the existing Zod schema, validates the file bytes and image signature, rotates
according to EXIF, and converts the image to WebP.

The API generates the storage key and never accepts a client-selected
`imageObjectKey`. Keys use the form
`poll-images/{authorId}/{uuid}.webp`. The normalized object is uploaded before
the database transaction. If poll creation fails, the newly uploaded object is
deleted. If the database succeeds, the key is persisted in `polls.image_object_key`.

Poll responses expose `imageUrl` (for example, `/media/polls/{pollId}`) and do
not require clients to construct storage URLs. The media endpoint loads the
poll and enforces the same visibility/access rules as the poll feed before
streaming the object. Deleted polls return 404. The existing raw key may remain
an internal repository field during the transition but is not used by Flutter.

When a poll is deleted, its database record is removed/soft-deleted according
to the existing poll behavior and its image object is deleted. Storage cleanup
failures are reported using the existing storage error conventions and are
covered by tests; orphan cleanup can remove keys under the poll-images prefix.

## API behavior

`POST /polls` accepts:

- `question`: text, 1–280 characters;
- `options`: JSON array, 2–5 unique values, each 1–160 characters;
- existing optional fields (`description`, `visibility`, `endsAt`, and
  `allowVoteCancellation`);
- optional `image`: one JPEG, PNG, or WebP file up to 5 MiB.

Invalid multipart input returns the existing 400 validation format. Invalid,
animated, oversized, or unsupported images return a stable image-specific
error code. Storage failures return 503. The JSON response remains
`{ "poll": ... }` and adds nullable `imageUrl`.

## Flutter behavior

The create screen adds an “Add image” action. After selection it shows a
preview, filename/size context, and a remove action. The publish request uses
`http.MultipartRequest`; it sends the existing fields and optional image bytes.
The screen prevents duplicate submission and preserves the selected image when
validation or a request fails. A successful response returns the poll as today.
Poll models and cards render `imageUrl` when present, with a bounded image area
and a fallback for loading errors.

## Consistency and security

- The server remains the source of truth for image type, bytes, size, storage
  key, and access control.
- A user cannot reference another user's object by supplying a storage key.
- Visibility checks apply to image retrieval, including private/follower polls.
- Image upload and poll creation are treated as one logical operation; failed
  database creation never leaves the newly uploaded object behind.
- Existing avatar upload behavior is not changed.

## Testing

Backend tests cover successful image creation, absent image, invalid MIME and
signature, oversized file, animated image, storage failure cleanup, media access
for public/follower/private polls, deleted/missing objects, and deletion
cleanup. Flutter tests cover request encoding, optional image inclusion,
preview removal, failed submission retention, and response parsing with both
null and non-null `imageUrl`.

## Out of scope

- Multiple images or galleries.
- Image cropping/editor UI.
- Presigned uploads or direct client access to S3/MinIO.
- Image moderation/classification beyond validation and the existing reports
  workflow.
