import Icon from "./Icon";

export default function HiddenProjectsToggle({ shown, disabled, onToggle }: { shown: boolean; disabled?: boolean; onToggle(): void }) {
  return <button type="button" className="icon-button hidden-projects-toggle" aria-label="显示隐藏项目" aria-pressed={shown}
    disabled={disabled} onClick={onToggle}><Icon name={shown ? "eye" : "eyeClosed"} /></button>;
}
