# Poll Comments Live Smoke Test

Use this checklist to verify the comments flow against a running local API.
The test data is disposable. Keep the API and Docker infrastructure running
only for the duration of the check.

## Prerequisites

- Node.js 20+ and npm dependencies are installed.
- Docker Desktop is running.
- `services/api/.env` exists and points to the local Compose services.
- PostgreSQL is migrated with `npm run db:migrate`.
- The API is running on `http://localhost:3000` with `npm run api:dev`.

## Checklist

- [ ] Register a new user with `POST /auth/register`.
- [ ] Log in with `POST /auth/login` and store the returned `accessToken`.
- [ ] Create a poll with `POST /polls` using the bearer token; store `poll.id`.
- [ ] Open the created poll's comments screen from the Flutter feed or profile.
- [ ] Confirm the comments screen loads `GET /polls/:pollId/comments?limit=50` and shows an empty or valid list.
- [ ] Post a comment with `POST /polls/:pollId/comments` and confirm both `comment` and updated `poll` are returned.
- [ ] Verify the comments screen and returned `poll.commentsCount` increased by one.
- [ ] Refresh the comments screen/list and confirm the new comment remains present with the same count.
- [ ] Try posting an empty comment and confirm a validation error is shown without changing the count.
- [ ] Stop the API and Docker services after the check; no infrastructure needs to remain up.

## Cleanup

The smoke test has no persistent runtime requirement. Once the API requests and
Flutter comments flow have been verified, stop the API process and shut down
the local dependencies:

```bash
docker compose -f infra/docker/docker-compose.yml down
```

The next smoke run can start the same dependencies again and rerun migrations
if the local database was removed.

## PowerShell example

```powershell
$baseUrl = 'http://localhost:3000'
$suffix = Get-Random
$email = "smoke-$suffix@example.com"
$username = "smoke$suffix"
$password = 'Password123!'

$register = Invoke-RestMethod -Method Post -Uri "$baseUrl/auth/register" `
  -ContentType 'application/json' `
  -Body (@{ email = $email; username = $username; password = $password } | ConvertTo-Json)

$login = Invoke-RestMethod -Method Post -Uri "$baseUrl/auth/login" `
  -ContentType 'application/json' `
  -Body (@{ email = $email; password = $password } | ConvertTo-Json)

$headers = @{ Authorization = "Bearer $($login.accessToken)" }
$poll = Invoke-RestMethod -Method Post -Uri "$baseUrl/polls" `
  -Headers $headers -ContentType 'application/json' `
  -Body (@{ question = 'Live smoke question'; options = @('Yes', 'No') } | ConvertTo-Json)

$pollId = $poll.poll.id
$before = Invoke-RestMethod -Method Get -Uri "$baseUrl/polls/$pollId/comments?limit=50" `
  -Headers $headers

$created = Invoke-RestMethod -Method Post -Uri "$baseUrl/polls/$pollId/comments" `
  -Headers $headers -ContentType 'application/json' `
  -Body (@{ body = 'Live smoke comment' } | ConvertTo-Json)

$after = Invoke-RestMethod -Method Get -Uri "$baseUrl/polls/$pollId/comments?limit=50" `
  -Headers $headers

Write-Host "commentsCount: $($created.poll.commentsCount)"
Write-Host "comments returned after refresh: $($after.items.Count)"

$validationFailed = $false
try {
  Invoke-RestMethod -Method Post -Uri "$baseUrl/polls/$pollId/comments" `
    -Headers $headers -ContentType 'application/json' `
    -Body (@{ body = '   ' } | ConvertTo-Json)
} catch {
  $validationFailed = $true
}
if (-not $validationFailed) {
  throw 'Expected empty comment request to fail.'
}
Write-Host 'Validation error case passed.'
```

After verification, stop the API process and run:

```bash
docker compose -f infra/docker/docker-compose.yml down
```
