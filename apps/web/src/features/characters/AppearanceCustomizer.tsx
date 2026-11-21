import type { AppearanceSelection } from "@cp/core";
import { useState } from "react";
import { ActionButton } from "../../ui/ActionButton";
import { cssUrl } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { FrameBox } from "../../ui/FrameBox";
import {
  AGE_OPTIONS,
  type AppearancePartKey,
  appearanceFilledCount,
  BUILD_OPTIONS,
  CYBERWARE_FACE_OPTIONS,
  EYE_OPTIONS,
  FACE_OPTIONS,
  GROOMING_OPTIONS,
  HAIR_COLOR_OPTIONS,
  HAIR_STYLE_OPTIONS,
  MARKS_OPTIONS,
  type PhysicalOption,
  randomizeAppearance,
  synthesizeAppearanceLook,
} from "./appearance";
import wb from "./workbench.module.css";

interface BioRowProps {
  readonly partKey: AppearancePartKey;
  readonly index: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly locked: boolean;
  readonly onToggleLock: (key: AppearancePartKey) => void;
  readonly children: React.ReactNode;
}

function BioRow({ partKey, index, title, subtitle, locked, onToggleLock, children }: BioRowProps) {
  return (
    <section className={wb.bioRow} data-locked={locked || undefined} aria-label={title}>
      <div className={wb.bioRowRail}>
        <div className={wb.bioRowTitleLine}>
          <span className={wb.bioIndex}>{index}</span>
          <h3 className={wb.bioTitle}>{title}</h3>
        </div>
        {subtitle && <span className={wb.bioSub}>{subtitle}</span>}
        <button
          type="button"
          className={wb.bioLockBtn}
          aria-pressed={locked}
          title={locked ? "已锁定：一键随机时保留此部位" : "点击锁定，一键随机时跳过此部位"}
          onClick={() => onToggleLock(partKey)}
        >
          <span className={wb.bioLockDot} aria-hidden />
          {locked ? "已锁定" : "锁定"}
        </button>
      </div>
      <div className={wb.bioRowContent}>{children}</div>
    </section>
  );
}

function OptionGroup({
  label,
  subLabel,
  options,
  selected,
  onSelect,
}: {
  readonly label: string;
  readonly subLabel?: string;
  readonly options: readonly PhysicalOption[];
  readonly selected: string | undefined;
  readonly onSelect: (id: string | undefined) => void;
}) {
  return (
    <div className={wb.bioGroupWrap}>
      {subLabel && <span className={wb.bioGroupTag}>{subLabel}</span>}
      <fieldset className={wb.bioOptions} aria-label={label}>
        {options.map((o) => {
          const active = selected === o.id;
          return (
            <button
              key={o.id}
              type="button"
              className={wb.bioOption}
              aria-pressed={active}
              title={o.text}
              onClick={() => onSelect(active ? undefined : o.id)}
            >
              {o.swatch && (
                <span
                  className={wb.bioSwatch}
                  style={{ backgroundColor: o.swatch }}
                  aria-hidden="true"
                />
              )}
              <span>{o.label}</span>
            </button>
          );
        })}
      </fieldset>
    </div>
  );
}

/**
 * Step 02：零输入 7 部位纯物理体貌定制面板（BIOMETRIC SCAN）
 * 采用 2077 生物扫描仪统一表格式布局（左部位索引轨 + 右流畅切角芯片流），杜绝空心卡片堆砌；
 * 严格不含衣着/穿搭选项，实时合成自然中文外貌描写写入 card.look，结构化存档写入 board.appearance。
 */
export function AppearanceCustomizer({
  selection,
  look,
  pronoun,
  onUpdate,
  onManualLook,
}: {
  readonly selection: AppearanceSelection;
  readonly look: string;
  readonly pronoun: string;
  readonly onUpdate: (nextSelection: AppearanceSelection, nextLook: string) => void;
  readonly onManualLook: (nextLook: string) => void;
}) {
  const [locked, setLocked] = useState<ReadonlySet<AppearancePartKey>>(() => new Set());
  const [manualOpen, setManualOpen] = useState(false);

  const filled = appearanceFilledCount(selection);
  const synthesized = synthesizeAppearanceLook(selection);
  const isCustomLook = look.trim() !== "" && synthesized !== "" && look.trim() !== synthesized;
  const gridUrl = cssUrl("fx.grid");

  const toggleLock = (key: AppearancePartKey) => {
    setLocked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const applySelection = (next: AppearanceSelection) => {
    onUpdate(next, synthesizeAppearanceLook(next));
  };

  const toggleMark = (id: string) => {
    const current = selection.marks ?? [];
    const has = current.includes(id);
    if (has) {
      applySelection({ ...selection, marks: current.filter((x) => x !== id) });
      return;
    }
    if (current.length >= 2) return;
    applySelection({ ...selection, marks: [...current, id] });
  };

  const handleRandomize = () => {
    const next = randomizeAppearance(selection, locked, pronoun);
    applySelection(next);
  };

  const handleReset = () => {
    applySelection({ marks: [] });
  };

  return (
    <div className={wb.bioWrap}>
      <div className={wb.bioToolbar}>
        <div className={wb.bioToolbarInfo}>
          <span className={wb.bioStatus}>
            {"BIOMETRIC SCAN // "}
            <b>{filled}</b> / 7 项已录入
          </span>
          <span className={wb.note}>
            纯物理体貌（不含衣着），点选即实时合成外貌描述与立绘提示词；锁定单行后一键随机自动跳过。
          </span>
        </div>
        <div className={wb.slotTools}>
          <Button small primary onClick={handleRandomize}>
            ✦ 一键随机{locked.size > 0 ? `（已锁 ${locked.size}）` : ""}
          </Button>
          <Button small disabled={filled === 0 && look.trim() === ""} onClick={handleReset}>
            清空重置
          </Button>
        </div>
      </div>

      <div className={wb.bioConsole}>
        <span className={wb.hudGridBg} style={{ backgroundImage: gridUrl }} aria-hidden />
        <BioRow
          partKey="build"
          index="01"
          title="体型体态"
          subtitle="骨架与体格"
          locked={locked.has("build")}
          onToggleLock={toggleLock}
        >
          <OptionGroup
            label="体型体态"
            options={BUILD_OPTIONS}
            selected={selection.build}
            onSelect={(build) => applySelection({ ...selection, build })}
          />
        </BioRow>

        <BioRow
          partKey="eyes"
          index="02"
          title="眼眸与义眼"
          subtitle="虹膜与光学环"
          locked={locked.has("eyes")}
          onToggleLock={toggleLock}
        >
          <OptionGroup
            label="眼眸与义眼"
            options={EYE_OPTIONS}
            selected={selection.eyes}
            onSelect={(eyes) => applySelection({ ...selection, eyes })}
          />
        </BioRow>

        <BioRow
          partKey="hair"
          index="03"
          title="发型与发色"
          subtitle="剪裁与色卡"
          locked={locked.has("hair")}
          onToggleLock={toggleLock}
        >
          <div className={wb.bioSubStack}>
            <OptionGroup
              label="发型"
              subLabel="发型"
              options={HAIR_STYLE_OPTIONS}
              selected={selection.hairStyle}
              onSelect={(hairStyle) =>
                applySelection({
                  ...selection,
                  hairStyle,
                  ...(hairStyle === "shaved" ? { hairColor: undefined } : {}),
                })
              }
            />
            {selection.hairStyle !== "shaved" && (
              <OptionGroup
                label="发色"
                subLabel="发色"
                options={HAIR_COLOR_OPTIONS}
                selected={selection.hairColor}
                onSelect={(hairColor) => applySelection({ ...selection, hairColor })}
              />
            )}
          </div>
        </BioRow>

        <BioRow
          partKey="face"
          index="04"
          title="面容与年龄"
          subtitle="视觉年龄 + 神态"
          locked={locked.has("face")}
          onToggleLock={toggleLock}
        >
          <div className={wb.bioSubStack}>
            <OptionGroup
              label="视觉年龄"
              subLabel="年龄"
              options={AGE_OPTIONS}
              selected={selection.age}
              onSelect={(age) => applySelection({ ...selection, age })}
            />
            <OptionGroup
              label="五官神态"
              subLabel="五官"
              options={FACE_OPTIONS}
              selected={selection.face}
              onSelect={(face) => applySelection({ ...selection, face })}
            />
          </div>
        </BioRow>

        <BioRow
          partKey="marks"
          index="05"
          title="伤疤与纹身"
          subtitle={`多选 ${(selection.marks ?? []).length} / 2`}
          locked={locked.has("marks")}
          onToggleLock={toggleLock}
        >
          <fieldset className={wb.bioOptions} aria-label="伤疤与纹身（最多 2 项）">
            {MARKS_OPTIONS.map((o) => {
              const marks = selection.marks ?? [];
              const active = marks.includes(o.id);
              const disabled = !active && marks.length >= 2;
              return (
                <button
                  key={o.id}
                  type="button"
                  className={wb.bioOption}
                  aria-pressed={active}
                  disabled={disabled}
                  title={disabled ? "最多选择 2 项伤疤或纹身" : o.text}
                  onClick={() => toggleMark(o.id)}
                >
                  <span>{o.label}</span>
                </button>
              );
            })}
          </fieldset>
        </BioRow>

        <BioRow
          partKey="cyberwareFace"
          index="06"
          title="面部义体线"
          subtitle="外露接缝插槽"
          locked={locked.has("cyberwareFace")}
          onToggleLock={toggleLock}
        >
          <OptionGroup
            label="面部义体线"
            options={CYBERWARE_FACE_OPTIONS}
            selected={selection.cyberwareFace}
            onSelect={(cyberwareFace) => applySelection({ ...selection, cyberwareFace })}
          />
        </BioRow>

        <BioRow
          partKey="grooming"
          index="07"
          title="妆容与毛发"
          subtitle="眼妆 / 穿环 / 胡须"
          locked={locked.has("grooming")}
          onToggleLock={toggleLock}
        >
          <OptionGroup
            label="妆容与毛发"
            options={GROOMING_OPTIONS}
            selected={selection.grooming}
            onSelect={(grooming) => applySelection({ ...selection, grooming })}
          />
        </BioRow>
      </div>

      <section className={wb.bioOutput} aria-label="生物体征合成输出">
        <span className={wb.hudGridBg} style={{ backgroundImage: gridUrl }} aria-hidden />
        <header className={wb.bioOutputHead}>
          <div className={wb.bioOutputMeta}>
            <span className={wb.bioOutputCode}>{"BIOMETRIC OUTPUT // LIVE"}</span>
            <span className={wb.note}>
              {look.length} / 300 字{isCustomLook ? " · 已手动微调" : " · 实时同步至立绘提示词"}
            </span>
          </div>
          <div className={wb.slotTools}>
            {isCustomLook && synthesized && (
              <ActionButton onClick={() => onManualLook(synthesized)}>按选项重新合成</ActionButton>
            )}
            <ActionButton onClick={() => setManualOpen((open) => !open)}>
              {manualOpen ? "收起微调" : "微调文案"}
            </ActionButton>
          </div>
        </header>
        {manualOpen ? (
          <FrameBox className={wb.bioTextareaBox}>
            <textarea
              rows={3}
              maxLength={300}
              value={look}
              aria-label="微调外貌描写"
              placeholder="点击上方 7 部位选项即可自动生成，也可在此微调（最多 300 字）"
              onChange={(e) => onManualLook(e.target.value)}
            />
          </FrameBox>
        ) : (
          <p className={wb.bioOutputText}>
            {look.trim() || "尚未选择体貌特征：点选上方任意特征，或点击「✦ 一键随机」自动生成。"}
          </p>
        )}
      </section>
    </div>
  );
}
