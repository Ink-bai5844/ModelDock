import { AppError } from "../core/errors.js";

const PARTITION_MARKER = "__modeldock_partition_version";
const CONVERSATIONS_PRESENT_MARKER = "__modeldock_conversations_present";
const PARTITION_VERSION = 1;
const MAX_RECORD_ID_LENGTH = 191;

export interface PlainMessageState {
  id: string;
  ordinal: number;
  payload: Record<string, unknown>;
}

export interface PlainConversationState {
  id: string;
  ordinal: number;
  payload: Record<string, unknown>;
  messages: PlainMessageState[];
}

export interface PlainAccountStatePartition {
  root: Record<string, unknown>;
  conversations: PlainConversationState[];
}

function stateRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(400, "INVALID_STATE", `${label}必须是对象。`);
  }
  return value as Record<string, unknown>;
}

function recordId(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > MAX_RECORD_ID_LENGTH ||
    value.includes("\0")
  ) {
    throw new AppError(400, "INVALID_STATE", `${label}标识无效。`);
  }
  return value;
}

export function partitionAccountState(value: unknown): PlainAccountStatePartition {
  const state = stateRecord(value, "账号状态");
  const sourceConversations = Array.isArray(state.conversations)
    ? state.conversations
    : [];
  const conversations = sourceConversations.map((value, ordinal) => {
    const conversation = stateRecord(value, "会话");
    const id = recordId(conversation.id, "会话");
    const sourceMessages = Array.isArray(conversation.messages)
      ? conversation.messages
      : [];
    const messages = sourceMessages.map((value, messageOrdinal) => {
      const message = stateRecord(value, "消息");
      return {
        id: recordId(message.id, "消息"),
        ordinal: messageOrdinal,
        payload: { ...message },
      };
    });
    const { messages: _messages, ...payload } = conversation;
    return { id, ordinal, payload, messages };
  });
  const conversationsPresent = Object.prototype.hasOwnProperty.call(
    state,
    "conversations",
  );
  const {
    conversations: _conversations,
    [PARTITION_MARKER]: _marker,
    [CONVERSATIONS_PRESENT_MARKER]: _present,
    ...root
  } = state;
  return {
    root: {
      ...root,
      [PARTITION_MARKER]: PARTITION_VERSION,
      [CONVERSATIONS_PRESENT_MARKER]: conversationsPresent,
    },
    conversations,
  };
}

export function isPartitionedRoot(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value as Record<string, unknown>)[PARTITION_MARKER] === PARTITION_VERSION,
  );
}

export function mergeAccountState(
  rootValue: unknown,
  conversations: PlainConversationState[],
): Record<string, unknown> {
  const root = stateRecord(rootValue, "账号状态");
  const {
    [PARTITION_MARKER]: _marker,
    [CONVERSATIONS_PRESENT_MARKER]: conversationsPresent,
    ...publicRoot
  } = root;
  const mergedConversations = conversations
      .slice()
      .sort((left, right) => left.ordinal - right.ordinal)
      .map((conversation) => ({
        ...conversation.payload,
        messages: conversation.messages
          .slice()
          .sort((left, right) => left.ordinal - right.ordinal)
          .map((message) => message.payload),
      }));
  return conversationsPresent === true || mergedConversations.length
    ? { ...publicRoot, conversations: mergedConversations }
    : publicRoot;
}
