/**
 * Byte-identical parity check for extracted sanitize helpers vs inlined legacy copies.
 * Run: npx tsx scripts/verify-sanitize.mjs
 */

function legacyContentToText(content) {
  if (typeof content === "string") return content;
  if (content == null) return "";
  return content
    .flatMap((part) => {
      if (!part || typeof part !== "object" || Array.isArray(part)) return [];
      const value = part;
      return value.type === "text" && typeof value.text === "string" ? [value.text] : [];
    })
    .join("\n");
}

function legacySanitizeMemoryContent(text) {
  return text
    .replace(/debug-test/gi, "")
    .replace(/记忆系统/g, "")
    .replace(/自动记忆测试口令/g, "口令")
    .replace(/测试口令/g, "口令")
    .replace(/标签为?[^，。；\s]+/g, "")
    .replace(/标签[:：]?[^，。；\s]+/g, "")
    .replace(/[，,；;：:]\s*([。.!！?？])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/^[，,；;：:\s]+|[，,；;：:\s]+$/g, "")
    .trim();
}

function legacySanitizeSummaryContent(text) {
  return legacySanitizeMemoryContent(
    text
      .replace(/<time_reminder>[^|。\n]*/gi, "")
      .replace(/对话摘要（\d+ 条消息）：?/g, "")
      .replace(/用户话题[:：]/g, "")
      .replace(/助手要点[:：]/g, "")
  );
}

const { contentToText, sanitizeMemoryContent, sanitizeSummaryContent } = await import(
  "../src/utils/sanitize.ts"
);

const samples = [
  "debug-test 记忆系统 正常内容",
  "自动记忆测试口令 和 测试口令 混用",
  "标签为重要事项，标签：工作",
  "句末，。 分号；！",
  "  多余   空格  ",
  "，；：开头和结尾，",
  "<time_reminder>now|用户话题：天气助手要点：晴",
  "对话摘要（12 条消息）：用户说了什么",
  "DEBUG-TEST mixed Case",
  "纯中文无标记的记忆条目。",
];

let failed = 0;
for (const sample of samples) {
  if (sanitizeMemoryContent(sample) !== legacySanitizeMemoryContent(sample)) {
    console.error("sanitizeMemoryContent mismatch:", JSON.stringify(sample));
    failed += 1;
  }
  if (sanitizeSummaryContent(sample) !== legacySanitizeSummaryContent(sample)) {
    console.error("sanitizeSummaryContent mismatch:", JSON.stringify(sample));
    failed += 1;
  }
}

const contentSamples = [
  "plain",
  [{ type: "text", text: "part1" }, { type: "text", text: "part2" }],
  [{ type: "image", url: "x" }, { type: "text", text: "only text" }],
  null,
  "",
];
for (const sample of contentSamples) {
  if (contentToText(sample) !== legacyContentToText(sample)) {
    console.error("contentToText mismatch:", JSON.stringify(sample));
    failed += 1;
  }
}

if (failed > 0) {
  console.error(`verify-sanitize: ${failed} mismatch(es)`);
  process.exit(1);
}
console.log("verify-sanitize: ok (10 text samples + contentToText cases)");