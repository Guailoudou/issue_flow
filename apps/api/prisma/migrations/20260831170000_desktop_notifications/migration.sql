ALTER TABLE "ApiToken" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'PERSONAL';
ALTER TABLE "ApiToken" ADD COLUMN "deviceName" TEXT;

CREATE INDEX "ApiToken_userId_kind_createdAt_idx" ON "ApiToken"("userId", "kind", "createdAt");

CREATE TABLE "DesktopPairing" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deviceName" TEXT NOT NULL,
    "userCodeHash" TEXT NOT NULL,
    "deviceSecretHash" TEXT NOT NULL,
    "approvedUserId" INTEGER,
    "expiresAt" DATETIME NOT NULL,
    "approvedAt" DATETIME,
    "consumedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DesktopPairing_approvedUserId_fkey" FOREIGN KEY ("approvedUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "DesktopPairing_userCodeHash_key" ON "DesktopPairing"("userCodeHash");
CREATE INDEX "DesktopPairing_expiresAt_idx" ON "DesktopPairing"("expiresAt");
CREATE INDEX "DesktopPairing_approvedUserId_createdAt_idx" ON "DesktopPairing"("approvedUserId", "createdAt");

CREATE TABLE "DesktopPreference" (
    "userId" INTEGER NOT NULL PRIMARY KEY,
    "systemNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "assignmentNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "mentionNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "statusNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "assigneeNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "commentNotificationsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "doNotDisturbEnabled" BOOLEAN NOT NULL DEFAULT false,
    "doNotDisturbStart" TEXT,
    "doNotDisturbEnd" TEXT,
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "recentlyClosedDays" INTEGER NOT NULL DEFAULT 7,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DesktopPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "IssueNotificationMute" (
    "userId" INTEGER NOT NULL,
    "issueId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IssueNotificationMute_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "IssueNotificationMute_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    PRIMARY KEY ("userId", "issueId")
);

CREATE INDEX "IssueNotificationMute_issueId_idx" ON "IssueNotificationMute"("issueId");
