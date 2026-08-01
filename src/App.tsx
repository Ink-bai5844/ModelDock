import {
  ArrowClockwise,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Brain,
  CaretDown,
  ChatCircleText,
  Check,
  CheckCircle,
  CheckSquare,
  CircleNotch,
  Code,
  Command,
  Copy,
  DotsSixVertical,
  DotsThree,
  DownloadSimple,
  Eye,
  EyeSlash,
  FileText,
  FloppyDisk,
  GearSix,
  Globe,
  LockKey,
  MagnifyingGlass,
  Moon,
  Paperclip,
  Palette,
  PencilSimple,
  Plus,
  SidebarSimple,
  SignOut,
  SlidersHorizontal,
  SquaresFour,
  Stop,
  Sun,
  TestTube,
  Trash,
  VideoCamera,
  Waveform,
  ImageSquare,
  X,
} from "@phosphor-icons/react";
import {
  type FormEvent,
  lazy,
  Suspense,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  conversationToHistory,
  normalizeAppState,
  type AccentName,
  type PersistedAppState,
  type ThemeMode,
} from "./accountState";
import { rememberAccountTheme } from "./accountThemeCache";
import {
  changePassword,
  ClientApiError,
  getRuntimeConfig,
  getSession,
  loadUserState,
  login,
  logout,
  register,
  saveUserState,
  streamChat,
  testProviderConnection,
} from "./api";
import { AppearanceDrawer } from "./AppearanceDrawer";
import { AuthScreen } from "./AuthScreen";
import type { EffectSettings } from "./effects";
import { ParticleField } from "./ParticleField";
import { ModelCatalogWorkspace } from "./ModelCatalogWorkspace";
import { ReasoningPanel } from "./ReasoningPanel";
import { DEFAULT_CUSTOM_MAPPING } from "./mappingTemplates";
import {
  acceptForInputTypes,
  attachmentSource,
  fileToAttachment,
  formatBytes,
  MAX_DRAFT_ATTACHMENT_BYTES,
  MAX_DRAFT_ATTACHMENTS,
  MODEL_INPUT_TYPE_LABELS,
} from "./media";
import { moveItemById, useSortableList } from "./sortable";
import type {
  ApiConfig,
  AuthUser,
  CatalogModel,
  ChatAttachment,
  ChatHistory,
  ChatMessage,
  ConversationRecord,
  CustomMappingTemplate,
  CustomProviderMapping,
  ModelGroup,
  ModelInputType,
  ModelOption,
  ProviderFormat,
} from "./types";

const PAGE_SIZE = 6;

const MarkdownContent = lazy(() =>
  import("./MarkdownContent").then((module) => ({
    default: module.MarkdownContent,
  })),
);

type AppView = "chat" | "settings" | "catalog";

const ACCENT_RGB: Record<ThemeMode, Record<AccentName, string>> = {
  dark: {
    lime: "185, 241, 111",
    blue: "121, 184, 255",
    violet: "200, 164, 255",
    orange: "255, 179, 107",
    rose: "255, 146, 173",
    cyan: "101, 217, 209",
  },
  light: {
    lime: "63, 114, 13",
    blue: "23, 105, 170",
    violet: "112, 66, 163",
    orange: "168, 78, 8",
    rose: "170, 53, 85",
    cyan: "13, 116, 111",
  },
};

const ACCENT_OPTIONS: Array<{ id: AccentName; label: string; color: string }> = [
  { id: "lime", label: "荧光绿", color: "#b9f16f" },
  { id: "blue", label: "钴蓝", color: "#79b8ff" },
  { id: "violet", label: "紫罗兰", color: "#c8a4ff" },
  { id: "orange", label: "琥珀橙", color: "#ffb36b" },
  { id: "rose", label: "玫瑰红", color: "#ff92ad" },
  { id: "cyan", label: "青绿色", color: "#65d9d1" },
];

const FORMAT_LABELS: Record<ProviderFormat, string> = {
  "openai-compatible": "OpenAI Compatible",
  anthropic: "Anthropic Messages",
  gemini: "Google Gemini",
  ollama: "Ollama Local",
  custom: "自定义映射",
};

const formatHint: Record<ProviderFormat, string> = {
  "openai-compatible": "兼容 /v1/chat/completions 的接口，包括 OpenAI、DeepSeek 与多数中转服务。",
  anthropic: "使用独立 system 参数与 content block 的 Anthropic Messages API。",
  gemini: "使用 contents / parts 结构的 Google Generative Language API。",
  ollama: "连接 Ollama 本地或私有网络中的 /api/chat 端点。",
  custom: "通过字段路径与协议映射接入 JSON、Multipart、SSE 或 NDJSON 接口。",
};

interface UserAvatarProps {
  username: string;
  className: string;
}

function UserAvatar({ username, className }: UserAvatarProps) {
  const initials = Array.from(username.trim()).slice(0, 2).join("").toLocaleUpperCase();

  return (
    <span
      className={className}
      role="img"
      aria-label={`${username} 的头像`}
      title={username}
    >
      {initials}
    </span>
  );
}

interface WorkspaceAppProps {
  user: AuthUser;
  initialState: PersistedAppState;
  onLoggedOut: () => void;
}

function activateAccountTheme(accountId: string, theme: ThemeMode) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  rememberAccountTheme(window.localStorage, accountId, theme);
}

function WorkspaceApp({ user, initialState, onLoggedOut }: WorkspaceAppProps) {
  const [view, setView] = useState<AppView>("chat");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [configs, setConfigs] = useState<ApiConfig[]>(initialState.configs);
  const [mappingTemplates, setMappingTemplates] = useState<CustomMappingTemplate[]>(
    initialState.customMappingTemplates,
  );
  const [deletedBuiltInTemplateIds, setDeletedBuiltInTemplateIds] = useState<string[]>(
    initialState.deletedBuiltInTemplateIds ?? [],
  );
  const [modelGroups, setModelGroups] = useState<ModelGroup[]>(initialState.modelGroups);
  const [catalogModels, setCatalogModels] = useState<CatalogModel[]>(initialState.catalogModels);
  const [selectedApiId, setSelectedApiId] = useState(initialState.selectedApiId);
  const [editingApiId, setEditingApiId] = useState(initialState.selectedApiId);
  const [selectedModelId, setSelectedModelId] = useState(initialState.selectedModelId);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(initialState.theme);
  const [accent, setAccent] = useState<AccentName>(initialState.accent);
  const [effectSettings, setEffectSettings] = useState<EffectSettings>(initialState.effectSettings);
  const [conversations, setConversations] = useState<ConversationRecord[]>(
    initialState.conversations,
  );
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    initialState.activeConversationId,
  );
  const [historyQuery, setHistoryQuery] = useState("");
  const deferredHistoryQuery = useDeferredValue(historyQuery);
  const [historyPage, setHistoryPage] = useState(1);
  const initialConversation =
    initialState.conversations.find(
      (conversation) => conversation.id === initialState.activeConversationId,
    ) ?? initialState.conversations[0];
  const [currentTitle, setCurrentTitle] = useState(
    initialConversation?.title ?? "未命名对话",
  );
  const [messages, setMessages] = useState<ChatMessage[]>(
    initialConversation?.messages ?? [],
  );
  const [draft, setDraft] = useState("");
  const [draftAttachments, setDraftAttachments] = useState<ChatAttachment[]>([]);
  const [editingPromptMessageId, setEditingPromptMessageId] = useState<string | null>(
    null,
  );
  const [isStreaming, setIsStreaming] = useState(false);
  const [reasoningEnabled, setReasoningEnabled] = useState(false);
  const [toast, setToast] = useState("");
  const abortController = useRef<AbortController | null>(null);
  const promptEditDraftBackup = useRef<{
    content: string;
    attachments: ChatAttachment[];
  } | null>(null);
  const messagesRef = useRef(messages);

  const availableModels = useMemo(
    () =>
      configs
        .filter((config) => config.enabled)
        .flatMap((config) =>
          config.models.map((model) => ({ ...model, configId: config.id, providerName: config.name })),
        ),
    [configs],
  );

  const selectedModel =
    availableModels.find(
      (model) =>
        model.configId === selectedApiId &&
        model.id === selectedModelId,
    ) ?? availableModels[0];
  const reasoningAvailable = selectedModel?.supportsReasoning === true;
  const reasoningActive = reasoningAvailable && reasoningEnabled;

  useEffect(() => {
    setReasoningEnabled(false);
  }, [
    selectedModel?.configId,
    selectedModel?.id,
    selectedModel?.supportsReasoning,
  ]);

  useEffect(() => {
    if (
      availableModels.length &&
      !availableModels.some(
        (model) =>
          model.configId === selectedApiId &&
          model.id === selectedModelId,
      )
    ) {
      setSelectedApiId(availableModels[0].configId);
      setSelectedModelId(availableModels[0].id);
    }
  }, [availableModels, selectedApiId, selectedModelId]);

  useEffect(() => {
    setHistoryPage(1);
  }, [deferredHistoryQuery]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    activateAccountTheme(user.id, theme);
    document.documentElement.dataset.accent = accent;
  }, [user.id, theme, accent]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const persistedState = useMemo<PersistedAppState>(
    () => ({
      version: 5,
      configs,
      customMappingTemplates: mappingTemplates,
      deletedBuiltInTemplateIds,
      modelGroups,
      catalogModels,
      theme,
      accent,
      effectSettings,
      conversations,
      activeConversationId,
      selectedModelId,
      selectedApiId,
    }),
    [
      accent,
      activeConversationId,
      catalogModels,
      configs,
      conversations,
      deletedBuiltInTemplateIds,
      effectSettings,
      mappingTemplates,
      modelGroups,
      selectedApiId,
      selectedModelId,
      theme,
    ],
  );

  const saveFailureNotified = useRef(false);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void saveUserState(persistedState)
        .then(() => {
          saveFailureNotified.current = false;
        })
        .catch((error) => {
          if (error instanceof ClientApiError && error.status === 401) {
            onLoggedOut();
            return;
          }
          if (!saveFailureNotified.current) {
            saveFailureNotified.current = true;
            setToast(error instanceof Error ? error.message : "账号状态保存失败");
          }
        });
    }, isStreaming ? 900 : 420);
    return () => window.clearTimeout(timer);
  }, [isStreaming, onLoggedOut, persistedState]);

  useEffect(
    () => () => {
      abortController.current?.abort();
    },
    [],
  );

  const historyItems = useMemo(
    () =>
      [...conversations]
        .sort(
          (left, right) =>
            new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
        )
        .map(conversationToHistory),
    [conversations],
  );

  const filteredHistory = useMemo(() => {
    const query = deferredHistoryQuery.trim().toLowerCase();
    if (!query) return historyItems;
    return historyItems.filter((item) =>
      [item.title, item.preview, item.modelName, item.providerName].some((value) =>
        value.toLowerCase().includes(query),
      ),
    );
  }, [deferredHistoryQuery, historyItems]);

  const totalPages = Math.max(1, Math.ceil(filteredHistory.length / PAGE_SIZE));
  useEffect(() => {
    setHistoryPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const pageHistory = filteredHistory.slice(
    (historyPage - 1) * PAGE_SIZE,
    historyPage * PAGE_SIZE,
  );

  const stopStreaming = () => {
    abortController.current?.abort();
  };

  const resetPromptEdit = (restoreDraft: boolean) => {
    if (!editingPromptMessageId) return;
    const backup = promptEditDraftBackup.current;
    if (restoreDraft && backup) {
      setDraft(backup.content);
      setDraftAttachments(backup.attachments);
    } else {
      setDraft("");
      setDraftAttachments([]);
    }
    promptEditDraftBackup.current = null;
    setEditingPromptMessageId(null);
  };

  const commitConversation = (
    conversationId: string,
    title: string,
    nextMessages: ChatMessage[],
  ) => {
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    setConversations((current) => {
      const existing = current.find((conversation) => conversation.id === conversationId);
      const preview =
        [...nextMessages]
          .reverse()
          .map((message) =>
            message.content.trim() ||
            (message.attachments?.length
              ? `${message.attachments.length} 个${MODEL_INPUT_TYPE_LABELS[message.attachments[0].kind]}附件`
              : ""),
          )
          .find(Boolean)
          ?.slice(0, 96) ?? "新对话";
      const next: ConversationRecord = {
        id: conversationId,
        title,
        preview,
        updatedAt: new Date().toISOString(),
        configId: selectedModel?.configId ?? existing?.configId,
        modelId: selectedModel?.id ?? existing?.modelId ?? "",
        modelName: selectedModel?.name ?? existing?.modelName ?? "未选择模型",
        providerName:
          selectedModel?.providerName ?? existing?.providerName ?? "未选择 API",
        messages: nextMessages,
      };
      return [next, ...current.filter((conversation) => conversation.id !== conversationId)];
    });
  };

  const startStreaming = async (
    conversationId: string,
    title: string,
    requestMessages: ChatMessage[],
  ) => {
    if (!selectedModel) {
      setToast("请先启用一个 API 配置并选择模型");
      return;
    }
    const useReasoning = reasoningAvailable ? reasoningActive : undefined;
    const responseId = `assistant-${Date.now()}`;
    const started = performance.now();
    let assistantContent = "";
    let assistantReasoning = "";
    let assistantAttachments: ChatAttachment[] = [];
    const withPlaceholder = [
      ...requestMessages,
      {
        id: responseId,
        role: "assistant",
        content: "",
        author: selectedModel.name,
        meta: `${selectedModel.name} · 生成中`,
      },
    ] satisfies ChatMessage[];
    commitConversation(conversationId, title, withPlaceholder);
    setIsStreaming(true);
    const controller = new AbortController();
    abortController.current = controller;
    try {
      await streamChat(
        {
          configId: selectedModel.configId,
          model: selectedModel.id,
          messages: requestMessages,
          reasoning: useReasoning,
        },
        controller.signal,
        (chunk) => {
          if (chunk.type === "text-delta") {
            assistantContent += chunk.text;
          } else if (chunk.type === "reasoning-delta") {
            assistantReasoning += chunk.text;
          } else if (
            !assistantAttachments.some(
              (attachment) => attachment.id === chunk.attachment.id,
            )
          ) {
            assistantAttachments = [...assistantAttachments, chunk.attachment];
          }
          commitConversation(
            conversationId,
            title,
            withPlaceholder.map((message) =>
              message.id === responseId
                ? {
                    ...message,
                    content: assistantContent,
                    reasoning: assistantReasoning || undefined,
                    attachments: assistantAttachments,
                    meta: `${selectedModel.name} · ${
                      assistantReasoning && !assistantContent
                        ? "思考中"
                        : "生成中"
                    }`,
                  }
                : message,
            ),
          );
        },
      );
      const elapsed = ((performance.now() - started) / 1000).toFixed(1);
      commitConversation(
        conversationId,
        title,
        withPlaceholder.map((message) =>
          message.id === responseId
            ? {
                ...message,
                content:
                  assistantContent ||
                  (assistantAttachments.length
                    ? ""
                    : assistantReasoning
                      ? "模型仅返回了思考过程，没有最终回答。"
                      : "模型没有返回文本内容。"),
                reasoning: assistantReasoning || undefined,
                attachments: assistantAttachments,
                meta: `${selectedModel.name} · ${elapsed}s`,
              }
            : message,
        ),
      );
    } catch (error) {
      const cancelled = controller.signal.aborted;
      const message = cancelled
        ? assistantContent || "生成已停止。"
        : error instanceof Error
          ? `请求失败：${error.message}`
          : "请求模型时发生未知错误。";
      commitConversation(
        conversationId,
        title,
        withPlaceholder.map((item) =>
          item.id === responseId
            ? {
                ...item,
                content: message,
                reasoning: assistantReasoning || undefined,
                attachments: assistantAttachments,
                meta: cancelled ? `${selectedModel.name} · 已停止` : `${selectedModel.name} · 错误`,
              }
            : item,
        ),
      );
    } finally {
      if (abortController.current === controller) abortController.current = null;
      setIsStreaming(false);
    }
  };

  const sendMessage = (event?: FormEvent) => {
    event?.preventDefault();
    const text = draft.trim();
    if ((!text && !draftAttachments.length) || isStreaming) return;
    if (!selectedModel) {
      setToast("请先启用一个 API 配置并选择模型");
      return;
    }
    const unsupported = draftAttachments.find(
      (attachment) => !selectedModel.inputTypes.includes(attachment.kind),
    );
    if (unsupported) {
      setToast(
        `${selectedModel.name} 未启用${MODEL_INPUT_TYPE_LABELS[unsupported.kind]}输入，请移除附件或切换模型`,
      );
      return;
    }
    const conversationId = activeConversationId ?? `chat-${Date.now()}`;
    const attachmentTitle = draftAttachments.length
      ? `${MODEL_INPUT_TYPE_LABELS[draftAttachments[0].kind]}附件`
      : "新对话";
    const title =
      activeConversationId && currentTitle !== "未命名对话"
        ? currentTitle
        : text.slice(0, 34) || attachmentTitle;
    const editingIndex = editingPromptMessageId
      ? messagesRef.current.findIndex(
          (message) =>
            message.id === editingPromptMessageId && message.role === "user",
        )
      : -1;
    if (editingPromptMessageId && editingIndex < 0) {
      setToast("找不到要编辑的提示词，请重新打开该对话");
      resetPromptEdit(false);
      return;
    }
    const nextUserMessage: ChatMessage = {
      id: editingPromptMessageId ?? `user-${Date.now()}`,
      role: "user",
      content: text,
      attachments: draftAttachments,
      meta: new Date().toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };
    const requestMessages =
      editingIndex >= 0
        ? [...messagesRef.current.slice(0, editingIndex), nextUserMessage]
        : [...messagesRef.current, nextUserMessage];
    setActiveConversationId(conversationId);
    setCurrentTitle(title);
    setDraft("");
    setDraftAttachments([]);
    setEditingPromptMessageId(null);
    promptEditDraftBackup.current = null;
    commitConversation(conversationId, title, requestMessages);
    void startStreaming(conversationId, title, requestMessages);
  };

  const openHistory = (item: ChatHistory) => {
    const conversation = conversations.find((entry) => entry.id === item.id);
    if (!conversation) return;
    stopStreaming();
    setCurrentTitle(item.title);
    const matchingConfig =
      configs.find((config) => config.id === conversation.configId) ??
      configs.find(
        (config) =>
          config.name === conversation.providerName &&
          config.models.some((model) => model.id === item.modelId),
      );
    if (matchingConfig) setSelectedApiId(matchingConfig.id);
    setSelectedModelId(item.modelId);
    setActiveConversationId(item.id);
    messagesRef.current = conversation.messages;
    setMessages(conversation.messages);
    resetPromptEdit(false);
    setDraftAttachments([]);
    setView("chat");
    setSidebarOpen(false);
  };

  const newChat = () => {
    stopStreaming();
    resetPromptEdit(false);
    setCurrentTitle("未命名对话");
    setActiveConversationId(null);
    messagesRef.current = [];
    setMessages([]);
    setDraft("");
    setDraftAttachments([]);
    setView("chat");
    setSidebarOpen(false);
  };

  const deleteHistory = (conversationIds: string[]) => {
    if (!conversationIds.length) return;
    const deleted = new Set(conversationIds);
    const activeDeleted =
      activeConversationId !== null && deleted.has(activeConversationId);
    stopStreaming();
    setConversations((current) =>
      current.filter((conversation) => !deleted.has(conversation.id)),
    );
    if (activeDeleted) {
      resetPromptEdit(false);
      setActiveConversationId(null);
      setCurrentTitle("未命名对话");
      messagesRef.current = [];
      setMessages([]);
      setDraft("");
      setDraftAttachments([]);
      setView("chat");
    }
    setToast(`已删除 ${conversationIds.length} 条聊天记录`);
  };

  const saveConfigs = async () => {
    await saveUserState(persistedState);
    setToast("配置已保存");
  };

  const applyCatalogChange = (nextModels: CatalogModel[], nextGroups: ModelGroup[]) => {
    const nextModelsById = new Map(nextModels.map((model) => [model.id, model]));
    const nextGroupsById = new Map(nextGroups.map((group) => [group.id, group]));

    setConfigs((currentConfigs) => {
      const nextConfigs = currentConfigs.map((config) => ({
        ...config,
        models: config.models.flatMap((option) => {
          const catalogId =
            option.catalogId ??
            catalogModels.find((model) => model.invocationName === option.id)?.id;
          if (!catalogId) return [option];

          const updated = nextModelsById.get(catalogId);
          if (!updated) return [];

          const group = nextGroupsById.get(updated.groupId);
          return [
            {
              ...option,
              catalogId,
              id: updated.invocationName,
              name: updated.name,
              family: group?.name ?? option.family,
              context: updated.context,
              capability: updated.capability,
              inputTypes: updated.inputTypes,
              supportsReasoning: updated.supportsReasoning ?? false,
            },
          ];
        }),
      }));
      return nextConfigs;
    });

    const selectedCatalogModel = catalogModels.find(
      (model) => model.invocationName === selectedModelId,
    );
    if (selectedCatalogModel) {
      const updated = nextModelsById.get(selectedCatalogModel.id);
      if (updated) setSelectedModelId(updated.invocationName);
    }

    setCatalogModels(nextModels);
    setModelGroups(nextGroups);
  };

  const copyMessage = async (message: ChatMessage) => {
    await navigator.clipboard.writeText(message.content);
    setToast("回答已复制");
  };

  const editLastPrompt = () => {
    if (isStreaming) return;
    let userIndex = -1;
    for (let index = messagesRef.current.length - 1; index >= 0; index -= 1) {
      if (messagesRef.current[index].role === "user") {
        userIndex = index;
        break;
      }
    }
    if (userIndex < 0) {
      setToast("当前对话没有可编辑的提示词");
      return;
    }
    const prompt = messagesRef.current[userIndex];
    if (!editingPromptMessageId) {
      promptEditDraftBackup.current = {
        content: draft,
        attachments: draftAttachments,
      };
    }
    setEditingPromptMessageId(prompt.id);
    setDraft(prompt.content);
    setDraftAttachments(prompt.attachments ?? []);
    setToast(
      prompt.attachments?.length
        ? `已恢复提示词和 ${prompt.attachments.length} 个附件`
        : "已恢复最后一条提示词",
    );
    window.setTimeout(() => document.getElementById("chat-input")?.focus(), 0);
  };

  const regenerateLastAnswer = () => {
    if (isStreaming || !activeConversationId) return;
    let assistantIndex = -1;
    for (let index = messagesRef.current.length - 1; index >= 0; index -= 1) {
      if (messagesRef.current[index].role === "assistant") {
        assistantIndex = index;
        break;
      }
    }
    if (assistantIndex < 1) return;
    const requestMessages = messagesRef.current.slice(0, assistantIndex);
    if (requestMessages[requestMessages.length - 1]?.role !== "user") return;
    void startStreaming(activeConversationId, currentTitle, requestMessages);
  };

  const handleLogout = async () => {
    stopStreaming();
    try {
      await saveUserState(persistedState);
    } finally {
      await logout().catch(() => undefined);
      onLoggedOut();
    }
  };

  const handleChangePassword = async (
    currentPassword: string,
    newPassword: string,
  ) => {
    await saveUserState(persistedState);
    await changePassword(currentPassword, newPassword);
    setToast("密码已更新");
  };

  const navigate = (nextView: AppView) => {
    setView(nextView);
    setCommandOpen(false);
    setSidebarOpen(false);
    window.setTimeout(() => document.getElementById("main-content")?.focus(), 0);
  };

  const focusHistorySearch = () => {
    setCommandOpen(false);
    setSidebarOpen(true);
    window.setTimeout(
      () => document.getElementById("history-search")?.focus(),
      0,
    );
  };

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.matches("input, textarea, select, [contenteditable='true']") ??
        false;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        focusHistorySearch();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "/") {
        event.preventDefault();
        setCommandOpen(true);
        return;
      }
      if (!isTyping && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        newChat();
      }
      if (event.key === "Escape") setCommandOpen(false);
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  });

  return (
    <div className="app-shell">
      <ParticleField
        settings={effectSettings}
        accentRgb={ACCENT_RGB[theme][accent]}
        isLight={theme === "light"}
      />
      <Sidebar
        open={sidebarOpen}
        view={view}
        query={historyQuery}
        onQuery={setHistoryQuery}
        history={pageHistory}
        page={historyPage}
        totalPages={totalPages}
        onPage={setHistoryPage}
        onClose={() => setSidebarOpen(false)}
        onNavigate={navigate}
        onNewChat={newChat}
        onOpenHistory={openHistory}
        allHistoryIds={filteredHistory.map((item) => item.id)}
        onDeleteHistory={deleteHistory}
        username={user.username}
        onChangePassword={handleChangePassword}
        onLogout={() => void handleLogout()}
      />
      {sidebarOpen && (
        <button
          className="sidebar-scrim"
          aria-label="关闭侧栏"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <main id="main-content" className="main-stage" tabIndex={-1}>
        <Topbar
          title={
            view === "chat"
              ? currentTitle
              : view === "settings"
                ? "API 连接"
                : "模型目录"
          }
          view={view}
          selectedModel={selectedModel}
          selectedProvider={selectedModel?.providerName}
          modelMenuOpen={modelMenuOpen}
          themeMenuOpen={themeMenuOpen}
          theme={theme}
          accent={accent}
          configs={configs}
          onToggleSidebar={() => setSidebarOpen((open) => !open)}
          onToggleModelMenu={() => {
            setModelMenuOpen((open) => !open);
            setThemeMenuOpen(false);
          }}
          selectedApiId={selectedApiId}
          onSelectModel={(configId, modelId) => {
            setSelectedApiId(configId);
            setSelectedModelId(modelId);
            setModelMenuOpen(false);
          }}
          onOpenSettings={() => navigate("settings")}
          onToggleThemeMenu={() => {
            setThemeMenuOpen((open) => !open);
            setModelMenuOpen(false);
          }}
          onTheme={setTheme}
          onAccent={setAccent}
          onOpenAppearance={() => {
            setThemeMenuOpen(false);
            setAppearanceOpen(true);
          }}
          onOpenCommands={() => setCommandOpen(true)}
        />

        {view === "chat" ? (
          <ChatWorkspace
            messages={messages}
            draft={draft}
            draftAttachments={draftAttachments}
            username={user.username}
            modelName={selectedModel?.name ?? "暂无可用模型"}
            providerName={selectedModel?.providerName ?? "请先启用 API"}
            inputTypes={selectedModel?.inputTypes ?? ["text"]}
            reasoningAvailable={reasoningAvailable}
            reasoningEnabled={reasoningActive}
            isStreaming={isStreaming}
            editingPromptMessageId={editingPromptMessageId}
            onDraft={setDraft}
            onAddAttachments={(attachments) =>
              setDraftAttachments((current) => [...current, ...attachments])
            }
            onRemoveAttachment={(attachmentId) =>
              setDraftAttachments((current) =>
                current.filter((attachment) => attachment.id !== attachmentId),
              )
            }
            onSend={sendMessage}
            onToggleReasoning={() =>
              setReasoningEnabled((enabled) => !enabled)
            }
            onStop={stopStreaming}
            onCopy={(message) => void copyMessage(message)}
            onRegenerate={regenerateLastAnswer}
            onEditLastPrompt={editLastPrompt}
            onCancelPromptEdit={() => resetPromptEdit(true)}
            onToast={setToast}
          />
        ) : view === "settings" ? (
          <SettingsWorkspace
            configs={configs}
            mappingTemplates={mappingTemplates}
            catalogModels={catalogModels}
            modelGroups={modelGroups}
            selectedApiId={editingApiId}
            onSelect={setEditingApiId}
            onChange={setConfigs}
            onTemplatesChange={setMappingTemplates}
            onTemplateDeleted={(templateId) => {
              if (!templateId.startsWith("builtin-")) return;
              setDeletedBuiltInTemplateIds((deletedIds) =>
                deletedIds.includes(templateId)
                  ? deletedIds
                  : [...deletedIds, templateId],
              );
            }}
            onSave={saveConfigs}
            onToast={setToast}
            onOpenCatalog={() => navigate("catalog")}
          />
        ) : (
          <ModelCatalogWorkspace
            models={catalogModels}
            groups={modelGroups}
            onChange={applyCatalogChange}
            onToast={setToast}
            onOpenApis={() => navigate("settings")}
          />
        )}
      </main>

      {toast && (
        <div className="toast" role="status" aria-live="polite">
          <CheckCircle size={18} weight="fill" />
          {toast}
        </div>
      )}
      <AppearanceDrawer
        open={appearanceOpen}
        settings={effectSettings}
        onChange={setEffectSettings}
        onClose={() => setAppearanceOpen(false)}
      />
      {commandOpen && (
        <CommandPalette
          onClose={() => setCommandOpen(false)}
          onNewChat={newChat}
          onSearch={focusHistorySearch}
          onNavigate={navigate}
          onAppearance={() => {
            setCommandOpen(false);
            setAppearanceOpen(true);
          }}
        />
      )}
    </div>
  );
}

interface SidebarProps {
  open: boolean;
  view: AppView;
  query: string;
  history: ChatHistory[];
  page: number;
  totalPages: number;
  onQuery: (query: string) => void;
  onPage: (page: number) => void;
  onClose: () => void;
  onNavigate: (view: AppView) => void;
  onNewChat: () => void;
  onOpenHistory: (item: ChatHistory) => void;
  allHistoryIds: string[];
  onDeleteHistory: (conversationIds: string[]) => void;
  username: string;
  onChangePassword: (
    currentPassword: string,
    newPassword: string,
  ) => Promise<void>;
  onLogout: () => void;
}

function Sidebar({
  open,
  view,
  query,
  history,
  page,
  totalPages,
  onQuery,
  onPage,
  onClose,
  onNavigate,
  onNewChat,
  onOpenHistory,
  allHistoryIds,
  onDeleteHistory,
  username,
  onChangePassword,
  onLogout,
}: SidebarProps) {
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  const allFilteredSelected =
    allHistoryIds.length > 0 &&
    allHistoryIds.every((id) => selectedHistoryIds.has(id));

  useEffect(() => {
    if (!batchMode) return;
    setSelectedHistoryIds(new Set());
    setDeleteConfirmationOpen(false);
  }, [batchMode, query]);

  const toggleHistorySelection = (id: string) => {
    setSelectedHistoryIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const closeBatchMode = () => {
    setBatchMode(false);
    setSelectedHistoryIds(new Set());
    setDeleteConfirmationOpen(false);
  };

  const confirmHistoryDeletion = () => {
    const selected = [...selectedHistoryIds];
    onDeleteHistory(selected);
    closeBatchMode();
  };

  return (
    <aside className={`sidebar ${open ? "is-open" : ""}`} aria-label="主导航">
      <div className="brand-row">
        <button className="brand-lockup" onClick={() => onNavigate("chat")} aria-label="ModelDock 首页">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>ModelDock</span>
        </button>
        <button className="icon-button sidebar-close" onClick={onClose} aria-label="关闭侧栏">
          <X size={19} />
        </button>
      </div>

      <button className="new-chat-button" onClick={onNewChat}>
        <Plus size={18} />
        <span>新建对话</span>
        <kbd>N</kbd>
      </button>

      <nav className="primary-nav" aria-label="功能导航">
        <button className={view === "chat" ? "active" : ""} onClick={() => onNavigate("chat")}>
          <ChatCircleText size={19} />
          对话
        </button>
        <button
          className={view === "settings" ? "active" : ""}
          onClick={() => onNavigate("settings")}
        >
          <SlidersHorizontal size={19} />
          API 连接
        </button>
        <button
          className={view === "catalog" ? "active" : ""}
          onClick={() => onNavigate("catalog")}
        >
          <SquaresFour size={19} />
          模型目录
        </button>
      </nav>

      <div className="history-heading">
        <span>{batchMode ? `已选 ${selectedHistoryIds.size} 项` : "历史记录"}</span>
        <button
          className={`mini-icon-button ${batchMode ? "active" : ""}`}
          aria-label={batchMode ? "退出批量管理" : "批量管理历史记录"}
          aria-pressed={batchMode}
          title={batchMode ? "退出批量管理" : "批量管理"}
          disabled={!batchMode && !allHistoryIds.length}
          onClick={() => {
            if (batchMode) closeBatchMode();
            else setBatchMode(true);
          }}
        >
          {batchMode ? <X size={17} /> : <CheckSquare size={18} />}
        </button>
      </div>

      <label className="search-field">
        <span className="sr-only">搜索历史对话</span>
        <MagnifyingGlass size={17} />
        <input
          id="history-search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="搜索标题、模型或内容"
          autoComplete="off"
        />
        {query ? (
          <button onClick={() => onQuery("")} aria-label="清除搜索">
            <X size={15} />
          </button>
        ) : (
          <kbd>⌘ K</kbd>
        )}
      </label>

      <div className="history-list" aria-live="polite">
        {history.length ? (
          history.map((item) => {
            const selected = selectedHistoryIds.has(item.id);
            return (
              <button
                className={`history-item ${batchMode ? "selection-mode" : ""} ${selected ? "selected" : ""}`}
                key={item.id}
                onClick={() =>
                  batchMode
                    ? toggleHistorySelection(item.id)
                    : onOpenHistory(item)
                }
                aria-pressed={batchMode ? selected : undefined}
                aria-label={
                  batchMode
                    ? `${selected ? "取消选择" : "选择"}：${item.title}`
                    : undefined
                }
              >
                {batchMode && (
                  <span className="history-selector" aria-hidden="true">
                    {selected && <Check size={13} weight="bold" />}
                  </span>
                )}
                <span className="history-item-copy">
                  <span className="history-item-top">
                    <span className="history-title">{item.title}</span>
                    <time>{item.updatedAt}</time>
                  </span>
                  <span className="history-preview">{item.preview}</span>
                  <span className="history-model">
                    <i className={`model-dot model-dot-${item.modelId.split("-")[0]}`} />
                    {item.modelName}
                  </span>
                </span>
              </button>
            );
          })
        ) : (
          <div className="empty-history">
            <MagnifyingGlass size={22} />
            <strong>{query ? "没有匹配的对话" : "还没有聊天记录"}</strong>
            <span>
              {query
                ? "试试模型名称或更短的关键词"
                : "发送第一条消息后，对话会出现在这里"}
            </span>
          </div>
        )}
      </div>

      <div className="sidebar-footer">
        {batchMode && (
          <div className="history-batch-toolbar" aria-label="批量操作">
            <div>
              <button
                onClick={() =>
                  setSelectedHistoryIds(
                    allFilteredSelected ? new Set() : new Set(allHistoryIds),
                  )
                }
                disabled={!allHistoryIds.length}
              >
                {allFilteredSelected ? "取消全选" : "全选结果"}
              </button>
              <span>
                {selectedHistoryIds.size} / {allHistoryIds.length}
              </span>
            </div>
            <button
              className="history-delete-button"
              disabled={!selectedHistoryIds.size}
              onClick={() => setDeleteConfirmationOpen(true)}
            >
              <Trash size={15} />
              删除
            </button>
          </div>
        )}
        <div className="pagination" aria-label="历史记录分页">
          <button
            className="mini-icon-button"
            disabled={page === 1}
            onClick={() => onPage(Math.max(1, page - 1))}
            aria-label="上一页"
          >
            <ArrowLeft size={16} />
          </button>
          <span>
            {page} / {totalPages}
          </span>
          <button
            className="mini-icon-button"
            disabled={page === totalPages}
            onClick={() => onPage(Math.min(totalPages, page + 1))}
            aria-label="下一页"
          >
            <ArrowRight size={16} />
          </button>
        </div>
        <div className="account-menu-wrap">
          {accountMenuOpen && (
            <div className="account-menu">
              <div>
                  <UserAvatar className="avatar" username={username} />
                  <span>
                    <strong>{username}</strong>
                    <small>账号与偏好</small>
                  </span>
              </div>
              <button
                className="account-menu-password"
                onClick={() => {
                  setAccountMenuOpen(false);
                  setPasswordDialogOpen(true);
                }}
              >
                <LockKey size={16} />
                修改密码
              </button>
              <button className="account-menu-logout" onClick={onLogout}>
                <SignOut size={16} />
                退出登录
              </button>
            </div>
          )}
          <button
            className="profile-button"
            aria-label="打开用户菜单"
            aria-expanded={accountMenuOpen}
            onClick={() => setAccountMenuOpen((open) => !open)}
          >
            <UserAvatar className="avatar" username={username} />
            <span>
              <strong>{username}</strong>
              <small>个人工作区</small>
            </span>
            <DotsThree size={17} />
          </button>
        </div>
      </div>

      {deleteConfirmationOpen &&
        createPortal(
          <div
            className="history-delete-scrim"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setDeleteConfirmationOpen(false);
              }
            }}
          >
            <section
              className="history-delete-dialog"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="history-delete-title"
              aria-describedby="history-delete-description"
            >
              <span className="history-delete-icon" aria-hidden="true">
                <Trash size={20} />
              </span>
              <div>
                <span className="eyebrow">DELETE CONVERSATIONS</span>
                <h2 id="history-delete-title">删除所选聊天记录？</h2>
                <p id="history-delete-description">
                  将永久删除 {selectedHistoryIds.size} 条记录及其中的全部消息，此操作无法撤销。
                </p>
              </div>
              <div className="history-delete-actions">
                <button
                  autoFocus
                  onClick={() => setDeleteConfirmationOpen(false)}
                >
                  取消
                </button>
                <button className="danger" onClick={confirmHistoryDeletion}>
                  <Trash size={15} />
                  删除 {selectedHistoryIds.size} 条
                </button>
              </div>
            </section>
          </div>,
          document.body,
        )}
      {passwordDialogOpen &&
        createPortal(
          <PasswordChangeDialog
            username={username}
            onClose={() => setPasswordDialogOpen(false)}
            onSubmit={onChangePassword}
          />,
          document.body,
        )}
    </aside>
  );
}

interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  autoComplete: "current-password" | "new-password";
  visible: boolean;
  autoFocus?: boolean;
  onChange: (value: string) => void;
  onToggleVisibility: () => void;
}

function PasswordField({
  id,
  label,
  value,
  autoComplete,
  visible,
  autoFocus,
  onChange,
  onToggleVisibility,
}: PasswordFieldProps) {
  return (
    <label className="password-change-field" htmlFor={id}>
      <span>{label}</span>
      <span className="password-change-input">
        <input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          autoFocus={autoFocus}
          autoComplete={autoComplete}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          onClick={onToggleVisibility}
          aria-label={`${visible ? "隐藏" : "显示"}${label}`}
          aria-pressed={visible}
        >
          {visible ? <EyeSlash size={16} /> : <Eye size={16} />}
        </button>
      </span>
    </label>
  );
}

interface PasswordChangeDialogProps {
  username: string;
  onClose: () => void;
  onSubmit: (currentPassword: string, newPassword: string) => Promise<void>;
}

function PasswordChangeDialog({
  username,
  onClose,
  onSubmit,
}: PasswordChangeDialogProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [visibleFields, setVisibleFields] = useState<Set<string>>(
    () => new Set(),
  );
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose, submitting]);

  const toggleVisibility = (field: string) => {
    setVisibleFields((current) => {
      const next = new Set(current);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (!currentPassword) {
      setError("请输入当前密码。");
      return;
    }
    if (newPassword.length < 8 || newPassword.length > 128) {
      setError("新密码长度需为 8–128 个字符。");
      return;
    }
    if (newPassword === currentPassword) {
      setError("新密码不能与当前密码相同。");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致。");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(currentPassword, newPassword);
      onClose();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "密码修改失败，请稍后重试。",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="password-change-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <section
        className="password-change-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="password-change-title"
        aria-describedby="password-change-description"
      >
        <div className="password-change-heading">
          <span className="password-change-icon" aria-hidden="true">
            <LockKey size={20} />
          </span>
          <div>
            <span className="eyebrow">ACCOUNT SECURITY</span>
            <h2 id="password-change-title">修改密码</h2>
            <small>{username}</small>
          </div>
          <button
            className="mini-icon-button"
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="关闭修改密码窗口"
          >
            <X size={17} />
          </button>
        </div>
        <p id="password-change-description">
          修改后请使用新密码登录，其他已登录设备将自动退出。
        </p>
        <form onSubmit={submit}>
          <PasswordField
            id="current-account-password"
            label="当前密码"
            value={currentPassword}
            autoComplete="current-password"
            visible={visibleFields.has("current")}
            autoFocus
            onChange={setCurrentPassword}
            onToggleVisibility={() => toggleVisibility("current")}
          />
          <PasswordField
            id="new-account-password"
            label="新密码"
            value={newPassword}
            autoComplete="new-password"
            visible={visibleFields.has("new")}
            onChange={setNewPassword}
            onToggleVisibility={() => toggleVisibility("new")}
          />
          <PasswordField
            id="confirm-account-password"
            label="确认新密码"
            value={confirmPassword}
            autoComplete="new-password"
            visible={visibleFields.has("confirm")}
            onChange={setConfirmPassword}
            onToggleVisibility={() => toggleVisibility("confirm")}
          />
          <span className="password-change-hint">使用 8–128 个字符。</span>
          {error && (
            <div className="password-change-error" role="alert">
              {error}
            </div>
          )}
          <div className="password-change-actions">
            <button type="button" onClick={onClose} disabled={submitting}>
              取消
            </button>
            <button
              className="primary"
              type="submit"
              disabled={submitting}
            >
              {submitting && <CircleNotch className="spin" size={15} />}
              {submitting ? "正在更新" : "确认修改"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

interface TopbarProps {
  title: string;
  view: AppView;
  selectedModel?: ModelOption & { configId: string; providerName: string };
  selectedProvider?: string;
  modelMenuOpen: boolean;
  themeMenuOpen: boolean;
  theme: ThemeMode;
  accent: AccentName;
  configs: ApiConfig[];
  selectedApiId: string;
  onToggleSidebar: () => void;
  onToggleModelMenu: () => void;
  onSelectModel: (configId: string, modelId: string) => void;
  onOpenSettings: () => void;
  onToggleThemeMenu: () => void;
  onTheme: (theme: ThemeMode) => void;
  onAccent: (accent: AccentName) => void;
  onOpenAppearance: () => void;
  onOpenCommands: () => void;
}

function Topbar({
  title,
  view,
  selectedModel,
  selectedProvider,
  modelMenuOpen,
  themeMenuOpen,
  theme,
  accent,
  configs,
  selectedApiId,
  onToggleSidebar,
  onToggleModelMenu,
  onSelectModel,
  onOpenSettings,
  onToggleThemeMenu,
  onTheme,
  onAccent,
  onOpenAppearance,
  onOpenCommands,
}: TopbarProps) {
  return (
    <header className="topbar">
      <div className="topbar-title">
        <button className="icon-button mobile-menu" onClick={onToggleSidebar} aria-label="打开侧栏">
          <SidebarSimple size={21} />
        </button>
        <div>
          <span className="eyebrow">
            {view === "chat"
              ? "WORKSPACE / CHAT"
              : view === "settings"
                ? "WORKSPACE / CONNECTIONS"
                : "WORKSPACE / CATALOG"}
          </span>
          <h1>{title}</h1>
        </div>
      </div>

      <div className="topbar-actions">
        {view === "chat" && (
          <div className="model-switcher-wrap">
            <button
              className={`model-switcher ${modelMenuOpen ? "is-open" : ""}`}
              onClick={onToggleModelMenu}
              aria-expanded={modelMenuOpen}
              aria-haspopup="listbox"
            >
              <span className="model-symbol">{selectedModel?.name.slice(0, 1) ?? "—"}</span>
              <span className="model-switcher-copy">
                <strong>{selectedModel?.name ?? "暂无可用模型"}</strong>
                <small>
                  <i /> {selectedProvider ?? "请配置 API"}
                </small>
              </span>
              <CaretDown size={15} />
            </button>
            {modelMenuOpen && (
              <ModelMenu
                configs={configs}
                selectedConfigId={selectedApiId}
                selectedId={selectedModel?.id ?? ""}
                onSelect={onSelectModel}
                onSettings={onOpenSettings}
              />
            )}
          </div>
        )}
        <ThemeControl
          open={themeMenuOpen}
          theme={theme}
          accent={accent}
          onToggle={onToggleThemeMenu}
          onTheme={onTheme}
          onAccent={onAccent}
          onAdvanced={onOpenAppearance}
        />
        <button
          className="icon-button"
          onClick={onOpenCommands}
          aria-label="打开快捷命令"
          title="快捷命令（Ctrl+/）"
        >
          <Command size={19} />
        </button>
        <button className="icon-button" onClick={onOpenSettings} aria-label="打开设置" title="设置">
          <GearSix size={19} />
        </button>
      </div>
    </header>
  );
}

function ThemeControl({
  open,
  theme,
  accent,
  onToggle,
  onTheme,
  onAccent,
  onAdvanced,
}: {
  open: boolean;
  theme: ThemeMode;
  accent: AccentName;
  onToggle: () => void;
  onTheme: (theme: ThemeMode) => void;
  onAccent: (accent: AccentName) => void;
  onAdvanced: () => void;
}) {
  const currentAccent = ACCENT_OPTIONS.find((option) => option.id === accent)!;

  return (
    <div className="theme-control-wrap">
      <button
        className={`icon-button theme-trigger ${open ? "is-open" : ""}`}
        onClick={onToggle}
        aria-label="外观与主题色"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="外观"
      >
        {theme === "dark" ? <Moon size={19} /> : <Sun size={19} />}
        <i style={{ "--swatch-color": currentAccent.color } as React.CSSProperties} />
      </button>
      {open && (
        <div className="theme-menu" role="dialog" aria-label="外观与主题色">
          <div className="theme-menu-heading">
            <span className="theme-menu-icon">
              <Palette size={18} />
            </span>
            <div>
              <strong>界面外观</strong>
              <span>选择明暗模式和主题色</span>
            </div>
          </div>

          <div className="theme-section">
            <span className="theme-label">显示模式</span>
            <div className="theme-mode-switch" role="group" aria-label="显示模式">
              <button
                className={theme === "light" ? "selected" : ""}
                onClick={() => onTheme("light")}
                aria-pressed={theme === "light"}
              >
                <Sun size={16} />
                浅色
              </button>
              <button
                className={theme === "dark" ? "selected" : ""}
                onClick={() => onTheme("dark")}
                aria-pressed={theme === "dark"}
              >
                <Moon size={16} />
                深色
              </button>
            </div>
          </div>

          <div className="theme-section">
            <div className="theme-label-row">
              <span className="theme-label">主题色</span>
              <small>{currentAccent.label}</small>
            </div>
            <div className="accent-grid" role="group" aria-label="主题色">
              {ACCENT_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  className={accent === option.id ? "selected" : ""}
                  onClick={() => onAccent(option.id)}
                  aria-label={option.label}
                  aria-pressed={accent === option.id}
                  title={option.label}
                >
                  <i style={{ "--swatch-color": option.color } as React.CSSProperties}>
                    {accent === option.id && <Check size={13} weight="bold" />}
                  </i>
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
          </div>

          <button className="theme-advanced-button" onClick={onAdvanced}>
            <span>
              <i><SlidersHorizontal size={16} /></i>
              <span>
                <strong>高级外观设置</strong>
                <small>粒子、交互、颜色与动效参数</small>
              </span>
            </span>
            <ArrowRight size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

function ModelMenu({
  configs,
  selectedConfigId,
  selectedId,
  onSelect,
  onSettings,
}: {
  configs: ApiConfig[];
  selectedConfigId: string;
  selectedId: string;
  onSelect: (configId: string, modelId: string) => void;
  onSettings: () => void;
}) {
  const enabledConfigs = configs.filter((config) => config.enabled && config.models.length);
  return (
    <div className="model-menu" role="listbox" aria-label="选择模型">
      <div className="model-menu-head">
        <div>
          <strong>选择运行模型</strong>
          <span>仅显示已启用的 API 与模型</span>
        </div>
        <span className="live-badge">
          <i /> {enabledConfigs.length} 个端点
        </span>
      </div>
      <div className="model-menu-content">
        {enabledConfigs.length ? (
          enabledConfigs.map((config) => (
            <section key={config.id} className="model-provider-group">
              <div className="provider-label">
                <span style={{ "--provider-color": config.color } as React.CSSProperties}>
                  {config.name}
                </span>
                <small>{FORMAT_LABELS[config.format]}</small>
              </div>
              {config.models.map((model) => (
                <button
                  key={`${config.id}-${model.id}`}
                  className={
                    selectedConfigId === config.id && selectedId === model.id
                      ? "selected"
                      : ""
                  }
                  onClick={() => onSelect(config.id, model.id)}
                  role="option"
                  aria-selected={
                    selectedConfigId === config.id && selectedId === model.id
                  }
                >
                  <span className="model-menu-avatar">{model.name.slice(0, 1)}</span>
                  <span>
                    <strong>{model.name}</strong>
                    <small>
                      {model.capability} · {model.context}
                    </small>
                  </span>
                  {selectedConfigId === config.id && selectedId === model.id && (
                    <Check size={17} weight="bold" />
                  )}
                </button>
              ))}
            </section>
          ))
        ) : (
          <div className="model-menu-empty">请先在 API 与模型页面启用一个端点。</div>
        )}
      </div>
      <button className="model-menu-settings" onClick={onSettings}>
        <SlidersHorizontal size={17} />
        管理 API 与模型目录
        <ArrowRight size={15} />
      </button>
    </div>
  );
}

function CommandPalette({
  onClose,
  onNewChat,
  onSearch,
  onNavigate,
  onAppearance,
}: {
  onClose: () => void;
  onNewChat: () => void;
  onSearch: () => void;
  onNavigate: (view: AppView) => void;
  onAppearance: () => void;
}) {
  const actions = [
    {
      label: "新建对话",
      detail: "开始一个空白会话",
      shortcut: "N",
      icon: <Plus size={18} />,
      run: onNewChat,
    },
    {
      label: "检索历史记录",
      detail: "按标题、内容、模型或 API 搜索",
      shortcut: "Ctrl K",
      icon: <MagnifyingGlass size={18} />,
      run: onSearch,
    },
    {
      label: "管理 API 连接",
      detail: "编辑端点、密钥与可用模型",
      shortcut: "",
      icon: <SlidersHorizontal size={18} />,
      run: () => onNavigate("settings"),
    },
    {
      label: "打开模型目录",
      detail: "维护模型资料和分组",
      shortcut: "",
      icon: <SquaresFour size={18} />,
      run: () => onNavigate("catalog"),
    },
    {
      label: "高级外观设置",
      detail: "调整粒子、网格与背景动效",
      shortcut: "",
      icon: <Palette size={18} />,
      run: onAppearance,
    },
  ];

  return (
    <div
      className="command-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-title"
      >
        <div className="command-palette-head">
          <span>
            <Command size={18} />
          </span>
          <div>
            <strong id="command-title">快捷命令</strong>
            <small>快速前往 ModelDock 的常用功能</small>
          </div>
          <button className="mini-icon-button" onClick={onClose} aria-label="关闭快捷命令">
            <X size={17} />
          </button>
        </div>
        <div className="command-list">
          {actions.map((action, index) => (
            <button
              key={action.label}
              autoFocus={index === 0}
              onClick={() => {
                onClose();
                action.run();
              }}
            >
              <i>{action.icon}</i>
              <span>
                <strong>{action.label}</strong>
                <small>{action.detail}</small>
              </span>
              {action.shortcut && <kbd>{action.shortcut}</kbd>}
              <ArrowRight size={15} />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function AttachmentIcon({
  kind,
  size = 18,
}: {
  kind: ModelInputType;
  size?: number;
}) {
  if (kind === "image") return <ImageSquare size={size} />;
  if (kind === "video") return <VideoCamera size={size} />;
  if (kind === "audio") return <Waveform size={size} />;
  return <FileText size={size} />;
}

function MessageAttachments({
  attachments,
  onPreviewImage,
}: {
  attachments?: ChatAttachment[];
  onPreviewImage: (attachment: ChatAttachment) => void;
}) {
  if (!attachments?.length) return null;
  return (
    <div className="message-attachments">
      {attachments.map((attachment) => {
        const source = attachmentSource(attachment);
        if (!source) return null;
        if (attachment.kind === "image") {
          return (
            <button
              type="button"
              className="message-media message-media-image"
              key={attachment.id}
              onClick={() => onPreviewImage(attachment)}
              aria-label={`全图预览：${attachment.name}`}
            >
              <img src={source} alt={attachment.name} loading="lazy" />
              <span className="message-media-zoom-hint" aria-hidden="true">
                <Eye size={14} />
                全图预览
              </span>
              <span>{attachment.name}</span>
            </button>
          );
        }
        if (attachment.kind === "video") {
          return (
            <figure className="message-media message-media-video" key={attachment.id}>
              <video controls preload="metadata" src={source}>
                你的浏览器不支持视频播放。
              </video>
              <figcaption>{attachment.name}</figcaption>
            </figure>
          );
        }
        if (attachment.kind === "audio") {
          return (
            <figure className="message-media message-media-audio" key={attachment.id}>
              <figcaption>
                <Waveform size={17} />
                <span>
                  <strong>{attachment.name}</strong>
                  <small>{formatBytes(attachment.size)}</small>
                </span>
              </figcaption>
              <audio controls preload="metadata" src={source}>
                你的浏览器不支持音频播放。
              </audio>
            </figure>
          );
        }
        return (
          <a
            className="message-file-card"
            href={source}
            key={attachment.id}
            target={attachment.url ? "_blank" : undefined}
            rel={attachment.url ? "noreferrer" : undefined}
            download={attachment.dataUrl ? attachment.name : undefined}
          >
            <span>
              <FileText size={18} />
            </span>
            <span>
              <strong>{attachment.name}</strong>
              <small>{attachment.mimeType} · {formatBytes(attachment.size)}</small>
            </span>
          </a>
        );
      })}
    </div>
  );
}

interface ImagePreviewModalProps {
  attachment: ChatAttachment;
  onClose: () => void;
  onToast: (message: string) => void;
}

function ImagePreviewModal({
  attachment,
  onClose,
  onToast,
}: ImagePreviewModalProps) {
  const source = attachmentSource(attachment);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    closeButtonRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  if (!source) return null;

  const downloadImage = async () => {
    if (isDownloading) return;
    setIsDownloading(true);
    let objectUrl = "";
    try {
      const response = await fetch(source);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      objectUrl = URL.createObjectURL(await response.blob());

      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = attachment.name || "modeldock-image";
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
      const completedObjectUrl = objectUrl;
      window.setTimeout(() => URL.revokeObjectURL(completedObjectUrl), 1_000);
      objectUrl = "";
    } catch {
      if (attachment.url) {
        window.open(source, "_blank", "noopener,noreferrer");
        onToast("远程图片不允许直接下载，已在新窗口打开原图");
      } else {
        onToast("图片下载失败，请稍后重试");
      }
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setIsDownloading(false);
    }
  };

  return createPortal(
    <div
      className="image-preview-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="image-preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="image-preview-title"
        aria-describedby="image-preview-description"
      >
        <header className="image-preview-header">
          <span className="image-preview-mark" aria-hidden="true">
            <ImageSquare size={18} />
          </span>
          <div>
            <strong id="image-preview-title">{attachment.name}</strong>
            <small id="image-preview-description">
              {attachment.mimeType || "图片"} · {formatBytes(attachment.size)}
            </small>
          </div>
          <div className="image-preview-actions">
            <button
              type="button"
              className="image-preview-download"
              onClick={() => void downloadImage()}
              disabled={isDownloading}
            >
              {isDownloading ? (
                <CircleNotch className="spin" size={16} />
              ) : (
                <DownloadSimple size={16} />
              )}
              {isDownloading ? "正在下载" : "下载原图"}
            </button>
            <button
              ref={closeButtonRef}
              type="button"
              className="image-preview-close"
              onClick={onClose}
              aria-label="关闭图片预览"
              title="关闭图片预览"
            >
              <X size={18} />
            </button>
          </div>
        </header>
        <div className="image-preview-stage">
          <img src={source} alt={attachment.name} />
        </div>
        <footer className="image-preview-footer">
          <span>ESC 关闭</span>
          <span>图片仅在点击“下载原图”后保存</span>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function DraftAttachmentStrip({
  attachments,
  onRemove,
  onPreviewImage,
}: {
  attachments: ChatAttachment[];
  onRemove: (attachmentId: string) => void;
  onPreviewImage: (attachment: ChatAttachment) => void;
}) {
  if (!attachments.length) return null;
  return (
    <div className="draft-attachments" aria-label="待发送附件">
      {attachments.map((attachment) => {
        const source = attachmentSource(attachment);
        return (
          <div className="draft-attachment" key={attachment.id}>
            {attachment.kind === "image" && source ? (
              <button
                type="button"
                className="draft-attachment-preview draft-attachment-preview-button"
                onClick={() => onPreviewImage(attachment)}
                aria-label={`全图预览：${attachment.name}`}
                title="全图预览"
              >
                <img src={source} alt="" />
              </button>
            ) : (
              <span className="draft-attachment-preview" aria-hidden="true">
                <AttachmentIcon kind={attachment.kind} size={17} />
              </span>
            )}
            <span>
              <strong>{attachment.name}</strong>
              <small>
                {MODEL_INPUT_TYPE_LABELS[attachment.kind]} · {formatBytes(attachment.size)}
              </small>
            </span>
            <button
              type="button"
              className="draft-attachment-remove"
              onClick={() => onRemove(attachment.id)}
              aria-label={`移除附件：${attachment.name}`}
              title="移除附件"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

interface ChatWorkspaceProps {
  messages: ChatMessage[];
  draft: string;
  draftAttachments: ChatAttachment[];
  username: string;
  modelName: string;
  providerName: string;
  inputTypes: ModelInputType[];
  reasoningAvailable: boolean;
  reasoningEnabled: boolean;
  isStreaming: boolean;
  editingPromptMessageId: string | null;
  onDraft: (value: string) => void;
  onAddAttachments: (attachments: ChatAttachment[]) => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onSend: (event?: FormEvent) => void;
  onToggleReasoning: () => void;
  onStop: () => void;
  onCopy: (message: ChatMessage) => void;
  onRegenerate: () => void;
  onEditLastPrompt: () => void;
  onCancelPromptEdit: () => void;
  onToast: (message: string) => void;
}

function ChatWorkspace({
  messages,
  draft,
  draftAttachments,
  username,
  modelName,
  providerName,
  inputTypes,
  reasoningAvailable,
  reasoningEnabled,
  isStreaming,
  editingPromptMessageId,
  onDraft,
  onAddAttachments,
  onRemoveAttachment,
  onSend,
  onToggleReasoning,
  onStop,
  onCopy,
  onRegenerate,
  onEditLastPrompt,
  onCancelPromptEdit,
  onToast,
}: ChatWorkspaceProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [codeMode, setCodeMode] = useState(false);
  const [previewImage, setPreviewImage] = useState<ChatAttachment | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: isStreaming ? "auto" : "smooth" });
  }, [messages, isStreaming]);

  const suggestions = ["比较三个方案的权衡", "整理为实施清单", "找出潜在风险"];

  const lastAssistantMessageId = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === "assistant") return messages[index].id;
    }
    return null;
  }, [messages]);

  const attachFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const incoming = Array.from(files);
    if (draftAttachments.length + incoming.length > MAX_DRAFT_ATTACHMENTS) {
      onToast(`每条消息最多添加 ${MAX_DRAFT_ATTACHMENTS} 个附件`);
      return;
    }
    try {
      const next: ChatAttachment[] = [];
      for (const file of incoming) {
        next.push(await fileToAttachment(file, inputTypes));
      }
      const totalBytes = [...draftAttachments, ...next].reduce(
        (sum, attachment) => sum + attachment.size,
        0,
      );
      if (totalBytes > MAX_DRAFT_ATTACHMENT_BYTES) {
        throw new Error(
          `单条消息的附件总大小不能超过 ${formatBytes(MAX_DRAFT_ATTACHMENT_BYTES)}。`,
        );
      }
      onAddAttachments(next);
      onToast(`已添加 ${next.length} 个附件`);
    } catch (error) {
      onToast(error instanceof Error ? error.message : "附件读取失败");
    }
  };

  return (
    <div className="chat-workspace">
      <div className="chat-scroll">
        <div className="chat-content">
          {messages.length ? (
            <>
              <div className="conversation-meta">
                <span>今天</span>
                <i />
                <span>{messages.length} 条消息</span>
              </div>
              {messages.map((message) => (
                <article className={`message message-${message.role}`} key={message.id}>
                  <div className="message-rail">
                    {message.role === "assistant" ? (
                      <span className="assistant-mark">
                        <i />
                        <i />
                      </span>
                    ) : (
                      <UserAvatar className="user-mark" username={username} />
                    )}
                  </div>
                  <div className="message-body">
                    <div className="message-author">
                      <strong>
                        {message.role === "assistant"
                          ? message.author ??
                            message.meta?.split(" · ")[0] ??
                            "Assistant"
                          : "你"}
                      </strong>
                      <span>{message.meta}</span>
                    </div>
                    {message.role === "assistant" && message.reasoning && (
                      <ReasoningPanel
                        content={message.reasoning}
                        hasAnswer={Boolean(message.content)}
                        isStreaming={
                          isStreaming &&
                          message === messages[messages.length - 1]
                        }
                      />
                    )}
                    <div className="message-copy">
                      {message.content ? (
                        <Suspense
                          fallback={
                            <span className="markdown-loading">
                              {message.content}
                            </span>
                          }
                        >
                          <MarkdownContent content={message.content} />
                        </Suspense>
                      ) : message.attachments?.length || message.reasoning ? null : (
                        <span className="typing-indicator" aria-label="正在生成">
                          <i />
                          <i />
                          <i />
                        </span>
                      )}
                      {isStreaming &&
                        message.role === "assistant" &&
                        message === messages[messages.length - 1] &&
                        message.content && <span className="stream-caret" aria-hidden="true" />}
                    </div>
                    <MessageAttachments
                      attachments={message.attachments}
                      onPreviewImage={setPreviewImage}
                    />
                    {message.role === "assistant" && message.content && (
                      <div className="message-actions">
                        <button
                          aria-label="复制回答"
                          title="复制"
                          onClick={() => onCopy(message)}
                        >
                          <Copy size={15} />
                        </button>
                        <button
                          aria-label="重新生成回答"
                          title="重新生成最后一条回答"
                          onClick={onRegenerate}
                          hidden={message.id !== lastAssistantMessageId}
                          disabled={isStreaming}
                        >
                          <ArrowClockwise size={15} />
                        </button>
                        <button
                          aria-label="编辑并重发最后一条提示词"
                          title="编辑并重发最后一条提示词"
                          hidden={message.id !== lastAssistantMessageId}
                          onClick={onEditLastPrompt}
                          disabled={isStreaming || editingPromptMessageId !== null}
                        >
                          <PencilSimple size={15} />
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </>
          ) : (
            <div className="empty-chat">
              <span className="empty-chat-mark">
                <i />
                <i />
                <i />
              </span>
              <p className="eyebrow">NEW THREAD</p>
              <h2>从一个清晰的问题开始。</h2>
              <p>当前使用 {modelName}，请求将通过 {providerName} 发送。</p>
              <span className="empty-chat-modalities">
                支持输入：
                {inputTypes.map((type) => MODEL_INPUT_TYPE_LABELS[type]).join(" · ")}
              </span>
              <div className="suggestion-grid">
                {["设计一个 API 适配器接口", "比较模型的成本与延迟", "生成部署前检查清单"].map(
                  (suggestion) => (
                    <button key={suggestion} onClick={() => onDraft(suggestion)}>
                      <ArrowUp size={16} />
                      {suggestion}
                    </button>
                  ),
                )}
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="composer-zone">
        {messages.length > 0 && !editingPromptMessageId && (
          <div className="quick-prompts" aria-label="快捷提示">
            {suggestions.map((suggestion) => (
              <button key={suggestion} onClick={() => onDraft(suggestion)}>
                {suggestion}
              </button>
            ))}
          </div>
        )}
        {editingPromptMessageId && (
          <div className="prompt-edit-status" role="status">
            <PencilSimple size={16} />
            <span>
              <strong>正在编辑最后一条提示词</strong>
              <small>文字和附件已恢复；发送后将替换原提示词及其后续回复。</small>
            </span>
            <button type="button" onClick={onCancelPromptEdit}>
              <X size={14} />
              取消
            </button>
          </div>
        )}
        <form className={`composer ${codeMode ? "code-mode" : ""}`} onSubmit={onSend}>
          <DraftAttachmentStrip
            attachments={draftAttachments}
            onRemove={onRemoveAttachment}
            onPreviewImage={setPreviewImage}
          />
          <label htmlFor="chat-input" className="sr-only">
            输入消息
          </label>
          <textarea
            id="chat-input"
            value={draft}
            onChange={(event) => onDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSend();
              }
            }}
            placeholder={
              codeMode
                ? `向 ${modelName} 提交代码问题…`
                : reasoningEnabled
                  ? `让 ${modelName} 深度思考…`
                  : `向 ${modelName} 提问…`
            }
            rows={1}
          />
          <div className="composer-footer">
            <div className="composer-tools">
              <input
                ref={fileInputRef}
                className="sr-only"
                type="file"
                multiple
                accept={acceptForInputTypes(inputTypes)}
                onChange={(event) => {
                  void attachFiles(event.target.files);
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                aria-label="添加文件"
                title={`添加${inputTypes.map((type) => MODEL_INPUT_TYPE_LABELS[type]).join("、")}文件`}
                onClick={() => fileInputRef.current?.click()}
                disabled={isStreaming}
              >
                <Paperclip size={18} />
              </button>
              <button
                type="button"
                className={codeMode ? "active" : ""}
                aria-label="代码模式"
                aria-pressed={codeMode}
                title="代码模式"
                onClick={() => setCodeMode((enabled) => !enabled)}
              >
                <Code size={18} />
              </button>
              {reasoningAvailable && (
                <button
                  type="button"
                  className={`composer-reasoning-toggle ${
                    reasoningEnabled ? "active" : ""
                  }`}
                  aria-label={
                    reasoningEnabled ? "关闭深度思考" : "开启深度思考"
                  }
                  aria-pressed={reasoningEnabled}
                  title={
                    reasoningEnabled
                      ? "本次请求将使用深度思考"
                      : "本次请求将直接生成回答"
                  }
                  onClick={onToggleReasoning}
                  disabled={isStreaming}
                >
                  <Brain size={17} weight={reasoningEnabled ? "fill" : "regular"} />
                  深度思考
                </button>
              )}
              <span>
                <i /> {providerName} · {inputTypes.map((type) => MODEL_INPUT_TYPE_LABELS[type]).join(" / ")}
              </span>
            </div>
            {isStreaming ? (
              <button className="send-button stop-button" type="button" onClick={onStop} aria-label="停止生成">
                <Stop size={15} weight="fill" />
              </button>
            ) : (
              <button
                className="send-button"
                type="submit"
                disabled={!draft.trim() && !draftAttachments.length}
                aria-label={
                  editingPromptMessageId
                    ? "重新发送编辑后的提示词"
                    : "发送消息"
                }
              >
                <ArrowUp size={17} weight="bold" />
              </button>
            )}
          </div>
        </form>
        <p className="composer-note">Enter 发送 · Shift + Enter 换行 · 模型输出可能不准确</p>
      </div>
      {previewImage && (
        <ImagePreviewModal
          attachment={previewImage}
          onClose={() => setPreviewImage(null)}
          onToast={onToast}
        />
      )}
    </div>
  );
}

interface SettingsWorkspaceProps {
  configs: ApiConfig[];
  mappingTemplates: CustomMappingTemplate[];
  catalogModels: CatalogModel[];
  modelGroups: ModelGroup[];
  selectedApiId: string;
  onSelect: (id: string) => void;
  onChange: (configs: ApiConfig[]) => void;
  onTemplatesChange: (templates: CustomMappingTemplate[]) => void;
  onTemplateDeleted: (templateId: string) => void;
  onSave: () => Promise<void>;
  onToast: (message: string) => void;
  onOpenCatalog: () => void;
}

function SettingsWorkspace({
  configs,
  mappingTemplates,
  catalogModels,
  modelGroups,
  selectedApiId,
  onSelect,
  onChange,
  onTemplatesChange,
  onTemplateDeleted,
  onSave,
  onToast,
  onOpenCatalog,
}: SettingsWorkspaceProps) {
  const [showKey, setShowKey] = useState(false);
  const [modelQuery, setModelQuery] = useState("");
  const deferredModelQuery = useDeferredValue(modelQuery);
  const [testing, setTesting] = useState(false);
  const [templateManagerOpen, setTemplateManagerOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const [templateSuggestedModel, setTemplateSuggestedModel] = useState("");

  const selected = configs.find((config) => config.id === selectedApiId) ?? configs[0];
  const apiSorter = useSortableList({
    scope: "api-endpoints",
    ids: configs.map((config) => config.id),
    onMove: (draggedId, targetId) => {
      onChange(moveItemById(configs, draggedId, targetId));
    },
    onMoveEnd: () => onToast("API 端点顺序已更新"),
  });
  const activeTemplate = mappingTemplates.find(
    (template) => template.id === selected?.customTemplateId,
  );

  useEffect(() => {
    setTemplateName(activeTemplate?.name ?? "");
    setTemplateDescription(activeTemplate?.description ?? "");
    setTemplateSuggestedModel(activeTemplate?.suggestedModel ?? "");
  }, [activeTemplate]);

  if (!selected) return null;

  const patchSelected = (patch: Partial<ApiConfig>) => {
    onChange(configs.map((config) => (config.id === selected.id ? { ...config, ...patch } : config)));
  };

  const patchCustomMapping = (patch: Partial<CustomProviderMapping>) => {
    patchSelected({
      customMapping: {
        ...DEFAULT_CUSTOM_MAPPING,
        ...selected.customMapping,
        ...patch,
      },
    });
  };

  const selectMappingTemplate = (templateId: string) => {
    if (!templateId) {
      patchSelected({ customTemplateId: undefined });
      setTemplateName("");
      setTemplateDescription("");
      setTemplateSuggestedModel("");
      onToast("已切换为手动配置，当前映射内容保持不变");
      return;
    }
    const template = mappingTemplates.find((item) => item.id === templateId);
    if (!template) return;
    patchSelected({
      format: "custom",
      endpoint: template.endpoint,
      customMapping: structuredClone(template.mapping),
      customTemplateId: template.id,
    });
    setTemplateName(template.name);
    setTemplateDescription(template.description);
    setTemplateSuggestedModel(template.suggestedModel);
    onToast(`已应用模板：${template.name}`);
  };

  const templateFromCurrent = (
    id: string,
    name: string,
  ): CustomMappingTemplate => ({
    id,
    name,
    description: templateDescription.trim(),
    endpoint: selected.endpoint,
    suggestedModel: templateSuggestedModel.trim(),
    mapping: {
      ...DEFAULT_CUSTOM_MAPPING,
      ...selected.customMapping,
    },
  });

  const saveNewTemplate = () => {
    const name = templateName.trim();
    if (!name) {
      setTemplateManagerOpen(true);
      onToast("请先填写模板名称");
      return;
    }
    const id = `mapping-template-${Date.now()}-${crypto.randomUUID()}`;
    const next = templateFromCurrent(id, name);
    onTemplatesChange([...mappingTemplates, next]);
    patchSelected({ customTemplateId: id });
    onToast(`模板“${name}”已保存`);
  };

  const updateCurrentTemplate = () => {
    if (!activeTemplate) {
      onToast("当前是手动配置，请选择模板或另存为新模板");
      return;
    }
    const name = templateName.trim();
    if (!name) {
      onToast("模板名称不能为空");
      return;
    }
    onTemplatesChange(
      mappingTemplates.map((template) =>
        template.id === activeTemplate.id
          ? templateFromCurrent(template.id, name)
          : template,
      ),
    );
    onToast(`模板“${name}”已更新`);
  };

  const deleteCurrentTemplate = () => {
    if (!activeTemplate) {
      onToast("当前没有选中的模板");
      return;
    }
    onTemplatesChange(
      mappingTemplates.filter((template) => template.id !== activeTemplate.id),
    );
    onTemplateDeleted(activeTemplate.id);
    onChange(
      configs.map((config) =>
        config.customTemplateId === activeTemplate.id
          ? { ...config, customTemplateId: undefined }
          : config,
      ),
    );
    setTemplateName("");
    setTemplateDescription("");
    setTemplateSuggestedModel("");
    onToast(`模板“${activeTemplate.name}”已删除，API 配置内容未改变`);
  };

  const addConfig = () => {
    const id = `api-${Date.now()}`;
    const next: ApiConfig = {
      id,
      name: "新 API 配置",
      format: "openai-compatible",
      endpoint: "https://",
      apiKey: "",
      enabled: true,
      color: "#b9f16f",
      models: [],
      customMapping: structuredClone(DEFAULT_CUSTOM_MAPPING),
    };
    onChange([...configs, next]);
    onSelect(id);
  };

  const deleteConfig = () => {
    if (configs.length === 1) {
      onToast("至少保留一个 API 配置");
      return;
    }
    const next = configs.filter((config) => config.id !== selected.id);
    onChange(next);
    onSelect(next[0].id);
    onToast("配置已从当前草稿移除");
  };

  const toModelOption = (model: CatalogModel): ModelOption => {
    const group = modelGroups.find((item) => item.id === model.groupId);
    return {
      catalogId: model.id,
      id: model.invocationName,
      name: model.name,
      family: group?.name ?? "未分组",
      context: model.context,
      capability: model.capability,
      inputTypes: model.inputTypes,
      supportsReasoning: model.supportsReasoning ?? false,
    };
  };

  const toggleModel = (model: CatalogModel) => {
    const exists = selected.models.some(
      (current) =>
        current.catalogId === model.id ||
        (!current.catalogId && current.id === model.invocationName),
    );
    patchSelected({
      models: exists
        ? selected.models.filter(
            (current) =>
              current.catalogId !== model.id &&
              (current.catalogId || current.id !== model.invocationName),
          )
        : [...selected.models, toModelOption(model)],
    });
  };

  const testConnection = async () => {
    setTesting(true);
    try {
      await onSave();
      const result = await testProviderConnection(selected.id);
      onToast(result.message);
    } catch (error) {
      onToast(error instanceof Error ? error.message : "连接测试失败");
    } finally {
      setTesting(false);
    }
  };

  const normalizedModelQuery = deferredModelQuery.trim().toLowerCase();
  const filteredCatalog = modelGroups
    .map((group) => ({
      group,
      models: catalogModels.filter(
        (model) =>
          model.groupId === group.id &&
          [model.name, model.invocationName, model.capability, model.description].some((value) =>
          value.toLowerCase().includes(deferredModelQuery.toLowerCase()),
          ),
      ),
    }))
    .filter((group) => group.models.length);

  return (
    <div className="settings-workspace">
      <div className="settings-intro">
        <div>
          <span className="eyebrow">CONNECTION REGISTRY</span>
          <h2>连接一次，按需调度。</h2>
          <p>保存不同协议的 API 端点，并从统一模型目录中选择这个连接可以调用的模型。</p>
        </div>
        <div className="settings-intro-actions">
          <button
            className="secondary-button"
            onClick={() => void testConnection()}
            disabled={testing}
          >
            {testing ? <CircleNotch className="spin" size={17} /> : <TestTube size={17} />}
            {testing ? "正在检查" : "测试连接"}
          </button>
          <button
            className="primary-button"
            onClick={() => void onSave().catch((error) => {
              onToast(error instanceof Error ? error.message : "保存失败");
            })}
          >
            <FloppyDisk size={17} />
            保存更改
          </button>
        </div>
      </div>

      <div className="settings-layout">
        <aside className="api-registry" aria-label="API 配置列表">
          <div className="panel-heading">
            <div>
              <strong>API 端点</strong>
              <span>{configs.length} 个配置</span>
            </div>
            <button className="mini-icon-button" onClick={addConfig} aria-label="添加 API 配置">
              <Plus size={17} />
            </button>
          </div>
          <div className="api-list">
            {configs.map((config) => {
              const className = [
                "sortable-item",
                config.id === selected.id ? "selected" : "",
                apiSorter.draggedId === config.id ? "sorting" : "",
                apiSorter.overId === config.id
                  ? `sort-over sort-over-${apiSorter.overPosition}`
                  : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <button
                  {...apiSorter.itemProps(config.id)}
                  key={config.id}
                  className={className}
                  onClick={() => {
                    if (!apiSorter.consumeClick()) onSelect(config.id);
                  }}
                  aria-label={`${config.name}，拖动排序，或按 Alt 加上下方向键移动`}
                  title="拖动右侧手柄排序；Alt + ↑/↓ 也可移动"
                >
                  <span
                    className="api-avatar"
                    style={{ "--api-color": config.color } as React.CSSProperties}
                  >
                    {config.name.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="api-list-copy">
                    <strong>{config.name}</strong>
                    <small>{FORMAT_LABELS[config.format]}</small>
                    <span>
                      <i className={config.enabled ? "online" : ""} />
                      {config.enabled ? `${config.models.length} 个模型` : "已停用"}
                    </span>
                  </span>
                  <span
                    {...apiSorter.gripProps(config.id)}
                    className="sort-grip"
                    aria-hidden="true"
                  >
                    <DotsSixVertical size={15} weight="bold" />
                  </span>
                  <CaretDown size={14} />
                </button>
              );
            })}
          </div>
          <button className="add-api-button" onClick={addConfig}>
            <Plus size={17} />
            添加 API 配置
          </button>
        </aside>

        <section className="config-editor">
          <div className="config-editor-heading">
            <div>
              <span
                className="api-avatar large"
                style={{ "--api-color": selected.color } as React.CSSProperties}
              >
                {selected.name.slice(0, 2).toUpperCase()}
              </span>
              <div>
                <h3>{selected.name}</h3>
                <p>{FORMAT_LABELS[selected.format]}</p>
              </div>
            </div>
            <label className="switch-row">
              <span>{selected.enabled ? "已启用" : "已停用"}</span>
              <input
                type="checkbox"
                checked={selected.enabled}
                onChange={(event) => patchSelected({ enabled: event.target.checked })}
              />
              <i />
            </label>
          </div>

          <div className="form-section">
            <div className="section-title">
              <span>01</span>
              <div>
                <h4>连接信息</h4>
                <p>配置名称只在 ModelDock 内部显示。</p>
              </div>
            </div>
            <div className="form-grid">
              <label className="field field-wide">
                <span>配置名称</span>
                <input
                  value={selected.name}
                  onChange={(event) => patchSelected({ name: event.target.value })}
                  placeholder="例如：OpenAI · Production"
                />
              </label>
              <label className="field">
                <span>请求格式</span>
                <select
                  value={selected.format}
                  onChange={(event) => patchSelected({ format: event.target.value as ProviderFormat })}
                >
                  {Object.entries(FORMAT_LABELS).map(([value, label]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field catalog-color-field">
                <span>识别颜色</span>
                <span>
                  <input
                    type="color"
                    value={selected.color}
                    onChange={(event) => patchSelected({ color: event.target.value })}
                    aria-label={`${selected.name} 的识别颜色`}
                  />
                  <code>{selected.color.toUpperCase()}</code>
                </span>
              </label>
              <label className="field field-wide">
                <span>Base URL</span>
                <div className="input-with-icon">
                  <Globe size={17} />
                  <input
                    value={selected.endpoint}
                    onChange={(event) => patchSelected({ endpoint: event.target.value })}
                    placeholder="https://api.example.com/v1"
                    inputMode="url"
                  />
                </div>
                <small>{formatHint[selected.format]}</small>
              </label>
              <label className="field field-wide">
                <span>API Key</span>
                <div className="input-with-icon">
                  <span className="key-prefix">KEY</span>
                  <input
                    type={showKey ? "text" : "password"}
                    value={selected.apiKey}
                    onChange={(event) => patchSelected({ apiKey: event.target.value })}
                    placeholder={selected.format === "ollama" ? "本地连接可留空" : "输入 API Key"}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((show) => !show)}
                    aria-label={showKey ? "隐藏 API Key" : "显示 API Key"}
                  >
                    {showKey ? <EyeSlash size={17} /> : <Eye size={17} />}
                  </button>
                </div>
                <small>用于连接该 API；本地服务或无需凭据的端点可以留空。</small>
              </label>
              {selected.format === "custom" && (
                <div className="custom-mapping-grid field-wide">
                  <div className="custom-mapping-heading">
                    <span>
                      <Code size={16} />
                      自定义请求映射
                    </span>
                    <div className="custom-mapping-tools">
                      <small>字段路径使用点号分隔，数组项可写为 0，例如 choices.0.delta.content。</small>
                      <button
                        type="button"
                        className="mapping-preset-button"
                        onClick={() => setTemplateManagerOpen((open) => !open)}
                        aria-expanded={templateManagerOpen}
                      >
                        <SlidersHorizontal size={15} />
                        模板管理
                      </button>
                    </div>
                  </div>
                  <div className="mapping-template-panel field-wide">
                    <label className="field mapping-template-select">
                      <span>映射模板</span>
                      <select
                        value={selected.customTemplateId ?? ""}
                        onChange={(event) => selectMappingTemplate(event.target.value)}
                      >
                        <option value="">不使用模板（手动配置）</option>
                        {mappingTemplates.map((template) => (
                          <option value={template.id} key={template.id}>
                            {template.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="mapping-template-summary">
                      <ImageSquare size={17} />
                      <div>
                        <strong>{activeTemplate?.name ?? "独立手动配置"}</strong>
                        <span>
                          {activeTemplate?.description ??
                            "当前设置只保存到这个 API 配置，不会写入模板库。"}
                        </span>
                      </div>
                      {activeTemplate?.suggestedModel && (
                        <code>{activeTemplate.suggestedModel}</code>
                      )}
                    </div>
                    {templateManagerOpen && (
                      <div className="mapping-template-editor">
                        <label className="field">
                          <span>模板名称</span>
                          <input
                            value={templateName}
                            onChange={(event) => setTemplateName(event.target.value)}
                            placeholder="例如：公司内部图片编辑 API"
                          />
                        </label>
                        <label className="field">
                          <span>建议模型</span>
                          <input
                            value={templateSuggestedModel}
                            onChange={(event) =>
                              setTemplateSuggestedModel(event.target.value)
                            }
                            placeholder="例如：gpt-image-2"
                          />
                        </label>
                        <label className="field field-wide">
                          <span>模板说明</span>
                          <input
                            value={templateDescription}
                            onChange={(event) =>
                              setTemplateDescription(event.target.value)
                            }
                            placeholder="说明接口用途、限制或模型要求"
                          />
                        </label>
                        <div className="mapping-template-actions field-wide">
                          <button type="button" onClick={saveNewTemplate}>
                            <Plus size={15} />
                            另存为新模板
                          </button>
                          <button
                            type="button"
                            onClick={updateCurrentTemplate}
                            disabled={!activeTemplate}
                          >
                            <FloppyDisk size={15} />
                            更新所选模板
                          </button>
                          <button
                            type="button"
                            className="danger"
                            onClick={deleteCurrentTemplate}
                            disabled={!activeTemplate}
                          >
                            <Trash size={15} />
                            删除所选模板
                          </button>
                        </div>
                        <small className="field-wide">
                          新建或更新模板时，会保存当前 Base URL 和下方全部映射字段，不会保存 API Key。
                        </small>
                      </div>
                    )}
                  </div>
                  <div className="mapping-section-label field-wide">
                    <span>请求构造</span>
                    <small>将聊天上下文转换为目标接口需要的 JSON 或 Multipart 请求。</small>
                  </div>
                  <label className="field">
                    <span>聊天路径</span>
                    <input
                      value={selected.customMapping?.chatPath ?? DEFAULT_CUSTOM_MAPPING.chatPath}
                      onChange={(event) => patchCustomMapping({ chatPath: event.target.value })}
                      placeholder="chat/completions"
                    />
                  </label>
                  <label className="field">
                    <span>鉴权 Header</span>
                    <input
                      value={selected.customMapping?.authHeader ?? DEFAULT_CUSTOM_MAPPING.authHeader}
                      onChange={(event) => patchCustomMapping({ authHeader: event.target.value })}
                      placeholder="Authorization"
                    />
                  </label>
                  <label className="field">
                    <span>鉴权前缀</span>
                    <input
                      value={selected.customMapping?.authScheme ?? DEFAULT_CUSTOM_MAPPING.authScheme}
                      onChange={(event) => patchCustomMapping({ authScheme: event.target.value })}
                      placeholder="Bearer"
                    />
                  </label>
                  <label className="field">
                    <span>模型请求字段</span>
                    <input
                      value={
                        selected.customMapping?.requestModelField ??
                        DEFAULT_CUSTOM_MAPPING.requestModelField
                      }
                      onChange={(event) =>
                        patchCustomMapping({ requestModelField: event.target.value })
                      }
                      placeholder="model"
                    />
                  </label>
                  <label className="field">
                    <span>消息请求字段</span>
                    <input
                      value={
                        selected.customMapping?.requestMessagesField ??
                        DEFAULT_CUSTOM_MAPPING.requestMessagesField
                      }
                      onChange={(event) =>
                        patchCustomMapping({ requestMessagesField: event.target.value })
                      }
                      placeholder="messages"
                    />
                  </label>
                  <label className="field">
                    <span>消息取值方式</span>
                    <select
                      value={
                        selected.customMapping?.requestMessagesMode ??
                        DEFAULT_CUSTOM_MAPPING.requestMessagesMode
                      }
                      onChange={(event) =>
                        patchCustomMapping({
                          requestMessagesMode:
                            event.target.value as CustomProviderMapping["requestMessagesMode"],
                        })
                      }
                    >
                      <option value="messages">完整消息数组</option>
                      <option value="last-user-text">最后一条用户文本</option>
                      <option value="last-message-text">最后一条消息文本</option>
                      <option value="joined-user-text">拼接全部用户文本</option>
                      <option value="openai-responses-input">
                        OpenAI Responses 图文输入
                      </option>
                    </select>
                    <small>图片生成的 prompt 通常选择“最后一条用户文本”。</small>
                  </label>
                  <label className="field">
                    <span>请求编码</span>
                    <select
                      value={
                        selected.customMapping?.requestEncoding ??
                        DEFAULT_CUSTOM_MAPPING.requestEncoding
                      }
                      onChange={(event) =>
                        patchCustomMapping({
                          requestEncoding:
                            event.target.value as CustomProviderMapping["requestEncoding"],
                        })
                      }
                    >
                      <option value="json">JSON</option>
                      <option value="multipart">Multipart 表单</option>
                    </select>
                    <small>Image API 编辑端点需要 Multipart 表单。</small>
                  </label>
                  <label className="field">
                    <span>上传附件字段</span>
                    <input
                      value={
                        selected.customMapping?.requestAttachmentsField ??
                        DEFAULT_CUSTOM_MAPPING.requestAttachmentsField
                      }
                      onChange={(event) =>
                        patchCustomMapping({
                          requestAttachmentsField: event.target.value,
                        })
                      }
                      placeholder="image[]"
                    />
                    <small>仅 Multipart 使用；留空表示不上传附件。</small>
                  </label>
                  <label className="field">
                    <span>流式开关字段</span>
                    <input
                      value={
                        selected.customMapping?.requestStreamField ??
                        DEFAULT_CUSTOM_MAPPING.requestStreamField
                      }
                      onChange={(event) =>
                        patchCustomMapping({ requestStreamField: event.target.value })
                      }
                      placeholder="stream"
                    />
                  </label>
                  <label className="field">
                    <span>响应协议</span>
                    <select
                      value={
                        selected.customMapping?.streamProtocol ??
                        DEFAULT_CUSTOM_MAPPING.streamProtocol
                      }
                      onChange={(event) =>
                        patchCustomMapping({
                          streamProtocol: event.target.value as CustomProviderMapping["streamProtocol"],
                        })
                      }
                    >
                      <option value="sse">SSE</option>
                      <option value="ndjson">NDJSON</option>
                      <option value="json">单次 JSON</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Temperature 字段</span>
                    <input
                      value={
                        selected.customMapping?.requestTemperatureField ??
                        DEFAULT_CUSTOM_MAPPING.requestTemperatureField
                      }
                      onChange={(event) =>
                        patchCustomMapping({ requestTemperatureField: event.target.value })
                      }
                      placeholder="temperature"
                    />
                    <small>目标接口不接受该参数时留空。</small>
                  </label>
                  <label className="field">
                    <span>Max tokens 字段</span>
                    <input
                      value={
                        selected.customMapping?.requestMaxTokensField ??
                        DEFAULT_CUSTOM_MAPPING.requestMaxTokensField
                      }
                      onChange={(event) =>
                        patchCustomMapping({ requestMaxTokensField: event.target.value })
                      }
                      placeholder="max_tokens"
                    />
                    <small>支持嵌套路径，例如 generation.max_tokens；不用时留空。</small>
                  </label>
                  <label className="field field-wide">
                    <span>深度思考开关字段</span>
                    <input
                      value={
                        selected.customMapping?.requestReasoningField ??
                        DEFAULT_CUSTOM_MAPPING.requestReasoningField
                      }
                      onChange={(event) =>
                        patchCustomMapping({
                          requestReasoningField: event.target.value,
                        })
                      }
                      placeholder="thinking.type"
                    />
                    <small>
                      自定义接口启用深度思考时填写；例如 DeepSeek 使用 thinking.type，Ollama 使用 think。
                    </small>
                  </label>
                  <label className="field">
                    <span>深度思考开启值（JSON）</span>
                    <input
                      value={
                        selected.customMapping?.requestReasoningEnabledJson ??
                        DEFAULT_CUSTOM_MAPPING.requestReasoningEnabledJson
                      }
                      onChange={(event) =>
                        patchCustomMapping({
                          requestReasoningEnabledJson: event.target.value,
                        })
                      }
                      placeholder={'"enabled"'}
                      spellCheck={false}
                    />
                    <small>也可以使用 true、数字或 JSON 对象。</small>
                  </label>
                  <label className="field">
                    <span>深度思考关闭值（JSON）</span>
                    <input
                      value={
                        selected.customMapping?.requestReasoningDisabledJson ??
                        DEFAULT_CUSTOM_MAPPING.requestReasoningDisabledJson
                      }
                      onChange={(event) =>
                        patchCustomMapping({
                          requestReasoningDisabledJson: event.target.value,
                        })
                      }
                      placeholder={'"disabled"'}
                      spellCheck={false}
                    />
                    <small>例如 DeepSeek 使用 "disabled"，Ollama 使用 false。</small>
                  </label>
                  <label className="field field-wide">
                    <span>附加请求字段（JSON）</span>
                    <textarea
                      value={
                        selected.customMapping?.requestBodyJson ??
                        DEFAULT_CUSTOM_MAPPING.requestBodyJson
                      }
                      onChange={(event) =>
                        patchCustomMapping({ requestBodyJson: event.target.value })
                      }
                      placeholder={'{"size":"1024x1024","quality":"standard"}'}
                      rows={3}
                      spellCheck={false}
                    />
                    <small>
                      JSON 请求会直接合并；Multipart 请求会把顶层字段转换为表单字段。映射字段优先。
                    </small>
                  </label>
                  <div className="mapping-section-label field-wide">
                    <span>响应解析</span>
                    <small>文本与附件可同时返回；不使用的路径可以留空。</small>
                  </div>
                  <label className="field field-wide">
                    <span>文本增量响应路径</span>
                    <input
                      value={
                        selected.customMapping?.responseDeltaPath ??
                        DEFAULT_CUSTOM_MAPPING.responseDeltaPath
                      }
                      onChange={(event) =>
                        patchCustomMapping({ responseDeltaPath: event.target.value })
                      }
                      placeholder="choices.0.delta.content"
                    />
                  </label>
                  <label className="field field-wide">
                    <span>思考内容响应路径</span>
                    <input
                      value={
                        selected.customMapping?.responseReasoningPath ??
                        DEFAULT_CUSTOM_MAPPING.responseReasoningPath
                      }
                      onChange={(event) =>
                        patchCustomMapping({
                          responseReasoningPath: event.target.value,
                        })
                      }
                      placeholder="choices.0.delta.reasoning_content"
                    />
                    <small>
                      用于单独展示推理模型的思考过程；接口不返回时可以留空。
                    </small>
                  </label>
                  <label className="field field-wide">
                    <span>附件数组响应路径</span>
                    <input
                      value={
                        selected.customMapping?.responseAttachmentsPath ??
                        DEFAULT_CUSTOM_MAPPING.responseAttachmentsPath
                      }
                      onChange={(event) =>
                        patchCustomMapping({
                          responseAttachmentsPath: event.target.value,
                        })
                      }
                      placeholder="choices.0.delta.attachments"
                    />
                    <small>留空表示该自定义接口只返回文本。</small>
                  </label>
                  <label className="field">
                    <span>附件数据字段路径</span>
                    <input
                      value={
                        selected.customMapping?.responseAttachmentDataPath ??
                        DEFAULT_CUSTOM_MAPPING.responseAttachmentDataPath
                      }
                      onChange={(event) =>
                        patchCustomMapping({
                          responseAttachmentDataPath: event.target.value,
                        })
                      }
                      placeholder="data"
                    />
                  </label>
                  <label className="field">
                    <span>附件 URL 字段路径</span>
                    <input
                      value={
                        selected.customMapping?.responseAttachmentUrlPath ??
                        DEFAULT_CUSTOM_MAPPING.responseAttachmentUrlPath
                      }
                      onChange={(event) =>
                        patchCustomMapping({
                          responseAttachmentUrlPath: event.target.value,
                        })
                      }
                      placeholder="url"
                    />
                  </label>
                  <label className="field">
                    <span>附件 MIME 字段路径</span>
                    <input
                      value={
                        selected.customMapping?.responseAttachmentMimeTypePath ??
                        DEFAULT_CUSTOM_MAPPING.responseAttachmentMimeTypePath
                      }
                      onChange={(event) =>
                        patchCustomMapping({
                          responseAttachmentMimeTypePath: event.target.value,
                        })
                      }
                      placeholder="mime_type"
                    />
                  </label>
                  <label className="field">
                    <span>附件 MIME 固定值</span>
                    <input
                      value={
                        selected.customMapping?.responseAttachmentMimeTypeValue ??
                        DEFAULT_CUSTOM_MAPPING.responseAttachmentMimeTypeValue
                      }
                      onChange={(event) =>
                        patchCustomMapping({
                          responseAttachmentMimeTypeValue: event.target.value,
                        })
                      }
                      placeholder="image/png"
                    />
                    <small>响应中没有 MIME 字段时使用，例如 image/png。</small>
                  </label>
                  <label className="field">
                    <span>附件名称字段路径</span>
                    <input
                      value={
                        selected.customMapping?.responseAttachmentNamePath ??
                        DEFAULT_CUSTOM_MAPPING.responseAttachmentNamePath
                      }
                      onChange={(event) =>
                        patchCustomMapping({
                          responseAttachmentNamePath: event.target.value,
                        })
                      }
                      placeholder="name"
                    />
                  </label>
                  <label className="field">
                    <span>附件名称固定值</span>
                    <input
                      value={
                        selected.customMapping?.responseAttachmentNameValue ??
                        DEFAULT_CUSTOM_MAPPING.responseAttachmentNameValue
                      }
                      onChange={(event) =>
                        patchCustomMapping({
                          responseAttachmentNameValue: event.target.value,
                        })
                      }
                      placeholder="generated-image.png"
                    />
                    <small>响应中没有文件名时作为回退名称。</small>
                  </label>
                  <div className="mapping-section-label field-wide">
                    <span>模型目录与附加标头</span>
                    <small>用于模型列表解析及厂商要求的额外 Header。</small>
                  </div>
                  <label className="field">
                    <span>模型列表路径</span>
                    <input
                      value={selected.customMapping?.modelsPath ?? DEFAULT_CUSTOM_MAPPING.modelsPath}
                      onChange={(event) => patchCustomMapping({ modelsPath: event.target.value })}
                      placeholder="models"
                    />
                  </label>
                  <label className="field">
                    <span>模型数组响应路径</span>
                    <input
                      value={
                        selected.customMapping?.responseModelsPath ??
                        DEFAULT_CUSTOM_MAPPING.responseModelsPath
                      }
                      onChange={(event) =>
                        patchCustomMapping({ responseModelsPath: event.target.value })
                      }
                      placeholder="data"
                    />
                  </label>
                  <label className="field">
                    <span>模型标识字段路径</span>
                    <input
                      value={
                        selected.customMapping?.responseModelIdPath ??
                        DEFAULT_CUSTOM_MAPPING.responseModelIdPath
                      }
                      onChange={(event) =>
                        patchCustomMapping({ responseModelIdPath: event.target.value })
                      }
                      placeholder="id"
                    />
                  </label>
                  <label className="field field-wide">
                    <span>附加 Headers（JSON）</span>
                    <textarea
                      value={
                        selected.customMapping?.headersJson ??
                        DEFAULT_CUSTOM_MAPPING.headersJson
                      }
                      onChange={(event) => patchCustomMapping({ headersJson: event.target.value })}
                      placeholder={'{"X-Client": "ModelDock"}'}
                      rows={3}
                      spellCheck={false}
                    />
                  </label>
                </div>
              )}
            </div>
          </div>

          <div className="form-section model-section">
            <div className="section-title model-title">
              <span>02</span>
              <div>
                <h4>此连接的可用模型</h4>
                <p>这里只做启用选择；模型资料与分组在独立目录页维护。</p>
              </div>
              <span className="selection-count">{selected.models.length} 已选</span>
            </div>

            <label className="catalog-search">
              <span className="sr-only">检索预选模型</span>
              <MagnifyingGlass size={17} />
              <input
                value={modelQuery}
                onChange={(event) => setModelQuery(event.target.value)}
                placeholder="检索模型名称、标识或能力"
              />
              {modelQuery && (
                <button onClick={() => setModelQuery("")} aria-label="清除模型检索">
                  <X size={15} />
                </button>
              )}
            </label>

            <div className="model-catalog">
              {filteredCatalog.length ? (
                filteredCatalog.map((group) => (
                  <div className="catalog-group" key={group.group.id}>
                    <div className="catalog-family">
                      <span>{group.group.name}</span>
                      <i />
                      <small>{FORMAT_LABELS[group.group.format]} · {group.models.length}</small>
                    </div>
                    <div className="catalog-grid">
                      {group.models.map((model) => {
                        const checked = selected.models.some(
                          (item) =>
                            item.catalogId === model.id ||
                            (!item.catalogId && item.id === model.invocationName),
                        );
                        return (
                          <label className={`model-check-card ${checked ? "checked" : ""}`} key={model.id}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleModel(model)}
                            />
                            <span className="custom-check">
                              <Check size={13} weight="bold" />
                            </span>
                            <span className="catalog-model-avatar">{model.name.slice(0, 1)}</span>
                            <span>
                              <strong>{model.name}</strong>
                              <small>{model.invocationName}</small>
                              <em>
                                {model.capability} · {model.context}
                              </em>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))
              ) : (
                <div className="catalog-empty">
                  <MagnifyingGlass size={21} />
                  <strong>{normalizedModelQuery ? "没有匹配的目录模型" : "模型目录为空"}</strong>
                  <span>{normalizedModelQuery ? "尝试缩短关键词" : "先前往模型目录添加模型"}</span>
                </div>
              )}
            </div>

            <div className="catalog-management-callout">
              <div>
                <strong>需要新增或修改模型？</strong>
                <span>模型名称、调用名、简介与分组统一在模型目录中管理。</span>
              </div>
              <button onClick={onOpenCatalog}>
                管理模型目录
                <ArrowRight size={15} />
              </button>
            </div>
          </div>

          <div className="danger-row">
            <div>
              <Trash size={17} />
              <span>
                <strong>删除此配置</strong>
                <small>删除会同步到当前账号的模型目录。</small>
              </span>
            </div>
            <button onClick={deleteConfig}>删除配置</button>
          </div>
        </section>
      </div>
    </div>
  );
}

type BootstrapState =
  | { status: "loading" }
  | {
      status: "auth";
      runtime: { onlineMode: boolean; storage: string };
    }
  | {
      status: "ready";
      runtime: { onlineMode: boolean; storage: string };
      user: AuthUser;
      state: PersistedAppState;
    }
  | { status: "error"; message: string };

function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapState>({ status: "loading" });

  const initialize = async () => {
    setBootstrap({ status: "loading" });
    try {
      const runtime = await getRuntimeConfig();
      try {
        const user = await getSession();
        const state = normalizeAppState(await loadUserState());
        activateAccountTheme(user.id, state.theme);
        setBootstrap({ status: "ready", runtime, user, state });
      } catch (error) {
        if (error instanceof ClientApiError && error.status === 401) {
          setBootstrap({ status: "auth", runtime });
          return;
        }
        throw error;
      }
    } catch (error) {
      setBootstrap({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "无法连接 ModelDock 后端。",
      });
    }
  };

  useEffect(() => {
    void initialize();
  }, []);

  if (bootstrap.status === "loading") {
    return (
      <div className="bootstrap-screen">
        <span className="brand-mark" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <CircleNotch className="spin" size={20} />
        <span>正在打开工作区</span>
      </div>
    );
  }

  if (bootstrap.status === "error") {
    return (
      <div className="bootstrap-screen bootstrap-error">
        <LockKey size={28} />
        <strong>后端尚未连接</strong>
        <span>{bootstrap.message}</span>
        <button onClick={() => void initialize()}>重新连接</button>
      </div>
    );
  }

  if (bootstrap.status === "auth") {
    return (
      <AuthScreen
        onlineMode={bootstrap.runtime.onlineMode}
        storage={bootstrap.runtime.storage}
        onSubmit={async (mode, username, password) => {
          const user =
            mode === "login"
              ? await login(username, password)
              : await register(username, password);
          const state = normalizeAppState(await loadUserState());
          activateAccountTheme(user.id, state.theme);
          setBootstrap({
            status: "ready",
            runtime: bootstrap.runtime,
            user,
            state,
          });
        }}
      />
    );
  }

  return (
    <WorkspaceApp
      key={bootstrap.user.id}
      user={bootstrap.user}
      initialState={bootstrap.state}
      onLoggedOut={() => {
        setBootstrap({
          status: "auth",
          runtime: bootstrap.runtime,
        });
      }}
    />
  );
}

export default App;
