export default function HiddenProjectsToggle({ shown, disabled, onToggle }: { shown: boolean; disabled?: boolean; onToggle(): void }) {
  return <button type="button" className="hidden-projects-toggle" aria-pressed={shown}
    disabled={disabled} onClick={onToggle}><span aria-hidden="true">{shown ? "✓" : "+"}</span>包含隐藏项目</button>;
}
