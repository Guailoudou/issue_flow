UPDATE "Issue" SET "state" = 'OPEN', "closedAt" = NULL WHERE "state" = 'AWAITING_ACCEPTANCE';

CREATE TABLE "CommitAction" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "state" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "CommitActionLabel" (
    "actionId" INTEGER NOT NULL,
    "labelId" INTEGER NOT NULL,
    CONSTRAINT "CommitActionLabel_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "CommitAction" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CommitActionLabel_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "Label" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    PRIMARY KEY ("actionId", "labelId")
);

CREATE UNIQUE INDEX "CommitAction_keyword_key" ON "CommitAction"("keyword");
CREATE INDEX "CommitActionLabel_labelId_idx" ON "CommitActionLabel"("labelId");

INSERT INTO "CommitAction" ("id", "name", "keyword", "state", "isSystem", "updatedAt") VALUES
    (1, '开启 Issue', 'o', 'OPEN', true, CURRENT_TIMESTAMP),
    (2, '关闭 Issue', 'c', 'CLOSED', true, CURRENT_TIMESTAMP);
