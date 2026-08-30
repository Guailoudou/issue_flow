ALTER TABLE "OssSetting" ADD COLUMN "storageMode" TEXT NOT NULL DEFAULT 'LOCAL';
ALTER TABLE "OssSetting" ADD COLUMN "webdavUrl" TEXT NOT NULL DEFAULT '';
ALTER TABLE "OssSetting" ADD COLUMN "webdavPath" TEXT NOT NULL DEFAULT 'issueflow/attachments';
ALTER TABLE "OssSetting" ADD COLUMN "webdavUsernameEncrypted" TEXT;
ALTER TABLE "OssSetting" ADD COLUMN "webdavPasswordEncrypted" TEXT;

UPDATE "OssSetting" SET "storageMode" = 'S3' WHERE "enabled" = 1;
