import type {
  ApiConfig,
  CatalogModel,
  ChatHistory,
  ModelInputType,
  ModelGroup,
  ModelOption,
} from "./types";

const TEXT: ModelInputType[] = ["text"];
const TEXT_IMAGE: ModelInputType[] = ["text", "image"];
const ALL_INPUTS: ModelInputType[] = ["text", "image", "video", "audio"];

export const MODEL_CATALOG: Record<string, ModelOption[]> = {
  OpenAI: [
    { id: "gpt-5.6-sol", name: "GPT-5.6-sol", family: "OpenAI", context: "400K", capability: "前沿复杂推理", inputTypes: TEXT_IMAGE },
    { id: "gpt-5.5", name: "GPT-5.5", family: "OpenAI", context: "400K", capability: "推理 · 工具", inputTypes: TEXT_IMAGE },
    { id: "gpt-5.4-mini", name: "GPT-5.4 mini", family: "OpenAI", context: "400K", capability: "快速 · 通用", inputTypes: TEXT_IMAGE },
    { id: "gpt-image-2", name: "image-2", family: "OpenAI", context: "1K", capability: "图像生成", inputTypes: TEXT_IMAGE },
  ],
  Anthropic: [
    { id: "claude-fable-5", name: "Claude Fable 5", family: "Anthropic", context: "200K", capability: "顶级复杂推理", inputTypes: TEXT_IMAGE },
    { id: "claude-opus-4-8", name: "Claude Opus 4.8", family: "Anthropic", context: "200K", capability: "复杂任务", inputTypes: TEXT_IMAGE },
    { id: "claude-opus-4-6", name: "Claude Opus 4.6", family: "Anthropic", context: "200K", capability: "复杂任务", inputTypes: TEXT_IMAGE },
    { id: "claude-sonnet-5", name: "Claude Sonnet 5", family: "Anthropic", context: "200K", capability: "平衡 · 代码", inputTypes: TEXT_IMAGE },
  ],
  Google: [
    { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro", family: "Google", context: "1M", capability: "多模态 · 推理", inputTypes: ALL_INPUTS, supportsReasoning: true },
    { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash", family: "Google", context: "1M", capability: "实时 · 快速", inputTypes: ALL_INPUTS, supportsReasoning: true },
  ],
  DeepSeek: [
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", family: "DeepSeek", context: "128K", capability: "深度推理", inputTypes: TEXT, supportsReasoning: true },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 flash", family: "DeepSeek", context: "128K", capability: "实时 · 快速", inputTypes: TEXT },
  ],
  Local: [
    { id: "qwen3:32b", name: "Qwen3 32B", family: "Ollama", context: "40K", capability: "本地 · 推理", inputTypes: TEXT, supportsReasoning: true },
    { id: "llama3.3:70b", name: "Llama 3.3 70B", family: "Ollama", context: "128K", capability: "本地 · 通用", inputTypes: TEXT },
    { id: "gemma3:27b", name: "Gemma 3 27B", family: "Ollama", context: "128K", capability: "本地 · 多模态", inputTypes: TEXT_IMAGE },
  ],
};

export const INITIAL_MODEL_GROUPS: ModelGroup[] = [
  {
    id: "group-openai",
    name: "OpenAI · Main",
    format: "openai-compatible",
    description: "OpenAI 官方与 OpenAI-compatible 模型。",
    color: "#79b8ff",
  },
  {
    id: "group-anthropic",
    name: "Anthropic · Direct",
    format: "anthropic",
    description: "使用 Anthropic Messages 请求格式的模型。",
    color: "#e7a478",
  },
  {
    id: "group-google",
    name: "Google · Gemini",
    format: "gemini",
    description: "Google Generative Language API 模型。",
    color: "#c8a4ff",
  },
  {
    id: "group-deepseek",
    name: "DeepSeek · CN",
    format: "openai-compatible",
    description: "兼容 OpenAI 请求格式的 DeepSeek 模型。",
    color: "#65d9d1",
  },
  {
    id: "group-local",
    name: "Ollama · Studio",
    format: "ollama",
    description: "本地或私有网络中的 Ollama 模型。",
    color: "#aeb8b3",
  },
];

const FAMILY_GROUPS: Record<string, string> = {
  OpenAI: "group-openai",
  Anthropic: "group-anthropic",
  Google: "group-google",
  DeepSeek: "group-deepseek",
  Local: "group-local",
};

const DEFAULT_MODEL_DESCRIPTIONS: Record<string, string> = {
  "gpt-5.6-sol": "GPT-5.6-sol，前沿复杂推理模型。",
  "gpt-image-2": "OpenAI 生图模型。",
  "claude-fable-5": "Claude Fable 5，顶级复杂推理模型。",
};

export const INITIAL_CATALOG_MODELS: CatalogModel[] = Object.entries(MODEL_CATALOG).flatMap(
  ([family, models]) =>
    models.map((model) => ({
      id: `catalog-${model.id.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
      name: model.name,
      invocationName: model.id,
      groupId: FAMILY_GROUPS[family],
      description:
        DEFAULT_MODEL_DESCRIPTIONS[model.id] ??
        `${model.name}，适用于${model.capability.replaceAll("·", "、")}场景。`,
      context: model.context,
      capability: model.capability,
      inputTypes: [...model.inputTypes],
      supportsReasoning: model.supportsReasoning ?? false,
      supportsAgent: model.supportsAgent ?? false,
    })),
);

export const INITIAL_APIS: ApiConfig[] = [
  {
    id: "arc-openai",
    name: "OpenAI · Main",
    format: "openai-compatible",
    endpoint: "https://api.openai.com/v1",
    apiKey: "",
    enabled: true,
    color: "#b9f16f",
    models: [...MODEL_CATALOG.OpenAI],
  },
  {
    id: "arc-anthropic",
    name: "Anthropic · Direct",
    format: "anthropic",
    endpoint: "https://api.anthropic.com",
    apiKey: "",
    enabled: true,
    color: "#e7a478",
    models: [...MODEL_CATALOG.Anthropic],
  },
  {
    id: "arc-deepseek",
    name: "DeepSeek · CN",
    format: "openai-compatible",
    endpoint: "https://api.deepseek.com",
    apiKey: "",
    enabled: true,
    color: "#72a9ff",
    models: [...MODEL_CATALOG.DeepSeek],
  },
  {
    id: "arc-local",
    name: "Ollama · Studio",
    format: "ollama",
    endpoint: "http://127.0.0.1:11434",
    apiKey: "",
    enabled: false,
    color: "#c7cbd0",
    models: [...MODEL_CATALOG.Local],
  },
];

const historySeeds = [
  ["设计多模型路由策略", "比较成本、时延和上下文长度…", "12 分钟", "gpt-5.6-sol", "GPT-5.6-sol", "OpenAI · Main", "今天"],
  ["重构支付回调模块", "先从边界条件和幂等性开始…", "48 分钟", "claude-sonnet-5", "Claude Sonnet 5", "Anthropic · Direct", "今天"],
  ["Ubuntu 部署检查单", "Docker Compose 与 Nginx 配置…", "2 小时", "deepseek-v4-pro", "DeepSeek V4 Pro", "DeepSeek · CN", "今天"],
  ["整理会议纪要", "将讨论内容转为决策与行动项…", "4 小时", "gpt-5.4-mini", "GPT-5.4 mini", "OpenAI · Main", "今天"],
  ["PostgreSQL 索引优化", "分析慢查询执行计划并给出建议…", "昨天", "claude-opus-4-8", "Claude Opus 4.8", "Anthropic · Direct", "昨天"],
  ["产品定价页文案", "减少术语，突出用户能获得的结果…", "昨天", "gpt-5.5", "GPT-5.5", "OpenAI · Main", "昨天"],
  ["RAG 评测方案", "召回率、忠实度与回答相关性…", "周一", "deepseek-v4-flash", "DeepSeek V4 flash", "DeepSeek · CN", "更早"],
  ["TypeScript 类型体操", "用条件类型抽取嵌套字段路径…", "周一", "claude-fable-5", "Claude Fable 5", "Anthropic · Direct", "更早"],
  ["竞品功能矩阵", "从模型覆盖、计费与团队协作对比…", "7 月 23 日", "gpt-5.6-sol", "GPT-5.6-sol", "OpenAI · Main", "更早"],
  ["API 错误码规范", "统一外部错误、内部错误和追踪 ID…", "7 月 21 日", "deepseek-v4-pro", "DeepSeek V4 Pro", "DeepSeek · CN", "更早"],
  ["日志脱敏规则", "识别密钥、个人信息和业务敏感字段…", "7 月 18 日", "gpt-5.4-mini", "GPT-5.4 mini", "OpenAI · Main", "更早"],
  ["前端状态管理选型", "比较 Zustand、Redux Toolkit 与 Context…", "7 月 16 日", "claude-opus-4-6", "Claude Opus 4.6", "Anthropic · Direct", "更早"],
] as const;

export const INITIAL_HISTORY: ChatHistory[] = historySeeds.map((item, index) => ({
  id: `chat-${index + 1}`,
  title: item[0],
  preview: item[1],
  updatedAt: item[2],
  modelId: item[3],
  modelName: item[4],
  providerName: item[5],
  group: item[6],
}));
