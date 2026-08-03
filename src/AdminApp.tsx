import {
  ArrowClockwise,
  CircleNotch,
  Eye,
  EyeSlash,
  FloppyDisk,
  HardDrive,
  LockKey,
  MagnifyingGlass,
  Moon,
  PencilSimple,
  PuzzlePiece,
  ShieldCheck,
  SignOut,
  Sun,
  Trash,
  UploadSimple,
  User,
  UsersThree,
  X,
} from "@phosphor-icons/react";
import {
  type FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ClientApiError,
  deleteAdminAccount,
  deleteAdminSkill,
  getAdminSession,
  listAdminAccounts,
  listAdminSkills,
  loginAdmin,
  logout,
  installAdminSkill,
  updateAdminSkill,
  updateAdminSkillPolicy,
  updateAdminWorkspaceQuota,
  type AdminAccountSummary,
} from "./api";
import type { ThemeMode } from "./accountState";
import type {
  LocalSkillDescriptor,
  SkillInvocationPolicy,
} from "./types";

const ADMIN_THEME_STORAGE_KEY = "modeldock.admin.theme";

function getInitialTheme(): ThemeMode {
  const stored = window.localStorage.getItem(ADMIN_THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function initials(username: string): string {
  const normalized = username.trim();
  if (!normalized) return "MD";
  const parts = normalized.split(/[\s_.-]+/).filter(Boolean);
  return (parts.length > 1
    ? `${parts[0][0]}${parts[1][0]}`
    : normalized.slice(0, 2)
  ).toLocaleUpperCase("zh-CN");
}

function formatStorageBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

type AdminBootstrap =
  | { status: "loading" }
  | { status: "auth" }
  | {
      status: "ready";
      username: string;
      accounts: AdminAccountSummary[];
      skills: LocalSkillDescriptor[];
    }
  | { status: "error"; message: string };

export function AdminApp() {
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const [bootstrap, setBootstrap] = useState<AdminBootstrap>({
    status: "loading",
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.accent = "violet";
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem(ADMIN_THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    document.title = "ModelDock Admin";
  }, []);

  const initialize = async () => {
    setBootstrap({ status: "loading" });
    try {
      const user = await getAdminSession();
      const [accounts, skills] = await Promise.all([
        listAdminAccounts(),
        listAdminSkills(),
      ]);
      setBootstrap({
        status: "ready",
        username: user.username,
        accounts,
        skills,
      });
    } catch (error) {
      if (
        error instanceof ClientApiError &&
        (error.status === 401 || error.status === 403)
      ) {
        setBootstrap({ status: "auth" });
        return;
      }
      setBootstrap({
        status: "error",
        message:
          error instanceof Error ? error.message : "无法连接管理员服务。",
      });
    }
  };

  useEffect(() => {
    void initialize();
  }, []);

  const toggleTheme = () =>
    setTheme((current) => (current === "dark" ? "light" : "dark"));

  if (bootstrap.status === "loading") {
    return (
      <div id="main-content" className="admin-bootstrap">
        <span className="brand-mark admin-brand-mark" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <CircleNotch className="spin" size={20} />
        <span>正在验证管理员会话</span>
      </div>
    );
  }

  if (bootstrap.status === "error") {
    return (
      <div id="main-content" className="admin-bootstrap admin-bootstrap-error">
        <ShieldCheck size={30} />
        <strong>管理员服务暂不可用</strong>
        <span>{bootstrap.message}</span>
        <button onClick={() => void initialize()}>
          <ArrowClockwise size={16} />
          重新连接
        </button>
      </div>
    );
  }

  if (bootstrap.status === "auth") {
    return (
      <AdminLogin
        theme={theme}
        onToggleTheme={toggleTheme}
        onLogin={async (username, password) => {
          await loginAdmin(username, password);
          await initialize();
        }}
      />
    );
  }

  return (
    <AdminWorkspace
      theme={theme}
      username={bootstrap.username}
      accounts={bootstrap.accounts}
      skills={bootstrap.skills}
      onToggleTheme={toggleTheme}
      onAccounts={(accounts) =>
        setBootstrap((current) =>
          current.status === "ready" ? { ...current, accounts } : current,
        )
      }
      onSkills={(skills) =>
        setBootstrap((current) =>
          current.status === "ready" ? { ...current, skills } : current,
        )
      }
      onLogout={async () => {
        await logout().catch(() => undefined);
        setBootstrap({ status: "auth" });
      }}
    />
  );
}

interface AdminLoginProps {
  theme: ThemeMode;
  onToggleTheme: () => void;
  onLogin: (username: string, password: string) => Promise<void>;
}

function AdminLogin({
  theme,
  onToggleTheme,
  onLogin,
}: AdminLoginProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await onLogin(username, password);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "管理员验证失败。",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="admin-login-shell">
      <div className="admin-grid-backdrop" aria-hidden="true" />
      <button
        className="admin-theme-button"
        type="button"
        onClick={onToggleTheme}
        aria-label={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
      >
        {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
        {theme === "dark" ? "浅色" : "深色"}
      </button>
      <main id="main-content" className="admin-login-panel">
        <div className="admin-login-brand">
          <span className="brand-mark admin-brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>
            <strong>ModelDock</strong>
            <small>ADMIN CONTROL</small>
          </span>
        </div>
        <div className="admin-login-heading">
          <span>
            <ShieldCheck size={23} />
          </span>
          <div>
            <span className="eyebrow">RESTRICTED ACCESS</span>
            <h1>管理员验证</h1>
          </div>
        </div>
        <p>
          此入口仅允许唯一管理员账号访问。验证使用现有账号密码，不保存额外的管理员密码。
        </p>
        <form onSubmit={submit}>
          <label>
            <span>管理员账号</span>
            <div className="admin-login-input">
              <User size={17} />
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                required
                autoFocus
              />
            </div>
          </label>
          <label>
            <span>密码</span>
            <div className="admin-login-input">
              <LockKey size={17} />
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                minLength={8}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
              >
                {showPassword ? <EyeSlash size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </label>
          {error && (
            <div className="admin-login-error" role="alert">
              {error}
            </div>
          )}
          <button
            className="admin-login-submit"
            type="submit"
            disabled={submitting}
          >
            {submitting ? (
              <CircleNotch className="spin" size={18} />
            ) : (
              <LockKey size={18} />
            )}
            {submitting ? "正在验证" : "进入管理界面"}
          </button>
        </form>
      </main>
    </div>
  );
}

interface AdminWorkspaceProps {
  theme: ThemeMode;
  username: string;
  accounts: AdminAccountSummary[];
  skills: LocalSkillDescriptor[];
  onToggleTheme: () => void;
  onAccounts: (accounts: AdminAccountSummary[]) => void;
  onSkills: (skills: LocalSkillDescriptor[]) => void;
  onLogout: () => Promise<void>;
}

function AdminQuotaControl({
  account,
  onSaved,
  onToast,
}: {
  account: AdminAccountSummary;
  onSaved: (account: AdminAccountSummary) => void;
  onToast: (message: string) => void;
}) {
  const [megabytes, setMegabytes] = useState(
    String(Math.round(account.workspaceQuotaBytes / (1024 * 1024))),
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setMegabytes(
      String(Math.round(account.workspaceQuotaBytes / (1024 * 1024))),
    );
  }, [account.workspaceQuotaBytes]);

  const parsedMegabytes = Number(megabytes);
  const valid = Number.isInteger(parsedMegabytes) &&
    parsedMegabytes >= 1 &&
    parsedMegabytes <= 1_048_576;
  const changed = valid &&
    parsedMegabytes * 1024 * 1024 !== account.workspaceQuotaBytes;

  const save = async () => {
    if (!valid || !changed) return;
    setSaving(true);
    try {
      const saved = await updateAdminWorkspaceQuota(
        account.id,
        parsedMegabytes * 1024 * 1024,
      );
      onSaved(saved);
      onToast(`${account.username} 的工作区容量已更新`);
    } catch (error) {
      onToast(error instanceof Error ? error.message : "工作区容量保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-quota-control">
      <div>
        <span><HardDrive size={14} /> 工作区容量</span>
        <small>
          已用 {formatStorageBytes(account.workspaceUsedBytes)} / {formatStorageBytes(account.workspaceQuotaBytes)}
        </small>
      </div>
      <label>
        <span className="sr-only">{account.username} 的工作区容量（MB）</span>
        <input
          type="number"
          min="1"
          max="1048576"
          step="1"
          value={megabytes}
          disabled={saving}
          onChange={(event) => setMegabytes(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void save();
            }
          }}
          aria-invalid={!valid}
        />
        <em>MB</em>
      </label>
      <button
        type="button"
        disabled={!changed || saving}
        onClick={() => void save()}
        aria-label={`保存 ${account.username} 的工作区容量`}
      >
        {saving ? <CircleNotch className="spin" size={14} /> : <FloppyDisk size={14} />}
      </button>
    </div>
  );
}

function AdminWorkspace({
  theme,
  username,
  accounts,
  skills,
  onToggleTheme,
  onAccounts,
  onSkills,
  onLogout,
}: AdminWorkspaceProps) {
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState<AdminAccountSummary | null>(null);
  const [deletingSkill, setDeletingSkill] = useState<LocalSkillDescriptor | null>(null);
  const [toast, setToast] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [uploadingSkill, setUploadingSkill] = useState<string | null>(null);
  const [savingSkillPolicy, setSavingSkillPolicy] = useState<string | null>(null);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    if (!normalized) return accounts;
    return accounts.filter((account) =>
      account.username.toLocaleLowerCase("zh-CN").includes(normalized),
    );
  }, [accounts, query]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const [nextAccounts, nextSkills] = await Promise.all([
        listAdminAccounts(),
        listAdminSkills(),
      ]);
      onAccounts(nextAccounts);
      onSkills(nextSkills);
      setToast("管理目录已刷新");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "刷新失败");
    } finally {
      setRefreshing(false);
    }
  };

  const uploadSkill = async (file: File, skillId?: string) => {
    if (!file.name.toLocaleLowerCase("en-US").endsWith(".zip")) {
      setToast("请选择 ZIP 格式的 Skill 成品包");
      return;
    }
    if (file.size > 160 * 1024 * 1024) {
      setToast("Skill 成品包不能超过 160 MB");
      return;
    }
    setUploadingSkill(skillId ?? "new");
    try {
      const saved = skillId
        ? await updateAdminSkill(skillId, file)
        : await installAdminSkill(file);
      onSkills([
        ...skills.filter((skill) => skill.id !== saved.id),
        saved,
      ].sort((left, right) => left.displayName.localeCompare(right.displayName, "zh-CN")));
      setToast(`${saved.displayName} 已${skillId ? "更新" : "安装"}`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Skill 成品包处理失败");
    } finally {
      setUploadingSkill(null);
    }
  };

  const changeDefaultSkillPolicy = async (
    skillId: string,
    policy: SkillInvocationPolicy,
  ) => {
    setSavingSkillPolicy(skillId);
    try {
      const saved = await updateAdminSkillPolicy(skillId, policy);
      onSkills(skills.map((skill) => skill.id === saved.id ? saved : skill));
      setToast(`${saved.displayName} 的默认调用策略已更新`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "默认调用策略保存失败");
    } finally {
      setSavingSkillPolicy(null);
    }
  };

  return (
    <div className="admin-shell">
      <div className="admin-grid-backdrop" aria-hidden="true" />
      <header className="admin-topbar">
        <div className="admin-topbar-brand">
          <span className="brand-mark admin-brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>
            <strong>ModelDock</strong>
            <small>ADMIN CONTROL</small>
          </span>
        </div>
        <div className="admin-topbar-actions">
          <span className="admin-session-badge">
            <ShieldCheck size={15} />
            {username}
          </span>
          <button
            onClick={onToggleTheme}
            aria-label={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
            title={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
          >
            {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <button onClick={() => void onLogout()} aria-label="退出管理员界面">
            <SignOut size={17} />
          </button>
        </div>
      </header>

      <main id="main-content" className="admin-main">
        <section className="admin-overview">
          <div>
            <span className="eyebrow">ACCOUNT DIRECTORY</span>
            <h1>账号管理</h1>
            <p>查看 ModelDock 账号并永久删除非管理员账号。</p>
          </div>
          <div className="admin-stats">
            <span>
              <UsersThree size={19} />
              <strong>{accounts.length}</strong>
              <small>全部账号</small>
            </span>
            <span>
              <User size={19} />
              <strong>
                {accounts.filter((account) => !account.administrator).length}
              </strong>
              <small>普通账号</small>
            </span>
          </div>
        </section>

        <section className="admin-accounts-panel" aria-labelledby="admin-accounts-title">
          <div className="admin-accounts-toolbar">
            <div>
              <span className="eyebrow">USER REGISTRY</span>
              <h2 id="admin-accounts-title">账号目录</h2>
            </div>
            <div>
              <label className="admin-search">
                <span className="sr-only">搜索账号</span>
                <MagnifyingGlass size={16} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索账号名称"
                />
                {query && (
                  <button onClick={() => setQuery("")} aria-label="清除账号搜索">
                    <X size={15} />
                  </button>
                )}
              </label>
              <button
                className="admin-refresh"
                onClick={() => void refresh()}
                disabled={refreshing}
              >
                <ArrowClockwise
                  className={refreshing ? "spin" : ""}
                  size={16}
                />
                刷新
              </button>
            </div>
          </div>

          <div className="admin-account-list" aria-live="polite">
            <div className="admin-account-list-head" aria-hidden="true">
              <span>账号</span>
              <span>工作区容量</span>
              <span>创建时间</span>
              <span>最近更新</span>
              <span>操作</span>
            </div>
            {filtered.length ? (
              filtered.map((account) => (
                <article className="admin-account-row" key={account.id}>
                  <div className="admin-account-identity">
                    <span>{initials(account.username)}</span>
                    <div>
                      <strong>{account.username}</strong>
                      <small>{account.id}</small>
                    </div>
                    {account.administrator && <em>管理员</em>}
                  </div>
                  <AdminQuotaControl
                    account={account}
                    onSaved={(saved) => onAccounts(
                      accounts.map((item) => item.id === saved.id ? saved : item),
                    )}
                    onToast={setToast}
                  />
                  <time dateTime={account.createdAt}>
                    <small>创建时间</small>
                    {formatDate(account.createdAt)}
                  </time>
                  <time dateTime={account.updatedAt}>
                    <small>最近更新</small>
                    {formatDate(account.updatedAt)}
                  </time>
                  <button
                    className="admin-delete-account"
                    disabled={account.administrator}
                    onClick={() => setDeleting(account)}
                    aria-label={
                      account.administrator
                        ? "管理员账号不可删除"
                        : `删除账号 ${account.username}`
                    }
                    title={
                      account.administrator
                        ? "管理员账号受保护"
                        : "永久删除此账号"
                    }
                  >
                    {account.administrator ? (
                      <LockKey size={16} />
                    ) : (
                      <Trash size={16} />
                    )}
                    {account.administrator ? "受保护" : "删除"}
                  </button>
                </article>
              ))
            ) : (
              <div className="admin-empty">
                <MagnifyingGlass size={22} />
                <strong>没有匹配的账号</strong>
                <span>尝试输入更短的账号名称。</span>
              </div>
            )}
          </div>
        </section>

        <section className="admin-skills-panel" aria-labelledby="admin-skills-title">
          <div className="admin-skills-toolbar">
            <div>
              <span className="eyebrow">SKILL CATALOG</span>
              <h2 id="admin-skills-title">Skill目录</h2>
              <p>统一维护所有账号可调用的 Skill，并设置账号首次使用时的默认调用策略。</p>
            </div>
            <label
              className="admin-skill-upload primary"
              aria-disabled={uploadingSkill !== null}
            >
              {uploadingSkill === "new" ? (
                <CircleNotch className="spin" size={16} />
              ) : (
                <UploadSimple size={16} />
              )}
              {uploadingSkill === "new" ? "正在安装" : "安装 Skill"}
              <input
                type="file"
                accept=".zip,application/zip"
                disabled={uploadingSkill !== null}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  if (file) void uploadSkill(file);
                }}
              />
            </label>
          </div>

          <div className="admin-skill-list" aria-live="polite">
            {skills.length ? (
              skills.map((skill) => (
                <article className="admin-skill-row" key={skill.id}>
                  <span className="admin-skill-icon" aria-hidden="true">
                    <PuzzlePiece size={21} />
                  </span>
                  <div className="admin-skill-copy">
                    <div>
                      <strong>{skill.displayName}</strong>
                      <code>${skill.name}</code>
                    </div>
                    <p>{skill.description}</p>
                    <span className={skill.runtimeReady ? "ready" : "unavailable"}>
                      {skill.runtimeReady ? "可供聊天调用" : "运行环境尚未就绪"}
                    </span>
                  </div>
                  <label className="admin-skill-policy">
                    <span>默认调用策略</span>
                    <select
                      value={skill.defaultInvocationPolicy}
                      disabled={savingSkillPolicy !== null || uploadingSkill !== null}
                      onChange={(event) => void changeDefaultSkillPolicy(
                        skill.id,
                        event.currentTarget.value as SkillInvocationPolicy,
                      )}
                      aria-label={`${skill.displayName} 的默认调用策略`}
                    >
                      <option value="always">始终调用</option>
                      <option value="auto">智能判断</option>
                      <option value="manual">仅手动</option>
                    </select>
                    {savingSkillPolicy === skill.id && (
                      <CircleNotch className="spin" size={14} aria-label="保存中" />
                    )}
                  </label>
                  <div className="admin-skill-actions">
                    <label aria-disabled={uploadingSkill !== null}>
                      {uploadingSkill === skill.id ? (
                        <CircleNotch className="spin" size={16} />
                      ) : (
                        <PencilSimple size={16} />
                      )}
                      {uploadingSkill === skill.id ? "更新中" : "更新"}
                      <input
                        type="file"
                        accept=".zip,application/zip"
                        disabled={uploadingSkill !== null}
                        onChange={(event) => {
                          const file = event.currentTarget.files?.[0];
                          event.currentTarget.value = "";
                          if (file) void uploadSkill(file, skill.id);
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      disabled={uploadingSkill !== null}
                      onClick={() => setDeletingSkill(skill)}
                      aria-label={`删除 Skill ${skill.displayName}`}
                    >
                      <Trash size={16} />
                      删除
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <div className="admin-skill-empty">
                <PuzzlePiece size={22} />
                <strong>还没有安装 Skill</strong>
                <span>上传 ZIP 成品包后，它会出现在所有账号的 Skill目录中。</span>
              </div>
            )}
          </div>
        </section>
      </main>

      {deleting && (
        <AdminDeleteDialog
          account={deleting}
          onClose={() => setDeleting(null)}
          onDelete={async () => {
            const deleted = await deleteAdminAccount(deleting.id);
            onAccounts(
              accounts.filter((account) => account.id !== deleted.id),
            );
            setDeleting(null);
            setToast(`账号 ${deleted.username} 已删除`);
          }}
        />
      )}
      {deletingSkill && (
        <AdminDeleteSkillDialog
          skill={deletingSkill}
          onClose={() => setDeletingSkill(null)}
          onDelete={async () => {
            const deleted = await deleteAdminSkill(deletingSkill.id);
            onSkills(skills.filter((skill) => skill.id !== deleted.id));
            setDeletingSkill(null);
            setToast(`Skill ${deleted.displayName} 已删除`);
          }}
        />
      )}
      {toast && <div className="toast admin-toast">{toast}</div>}
    </div>
  );
}

interface AdminDeleteSkillDialogProps {
  skill: LocalSkillDescriptor;
  onClose: () => void;
  onDelete: () => Promise<void>;
}

function AdminDeleteSkillDialog({
  skill,
  onClose,
  onDelete,
}: AdminDeleteSkillDialogProps) {
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const confirmed = confirmation === skill.name;

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose, submitting]);

  return (
    <div
      className="admin-delete-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <section
        className="admin-delete-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="admin-delete-skill-title"
        aria-describedby="admin-delete-skill-description"
      >
        <div className="admin-delete-heading">
          <span><Trash size={20} /></span>
          <div>
            <span className="eyebrow">DELETE SKILL</span>
            <h2 id="admin-delete-skill-title">删除 {skill.displayName}？</h2>
          </div>
        </div>
        <p id="admin-delete-skill-description">
          删除后，所有账号都无法再从聊天框调用这个 Skill。此操作无法撤销。
        </p>
        <label>
          <span>输入 <strong>{skill.name}</strong> 确认</span>
          <input
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
            autoFocus
          />
        </label>
        {error && <div className="admin-delete-error" role="alert">{error}</div>}
        <div className="admin-delete-actions">
          <button onClick={onClose} disabled={submitting}>取消</button>
          <button
            className="danger"
            disabled={!confirmed || submitting}
            onClick={async () => {
              setError("");
              setSubmitting(true);
              try {
                await onDelete();
              } catch (deleteError) {
                setError(deleteError instanceof Error ? deleteError.message : "Skill 删除失败。");
                setSubmitting(false);
              }
            }}
          >
            {submitting ? <CircleNotch className="spin" size={16} /> : <Trash size={16} />}
            {submitting ? "正在删除" : "永久删除"}
          </button>
        </div>
      </section>
    </div>
  );
}

interface AdminDeleteDialogProps {
  account: AdminAccountSummary;
  onClose: () => void;
  onDelete: () => Promise<void>;
}

function AdminDeleteDialog({
  account,
  onClose,
  onDelete,
}: AdminDeleteDialogProps) {
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const confirmed = confirmation === account.username;

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose, submitting]);

  return (
    <div
      className="admin-delete-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <section
        className="admin-delete-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="admin-delete-title"
        aria-describedby="admin-delete-description"
      >
        <div className="admin-delete-heading">
          <span>
            <Trash size={20} />
          </span>
          <div>
            <span className="eyebrow">DELETE ACCOUNT</span>
            <h2 id="admin-delete-title">删除账号 {account.username}？</h2>
          </div>
        </div>
        <p id="admin-delete-description">
          账号、API 配置、模型目录和全部聊天记录将永久删除，且无法撤销。
        </p>
        <label>
          <span>
            输入 <strong>{account.username}</strong> 确认
          </span>
          <input
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
            autoFocus
          />
        </label>
        {error && (
          <div className="admin-delete-error" role="alert">
            {error}
          </div>
        )}
        <div className="admin-delete-actions">
          <button onClick={onClose} disabled={submitting}>
            取消
          </button>
          <button
            className="danger"
            disabled={!confirmed || submitting}
            onClick={async () => {
              setError("");
              setSubmitting(true);
              try {
                await onDelete();
              } catch (deleteError) {
                setError(
                  deleteError instanceof Error
                    ? deleteError.message
                    : "账号删除失败。",
                );
                setSubmitting(false);
              }
            }}
          >
            {submitting ? (
              <CircleNotch className="spin" size={16} />
            ) : (
              <Trash size={16} />
            )}
            {submitting ? "正在删除" : "永久删除"}
          </button>
        </div>
      </section>
    </div>
  );
}
