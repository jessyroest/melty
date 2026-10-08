import type { ReactNode } from "react";

/** Small stroke icons for the room. All decorative: the button around them carries the label. */
type P = { className?: string };

function Icon({ className, children }: P & { children: ReactNode }) {
  return (
    <svg
      className={`r-ico${className ? ` ${className}` : ""}`}
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const LockIcon = (p: P) => (
  <Icon {...p}>
    <rect x="5" y="10.5" width="14" height="10" rx="3" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </Icon>
);

export const InviteIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="10" cy="8.5" r="3.5" />
    <path d="M3.5 19.5c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5" />
    <path d="M19 8v6M16 11h6" />
  </Icon>
);

export const LeaveIcon = (p: P) => (
  <Icon {...p}>
    <path d="M14 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
    <path d="M10 8l-4 4 4 4M6 12h9" />
  </Icon>
);

export const SendIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Icon>
);

export const CopyIcon = (p: P) => (
  <Icon {...p}>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
    <path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
  </Icon>
);

export const CheckIcon = (p: P) => (
  <Icon {...p}>
    <path className="r-ico__check" d="M5 12.5l4.5 4.5L19 7.5" pathLength={1} />
  </Icon>
);

export const EyeIcon = (p: P) => (
  <Icon {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="2.8" />
  </Icon>
);

export const ShareIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 15V4M8 8l4-4 4 4" />
    <path d="M6 12H5a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1h-1" />
  </Icon>
);

export const PencilIcon = (p: P) => (
  <Icon {...p}>
    <path d="M15.5 5.5l3 3L9 18l-4 1 1-4z" />
  </Icon>
);

export const CloseIcon = (p: P) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);

export const LinkIcon = (p: P) => (
  <Icon {...p}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </Icon>
);

export const ArrowDownIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </Icon>
);

export const UnlockIcon = (p: P) => (
  <Icon {...p}>
    <rect x="5" y="10.5" width="14" height="10" rx="3" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 6.6-1.6" />
  </Icon>
);

export const FlameIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 21c-3.6 0-6-2.4-6-5.6 0-3.4 2.6-5 3.4-8.4 1.8 1.3 2.6 3 2.6 4.6 1-.6 1.6-1.6 1.8-3 1.8 1.6 4.2 3.8 4.2 6.8 0 3.2-2.4 5.6-6 5.6Z" />
  </Icon>
);

export const SmileIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M8.6 14.2a4.2 4.2 0 0 0 6.8 0M9.3 9.6h.01M14.7 9.6h.01" />
  </Icon>
);

export const DropIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 3.5c3 3.9 5.6 7.1 5.6 10.2a5.6 5.6 0 0 1-11.2 0c0-3.1 2.6-6.3 5.6-10.2Z" />
  </Icon>
);
