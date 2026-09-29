import type { SelectHTMLAttributes } from "react";
import Icon from "./Icon";

export default function SelectField({ label, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  return <label className="select-field">
    <span>{label}</span>
    <span className="select-control">
      <select {...props}>{children}</select>
      <Icon name="chevronDown" />
    </span>
  </label>;
}
