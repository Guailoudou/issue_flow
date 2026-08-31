ALTER TABLE "PlatformSetting" ADD COLUMN "aiTimeoutSeconds" INTEGER NOT NULL DEFAULT 60;
ALTER TABLE "PlatformSetting" ADD COLUMN "aiStructuredOutput" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PlatformSetting" ADD COLUMN "aiDisableThinking" BOOLEAN NOT NULL DEFAULT false;
