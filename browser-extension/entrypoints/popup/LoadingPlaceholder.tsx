import { createContext, useContext, type ComponentType, type ReactNode } from "react";

// The workspace supplies the effect; shared/content UI never imports its engine.
export const LoadingEffectContext = createContext<ComponentType | null>(null);

export default function LoadingPlaceholder({ active = true, className = "", children }: {
  active?: boolean; className?: string; children: ReactNode;
}) {
  const Effect = useContext(LoadingEffectContext);
  return <span className={`loading-placeholder ${className}`} role="status">
    {active && Effect && <Effect />}<span className="loading-label">{children}</span>
  </span>;
}
