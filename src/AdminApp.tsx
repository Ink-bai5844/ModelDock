import {
  ArrowClockwise,
  CircleNotch,
  Eye,
  EyeSlash,
  LockKey,
  MagnifyingGlass,
  Moon,
  ShieldCheck,
  SignOut,
  Sun,
  Trash,
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
  getAdminSession,
  listAdminAccounts,
  loginAdmin,
  logout,
  type AdminAccountSummary,
} from "./api";
import type { ThemeMode } from "./accountState";

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

type AdminBootstrap =
  | { status: "loading" }
  | { status: "auth" }
  | { status: "ready"; username: string; accounts: AdminAccountSummary[] }
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
      const accounts = await listAdminAccounts();
      setBootstrap({
        status: "ready",
        username: user.username,
        accounts,
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
      onToggleTheme={toggleTheme}
      onAccounts={(accounts) =>
        setBootstrap((current) =>
          current.status === "ready" ? { ...current, accounts } : current,
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
  onToggleTheme: () => void;
  onAccounts: (accounts: AdminAccountSummary[]) => void;
  onLogout: () => Promise<void>;
}

function AdminWorkspace({
  theme,
  username,
  accounts,
  onToggleTheme,
  onAccounts,
  onLogout,
}: AdminWorkspaceProps) {
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState<AdminAccountSummary | null>(null);
  const [toast, setToast] = useState("");
  const [refreshing, setRefreshing] = useState(false);
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
      onAccounts(await listAdminAccounts());
      setToast("账号列表已刷新");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "刷新失败");
    } finally {
      setRefreshing(false);
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
      {toast && <div className="toast admin-toast">{toast}</div>}
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
