export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class StorageUnavailableError extends AppError {
  constructor() {
    super(
      503,
      "ONLINE_STORAGE_NOT_CONFIGURED",
      "onlineMode 已启用，但 MySQL 存储适配器尚未配置。",
    );
  }
}

export function asAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof SyntaxError) {
    return new AppError(400, "INVALID_JSON", "请求中的 JSON 格式不正确。");
  }
  return new AppError(500, "INTERNAL_ERROR", "服务器处理请求时发生错误。");
}
