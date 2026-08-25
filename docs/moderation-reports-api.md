# Reports and moderation queue API

## Create report

```http
POST /reports
Authorization: Bearer <user-token>
Content-Type: application/json
```

```json
{
  "targetType": "poll",
  "targetId": "00000000-0000-4000-8000-000000000000",
  "category": "spam",
  "description": "This poll is spam."
}
```

The first active report by the same user for the same target returns `201`:

```json
{
  "report": {},
  "case": {},
  "deduplicated": false
}
```

Repeating an active report returns `200` with the original report and case:

```json
{
  "report": {},
  "case": {},
  "deduplicated": true
}
```

Users with a blocked or deleted account receive `401`. Missing/deleted targets
receive `404`, and invalid request bodies receive `400 validation_error`.

## Moderation capabilities

```http
GET /moderation/capabilities
Authorization: Bearer <staff-token>
```

The endpoint returns server-issued moderation permissions for the web panel.
Ordinary users receive `403 forbidden`.

## Moderation queue

```http
GET /moderation/cases?status=open&priority=normal&limit=50&cursor=<cursor>
Authorization: Bearer <moderator-token>
```

The endpoint requires `moderation.queue.read` and returns:

```json
{
  "items": [
    {
      "id": "...",
      "targetType": "poll",
      "targetId": "...",
      "status": "open",
      "priority": "normal",
      "assignedToUserId": null,
      "reportsCount": 1,
      "createdAt": "...",
      "updatedAt": "...",
      "resolvedAt": null
    }
  ],
  "nextCursor": null
}
```

Supported filters: `status`, `category`, `priority`, `assigneeId`,
`targetType`, `limit`, and `cursor`.

Ordinary users receive `403 forbidden` for the moderation queue. Queue and
report writes are server-side authorized and do not trust permissions supplied
by the client.

## Local migration and checks

```powershell
npm run db:migrate
npm run api:typecheck
npm run api:test
```
