interface StatusPillProps {
  status: "PASS" | "FAIL" | "CLEAN" | "PROVEN" | "NOT_PROVEN" | "UNVERIFIABLE" | "RUNNING" | "PENDING";
  label?: string;
}

const symbols: Record<StatusPillProps["status"], string> = {
  PASS: "✓",
  CLEAN: "✓",
  PROVEN: "✓",
  FAIL: "×",
  NOT_PROVEN: "×",
  UNVERIFIABLE: "!",
  RUNNING: "↻",
  PENDING: "·",
};

export function StatusPill({ status, label }: StatusPillProps) {
  return (
    <span className={`status-pill status-pill--${status.toLowerCase().replace("_", "-")}`}>
      <span aria-hidden="true">{symbols[status]}</span>
      {label ?? status.replace("_", " ")}
    </span>
  );
}
