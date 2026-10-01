import type { ReactNode } from "react";

export default function AsyncAction({ children, status, onCancel, cancelling = false, className = "" }: {
  children: ReactNode;
  status?: string;
  onCancel?: () => void;
  cancelling?: boolean;
  className?: string;
}) {
  return <div className={`async-action ${className}`} data-pending={!!status}>
    <div className="async-action-controls">{children}</div>
    {status && <div className="async-action-status">
      <span className="activity-dot" aria-hidden="true" />
      <span className="async-action-label" role="status" title={status}>{status}</span>
      {onCancel && <button type="button" className="async-action-cancel" disabled={cancelling} onClick={onCancel}>取消</button>}
    </div>}
  </div>;
}
