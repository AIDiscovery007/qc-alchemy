import Icon from "./Icon";

export default function HiddenProjectsToggle({ shown, disabled, onToggle }: { shown: boolean; disabled?: boolean; onToggle(): void }) {
  return <button type="button" className="icon-button hidden-projects-toggle" aria-label="包含隐藏项目" aria-pressed={shown}
    title={shown ? "收起隐藏项目" : "包含隐藏项目"} disabled={disabled} onClick={onToggle}>
    <span className="visibility-eye-closed" aria-hidden="true"><Icon name="eyeClosed" /></span>
    <span className="visibility-eye-open" aria-hidden="true"><Icon name="eye" /></span>
  </button>;
}
