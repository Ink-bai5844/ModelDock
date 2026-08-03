import type { GatewayMessage } from "../providers/provider.js";

export const PRIVATE_REASONING_NOTICE = "思考过程已在隐私模式下隐藏。";

const REDACTED_NAME = "[已隐藏姓名]";
const REDACTED_ADDRESS = "[已隐藏地址]";
const REDACTED_CONTACT = "[已隐藏联系方式]";
const REDACTED_SECRET = "[已隐藏敏感凭据]";
const REDACTED_IDENTIFIER = "[已隐藏身份信息]";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function uniqueTerms(values: Iterable<string>): string[] {
  return [...new Set(
    [...values]
      .map((value) => value.trim())
      .filter((value) => value.length >= 2 && value.length <= 80),
  )].sort((left, right) => right.length - left.length);
}

export function extractPrivateTerms(messages: GatewayMessage[]): string[] {
  const terms: string[] = [];
  for (const message of messages) {
    if (message.role !== "user") continue;
    const text = message.content;
    for (const match of text.matchAll(
      /(?:真实姓名|法定姓名|身份证姓名|联系人|收件人|户主)\s*(?:是|为|叫|[:：])?\s*([\u3400-\u9fff·]{2,8}?)(?=(?:先生|女士)?(?:[\s,，。！？?]|$))/gu,
    )) {
      terms.push(match[1]);
    }
    for (const match of text.matchAll(
      /(?:legal name|full name|identity name|contact|recipient)\s*(?:is|:|=)?\s*([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,3})/gi,
    )) {
      terms.push(match[1]);
    }
  }
  return uniqueTerms(terms);
}

export function redactPrivateContent(
  input: string,
  protectedTerms: Iterable<string> = [],
): string {
  let value = input;

  value = value.replace(
    /((?:password|passwd|pwd|passcode|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|secret|密码|口令|密钥|令牌)\s*(?:is|为|是|=|:|：)\s*)["']?([^\s,，;；"'`]{3,})/giu,
    `$1${REDACTED_SECRET}`,
  );
  value = value.replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{8,}={0,2}\b/gi, REDACTED_SECRET);
  value = value.replace(
    /\b(?:sk|pk|rk|api|key|token)-[A-Za-z0-9_-]{12,}\b/gi,
    REDACTED_SECRET,
  );
  value = value.replace(
    /\b[A-Za-z0-9+/]{32,}={0,2}\b/g,
    REDACTED_SECRET,
  );

  value = value.replace(
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    REDACTED_CONTACT,
  );
  value = value.replace(
    /(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)/g,
    REDACTED_CONTACT,
  );
  value = value.replace(
    /(?<![\dA-Za-z])\+\d{1,3}[\s-]?(?:\d[\s-]?){7,14}(?!\d)/g,
    REDACTED_CONTACT,
  );
  value = value.replace(
    /(?<!\d)(?:0\d{2,3}[-\s]?)?\d{7,8}(?!\d)/g,
    REDACTED_CONTACT,
  );

  value = value.replace(
    /(?<!\d)\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[0-9Xx](?!\d)/g,
    REDACTED_IDENTIFIER,
  );
  value = value.replace(
    /(?<!\d)(?:\d[ -]?){15,19}(?!\d)/g,
    REDACTED_IDENTIFIER,
  );
  value = value.replace(
    /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    REDACTED_IDENTIFIER,
  );
  value = value.replace(
    /(?<!\d)-?(?:[1-8]?\d(?:\.\d+)?|90(?:\.0+)?)[,，\s]+-?(?:1[0-7]\d(?:\.\d+)?|180(?:\.0+)?|\d?\d(?:\.\d+)?)(?!\d)/g,
    REDACTED_ADDRESS,
  );

  value = value.replace(
    /[\u3400-\u9fff]{2,}(?:省|自治区|特别行政区|市|自治州|地区|盟)[\u3400-\u9fffA-Za-z0-9]{0,30}(?:区|县|旗|镇|乡|街道|路|街|道|巷|弄|号|栋|单元|室)[\u3400-\u9fffA-Za-z0-9-]{0,24}/gu,
    REDACTED_ADDRESS,
  );
  value = value.replace(
    /(?:地址|住址|收货地址|家庭地址)\s*(?:是|为|=|:|：)\s*[^\n。；;]{4,120}/gu,
    (match) => `${match.slice(0, match.search(/(?:是|为|=|:|：)/u) + 1)}${REDACTED_ADDRESS}`,
  );

  value = value.replace(
    /([\u3400-\u9fff·]{2,4})(先生|女士|老师|同学|医生|经理|主任|老板)/gu,
    `${REDACTED_NAME}$2`,
  );
  value = value.replace(
    /\b(?:Mr|Mrs|Ms|Miss|Dr|Prof)\.?\s+[A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,3}\b/g,
    REDACTED_NAME,
  );
  value = value.replace(
    /((?:真实姓名|法定姓名|身份证姓名|联系人|收件人|户主|legal name|full name|identity name|recipient|contact)\s*(?:是|为|is|=|:|：)\s*)([\p{L}][\p{L}·'. -]{1,60})/giu,
    `$1${REDACTED_NAME}`,
  );

  for (const term of uniqueTerms(protectedTerms)) {
    value = value.replace(new RegExp(escapeRegExp(term), "giu"), REDACTED_NAME);
  }
  return value;
}

export function redactPrivateValue<T>(
  input: T,
  protectedTerms: Iterable<string> = [],
): T {
  const seen = new WeakSet<object>();
  const visit = (value: unknown, depth: number): unknown => {
    if (typeof value === "string") return redactPrivateContent(value, protectedTerms);
    if (!value || typeof value !== "object" || depth > 12) return value;
    if (seen.has(value)) return "[已隐藏循环数据]";
    seen.add(value);
    if (Array.isArray(value)) return value.map((entry) => visit(entry, depth + 1));
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, visit(entry, depth + 1)]),
    );
  };
  return visit(input, 0) as T;
}

export class PrivateResponseGuard {
  private text = "";
  private reasoningNoticeSent = false;
  private readonly terms: string[];

  constructor(protectedTerms: Iterable<string> = []) {
    this.terms = uniqueTerms(protectedTerms);
  }

  appendText(chunk: string): void {
    this.text += chunk;
  }

  takeReasoningNotice(): string | undefined {
    if (this.reasoningNoticeSent) return undefined;
    this.reasoningNoticeSent = true;
    return PRIVATE_REASONING_NOTICE;
  }

  redact(value: string): string {
    return redactPrivateContent(value, this.terms);
  }

  flushText(): string {
    const output = this.redact(this.text);
    this.text = "";
    return output;
  }
}
