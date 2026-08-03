import {
  ArrowClockwise,
  CircleNotch,
  DownloadSimple,
  Eye,
  FileAudio,
  FileCode,
  FileImage,
  FilePdf,
  FileText,
  FileVideo,
  HardDrive,
  MagnifyingGlass,
  Trash,
  X,
} from "@phosphor-icons/react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  deleteWorkspaceFile,
  loadWorkspace,
  loadWorkspaceFile,
  workspaceFileUrl,
  type WorkspaceFile,
  type WorkspaceSnapshot,
} from "./api";

const MarkdownContent = lazy(() =>
  import("./MarkdownContent").then((module) => ({
    default: module.MarkdownContent,
  })),
);

type PreviewKind = "markdown" | "text" | "image" | "audio" | "video" | "pdf";

interface WorkspaceFilesProps {
  onToast: (message: string) => void;
}

interface PreviewPayload {
  text?: string;
  objectUrl?: string;
}

const TEXT_PREVIEW_LIMIT = 1024 * 1024;
const BINARY_PREVIEW_LIMIT = 100 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${unit}`;
}

function fileName(filePath: string): string {
  return filePath.split("/").pop() || filePath;
}

function fileDirectory(filePath: string): string {
  const parts = filePath.split("/");
  parts.pop();
  return parts.join("/") || "工作区根目录";
}

function previewKind(file: WorkspaceFile): PreviewKind | undefined {
  const mimeType = file.mimeType.toLocaleLowerCase("en-US");
  if (mimeType.startsWith("text/markdown")) return "markdown";
  if (
    mimeType.startsWith("text/") ||
    mimeType.startsWith("application/json")
  ) {
    return "text";
  }
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("application/pdf")) return "pdf";
  return undefined;
}

function canPreview(file: WorkspaceFile): boolean {
  const kind = previewKind(file);
  if (!kind) return false;
  return file.size <= (kind === "text" || kind === "markdown"
    ? TEXT_PREVIEW_LIMIT
    : BINARY_PREVIEW_LIMIT);
}

function FileTypeIcon({ file }: { file: WorkspaceFile }) {
  const kind = previewKind(file);
  if (kind === "image") return <FileImage size={21} />;
  if (kind === "audio") return <FileAudio size={21} />;
  if (kind === "video") return <FileVideo size={21} />;
  if (kind === "pdf") return <FilePdf size={21} />;
  if (kind === "text" || kind === "markdown") {
    return /\.(?:js|jsx|ts|tsx|py|go|rs|java|c|h|cpp|css|html|xml|sh|ps1|sql)$/i.test(file.path)
      ? <FileCode size={21} />
      : <FileText size={21} />;
  }
  return <FileText size={21} />;
}

function PreviewShell({ children }: { children: ReactNode }) {
  return <div className="workspace-preview-content">{children}</div>;
}

export function WorkspaceFiles({ onToast }: WorkspaceFilesProps) {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [previewFile, setPreviewFile] = useState<WorkspaceFile | null>(null);
  const [previewPayload, setPreviewPayload] = useState<PreviewPayload>({});
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [deletingFile, setDeletingFile] = useState<WorkspaceFile | null>(null);
  const [deleting, setDeleting] = useState(false);

  const refresh = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      setSnapshot(await loadWorkspace());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "工作区读取失败。");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!previewFile) {
      setPreviewPayload({});
      setPreviewError("");
      return;
    }
    let active = true;
    let objectUrl: string | undefined;
    const kind = previewKind(previewFile);
    setPreviewLoading(true);
    setPreviewPayload({});
    setPreviewError("");
    void loadWorkspaceFile(previewFile.path)
      .then(async (blob) => {
        if (!active) return;
        if (kind === "text" || kind === "markdown") {
          setPreviewPayload({ text: await blob.text() });
        } else {
          objectUrl = URL.createObjectURL(blob);
          setPreviewPayload({ objectUrl });
        }
      })
      .catch((loadError) => {
        if (active) {
          setPreviewError(
            loadError instanceof Error ? loadError.message : "文件预览失败。",
          );
        }
      })
      .finally(() => {
        if (active) setPreviewLoading(false);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [previewFile]);

  useEffect(() => {
    if (!previewFile && !deletingFile) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (!deleting) setDeletingFile(null);
      setPreviewFile(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previewFile, deletingFile, deleting]);

  const files = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("zh-CN");
    return [...(snapshot?.files ?? [])]
      .filter((file) => !needle || file.path.toLocaleLowerCase("zh-CN").includes(needle))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }, [query, snapshot]);

  const quotaPercent = snapshot?.quotaBytes
    ? Math.min(100, (snapshot.usedBytes / snapshot.quotaBytes) * 100)
    : 0;
  const overQuota = Boolean(
    snapshot && snapshot.usedBytes > snapshot.quotaBytes,
  );

  const confirmDelete = async () => {
    if (!deletingFile) return;
    setDeleting(true);
    try {
      await deleteWorkspaceFile(deletingFile.path);
      setSnapshot((current) => current
        ? {
            ...current,
            files: current.files.filter((file) => file.path !== deletingFile.path),
            usedBytes: Math.max(0, current.usedBytes - deletingFile.size),
            fileCount: Math.max(0, current.fileCount - 1),
          }
        : current);
      if (previewFile?.path === deletingFile.path) setPreviewFile(null);
      onToast(`${fileName(deletingFile.path)} 已删除`);
      setDeletingFile(null);
    } catch (deleteError) {
      onToast(deleteError instanceof Error ? deleteError.message : "文件删除失败。");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="workspace-files-page">
      <section className="workspace-files-overview">
        <div>
          <span className="eyebrow">WORKSPACE / FILES</span>
          <h2>账号工作区</h2>
          <p>查看 Agent 为你生成的文件。可预览常用格式，也可以下载或删除。</p>
        </div>
        <div className={`workspace-quota-card ${overQuota ? "over" : ""}`}>
          <span><HardDrive size={20} /></span>
          <div>
            <small>已用容量</small>
            <strong>
              {snapshot ? formatBytes(snapshot.usedBytes) : "—"}
              <em>/ {snapshot ? formatBytes(snapshot.quotaBytes) : "—"}</em>
            </strong>
            <div className="workspace-quota-track" aria-hidden="true">
              <i style={{ width: `${quotaPercent}%` }} />
            </div>
          </div>
        </div>
      </section>

      <section className="workspace-files-panel" aria-labelledby="workspace-files-title">
        <div className="workspace-files-toolbar">
          <div>
            <span className="eyebrow">PRIVATE FILES</span>
            <h2 id="workspace-files-title">文件目录</h2>
            <p>{snapshot ? `${snapshot.fileCount} 个文件` : "正在统计文件"}</p>
          </div>
          <div>
            <label className="workspace-file-search">
              <span className="sr-only">搜索工作区文件</span>
              <MagnifyingGlass size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索文件名或目录"
              />
              {query && (
                <button type="button" onClick={() => setQuery("")} aria-label="清除文件搜索">
                  <X size={15} />
                </button>
              )}
            </label>
            <button
              className="workspace-refresh-button"
              type="button"
              disabled={refreshing}
              onClick={() => void refresh(true)}
            >
              <ArrowClockwise className={refreshing ? "spin" : ""} size={16} />
              刷新
            </button>
          </div>
        </div>

        {loading ? (
          <div className="workspace-files-state">
            <CircleNotch className="spin" size={22} />
            <strong>正在读取工作区</strong>
          </div>
        ) : error ? (
          <div className="workspace-files-state error" role="alert">
            <HardDrive size={23} />
            <strong>工作区暂时无法读取</strong>
            <span>{error}</span>
            <button type="button" onClick={() => void refresh()}>重新加载</button>
          </div>
        ) : files.length ? (
          <>
            <div className="workspace-file-list-head" aria-hidden="true">
              <span>文件</span>
              <span>大小</span>
              <span>更新时间</span>
              <span>操作</span>
            </div>
            <div className="workspace-file-list" aria-live="polite">
              {files.map((file) => {
                const previewable = canPreview(file);
                return (
                  <article className="workspace-file-row" key={file.path}>
                    <button
                      className="workspace-file-identity"
                      type="button"
                      disabled={!previewable}
                      onClick={() => setPreviewFile(file)}
                      title={previewable ? "打开预览" : "此格式仅支持下载"}
                    >
                      <span aria-hidden="true"><FileTypeIcon file={file} /></span>
                      <span>
                        <strong>{fileName(file.path)}</strong>
                        <small>{fileDirectory(file.path)}</small>
                      </span>
                    </button>
                    <span className="workspace-file-size"><small>大小</small>{formatBytes(file.size)}</span>
                    <time dateTime={file.updatedAt}>
                      <small>更新时间</small>
                      {new Date(file.updatedAt).toLocaleString("zh-CN", {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                    <div className="workspace-file-actions">
                      {previewable && (
                        <button type="button" onClick={() => setPreviewFile(file)} aria-label={`预览 ${fileName(file.path)}`}>
                          <Eye size={16} />
                        </button>
                      )}
                      <a href={workspaceFileUrl(file.path, true)} download={fileName(file.path)} aria-label={`下载 ${fileName(file.path)}`}>
                        <DownloadSimple size={16} />
                      </a>
                      <button className="danger" type="button" onClick={() => setDeletingFile(file)} aria-label={`删除 ${fileName(file.path)}`}>
                        <Trash size={16} />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
            {snapshot?.truncated && (
              <p className="workspace-truncated-note">文件数量较多，当前仅显示最近读取到的 2,000 项。</p>
            )}
          </>
        ) : (
          <div className="workspace-files-state">
            <HardDrive size={24} />
            <strong>{query ? "没有匹配的文件" : "工作区还是空的"}</strong>
            <span>{query ? "尝试缩短关键词。" : "Agent 生成的交付文件会保存在这里。"}</span>
          </div>
        )}
      </section>

      {previewFile && (
        <div className="workspace-dialog-scrim" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setPreviewFile(null);
        }}>
          <section className="workspace-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="workspace-preview-title">
            <header>
              <span aria-hidden="true"><FileTypeIcon file={previewFile} /></span>
              <div>
                <strong id="workspace-preview-title">{fileName(previewFile.path)}</strong>
                <small>{formatBytes(previewFile.size)} · {fileDirectory(previewFile.path)}</small>
              </div>
              <a href={workspaceFileUrl(previewFile.path, true)} download={fileName(previewFile.path)}>
                <DownloadSimple size={16} />
                下载
              </a>
              <button type="button" onClick={() => setPreviewFile(null)} aria-label="关闭文件预览">
                <X size={17} />
              </button>
            </header>
            {previewLoading ? (
              <PreviewShell><CircleNotch className="spin" size={24} /><strong>正在加载预览</strong></PreviewShell>
            ) : previewError ? (
              <PreviewShell><HardDrive size={24} /><strong>无法预览此文件</strong><span>{previewError}</span></PreviewShell>
            ) : previewKind(previewFile) === "markdown" ? (
              <div className="workspace-markdown-preview">
                <Suspense fallback={<PreviewShell><CircleNotch className="spin" size={22} /></PreviewShell>}>
                  <MarkdownContent content={previewPayload.text ?? ""} />
                </Suspense>
              </div>
            ) : previewKind(previewFile) === "text" ? (
              <pre className="workspace-text-preview">{previewPayload.text}</pre>
            ) : previewKind(previewFile) === "image" && previewPayload.objectUrl ? (
              <div className="workspace-media-preview image"><img src={previewPayload.objectUrl} alt={fileName(previewFile.path)} /></div>
            ) : previewKind(previewFile) === "audio" && previewPayload.objectUrl ? (
              <div className="workspace-media-preview audio"><FileAudio size={44} /><audio src={previewPayload.objectUrl} controls /></div>
            ) : previewKind(previewFile) === "video" && previewPayload.objectUrl ? (
              <div className="workspace-media-preview video"><video src={previewPayload.objectUrl} controls /></div>
            ) : previewKind(previewFile) === "pdf" && previewPayload.objectUrl ? (
              <iframe className="workspace-pdf-preview" src={previewPayload.objectUrl} title={`${fileName(previewFile.path)} 预览`} />
            ) : null}
          </section>
        </div>
      )}

      {deletingFile && (
        <div className="workspace-dialog-scrim" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !deleting) setDeletingFile(null);
        }}>
          <section className="workspace-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="workspace-delete-title">
            <span aria-hidden="true"><Trash size={21} /></span>
            <h2 id="workspace-delete-title">删除 {fileName(deletingFile.path)}？</h2>
            <p>文件将从你的账号工作区永久删除，此操作无法撤销。</p>
            <div>
              <button type="button" disabled={deleting} onClick={() => setDeletingFile(null)}>取消</button>
              <button className="danger" type="button" disabled={deleting} onClick={() => void confirmDelete()}>
                {deleting ? <CircleNotch className="spin" size={16} /> : <Trash size={16} />}
                {deleting ? "正在删除" : "永久删除"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
