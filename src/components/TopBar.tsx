"use client";
import { CommandPalette } from "./CommandPalette";
import { Clock } from "./Clock";
import { MobileDrawer } from "./MobileNav";
import { QuoteOfDay } from "./QuoteOfDay";
import { QuickAdd } from "./QuickAdd";
import { ThemePicker } from "./ThemePicker";

export function TopBar() {
  return (
    <header className="flex items-center gap-4 px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
      <MobileDrawer />
      <Clock />
      <QuoteOfDay />
      <div className="ml-auto flex items-center gap-3">
        <QuickAdd />
        <CommandPalette />
        <ThemePicker compact />
      </div>
    </header>
  );
}
