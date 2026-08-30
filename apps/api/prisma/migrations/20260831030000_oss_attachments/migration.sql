ALTER TABLE "IssueAttachment" ADD COLUMN "storageType" TEXT NOT NULL DEFAULT 'LOCAL';

CREATE TABLE "OssSetting" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "endpoint" TEXT NOT NULL DEFAULT '',
    "region" TEXT NOT NULL DEFAULT 'us-east-1',
    "bucket" TEXT NOT NULL DEFAULT '',
    "prefix" TEXT NOT NULL DEFAULT 'issueflow/attachments',
    "forcePathStyle" BOOLEAN NOT NULL DEFAULT false,
    "accessKeyIdEncrypted" TEXT,
    "accessKeySecretEncrypted" TEXT,
    "lastTestedAt" DATETIME,
    "lastTestStatus" TEXT,
    "lastTestMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
