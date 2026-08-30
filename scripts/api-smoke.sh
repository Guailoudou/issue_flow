#!/usr/bin/env bash
set -euo pipefail

ISSUEFLOW_BASE_URL="${ISSUEFLOW_BASE_URL:-http://127.0.0.1:3101/api}"
ISSUEFLOW_SMOKE_DIR="$(mktemp -d /private/tmp/issueflow-smoke.XXXXXX)"
ADMIN_COOKIE="$ISSUEFLOW_SMOKE_DIR/admin.cookie"
ALICE_COOKIE="$ISSUEFLOW_SMOKE_DIR/alice.cookie"
BOB_COOKIE="$ISSUEFLOW_SMOKE_DIR/bob.cookie"
SMOKE_SUFFIX="$(date +%s)$$"
ALICE_USERNAME="alice$SMOKE_SUFFIX"
BOB_USERNAME="bob$SMOKE_SUFFIX"
TEMP_USERNAME="temp$SMOKE_SUFFIX"
LABEL_NAME="bug-$SMOKE_SUFFIX"
MILESTONE_TITLE="Milestone $SMOKE_SUFFIX"

json_post() {
  local cookie="$1" path="$2" body="$3"
  curl -fsS -b "$cookie" -c "$cookie" -H 'Content-Type: application/json' -X POST "$ISSUEFLOW_BASE_URL$path" -d "$body"
}

json_put() {
  local cookie="$1" path="$2" body="$3"
  curl -fsS -b "$cookie" -c "$cookie" -H 'Content-Type: application/json' -X PUT "$ISSUEFLOW_BASE_URL$path" -d "$body"
}

json_patch() {
  local cookie="$1" path="$2" body="$3"
  curl -fsS -b "$cookie" -c "$cookie" -H 'Content-Type: application/json' -X PATCH "$ISSUEFLOW_BASE_URL$path" -d "$body"
}

json_delete() {
  local cookie="$1" path="$2"
  curl -fsS -b "$cookie" -c "$cookie" -X DELETE "$ISSUEFLOW_BASE_URL$path"
}

curl -fsS "$ISSUEFLOW_BASE_URL/health" | jq -e '.status == "ok"' >/dev/null

json_post "$ADMIN_COOKIE" '/auth/login' '{"username":"admin","password":"change-me-now"}' | jq -e '.user.role == "ADMIN"' >/dev/null
ADMIN_ID="$(curl -fsS -b "$ADMIN_COOKIE" "$ISSUEFLOW_BASE_URL/auth/me" | jq -er '.user.id')"

curl -fsS -b "$ADMIN_COOKIE" "$ISSUEFLOW_BASE_URL/settings" | jq -e '.name | length > 0' >/dev/null
json_put "$ADMIN_COOKIE" '/admin/settings' '{"name":"IssueFlow Smoke","description":"curl verified","logoUrl":"","defaultPageSize":20,"allowUserCreateIssue":true}' | jq -e '.name == "IssueFlow Smoke"' >/dev/null

ALICE_ID="$(json_post "$ADMIN_COOKIE" '/admin/users' "{\"username\":\"$ALICE_USERNAME\",\"password\":\"alice-password\",\"displayName\":\"Alice Curl\",\"email\":\"alice@example.com\"}" | jq -er '.user.id')"
BOB_ID="$(json_post "$ADMIN_COOKIE" '/admin/users' "{\"username\":\"$BOB_USERNAME\",\"password\":\"bob-password\",\"displayName\":\"Bob Curl\",\"email\":\"bob@example.com\"}" | jq -er '.user.id')"
TEMP_USER_ID="$(json_post "$ADMIN_COOKIE" '/admin/users' "{\"username\":\"$TEMP_USERNAME\",\"password\":\"temp-password\",\"displayName\":\"Temp Curl\",\"email\":\"\"}" | jq -er '.user.id')"
curl -fsS -b "$ADMIN_COOKIE" "$ISSUEFLOW_BASE_URL/users" | jq -e --argjson alice "$ALICE_ID" '.items | any(.id == $alice)' >/dev/null
json_patch "$ADMIN_COOKIE" "/admin/users/$ALICE_ID" '{"displayName":"Alice Verified"}' | jq -e '.user.displayName == "Alice Verified"' >/dev/null
json_post "$ADMIN_COOKIE" "/admin/users/$ALICE_ID/reset-password" '{"password":"alice-new-password"}' | jq -e '.ok == true' >/dev/null
json_delete "$ADMIN_COOKIE" "/admin/users/$TEMP_USER_ID" | jq -e '.ok == true' >/dev/null

LABEL_ID="$(json_post "$ADMIN_COOKIE" '/admin/labels' "{\"name\":\"$LABEL_NAME\",\"description\":\"Created by curl\",\"color\":\"D73A4A\"}" | jq -er '.id')"
json_put "$ADMIN_COOKIE" "/admin/labels/$LABEL_ID" "{\"name\":\"$LABEL_NAME\",\"description\":\"Updated by curl\",\"color\":\"B60205\"}" | jq -e '.description == "Updated by curl"' >/dev/null
curl -fsS -b "$ADMIN_COOKIE" "$ISSUEFLOW_BASE_URL/labels" | jq -e --argjson id "$LABEL_ID" '.items | any(.id == $id)' >/dev/null

MILESTONE_ID="$(json_post "$ADMIN_COOKIE" '/admin/milestones' "{\"title\":\"$MILESTONE_TITLE\",\"description\":\"Smoke\",\"dueDate\":null,\"state\":\"OPEN\"}" | jq -er '.id')"
json_put "$ADMIN_COOKIE" "/admin/milestones/$MILESTONE_ID" "{\"title\":\"$MILESTONE_TITLE\",\"description\":\"Verified\",\"dueDate\":null,\"state\":\"OPEN\"}" | jq -e '.description == "Verified"' >/dev/null
curl -fsS -b "$ADMIN_COOKIE" "$ISSUEFLOW_BASE_URL/milestones" | jq -e --argjson id "$MILESTONE_ID" '.items | any(.id == $id)' >/dev/null
curl -fsS -b "$ADMIN_COOKIE" "$ISSUEFLOW_BASE_URL/admin/stats" | jq -e '.users >= 3 and .openIssues >= 0' >/dev/null

json_post "$ALICE_COOKIE" '/auth/login' "{\"username\":\"$ALICE_USERNAME\",\"password\":\"alice-new-password\"}" | jq -e --arg username "$ALICE_USERNAME" '.user.username == $username' >/dev/null
json_post "$BOB_COOKIE" '/auth/login' "{\"username\":\"$BOB_USERNAME\",\"password\":\"bob-password\"}" | jq -e --arg username "$BOB_USERNAME" '.user.username == $username' >/dev/null

ISSUE_ID="$(json_post "$ALICE_COOKIE" '/issues' "{\"title\":\"Curl issue $SMOKE_SUFFIX\",\"body\":\"Smoke body @$BOB_USERNAME\",\"assigneeIds\":[$BOB_ID],\"labelIds\":[$LABEL_ID],\"milestoneId\":$MILESTONE_ID}" | jq -er '.id')"
curl -fsS -b "$ALICE_COOKIE" "$ISSUEFLOW_BASE_URL/issues?state=OPEN&assigneeId=$BOB_ID&labelId=$LABEL_ID&milestoneId=$MILESTONE_ID&q=Curl&page=1&pageSize=5" | jq -e --argjson id "$ISSUE_ID" '.items | any(.id == $id)' >/dev/null
UPDATED_AT="$(curl -fsS -b "$ALICE_COOKIE" "$ISSUEFLOW_BASE_URL/issues/$ISSUE_ID" | jq -er '.updatedAt')"
UPDATED_AT="$(json_patch "$ALICE_COOKIE" "/issues/$ISSUE_ID" "{\"title\":\"Curl issue updated\",\"updatedAt\":\"$UPDATED_AT\",\"assigneeIds\":[$BOB_ID,$ADMIN_ID],\"labelIds\":[$LABEL_ID],\"milestoneId\":$MILESTONE_ID}" | jq -er '.updatedAt')"
json_put "$ALICE_COOKIE" "/issues/$ISSUE_ID/subscription" '{"subscribed":false}' | jq -e '.subscribed == false' >/dev/null
json_put "$ALICE_COOKIE" "/issues/$ISSUE_ID/subscription" '{"subscribed":true}' | jq -e '.subscribed == true' >/dev/null

COMMENT_ID="$(json_post "$BOB_COOKIE" "/issues/$ISSUE_ID/comments" "{\"body\":\"Working on this @$ALICE_USERNAME\"}" | jq -er '.id')"
COMMENT_UPDATED_AT="$(curl -fsS -b "$BOB_COOKIE" "$ISSUEFLOW_BASE_URL/issues/$ISSUE_ID" | jq -er --argjson id "$COMMENT_ID" '.comments[] | select(.id == $id) | .updatedAt')"
json_patch "$BOB_COOKIE" "/comments/$COMMENT_ID" "{\"body\":\"Updated comment\",\"updatedAt\":\"$COMMENT_UPDATED_AT\"}" | jq -e '.body == "Updated comment"' >/dev/null
UPDATED_AT="$(curl -fsS -b "$BOB_COOKIE" "$ISSUEFLOW_BASE_URL/issues/$ISSUE_ID" | jq -er '.updatedAt')"
json_patch "$BOB_COOKIE" "/issues/$ISSUE_ID" "{\"state\":\"CLOSED\",\"updatedAt\":\"$UPDATED_AT\"}" | jq -e '.state == "CLOSED"' >/dev/null

NOTIFICATION_ID="$(curl -fsS -b "$BOB_COOKIE" "$ISSUEFLOW_BASE_URL/notifications?unread=true&page=1&pageSize=20" | jq -er '.items[0].id')"
json_patch "$BOB_COOKIE" "/notifications/$NOTIFICATION_ID/read" '{}' | jq -e '.ok == true' >/dev/null
json_post "$BOB_COOKIE" '/notifications/read-all' '{}' | jq -e '.ok == true' >/dev/null
json_delete "$BOB_COOKIE" "/comments/$COMMENT_ID" | jq -e '.ok == true' >/dev/null

json_delete "$ADMIN_COOKIE" "/admin/labels/$LABEL_ID" | jq -e '.ok == true' >/dev/null
json_delete "$ADMIN_COOKIE" "/admin/milestones/$MILESTONE_ID" | jq -e '.ok == true' >/dev/null
json_post "$ALICE_COOKIE" '/auth/logout' '{}' | jq -e '.ok == true' >/dev/null
json_patch "$ADMIN_COOKIE" "/admin/users/$BOB_ID" '{"active":false}' | jq -e '.user.active == false' >/dev/null
BOB_ME_STATUS="$(curl -sS -o "$ISSUEFLOW_SMOKE_DIR/bob-me.json" -w '%{http_code}' -b "$BOB_COOKIE" "$ISSUEFLOW_BASE_URL/auth/me")"
test "$BOB_ME_STATUS" = "401"

printf 'curl smoke passed: health, auth, users, settings, labels, milestones, stats, issues, comments, subscriptions, notifications\n'
printf 'artifacts: %s\n' "$ISSUEFLOW_SMOKE_DIR"
