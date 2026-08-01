import {
  ArrowRight,
  CircleNotch,
  Database,
  Eye,
  EyeSlash,
  HardDrives,
  LockKey,
  Moon,
  SquaresFour,
  Sun,
  User,
} from "@phosphor-icons/react";
import { type FormEvent, useEffect, useState } from "react";
import type { ThemeMode } from "./accountState";
import { DEFAULT_EFFECT_SETTINGS } from "./effects";
import { ParticleField } from "./ParticleField";

const AUTH_THEME_STORAGE_KEY = "modeldock.auth.theme";

function getInitialAuthTheme(): ThemeMode {
  const storedTheme = window.localStorage.getItem(AUTH_THEME_STORAGE_KEY);
  if (storedTheme === "light" || storedTheme === "dark") {
    return storedTheme;
  }
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

interface AuthScreenProps {
  onlineMode: boolean;
  storage: string;
  onSubmit: (
    mode: "login" | "register",
    username: string,
    password: string,
  ) => Promise<void>;
}

export function AuthScreen({ onlineMode, storage, onSubmit }: AuthScreenProps) {
  const [theme, setTheme] = useState<ThemeMode>(getInitialAuthTheme);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem(AUTH_THEME_STORAGE_KEY, theme);
  }, [theme]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (mode === "register" && password !== confirmPassword) {
      setError("两次输入的密码不一致。");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(mode, username, password);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法完成账号验证。");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-shell">
      <ParticleField
        settings={DEFAULT_EFFECT_SETTINGS}
        accentRgb={theme === "light" ? "112, 66, 163" : "200, 164, 255"}
        isLight={theme === "light"}
      />
      <div className="auth-ambient" aria-hidden="true">
        <i />
        <i />
      </div>
      <button
        className="auth-theme-toggle"
        type="button"
        onClick={() =>
          setTheme((currentTheme) =>
            currentTheme === "dark" ? "light" : "dark",
          )
        }
        aria-label={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
        title={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
      >
        {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
        <span>{theme === "dark" ? "浅色" : "深色"}</span>
      </button>
      <main className="auth-layout">
        <section className="auth-story">
          <div className="auth-brand">
            <span className="brand-mark" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span>ModelDock</span>
          </div>
          <div className="auth-story-copy">
            <span className="eyebrow">MULTI-MODEL WORKSPACE</span>
            <h1>把常用 AI 模型放进一个工作区。</h1>
            <p>
              统一管理 API 连接、模型目录和聊天记录，随时切换模型并继续对话。
            </p>
          </div>
          <div className="auth-feature-note">
            <SquaresFour size={20} />
            <span>
              <strong>模型、连接与对话，一处管理</strong>
              <small>登录后即可使用你的模型目录、聊天记录和界面偏好。</small>
            </span>
          </div>
        </section>

        <section className="auth-panel" aria-labelledby="auth-title">
          <div className="auth-mode">
            <button
              className={mode === "login" ? "active" : ""}
              onClick={() => {
                setMode("login");
                setError("");
              }}
            >
              登录
            </button>
            <button
              className={mode === "register" ? "active" : ""}
              onClick={() => {
                setMode("register");
                setError("");
              }}
            >
              注册
            </button>
          </div>

          <div className="auth-heading">
            <span className="auth-heading-icon">
              <LockKey size={20} />
            </span>
            <div>
              <span>{mode === "login" ? "WELCOME BACK" : "CREATE ACCOUNT"}</span>
              <h2 id="auth-title">{mode === "login" ? "进入工作区" : "创建独立账号"}</h2>
            </div>
          </div>

          <form className="auth-form" onSubmit={submit}>
            <label>
              <span>账号名称</span>
              <div className="auth-input">
                <User size={17} />
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  placeholder="3–32 个字符"
                  required
                />
              </div>
            </label>

            <label>
              <span>密码</span>
              <div className="auth-input">
                <LockKey size={17} />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  placeholder="至少 8 个字符"
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

            {mode === "register" && (
              <label>
                <span>确认密码</span>
                <div className="auth-input">
                  <LockKey size={17} />
                  <input
                    type={showPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    autoComplete="new-password"
                    placeholder="再次输入密码"
                    minLength={8}
                    required
                  />
                </div>
              </label>
            )}

            {error && (
              <div className="auth-error" role="alert">
                {error}
              </div>
            )}

            <button className="auth-submit" type="submit" disabled={submitting}>
              {submitting ? <CircleNotch className="spin" size={18} /> : <ArrowRight size={18} />}
              {submitting
                ? mode === "login"
                  ? "正在登录"
                  : "正在创建账号"
                : mode === "login"
                  ? "登录 ModelDock"
                  : "注册并进入"}
            </button>
          </form>

          <div className="auth-runtime">
            {onlineMode ? <Database size={16} /> : <HardDrives size={16} />}
            <span>
              <strong>{onlineMode ? "ONLINE MODE" : "OFFLINE MODE"}</strong>
              <small>{storage}</small>
            </span>
            <i className={onlineMode ? "online" : ""} />
          </div>
        </section>
      </main>
    </div>
  );
}
