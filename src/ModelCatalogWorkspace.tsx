import {
  ArrowLeft,
  CaretRight,
  CheckCircle,
  DotsSixVertical,
  FileText,
  FolderSimple,
  ImageSquare,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  Robot,
  TreeStructure,
  Trash,
  VideoCamera,
  Waveform,
  X,
} from "@phosphor-icons/react";
import {
  type CSSProperties,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  MODEL_INPUT_TYPES,
  MODEL_INPUT_TYPE_LABELS,
} from "./media";
import { moveItemById, useSortableList } from "./sortable";
import type {
  CatalogModel,
  ModelGroup,
  ModelInputType,
  ProviderFormat,
} from "./types";

const FORMAT_LABELS: Record<ProviderFormat, string> = {
  "openai-compatible": "OpenAI Compatible",
  anthropic: "Anthropic Messages",
  gemini: "Google Gemini",
  ollama: "Ollama Local",
  custom: "自定义映射",
};

function InputTypeIcon({ type }: { type: ModelInputType }) {
  if (type === "image") return <ImageSquare size={16} />;
  if (type === "video") return <VideoCamera size={16} />;
  if (type === "audio") return <Waveform size={16} />;
  return <FileText size={16} />;
}

interface ModelCatalogWorkspaceProps {
  models: CatalogModel[];
  groups: ModelGroup[];
  onChange: (models: CatalogModel[], groups: ModelGroup[]) => void;
  onToast: (message: string) => void;
  onOpenApis: () => void;
}

export function ModelCatalogWorkspace({
  models,
  groups,
  onChange,
  onToast,
  onOpenApis,
}: ModelCatalogWorkspaceProps) {
  const [selectedGroupId, setSelectedGroupId] = useState(groups[0]?.id ?? "");
  const [selectedModelId, setSelectedModelId] = useState(models[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);

  const selectedGroup =
    groups.find((group) => group.id === selectedGroupId) ?? groups[0];
  const groupModels = useMemo(() => {
    if (!selectedGroup) return [];
    const normalized = deferredQuery.trim().toLowerCase();
    return models.filter(
      (model) =>
        model.groupId === selectedGroup.id &&
        (!normalized ||
          [model.name, model.invocationName, model.description, model.capability].some((value) =>
            value.toLowerCase().includes(normalized),
          )),
    );
  }, [deferredQuery, models, selectedGroup]);
  const selectedModel =
    models.find((model) => model.id === selectedModelId) ??
    groupModels[0] ??
    models.find((model) => model.groupId === selectedGroup?.id);
  const groupSorter = useSortableList({
    scope: "model-groups",
    ids: groups.map((group) => group.id),
    onMove: (draggedId, targetId) => {
      onChange(models, moveItemById(groups, draggedId, targetId));
    },
    onMoveEnd: () => onToast("模型分组顺序已更新"),
  });
  const modelSorter = useSortableList({
    scope: "catalog-models",
    ids: groupModels.map((model) => model.id),
    disabled: Boolean(query.trim()),
    onMove: (draggedId, targetId) => {
      onChange(moveItemById(models, draggedId, targetId), groups);
    },
    onMoveEnd: () => onToast("目录模型顺序已更新"),
  });

  useEffect(() => {
    if (selectedGroup && selectedGroup.id !== selectedGroupId) {
      setSelectedGroupId(selectedGroup.id);
    }
  }, [selectedGroup, selectedGroupId]);

  useEffect(() => {
    if (selectedModel && selectedModel.id !== selectedModelId) {
      setSelectedModelId(selectedModel.id);
    }
  }, [selectedModel, selectedModelId]);

  const countModels = (groupId: string) =>
    models.filter((model) => model.groupId === groupId).length;

  const patchGroup = (patch: Partial<ModelGroup>) => {
    if (!selectedGroup) return;
    onChange(
      models,
      groups.map((group) =>
        group.id === selectedGroup.id ? { ...group, ...patch } : group,
      ),
    );
  };

  const addGroup = () => {
    const id = `group-${Date.now()}`;
    const next: ModelGroup = {
      id,
      name: "新模型分组",
      format: "openai-compatible",
      description: "用于组织使用相同接口格式的一组模型。",
      color: "#79b8ff",
    };
    onChange(models, [...groups, next]);
    setSelectedGroupId(id);
    setSelectedModelId("");
    onToast("已创建新的模型分组");
  };

  const deleteGroup = () => {
    if (!selectedGroup) return;
    if (groups.length === 1) {
      onToast("至少需要保留一个模型分组");
      return;
    }
    const fallback = groups.find((group) => group.id !== selectedGroup.id)!;
    const movedCount = countModels(selectedGroup.id);
    const nextGroups = groups.filter((group) => group.id !== selectedGroup.id);
    const nextModels = models.map((model) =>
      model.groupId === selectedGroup.id ? { ...model, groupId: fallback.id } : model,
    );
    onChange(nextModels, nextGroups);
    setSelectedGroupId(fallback.id);
    setSelectedModelId(nextModels.find((model) => model.groupId === fallback.id)?.id ?? "");
    onToast(
      movedCount
        ? `分组已删除，${movedCount} 个模型已移动到 ${fallback.name}`
        : "模型分组已删除",
    );
  };

  const patchModel = (patch: Partial<CatalogModel>) => {
    if (!selectedModel) return;
    onChange(
      models.map((model) =>
        model.id === selectedModel.id ? { ...model, ...patch } : model,
      ),
      groups,
    );
  };

  const addModel = () => {
    if (!selectedGroup) return;
    const timestamp = Date.now();
    const next: CatalogModel = {
      id: `catalog-${timestamp}`,
      name: "未命名模型",
      invocationName: `new-model-${models.length + 1}`,
      groupId: selectedGroup.id,
      description: "补充这个模型的定位、优势与适用场景。",
      context: "—",
      capability: "通用",
      inputTypes: ["text"],
      supportsReasoning: false,
    };
    onChange([...models, next], groups);
    setSelectedModelId(next.id);
    onToast("新模型已加入目录");
  };

  const deleteModel = () => {
    if (!selectedModel) return;
    const nextModels = models.filter((model) => model.id !== selectedModel.id);
    onChange(nextModels, groups);
    setSelectedModelId(
      nextModels.find((model) => model.groupId === selectedGroup?.id)?.id ?? "",
    );
    onToast("模型已从目录及 API 可用列表中移除");
  };

  return (
    <div className="settings-workspace catalog-workspace">
      <div className="settings-intro catalog-intro">
        <div>
          <span className="eyebrow">MODEL REGISTRY</span>
          <h2>统一管理每一个模型。</h2>
          <p>维护模型显示名称、API 调用名、分组和简介；API 页面只负责选择哪些模型可用。</p>
        </div>
        <div className="settings-intro-actions">
          <button className="secondary-button" onClick={onOpenApis}>
            <ArrowLeft size={16} />
            API 配置
          </button>
          <button className="primary-button" onClick={addModel} disabled={!selectedGroup}>
            <Plus size={17} />
            添加模型
          </button>
        </div>
      </div>

      <div className="catalog-admin-layout">
        <aside className="catalog-groups-panel" aria-label="模型分组管理">
          <div className="panel-heading">
            <div>
              <strong>模型分组</strong>
              <span>{groups.length} 个分组</span>
            </div>
            <button className="mini-icon-button" onClick={addGroup} aria-label="添加模型分组">
              <Plus size={17} />
            </button>
          </div>

          <div className="catalog-group-list">
            {groups.map((group) => {
              const className = [
                "sortable-item",
                group.id === selectedGroup?.id ? "selected" : "",
                groupSorter.draggedId === group.id ? "sorting" : "",
                groupSorter.overId === group.id
                  ? `sort-over sort-over-${groupSorter.overPosition}`
                  : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <button
                  {...groupSorter.itemProps(group.id)}
                  key={group.id}
                  className={className}
                  onClick={() => {
                    if (groupSorter.consumeClick()) return;
                    setSelectedGroupId(group.id);
                    setSelectedModelId(
                      models.find((model) => model.groupId === group.id)?.id ?? "",
                    );
                  }}
                  aria-label={`${group.name}，拖动排序，或按 Alt 加上下方向键移动`}
                  title="拖动右侧手柄排序；Alt + ↑/↓ 也可移动"
                >
                  <i style={{ "--group-color": group.color } as CSSProperties} />
                  <span>
                    <strong>{group.name}</strong>
                    <small>{FORMAT_LABELS[group.format]}</small>
                    <em>{countModels(group.id)} 个模型</em>
                  </span>
                  <span
                    {...groupSorter.gripProps(group.id)}
                    className="sort-grip"
                    aria-hidden="true"
                  >
                    <DotsSixVertical size={15} weight="bold" />
                  </span>
                  <CaretRight size={14} />
                </button>
              );
            })}
          </div>

          {selectedGroup && (
            <div className="catalog-group-editor">
              <div className="catalog-subheading">
                <PencilSimple size={15} />
                <span>编辑分组</span>
              </div>
              <label>
                <span>分组名称</span>
                <input
                  value={selectedGroup.name}
                  onChange={(event) => patchGroup({ name: event.target.value })}
                />
              </label>
              <label>
                <span>请求格式</span>
                <select
                  value={selectedGroup.format}
                  onChange={(event) =>
                    patchGroup({ format: event.target.value as ProviderFormat })
                  }
                >
                  {Object.entries(FORMAT_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>分组说明</span>
                <textarea
                  rows={3}
                  value={selectedGroup.description}
                  onChange={(event) => patchGroup({ description: event.target.value })}
                />
              </label>
              <label className="catalog-color-field">
                <span>识别颜色</span>
                <span>
                  <input
                    type="color"
                    value={selectedGroup.color}
                    onChange={(event) => patchGroup({ color: event.target.value })}
                  />
                  <code>{selectedGroup.color.toUpperCase()}</code>
                </span>
              </label>
              <button className="catalog-delete-button" onClick={deleteGroup}>
                <Trash size={15} />
                删除此分组
              </button>
            </div>
          )}
        </aside>

        <section className="catalog-model-panel">
          <div className="catalog-model-toolbar">
            <div>
              <span
                className="catalog-group-mark"
                style={{ "--group-color": selectedGroup?.color } as CSSProperties}
              >
                <FolderSimple size={18} weight="fill" />
              </span>
              <span>
                <strong>{selectedGroup?.name ?? "暂无分组"}</strong>
                <small>
                  {selectedGroup ? FORMAT_LABELS[selectedGroup.format] : "请先创建分组"}
                </small>
              </span>
            </div>
            <label className="catalog-admin-search">
              <MagnifyingGlass size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索模型名称或调用名"
              />
              {query && (
                <button onClick={() => setQuery("")} aria-label="清除模型搜索">
                  <X size={14} />
                </button>
              )}
            </label>
          </div>

          <div className="catalog-model-body">
            <div className="catalog-model-list" aria-label="模型列表">
              <div className="catalog-list-heading">
                <span>目录模型</span>
                <small>{groupModels.length}</small>
              </div>
              {groupModels.length ? (
                groupModels.map((model) => {
                  const className = [
                    "sortable-item",
                    model.id === selectedModel?.id ? "selected" : "",
                    modelSorter.draggedId === model.id ? "sorting" : "",
                    modelSorter.overId === model.id
                      ? `sort-over sort-over-${modelSorter.overPosition}`
                      : "",
                    query.trim() ? "sort-disabled" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <button
                      {...modelSorter.itemProps(model.id)}
                      key={model.id}
                      className={className}
                      onClick={() => {
                        if (!modelSorter.consumeClick()) setSelectedModelId(model.id);
                      }}
                      aria-label={
                        query.trim()
                          ? model.name
                          : `${model.name}，拖动排序，或按 Alt 加上下方向键移动`
                      }
                      title={
                        query.trim()
                          ? "清除搜索后可调整目录顺序"
                          : "拖动右侧手柄排序；Alt + ↑/↓ 也可移动"
                      }
                    >
                      <span className="catalog-model-icon">
                        <Robot size={17} />
                      </span>
                      <span>
                        <strong>{model.name}</strong>
                        <code>{model.invocationName}</code>
                        <small>{model.description}</small>
                        <span className="catalog-model-modalities">
                          {model.supportsReasoning && <em>思考</em>}
                          {model.inputTypes.map((type) => (
                            <em key={type}>{MODEL_INPUT_TYPE_LABELS[type]}</em>
                          ))}
                        </span>
                      </span>
                      {model.id === selectedModel?.id ? (
                        <CheckCircle size={16} weight="fill" />
                      ) : (
                        <CaretRight size={14} />
                      )}
                      <span
                        {...modelSorter.gripProps(model.id)}
                        className="sort-grip"
                        aria-hidden="true"
                      >
                        <DotsSixVertical size={15} weight="bold" />
                      </span>
                    </button>
                  );
                })
              ) : (
                <div className="catalog-admin-empty">
                  <Robot size={23} />
                  <strong>{query ? "没有匹配的模型" : "这个分组还没有模型"}</strong>
                  <span>{query ? "尝试缩短关键词" : "点击右上角添加第一个模型"}</span>
                </div>
              )}
            </div>

            <div className="catalog-model-editor">
              {selectedModel ? (
                <>
                  <div className="catalog-editor-heading">
                    <span className="catalog-model-icon large">
                      <Robot size={20} />
                    </span>
                    <div>
                      <span>MODEL PROFILE</span>
                      <h3>{selectedModel.name || "未命名模型"}</h3>
                    </div>
                  </div>
                  <div className="catalog-editor-form">
                    <label>
                      <span>模型名称</span>
                      <input
                        value={selectedModel.name}
                        onChange={(event) => patchModel({ name: event.target.value })}
                        placeholder="例如：GPT-5"
                      />
                    </label>
                    <label>
                      <span>API 调用名</span>
                      <input
                        className="mono-input"
                        value={selectedModel.invocationName}
                        onChange={(event) =>
                          patchModel({ invocationName: event.target.value })
                        }
                        placeholder="例如：gpt-5"
                      />
                      <small>发送请求时写入 model 字段的实际值。</small>
                    </label>
                    <label>
                      <span>所属分组</span>
                      <select
                        value={selectedModel.groupId}
                        onChange={(event) => {
                          patchModel({ groupId: event.target.value });
                          setSelectedGroupId(event.target.value);
                        }}
                      >
                        {groups.map((group) => (
                          <option key={group.id} value={group.id}>
                            {group.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="catalog-editor-split">
                      <label>
                        <span>上下文</span>
                        <input
                          value={selectedModel.context}
                          onChange={(event) => patchModel({ context: event.target.value })}
                          placeholder="例如：128K"
                        />
                      </label>
                      <label>
                        <span>能力标签</span>
                        <input
                          value={selectedModel.capability}
                          onChange={(event) =>
                            patchModel({ capability: event.target.value })
                          }
                          placeholder="推理 · 工具"
                        />
                      </label>
                    </div>
                    <fieldset className="catalog-input-types">
                      <legend>模型输入类型</legend>
                      <p>决定聊天页添加文件时可选择的媒体格式，可多选。</p>
                      <div>
                        {MODEL_INPUT_TYPES.map((type) => {
                          const checked = selectedModel.inputTypes.includes(type);
                          return (
                            <label
                              key={type}
                              className={checked ? "selected" : ""}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {
                                  const next = checked
                                    ? selectedModel.inputTypes.filter(
                                        (item) => item !== type,
                                      )
                                    : [...selectedModel.inputTypes, type];
                                  if (!next.length) {
                                    onToast("模型至少需要保留一种输入类型");
                                    return;
                                  }
                                  patchModel({ inputTypes: next });
                                }}
                              />
                              <span>
                                <InputTypeIcon type={type} />
                              </span>
                              <strong>{MODEL_INPUT_TYPE_LABELS[type]}</strong>
                              <CheckCircle
                                size={15}
                                weight={checked ? "fill" : "regular"}
                              />
                            </label>
                          );
                        })}
                      </div>
                    </fieldset>
                    <label
                      className={`catalog-reasoning-toggle ${
                        selectedModel.supportsReasoning ? "selected" : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedModel.supportsReasoning ?? false}
                        onChange={(event) =>
                          patchModel({ supportsReasoning: event.target.checked })
                        }
                      />
                      <span className="catalog-reasoning-icon">
                        <TreeStructure size={17} />
                      </span>
                      <span>
                        <strong>深度思考模式</strong>
                        <small>
                          请求模型返回可展示的思考过程；适用于 DeepSeek、Qwen 与其他推理模型。
                        </small>
                      </span>
                      <CheckCircle
                        size={17}
                        weight={selectedModel.supportsReasoning ? "fill" : "regular"}
                      />
                    </label>
                    <label>
                      <span>模型简介</span>
                      <textarea
                        rows={5}
                        value={selectedModel.description}
                        onChange={(event) =>
                          patchModel({ description: event.target.value })
                        }
                        placeholder="描述模型定位、优势和适用场景"
                      />
                    </label>
                  </div>
                  <div className="catalog-editor-footer">
                    <span>更改已自动保存</span>
                    <button onClick={deleteModel}>
                      <Trash size={15} />
                      删除模型
                    </button>
                  </div>
                </>
              ) : (
                <div className="catalog-editor-empty">
                  <Robot size={26} />
                  <strong>选择一个模型开始编辑</strong>
                  <span>也可以添加新的模型到当前分组。</span>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
