-- CreateTable
CREATE TABLE "YunxiaoIntegration" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "edition" TEXT NOT NULL DEFAULT 'CENTRAL',
    "baseUrl" TEXT NOT NULL DEFAULT '',
    "organizationId" TEXT NOT NULL DEFAULT '',
    "repositoryId" TEXT NOT NULL DEFAULT '',
    "repositoryName" TEXT NOT NULL DEFAULT '',
    "repositoryWebUrl" TEXT NOT NULL DEFAULT '',
    "tokenEncrypted" TEXT,
    "webhookSecretEncrypted" TEXT,
    "lastTestedAt" DATETIME,
    "lastTestStatus" TEXT,
    "lastTestMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CodeReference" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "issueId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL DEFAULT '',
    "status" TEXT,
    "sourceBranch" TEXT,
    "targetBranch" TEXT,
    "authorName" TEXT,
    "commitSha" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CodeReference_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "deliveryKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "summary" TEXT NOT NULL DEFAULT '{}',
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "CodeReference_issueId_type_externalId_key" ON "CodeReference"("issueId", "type", "externalId");
CREATE INDEX "CodeReference_issueId_updatedAt_idx" ON "CodeReference"("issueId", "updatedAt");
CREATE UNIQUE INDEX "WebhookDelivery_deliveryKey_key" ON "WebhookDelivery"("deliveryKey");
CREATE INDEX "WebhookDelivery_status_createdAt_idx" ON "WebhookDelivery"("status", "createdAt");
