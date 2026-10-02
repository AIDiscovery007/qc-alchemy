export default function InlineHelp({ label, children }: { label: string; children: string }) {
  return <details className="inline-help">
    <summary title={children}>{label}</summary>
    <p>{children}</p>
  </details>;
}
