"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Mood = "sit" | "walk" | "sleep" | "happy";
type Heart = { id: number; x: number };

const MOODS: Mood[] = ["sit", "walk", "walk", "sit", "sleep"];

// 桌宠小猫(neko-cute / anime 主题可见):纯 CSS 手绘——
// 会摇尾巴、眨眼,随机坐下/散步/打瞌睡;点它会开心冒爱心并"喵~"一声。
// 主题不匹配时 CSS display:none,组件挂载但不打扰。
export function DesktopPet() {
  const [enabled, setEnabled] = useState(false);
  const [mood, setMood] = useState<Mood>("sit");
  const [flip, setFlip] = useState(false);
  const [hearts, setHearts] = useState<Heart[]>([]);
  const [speech, setSpeech] = useState<string | null>(null);
  const heartSeq = useRef(0);
  const happyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const randomize = useCallback(() => {
    setMood(MOODS[Math.floor(Math.random() * MOODS.length)]);
    setFlip(Math.random() > 0.5);
  }, []);

  // 主题联动:挂载/切主题时读取当前风格;仅可爱系主题显示
  useEffect(() => {
    const sync = () => {
      const style = document.documentElement.dataset.style ?? "";
      setEnabled(style === "neko-cute" || style === "anime");
    };
    sync();
    window.addEventListener("evodesk-theme-change", sync);
    return () => window.removeEventListener("evodesk-theme-change", sync);
  }, []);

  // 随机心情:单 interval + 轮询下次换 mood 的 deadline(避免递归嵌套 interval 的清理竞态)
  useEffect(() => {
    if (!enabled) return;
    let deadline = Date.now() + 3000;
    const timer = setInterval(() => {
      if (Date.now() < deadline) return;
      randomize();
      deadline = Date.now() + 9000 + Math.floor(Math.random() * 7000);
    }, 1000);
    return () => clearInterval(timer);
  }, [enabled, randomize]);

  const pet = () => {
    setMood("happy");
    const seq = ++heartSeq.current;
    const fresh: Heart[] = Array.from({ length: 3 }, (_, i) => ({ id: seq * 10 + i, x: 8 + i * 22 + Math.random() * 10 }));
    setHearts((h) => [...h, ...fresh]);
    setSpeech(["喵~", "喵呜~", "呼噜呼噜…", "喵喵!"][Math.floor(Math.random() * 4)]);
    if (happyTimer.current) clearTimeout(happyTimer.current);
    happyTimer.current = setTimeout(() => {
      setMood("sit");
      setHearts([]);
      setSpeech(null);
    }, 1800);
  };

  if (!enabled) return null;

  return (
    <button
      type="button"
      className={`pet-root ${mood} ${flip ? "flip" : ""}`}
      onClick={pet}
      aria-label="桌宠小猫,点我摸摸"
      title="摸摸我~"
    >
      {hearts.map((h) => (
        <span key={h.id} className="pet-heart" style={{ left: h.x }}>❤</span>
      ))}
      {speech && <span className="pet-speech">{speech}</span>}
      {/* 尾巴(摇动) */}
      <span className="pet-tail" aria-hidden />
      {/* 身体 */}
      <span className="pet-body" aria-hidden>
        {/* 耳朵 */}
        <span className="pet-ear left" />
        <span className="pet-ear right" />
        {/* 内耳 */}
        <span className="pet-ear-inner left" />
        <span className="pet-ear-inner right" />
        {/* 眼睛(睡觉时闭眼) */}
        <span className="pet-eye left" />
        <span className="pet-eye right" />
        {/* 嘴 */}
        <span className="pet-mouth" aria-hidden />
        {/* 腮红 */}
        <span className="pet-blush left" />
        <span className="pet-blush right" />
      </span>
      {/* 爪印(走路时在身后冒出) */}
      {mood === "walk" && <span className="pet-paw" aria-hidden>🐾</span>}
      {mood === "sleep" && <span className="pet-zzz" aria-hidden>Z z z</span>}
    </button>
  );
}
