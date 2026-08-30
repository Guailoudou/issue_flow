-- Existing users and assignees keep their current behavior as developers.
CREATE TABLE "UserRole" (
    "userId" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    PRIMARY KEY ("userId", "role")
);
CREATE INDEX "UserRole_role_idx" ON "UserRole"("role");
INSERT INTO "UserRole" ("userId", "role") SELECT "id", 'DEVELOPMENT' FROM "User";

ALTER TABLE "Issue" ADD COLUMN "isProductIssue" BOOLEAN NOT NULL DEFAULT false;

PRAGMA foreign_keys=OFF;
CREATE TABLE "new_IssueAssignee" (
    "issueId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "ownerType" TEXT NOT NULL DEFAULT 'DEVELOPMENT',
    CONSTRAINT "IssueAssignee_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "IssueAssignee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    PRIMARY KEY ("issueId", "userId", "ownerType")
);
INSERT INTO "new_IssueAssignee" ("issueId", "userId", "ownerType") SELECT "issueId", "userId", 'DEVELOPMENT' FROM "IssueAssignee";
DROP TABLE "IssueAssignee";
ALTER TABLE "new_IssueAssignee" RENAME TO "IssueAssignee";
CREATE INDEX "IssueAssignee_userId_idx" ON "IssueAssignee"("userId");
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
