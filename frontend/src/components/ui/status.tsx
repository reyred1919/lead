import { Badge } from "./primitives";
import { ACTION_STATUS, EVENT_STATUS, INTERACTION_STATUS, JOB_STATUS, QUALITY, REFERRAL_STATUS, STAGE } from "@/lib/labels";

type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "navy" | "action";

const EVENT_TONE: Record<string, Tone> = { DRAFT: "neutral", READY: "info", ACTIVE: "success", CLOSED: "warning", ARCHIVED: "neutral" };
const QUALITY_TONE: Record<string, Tone> = { SERIOUS: "danger", FOLLOW_UP: "action", INTRO: "neutral" };
const STAGE_TONE: Record<string, Tone> = { QUALIFIED: "info", ASSIGNED: "action", FOLLOW_UP: "warning", WON: "success", LOST: "neutral", NURTURE: "info" };
const REF_TONE: Record<string, Tone> = { PENDING: "warning", ACCEPTED: "success", RETURNED: "danger", CANCELED: "neutral" };
const ACTION_TONE: Record<string, Tone> = { OPEN: "warning", ACKNOWLEDGED: "info", IN_PROGRESS: "action", DONE: "success", RETURNED: "danger", CANCELLED: "neutral" };
const JOB_TONE: Record<string, Tone> = { PENDING: "neutral", PROCESSING: "info", SENT: "info", DELIVERED: "success", SIMULATED: "warning", FAILED: "danger", DEAD: "danger", SKIPPED: "neutral" };

export const EventStatus = ({ s }: { s: string }) => <Badge dot tone={EVENT_TONE[s]}>{EVENT_STATUS[s] ?? s}</Badge>;
export const QualityBadge = ({ q }: { q: string }) => <Badge tone={QUALITY_TONE[q]}>{QUALITY[q] ?? q}</Badge>;
export const StageBadge = ({ s }: { s?: string | null }) => (s ? <Badge dot tone={STAGE_TONE[s]}>{STAGE[s] ?? s}</Badge> : <Badge tone="neutral">در انتظار ارزیابی</Badge>);
export const ReferralStatus = ({ s }: { s: string }) => <Badge dot tone={REF_TONE[s]}>{REFERRAL_STATUS[s] ?? s}</Badge>;
export const ActionStatus = ({ s }: { s: string }) => <Badge dot tone={ACTION_TONE[s]}>{ACTION_STATUS[s] ?? s}</Badge>;
export const JobStatus = ({ s }: { s: string }) => <Badge dot tone={JOB_TONE[s]}>{JOB_STATUS[s] ?? s}</Badge>;
export const InteractionStatus = ({ s }: { s: string }) => <Badge tone="neutral">{INTERACTION_STATUS[s] ?? s}</Badge>;
export const DemoBadge = () => <Badge tone="warning" className="font-bold">DEMO · داده نمونه</Badge>;
export const MockBadge = () => <Badge tone="warning">شبیه‌سازی — ارسال واقعی ندارد</Badge>;
