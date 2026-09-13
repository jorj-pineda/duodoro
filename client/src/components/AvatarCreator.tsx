"use client";
import { useState } from "react";
import PixelCharacter from "./PixelCharacter";
import { ART_PX } from "@/lib/scene";
import {
  SKIN_COLORS,
  HAIR_COLORS,
  OUTFIT_COLORS,
  HAIR_STYLES,
  EYE_STYLES,
  HAIR_STYLE_LABELS,
  EYE_STYLE_LABELS,
  DEFAULT_AVATAR,
  getWorld,
  type AvatarConfig,
  type EyeStyle,
} from "@/lib/avatarData";

interface Props {
  onSave: (config: AvatarConfig, displayName: string, username?: string) => void;
  initialConfig?: AvatarConfig;
  initialDisplayName?: string;
  /** When provided, shows a back button (edit mode, not first setup) */
  onBack?: () => void;
}

function ColorSwatch({
  colors,
  selected,
  onSelect,
}: {
  colors: { label: string; hex: string }[];
  selected: string;
  onSelect: (hex: string) => void;
}) {
  return (
    <div className="flex gap-2 flex-wrap">
      {colors.map(({ hex, label }) => (
        <button
          key={hex}
          title={label}
          aria-label={label}
          aria-pressed={selected === hex}
          onClick={() => onSelect(hex)}
          className="w-11 h-11 sm:w-7 sm:h-7 rounded border-2 transition-all"
          style={{
            backgroundColor: hex,
            borderColor: selected === hex ? "var(--surface)" : "transparent",
            boxShadow: selected === hex ? "0 0 0 2px var(--accent)" : undefined,
          }}
        />
      ))}
    </div>
  );
}

function CycleRow<T extends string>({
  label,
  options,
  labels,
  value,
  onChange,
}: {
  label: string;
  options: readonly T[];
  labels: Record<T, string>;
  value: T;
  onChange: (v: T) => void;
}) {
  const idx = options.indexOf(value);
  const prev = () =>
    onChange(options[(idx - 1 + options.length) % options.length]);
  const next = () => onChange(options[(idx + 1) % options.length]);

  return (
    <div className="flex items-center justify-between bg-raise px-3 py-2 rounded-lg">
      <span className="text-muted text-xs font-bold w-14">{label}</span>
      <div className="flex items-center gap-2">
        <button
          onClick={prev}
          aria-label={`Previous ${label.toLowerCase()}`}
          className="w-10 h-10 sm:w-6 sm:h-6 flex items-center justify-center bg-line hover:bg-faint rounded text-ink font-bold text-lg sm:text-sm transition-colors"
        >
          ‹
        </button>
        <span className="w-20 text-center text-xs text-ink">
          {labels[value]}
        </span>
        <button
          onClick={next}
          aria-label={`Next ${label.toLowerCase()}`}
          className="w-10 h-10 sm:w-6 sm:h-6 flex items-center justify-center bg-line hover:bg-faint rounded text-ink font-bold text-lg sm:text-sm transition-colors"
        >
          ›
        </button>
      </div>
    </div>
  );
}

export default function AvatarCreator({
  onSave,
  initialConfig,
  initialDisplayName,
  onBack,
}: Props) {
  const [config, setConfig] = useState<AvatarConfig>(
    initialConfig ?? DEFAULT_AVATAR,
  );
  const [displayName, setDisplayName] = useState(initialDisplayName ?? "");
  const [username, setUsername] = useState("");
  const [usernameError, setUsernameError] = useState("");

  const set = <K extends keyof AvatarConfig>(key: K, value: AvatarConfig[K]) =>
    setConfig((prev) => ({ ...prev, [key]: value }));

  const isEditing = !!onBack;

  return (
    <div className="flex flex-col items-center gap-8 w-full max-w-md mx-auto">
      <div>
        <h1 className="font-display text-3xl text-center text-ink tracking-wide">
          Duodoro
        </h1>
        <p className="text-muted text-center text-sm mt-1">
          {isEditing
            ? "Update your character"
            : "Focus together, no matter the distance"}
        </p>
      </div>

      <div className="bg-surface p-6 rounded-2xl shadow-xl border border-line w-full">
        <h2 className="font-display text-lg text-ink tracking-wide text-center mb-6">
          {isEditing ? "Edit character" : "Design your hero"}
        </h2>

        {/* ── Live Preview ── */}
        <div className="flex justify-center mb-6">
          <div
            className="rounded-2xl border-4 border-line flex items-end justify-center overflow-hidden"
            style={{
              width: 120,
              height: 140,
              background: getWorld("forest").skyGradient,
              paddingBottom: 12,
            }}
          >
            <PixelCharacter {...config} anim="idle" facing="right" size={ART_PX} />
          </div>
        </div>

        {/* ── Display Name & Username ── */}
        {!isEditing && (
          <>
            <div className="mb-4">
              <p className="text-faint text-xs font-semibold uppercase tracking-wider mb-2">
                Your name
              </p>
              <input
                aria-label="Display name"
                className="w-full px-3 py-2 bg-raise border border-line rounded-lg text-ink text-sm placeholder-faint focus:outline-none focus:border-accent transition-colors"
                placeholder="e.g. Jorge"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={24}
              />
            </div>
            <div className="mb-4">
              <p className="text-faint text-xs font-semibold uppercase tracking-wider mb-2">
                Username
              </p>
              <input
                aria-label="Username"
                className={`w-full px-3 py-2 bg-raise border rounded-lg text-ink text-sm font-mono placeholder-faint focus:outline-none transition-colors ${
                  usernameError ? "border-danger focus:border-danger" : "border-line focus:border-accent"
                }`}
                placeholder="e.g. jorji"
                value={username}
                onChange={(e) => {
                  const val = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "");
                  setUsername(val);
                  if (val && (val.length < 3 || val.length > 20)) {
                    setUsernameError("Must be 3-20 characters");
                  } else {
                    setUsernameError("");
                  }
                }}
                maxLength={20}
              />
              <p className="text-faint text-[10px] mt-1">
                Lowercase letters, numbers, underscores. A #tag will be added automatically.
              </p>
              {usernameError && (
                <p className="text-danger text-xs mt-1">{usernameError}</p>
              )}
            </div>
          </>
        )}

        {/* ── Controls ── */}
        <div className="space-y-3 text-sm mb-5">
          <CycleRow
            label="HAIR"
            options={HAIR_STYLES}
            labels={HAIR_STYLE_LABELS}
            value={config.hairStyle}
            onChange={(v) => set("hairStyle", v)}
          />
          <CycleRow
            label="EYES"
            options={EYE_STYLES}
            labels={EYE_STYLE_LABELS}
            value={config.eyeStyle}
            onChange={(v) => set("eyeStyle", v as EyeStyle)}
          />
        </div>

        {/* ── Color Pickers ── */}
        <div className="space-y-3 mb-6">
          <div>
            <p className="text-faint text-xs font-semibold uppercase tracking-wider mb-2">
              Skin
            </p>
            <ColorSwatch
              colors={SKIN_COLORS}
              selected={config.skinColor}
              onSelect={(hex) => set("skinColor", hex)}
            />
          </div>
          <div>
            <p className="text-faint text-xs font-semibold uppercase tracking-wider mb-2">
              Hair color
            </p>
            <ColorSwatch
              colors={HAIR_COLORS}
              selected={config.hairColor}
              onSelect={(hex) => set("hairColor", hex)}
            />
          </div>
          <div>
            <p className="text-faint text-xs font-semibold uppercase tracking-wider mb-2">
              Outfit
            </p>
            <ColorSwatch
              colors={OUTFIT_COLORS}
              selected={config.outfitColor}
              onSelect={(hex) => set("outfitColor", hex)}
            />
          </div>
        </div>

        <button
          onClick={() => onSave(config, displayName.trim(), !isEditing && username ? username : undefined)}
          className="w-full bg-accent hover:brightness-105 active:scale-95 text-white font-display text-lg py-3 px-4 rounded-xl border-b-4 border-accent-deep transition-all tracking-wide"
        >
          {isEditing ? "Save changes →" : "Ready to focus →"}
        </button>

        {onBack && (
          <button
            onClick={onBack}
            className="w-full mt-3 text-muted hover:text-ink text-sm transition-colors"
          >
            ← Cancel
          </button>
        )}
      </div>
    </div>
  );
}
