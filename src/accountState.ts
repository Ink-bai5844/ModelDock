import {
  INITIAL_APIS,
  INITIAL_CATALOG_MODELS,
  INITIAL_HISTORY,
  INITIAL_MODEL_GROUPS,
} from "./data";
import {
  DEFAULT_CUSTOM_MAPPING,
  INITIAL_CUSTOM_MAPPING_TEMPLATES,
} from "./mappingTemplates";
import {
  DEFAULT_EFFECT_SETTINGS,
  type EffectSettings,
} from "./effects";
import type {
  ApiConfig,
  CatalogModel,
  ChatAttachment,
  ChatHistory,
  ChatMessage,
  ConversationRecord,
  CustomMappingTemplate,
  ModelGroup,
  ModelInputType,
  ModelOption,
} from "./types";

export type ThemeMode = "dark" | "light";
export type AccentName = "lime" | "blue" | "violet" | "orange" | "rose" | "cyan";

export interface PersistedAppState {
  version: 5;
  configs: ApiConfig[];
  customMappingTemplates: CustomMappingTemplate[];
  deletedBuiltInTemplateIds: string[];
  modelGroups: ModelGroup[];
  catalogModels: CatalogModel[];
  theme: ThemeMode;
  accent: AccentName;
  effectSettings: EffectSettings;
  conversations: ConversationRecord[];
  activeConversationId: string | null;
  selectedModelId: string;
  selectedApiId: string;
}

const DEMO_MESSAGES: ChatMessage[] = [
  {
    id: "message-user-demo",
    role: "user",
    content: "我正在设计一个统一的多模型 API 网关。第一版的路由策略应该考虑哪些维度？",
    meta: "22:14",
  },
  {
    id: "message-assistant-demo",
    role: "assistant",
    author: "GPT-5.6-sol",
    content:
      "第一版不必追求“智能路由”，先把规则做得可解释、可观测。\n\n建议从能力匹配、硬性约束、动态健康信号和回退路径四个维度开始。每次决策都应记录为什么选择这个模型，便于后续观测和迭代。",
    meta: "GPT-5.6-sol · 示例会话",
  },
];

function createInitialConversations(): ConversationRecord[] {
  const now = Date.now();
  return INITIAL_HISTORY.map((item, index) => ({
    id: item.id,
    title: item.title,
    preview: item.preview.replace(/…$/, ""),
    updatedAt: new Date(now - index * 3_600_000).toISOString(),
    configId: INITIAL_APIS.find(
      (config) =>
        config.name === item.providerName &&
        config.models.some((model) => model.id === item.modelId),
    )?.id,
    modelId: item.modelId,
    modelName: item.modelName,
    providerName: item.providerName,
    messages:
      index === 0
        ? DEMO_MESSAGES
        : [
            {
              id: `${item.id}-user`,
              role: "user",
              content: item.title,
              meta: item.updatedAt,
            },
            {
              id: `${item.id}-assistant`,
              role: "assistant",
              author: item.modelName,
              content: item.preview.replace(/…$/, ""),
              meta: `${item.modelName} · 示例记录`,
            },
          ],
  }));
}

export function createDefaultAppState(): PersistedAppState {
  return {
    version: 5,
    configs: structuredClone(INITIAL_APIS),
    customMappingTemplates: structuredClone(INITIAL_CUSTOM_MAPPING_TEMPLATES),
    deletedBuiltInTemplateIds: [],
    modelGroups: structuredClone(INITIAL_MODEL_GROUPS),
    catalogModels: structuredClone(INITIAL_CATALOG_MODELS),
    theme: "dark",
    accent: "blue",
    effectSettings: structuredClone(DEFAULT_EFFECT_SETTINGS),
    conversations: createInitialConversations(),
    activeConversationId: INITIAL_HISTORY[0]?.id ?? null,
    selectedModelId: "gpt-5.6-sol",
    selectedApiId: INITIAL_APIS[0]?.id ?? "",
  };
}

function normalizeMappingTemplates(
  value: unknown,
  defaults: CustomMappingTemplate[],
): CustomMappingTemplate[] {
  if (!Array.isArray(value)) return defaults;
  return value.flatMap((template) => {
    if (!template || typeof template !== "object" || Array.isArray(template)) return [];
    const stored = template as Partial<CustomMappingTemplate>;
    if (
      typeof stored.id !== "string" ||
      !stored.id ||
      typeof stored.name !== "string" ||
      !stored.name ||
      !stored.mapping ||
      typeof stored.mapping !== "object"
    ) {
      return [];
    }
    return [{
      id: stored.id,
      name: stored.name,
      description:
        typeof stored.description === "string" ? stored.description : "",
      endpoint: typeof stored.endpoint === "string" ? stored.endpoint : "",
      suggestedModel:
        typeof stored.suggestedModel === "string" ? stored.suggestedModel : "",
      mapping: {
        ...DEFAULT_CUSTOM_MAPPING,
        ...stored.mapping,
      },
    }];
  });
}

const INPUT_TYPES = new Set<ModelInputType>(["text", "image", "video", "audio"]);

function normalizeInputTypes(value: unknown): ModelInputType[] {
  if (!Array.isArray(value)) return ["text"];
  const normalized = value.filter(
    (item): item is ModelInputType =>
      typeof item === "string" && INPUT_TYPES.has(item as ModelInputType),
  );
  return normalized.length ? [...new Set(normalized)] : ["text"];
}

function normalizeAttachment(value: unknown): ChatAttachment | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const attachment = value as Partial<ChatAttachment>;
  if (
    typeof attachment.id !== "string" ||
    typeof attachment.name !== "string" ||
    typeof attachment.mimeType !== "string" ||
    typeof attachment.kind !== "string" ||
    !INPUT_TYPES.has(attachment.kind as ModelInputType)
  ) {
    return undefined;
  }
  return {
    id: attachment.id,
    kind: attachment.kind as ModelInputType,
    name: attachment.name,
    mimeType: attachment.mimeType,
    size:
      typeof attachment.size === "number" && Number.isFinite(attachment.size)
        ? Math.max(0, attachment.size)
        : 0,
    dataUrl: typeof attachment.dataUrl === "string" ? attachment.dataUrl : undefined,
    url: typeof attachment.url === "string" ? attachment.url : undefined,
  };
}

function normalizeCatalogModels(
  value: unknown,
  defaults: CatalogModel[],
): CatalogModel[] {
  if (!Array.isArray(value)) return defaults;
  return value.map((model) => {
    const stored = model as CatalogModel;
    const fallback = defaults.find(
      (item) =>
        item.id === stored.id || item.invocationName === stored.invocationName,
    );
    return {
      ...stored,
      inputTypes: normalizeInputTypes(stored.inputTypes ?? fallback?.inputTypes),
      supportsReasoning:
        stored.supportsReasoning ?? fallback?.supportsReasoning ?? false,
    };
  });
}

function normalizeConfigs(
  value: unknown,
  defaults: ApiConfig[],
  catalogModels: CatalogModel[],
): ApiConfig[] {
  if (!Array.isArray(value)) return defaults;
  return value.map((config) => {
    const stored = config as ApiConfig;
    return {
      ...stored,
      models: Array.isArray(stored.models)
        ? stored.models.map((model): ModelOption => {
            const catalogModel = catalogModels.find(
              (item) =>
                item.id === model.catalogId ||
                item.invocationName === model.id,
            );
            return {
              ...model,
              inputTypes: normalizeInputTypes(
                model.inputTypes ?? catalogModel?.inputTypes,
              ),
              supportsReasoning:
                model.supportsReasoning ??
                catalogModel?.supportsReasoning ??
                false,
            };
          })
        : [],
    };
  });
}

export function normalizeAppState(value: unknown): PersistedAppState {
  const defaults = createDefaultAppState();
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaults;
  const stored = value as Partial<PersistedAppState>;
  const catalogModels = normalizeCatalogModels(
    stored.catalogModels,
    defaults.catalogModels,
  );
  const deletedBuiltInTemplateIds = Array.isArray(
    stored.deletedBuiltInTemplateIds,
  )
    ? stored.deletedBuiltInTemplateIds.filter(
        (id): id is string => typeof id === "string" && id.startsWith("builtin-"),
      )
    : [];
  const customMappingTemplates = normalizeMappingTemplates(
    stored.customMappingTemplates,
    defaults.customMappingTemplates,
  );
  return {
    ...defaults,
    ...stored,
    version: 5,
    configs: normalizeConfigs(stored.configs, defaults.configs, catalogModels),
    customMappingTemplates,
    deletedBuiltInTemplateIds,
    modelGroups:
      Array.isArray(stored.modelGroups) && stored.modelGroups.length
        ? stored.modelGroups
        : defaults.modelGroups,
    catalogModels,
    effectSettings: {
      ...defaults.effectSettings,
      ...stored.effectSettings,
      particles: {
        ...defaults.effectSettings.particles,
        ...stored.effectSettings?.particles,
      },
      connections: {
        ...defaults.effectSettings.connections,
        ...stored.effectSettings?.connections,
      },
      pointer: {
        ...defaults.effectSettings.pointer,
        ...stored.effectSettings?.pointer,
      },
      grid: { ...defaults.effectSettings.grid, ...stored.effectSettings?.grid },
      orbits: { ...defaults.effectSettings.orbits, ...stored.effectSettings?.orbits },
      haze: { ...defaults.effectSettings.haze, ...stored.effectSettings?.haze },
      scan: { ...defaults.effectSettings.scan, ...stored.effectSettings?.scan },
    },
    conversations: Array.isArray(stored.conversations)
      ? stored.conversations.map((conversation) => ({
          ...conversation,
          messages: Array.isArray(conversation.messages)
            ? conversation.messages.map((message) => ({
                ...message,
                reasoning:
                  typeof message.reasoning === "string"
                    ? message.reasoning
                    : undefined,
                attachments: Array.isArray(message.attachments)
                  ? message.attachments
                      .map(normalizeAttachment)
                      .filter(
                        (attachment): attachment is ChatAttachment =>
                          attachment !== undefined,
                      )
                  : undefined,
              }))
            : [],
        }))
      : defaults.conversations,
  };
}

function relativeTime(iso: string): string {
  const elapsed = Math.max(0, Date.now() - new Date(iso).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时`;
  if (hours < 48) return "昨天";
  return new Date(iso).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

export function conversationToHistory(conversation: ConversationRecord): ChatHistory {
  const elapsed = Date.now() - new Date(conversation.updatedAt).getTime();
  return {
    id: conversation.id,
    title: conversation.title,
    preview: conversation.preview,
    updatedAt: relativeTime(conversation.updatedAt),
    group: elapsed < 24 * 3_600_000 ? "今天" : elapsed < 48 * 3_600_000 ? "昨天" : "更早",
    modelId: conversation.modelId,
    modelName: conversation.modelName,
    providerName: conversation.providerName,
  };
}
