import type { FastifyInstance } from "fastify";
import type { Prisma, PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";
import { issueExportQuerySchema } from "@issueflow/shared";
import { isPreviewableImageMime, readAttachmentBuffer, resolveUploadDir, type AttachmentRouteOptions } from "./attachments";

const HEADERS = [
  "产品需求", "产品负责人", "状态", "需求明细", "附件：图片", "备注", "技术责任人", "状态",
  "预估人日", "计划开始时间", "计划完成时间", "开发进度", "研发自测", "产品验收",
] as const;
const FEEDBACK_HEADERS = ["问题描述", "类型", "优先级", "状态", "反馈者", "跟进人", "附件", "反馈时间", "备注说明"] as const;

function issueWhere(query: ReturnType<typeof issueExportQuerySchema.parse>): Prisma.IssueWhereInput {
  const commonFilters: Prisma.IssueWhereInput = {
    ...(query.authorId ? { authorId: query.authorId } : {}),
    ...(query.assigneeId ? { assignees: { some: { userId: query.assigneeId } } } : {}),
    ...(query.labelIds?.length ? { AND: query.labelIds.map((labelId) => ({ labels: { some: { labelId } } })) } : query.labelId ? { labels: { some: { labelId: query.labelId } } } : {}),
    ...(query.milestoneId ? { milestoneId: query.milestoneId } : {}),
    ...(query.q ? { OR: [{ title: { contains: query.q } }, { body: { contains: query.q } }] } : {}),
  };
  return { AND: [commonFilters, { OR: [
    { state: "OPEN" },
    { state: "CLOSED", closedAt: { gte: new Date(query.closedFrom), lte: new Date(query.closedTo) } },
  ] }] };
}

function applyBorders(row: ExcelJS.Row) {
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.border = {
      top: { style: "thin", color: { argb: "FFD9DEE7" } }, bottom: { style: "thin", color: { argb: "FFD9DEE7" } },
      left: { style: "thin", color: { argb: "FFD9DEE7" } }, right: { style: "thin", color: { argb: "FFD9DEE7" } },
    };
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    cell.font = { name: "Microsoft YaHei", size: 10, color: { argb: "FF172033" } };
  });
}

async function createWorkbook(prisma: PrismaClient, uploadDir: string, query: ReturnType<typeof issueExportQuerySchema.parse>, options: AttachmentRouteOptions) {
  const issues = await prisma.issue.findMany({
    where: issueWhere(query), orderBy: { [query.sort]: query.order },
    include: {
      author: { select: { displayName: true } }, milestone: { select: { title: true } },
      assignees: { include: { user: { select: { displayName: true } } } },
      labels: { include: { label: { select: { name: true } } } },
      attachments: { orderBy: { createdAt: "asc" } },
    },
  });
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "IssueFlow";
  workbook.created = new Date();
  workbook.modified = new Date();
  const sheet = workbook.addWorksheet("需求进度管理", { views: [{ state: "frozen", ySplit: 4 }] });
  sheet.columns = [20, 14, 12, 40, 22, 28, 18, 12, 12, 16, 16, 12, 12, 12].map((width) => ({ width }));
  sheet.mergeCells("A1:N3");
  const title = sheet.getCell("A1");
  title.value = "【需求进度与排期管理】（八月份）";
  title.font = { name: "Microsoft YaHei", size: 20, bold: true, color: { argb: "FF172033" } };
  title.alignment = { horizontal: "center", vertical: "middle" };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F6FC" } };
  sheet.getRow(1).height = 26; sheet.getRow(2).height = 20; sheet.getRow(3).height = 20;
  const headerRow = sheet.getRow(4);
  HEADERS.forEach((header, index) => { headerRow.getCell(index + 1).value = header; });
  headerRow.height = 32;
  headerRow.eachCell((cell) => {
    cell.font = { name: "Microsoft YaHei", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF315E9D" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
  });

  for (const issue of issues) {
    const start = sheet.rowCount + 1;
    const end = start + 1;
    const delivered = issue.state === "CLOSED";
    const notes = [
      issue.labels.length ? `标签：${issue.labels.map(({ label }) => label.name).join("、")}` : "",
      issue.milestone ? `里程碑：${issue.milestone.title}` : "",
      issue.attachments.length ? `附件：${issue.attachments.length} 个` : "",
    ].filter(Boolean).join("\n");
    const values: Array<string | number | Date | null> = [
      `#${issue.id} ${issue.title}`, issue.assignees.filter(({ ownerType }) => ownerType === "PRODUCT").map(({ user }) => user.displayName).join("、"), delivered ? "已交付" : "开放", issue.body, "", notes,
      issue.assignees.filter(({ ownerType }) => ownerType === "DEVELOPMENT").map(({ user }) => user.displayName).join("、"), delivered ? "已交付" : "开发中", "",
      issue.createdAt, issue.closedAt, delivered ? 1 : 0, "", delivered ? 1 : 0,
    ];
    for (let column = 1; column <= HEADERS.length; column += 1) {
      sheet.mergeCells(start, column, end, column);
      sheet.getCell(start, column).value = values[column - 1] ?? "";
    }
    sheet.getRow(start).height = 46; sheet.getRow(end).height = 46;
    applyBorders(sheet.getRow(start)); applyBorders(sheet.getRow(end));
    for (const column of [10, 11]) {
      sheet.getCell(start, column).numFmt = "yyyy-mm-dd";
      sheet.getCell(start, column).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    }
    for (const column of [3, 8, 9, 12, 13, 14]) sheet.getCell(start, column).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    const firstImage = issue.attachments.find((attachment) => isPreviewableImageMime(attachment.mimeType));
    if (firstImage) {
      try {
        const buffer = await readAttachmentBuffer(prisma, uploadDir, firstImage, options.oss);
        const extension = firstImage.mimeType === "image/jpeg" ? "jpeg" : firstImage.mimeType.split("/")[1];
        if (["png", "jpeg", "gif", "webp"].includes(extension ?? "")) {
          // ExcelJS can serialize arbitrary OOXML image extensions at runtime; its public type union omits WebP.
          const imageId = workbook.addImage({ base64: `data:${firstImage.mimeType};base64,${buffer.toString("base64")}`, extension: extension as "png" | "jpeg" | "gif" });
          sheet.addImage(imageId, `E${start}:E${end}`);
        }
      } catch { /* A missing or damaged image must not prevent the spreadsheet export. */ }
    }
  }

  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: 14 } };
  sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  const feedback = workbook.addWorksheet("用户反馈跟踪记录", { views: [{ state: "frozen", ySplit: 1 }] });
  feedback.columns = [32, 14, 12, 14, 16, 16, 20, 18, 30].map((width) => ({ width }));
  FEEDBACK_HEADERS.forEach((header, index) => { feedback.getCell(1, index + 1).value = header; });
  feedback.getRow(1).height = 30;
  feedback.getRow(1).eachCell((cell) => {
    cell.font = { name: "Microsoft YaHei", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF315E9D" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  feedback.autoFilter = "A1:I1";
  return workbook;
}

export async function exportRoutes(app: FastifyInstance, prisma: PrismaClient, options: AttachmentRouteOptions = {}) {
  const uploadDir = resolveUploadDir(options.uploadDir);
  app.get("/issues/export.xlsx", { preHandler: app.authenticate }, async (request, reply) => {
    const query = issueExportQuerySchema.parse(request.query);
    const workbook = await createWorkbook(prisma, uploadDir, query, options);
    const buffer = await workbook.xlsx.writeBuffer();
    const date = new Date().toISOString().slice(0, 10);
    const fileName = `需求进度管理-${date}.xlsx`;
    reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    reply.header("Content-Disposition", `attachment; filename="issueflow-${date}.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    reply.header("Cache-Control", "private, no-store");
    return reply.send(Buffer.from(buffer));
  });
}
