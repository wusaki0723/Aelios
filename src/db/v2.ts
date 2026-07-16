// Aelios 记忆库 v2 数据访问层 (母帖 #11 第 2 步)
// digest / precious / glossary / longtail 的 CRUD + memories 的 fact_key upsert / supersede。
// 调用方负责 MEMORY_LIFECYCLE_ENABLED 总闸；本层只管读写，不判断开关。
//
// v2 写路径 (upsert/supersede/archive) 同时写 D1 和 Vectorize：
// D1 是本体，Vectorize 是检索镜像 (母帖 L6)。只写 D1 不写向量 → recall 召不到。
// 同步用 embedding.ts 的 upsertMemoryEmbedding / deleteMemoryEmbedding (已带 kind:"memory")。

export * from "./v2/relations";
export * from "./v2/digest";
export * from "./v2/precious";
export * from "./v2/glossary";
export * from "./v2/longtail";
export * from "./v2/candidates";
export * from "./v2/memories";
export * from "./v2/logs";
