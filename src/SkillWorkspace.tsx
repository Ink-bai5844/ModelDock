import {
  CaretRight,
  CircleNotch,
  PuzzlePiece,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import type {
  LocalSkillDescriptor,
  SkillInvocationPolicy,
} from "./types";

interface SkillWorkspaceProps {
  skills: LocalSkillDescriptor[];
  loading: boolean;
  policies: Record<string, SkillInvocationPolicy>;
  onPolicyChange: (skillId: string, policy: SkillInvocationPolicy) => void;
}

const POLICY_OPTIONS: Array<{
  value: SkillInvocationPolicy;
  label: string;
  description: string;
}> = [
  {
    value: "always",
    label: "始终调用",
    description: "激活后每轮自动加载，适合需要持续人格或记忆的 Skill。",
  },
  {
    value: "auto",
    label: "智能判断",
    description: "激活后由 Agent 根据当前消息决定是否调用。",
  },
  {
    value: "manual",
    label: "仅手动",
    description: "只有本轮通过聊天框“/”明确选择时才调用。",
  },
];

function policyLabel(policy: SkillInvocationPolicy): string {
  return POLICY_OPTIONS.find((option) => option.value === policy)?.label ?? "智能判断";
}

export function SkillWorkspace({
  skills,
  loading,
  policies,
  onPolicyChange,
}: SkillWorkspaceProps) {
  const [selectedSkillId, setSelectedSkillId] = useState(skills[0]?.id ?? "");

  useEffect(() => {
    if (skills.some((skill) => skill.id === selectedSkillId)) return;
    setSelectedSkillId(skills[0]?.id ?? "");
  }, [selectedSkillId, skills]);

  const selectedSkill = useMemo(
    () => skills.find((skill) => skill.id === selectedSkillId) ?? skills[0],
    [selectedSkillId, skills],
  );
  const selectedPolicy = selectedSkill
    ? policies[selectedSkill.id] ?? selectedSkill.defaultInvocationPolicy
    : "auto";
  const selectedPolicyDescription = POLICY_OPTIONS.find(
    (option) => option.value === selectedPolicy,
  )?.description;

  return (
    <div className="settings-workspace skill-directory-workspace">
      <div className="settings-intro skill-directory-intro">
        <div>
          <span className="eyebrow">SKILL REGISTRY</span>
          <h2>让每个 Skill 在合适的时机工作。</h2>
          <p>
            浏览管理员提供的 Skill，并为当前账号分别设置调用方式。聊天时也可以输入“/”临时选择。
          </p>
        </div>
        <span className="skill-directory-count" role="status">
          {loading ? <CircleNotch className="spin" size={16} /> : <PuzzlePiece size={16} />}
          {loading ? "读取中" : `${skills.length} 个可用`}
        </span>
      </div>

      <div className="skill-directory-layout">
        <aside className="skill-registry" aria-label="可用 Skill 列表">
          <div className="panel-heading">
            <div>
              <strong>Skill目录</strong>
              <span>{loading ? "正在同步" : `${skills.length} 个 Skill`}</span>
            </div>
            {loading ? (
              <CircleNotch className="skill-registry-spinner spin" size={17} />
            ) : (
              <PuzzlePiece className="skill-registry-heading-icon" size={17} />
            )}
          </div>

          <div className="skill-registry-list">
            {skills.map((skill) => {
              const policy = policies[skill.id] ?? skill.defaultInvocationPolicy;
              return (
                <button
                  key={skill.id}
                  type="button"
                  className={skill.id === selectedSkill?.id ? "selected" : ""}
                  onClick={() => setSelectedSkillId(skill.id)}
                  aria-pressed={skill.id === selectedSkill?.id}
                >
                  <span className="skill-registry-icon" aria-hidden="true">
                    <PuzzlePiece size={18} />
                  </span>
                  <span className="skill-registry-copy">
                    <strong>{skill.displayName}</strong>
                    <small>${skill.name}</small>
                    <em>{policyLabel(policy)}</em>
                  </span>
                  <CaretRight size={14} />
                </button>
              );
            })}
          </div>
        </aside>

        <section className="skill-detail-panel" aria-live="polite">
          {loading ? (
            <div className="skill-directory-loading" role="status">
              <CircleNotch className="spin" size={22} />
              <span>正在读取 Skill目录</span>
            </div>
          ) : selectedSkill ? (
            <>
              <header className="skill-detail-header">
                <span className="skill-detail-icon" aria-hidden="true">
                  <PuzzlePiece size={22} />
                </span>
                <span className="skill-detail-heading">
                  <strong>{selectedSkill.displayName}</strong>
                  <small>${selectedSkill.name}</small>
                </span>
                <span className="skill-directory-state ready">可用</span>
              </header>

              <div className="skill-detail-body">
                <section className="skill-detail-section" aria-labelledby="skill-overview-title">
                  <span className="skill-detail-kicker" id="skill-overview-title">SKILL PROFILE</span>
                  <h3>功能简介</h3>
                  <p>{selectedSkill.description}</p>
                  <dl className="skill-detail-meta">
                    <div>
                      <dt>管理员默认</dt>
                      <dd>{policyLabel(selectedSkill.defaultInvocationPolicy)}</dd>
                    </div>
                    <div>
                      <dt>当前账号</dt>
                      <dd>{policyLabel(selectedPolicy)}</dd>
                    </div>
                  </dl>
                </section>

                <fieldset className="skill-policy-control skill-detail-section">
                  <legend>调用策略</legend>
                  <div className="skill-policy-segments">
                    {POLICY_OPTIONS.map((option) => (
                      <label key={option.value}>
                        <input
                          type="radio"
                          name={`skill-policy-${selectedSkill.id}`}
                          value={option.value}
                          checked={selectedPolicy === option.value}
                          onChange={() => onPolicyChange(selectedSkill.id, option.value)}
                        />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </div>
                  <p>{selectedPolicyDescription}</p>
                </fieldset>
              </div>
            </>
          ) : (
            <div className="skills-empty">
              <PuzzlePiece size={26} />
              <strong>暂无可用 Skill</strong>
              <span>管理员安装成品包后会显示在这里。</span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
