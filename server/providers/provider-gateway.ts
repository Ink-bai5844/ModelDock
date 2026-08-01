import { AppError } from "../core/errors.js";
import { AnthropicAdapter } from "./anthropic.js";
import { CustomAdapter } from "./custom.js";
import { GeminiAdapter } from "./gemini.js";
import { OllamaAdapter } from "./ollama.js";
import { OpenAiCompatibleAdapter } from "./openai-compatible.js";
import { normalizeReasoningStream } from "./reasoning-stream.js";
import type {
  ChatGatewayRequest,
  GatewayChunk,
  ProviderAdapter,
  ProviderConfig,
  ProviderFormat,
  ProviderModel,
} from "./provider.js";

export class ProviderGateway {
  private readonly adapters: Map<ProviderFormat, ProviderAdapter>;

  constructor(adapters: ProviderAdapter[] = [
    new OpenAiCompatibleAdapter(),
    new AnthropicAdapter(),
    new GeminiAdapter(),
    new OllamaAdapter(),
    new CustomAdapter(),
  ]) {
    this.adapters = new Map(adapters.map((adapter) => [adapter.format, adapter]));
  }

  async testConnection(
    config: ProviderConfig,
    signal?: AbortSignal,
  ): Promise<{ ok: true; message: string; models: number }> {
    const models = await this.adapter(config).listModels(config, signal);
    return {
      ok: true,
      message: models.length
        ? `连接成功，接口返回 ${models.length} 个模型。`
        : "连接成功，但接口没有返回模型列表。",
      models: models.length,
    };
  }

  listModels(config: ProviderConfig, signal?: AbortSignal): Promise<ProviderModel[]> {
    return this.adapter(config).listModels(config, signal);
  }

  streamChat(config: ProviderConfig, request: ChatGatewayRequest): AsyncIterable<GatewayChunk> {
    if (!config.enabled) {
      throw new AppError(400, "PROVIDER_DISABLED", "这个 API 配置当前已停用。");
    }
    return normalizeReasoningStream(
      this.adapter(config).streamChat(config, request),
      request.reasoning === true,
    );
  }

  private adapter(config: ProviderConfig): ProviderAdapter {
    const adapter = this.adapters.get(config.format);
    if (!adapter) {
      throw new AppError(
        400,
        "UNSUPPORTED_PROVIDER_FORMAT",
        `暂不支持 ${config.format} 请求格式。`,
      );
    }
    return adapter;
  }
}
