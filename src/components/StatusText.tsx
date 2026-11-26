import { AlertCircle, CheckCircle2, Clock, FileEdit, Lock, ShieldCheck, Truck, XCircle } from 'lucide-react';

const STATUS_MAP: Record<string, { label: string; colorClass: string; Icon: typeof Clock }> = {
  draft: { label: 'Draft', colorClass: 'text-zinc-600 dark:text-zinc-400', Icon: FileEdit },
  validated: { label: 'Validated', colorClass: 'text-orange-700 dark:text-orange-400', Icon: CheckCircle2 },
  ordered: { label: 'Ordered', colorClass: 'text-orange-700 dark:text-orange-400', Icon: Clock },
  signed: { label: 'Signed', colorClass: 'text-emerald-700 dark:text-emerald-400', Icon: CheckCircle2 },
  shipped: { label: 'Shipped', colorClass: 'text-amber-700 dark:text-amber-400', Icon: Truck },
  packed: { label: 'Packed', colorClass: 'text-orange-700 dark:text-orange-400', Icon: Clock },
  in_transit: { label: 'In Transit', colorClass: 'text-amber-700 dark:text-amber-400', Icon: Truck },
  delivered: { label: 'Delivered', colorClass: 'text-emerald-700 dark:text-emerald-400', Icon: CheckCircle2 },
  received: { label: 'Received', colorClass: 'text-emerald-700 dark:text-emerald-400', Icon: CheckCircle2 },
  billed: { label: 'Billed', colorClass: 'text-emerald-700 dark:text-emerald-400', Icon: CheckCircle2 },
  partial: { label: 'Partial', colorClass: 'text-amber-700 dark:text-amber-400', Icon: Clock },
  paid: { label: 'Paid', colorClass: 'text-emerald-700 dark:text-emerald-400', Icon: CheckCircle2 },
  paid_off: { label: 'Paid Off', colorClass: 'text-emerald-700 dark:text-emerald-400', Icon: CheckCircle2 },
  promised: { label: 'Promised', colorClass: 'text-amber-700 dark:text-amber-400', Icon: Clock },
  prepared: { label: 'Prepared', colorClass: 'text-orange-700 dark:text-orange-400', Icon: Clock },
  transmitted: { label: 'Transmitted', colorClass: 'text-amber-700 dark:text-amber-400', Icon: CheckCircle2 },
  settled: { label: 'Settled', colorClass: 'text-emerald-700 dark:text-emerald-400', Icon: CheckCircle2 },
  produced: { label: 'Produced', colorClass: 'text-emerald-700 dark:text-emerald-400', Icon: CheckCircle2 },
  operational: { label: 'Operational', colorClass: 'text-emerald-700 dark:text-emerald-400', Icon: CheckCircle2 },
  maintenance: { label: 'Maintenance', colorClass: 'text-amber-700 dark:text-amber-400', Icon: AlertCircle },
  offline: { label: 'Offline', colorClass: 'text-red-700 dark:text-red-400', Icon: XCircle },
  open: { label: 'Open', colorClass: 'text-orange-700 dark:text-orange-400', Icon: Clock },
  waiting_customer: { label: 'Waiting Customer', colorClass: 'text-amber-700 dark:text-amber-400', Icon: Clock },
  closed: { label: 'Closed', colorClass: 'text-zinc-600 dark:text-zinc-400', Icon: CheckCircle2 },
  available: { label: 'Available', colorClass: 'text-emerald-700 dark:text-emerald-400', Icon: CheckCircle2 },
  quarantine: { label: 'Quarantine', colorClass: 'text-amber-700 dark:text-amber-400', Icon: AlertCircle },
  consumed: { label: 'Consumed', colorClass: 'text-zinc-500 dark:text-zinc-400', Icon: CheckCircle2 },
  qualification: { label: 'Qualification', colorClass: 'text-zinc-600 dark:text-zinc-400', Icon: Clock },
  proposition: { label: 'Proposition', colorClass: 'text-orange-700 dark:text-orange-400', Icon: FileEdit },
  negotiation: { label: 'Negotiation', colorClass: 'text-amber-700 dark:text-amber-400', Icon: Clock },
  won: { label: 'Won', colorClass: 'text-emerald-700 dark:text-emerald-400', Icon: CheckCircle2 },
  lost: { label: 'Lost', colorClass: 'text-red-700 dark:text-red-400', Icon: XCircle },
  planned: { label: 'Planned', colorClass: 'text-orange-700 dark:text-orange-400', Icon: Clock },
  pending: { label: 'Pending', colorClass: 'text-amber-700 dark:text-amber-400', Icon: Clock },
  submitted: { label: 'Submitted', colorClass: 'text-orange-700 dark:text-orange-400', Icon: Clock },
  approved: { label: 'Approved', colorClass: 'text-emerald-700 dark:text-emerald-400', Icon: CheckCircle2 },
  rejected: { label: 'Rejected', colorClass: 'text-red-700 dark:text-red-400', Icon: XCircle },
  accepted: { label: 'Accepted', colorClass: 'text-emerald-700 dark:text-emerald-400', Icon: CheckCircle2 },
  sent: { label: 'Sent', colorClass: 'text-emerald-700 dark:text-emerald-400', Icon: CheckCircle2 },
  unprocessed: { label: 'Unprocessed', colorClass: 'text-amber-700 dark:text-amber-400', Icon: AlertCircle },
  converted_ticket: { label: 'Converted', colorClass: 'text-emerald-700 dark:text-emerald-400', Icon: CheckCircle2 },
  declined: { label: 'Declined', colorClass: 'text-red-700 dark:text-red-400', Icon: XCircle },
  cancelled: { label: 'Cancelled', colorClass: 'text-red-700 dark:text-red-400', Icon: XCircle },
  active: { label: 'Active', colorClass: 'text-emerald-700 dark:text-emerald-400', Icon: CheckCircle2 },
  inactive: { label: 'Inactive', colorClass: 'text-zinc-500 dark:text-zinc-400', Icon: XCircle },
  expired: { label: 'Expired', colorClass: 'text-red-700 dark:text-red-400', Icon: AlertCircle },
  on_hold: { label: 'On Hold', colorClass: 'text-amber-700 dark:text-amber-400', Icon: Clock },
  completed: { label: 'Completed', colorClass: 'text-emerald-700 dark:text-emerald-400', Icon: CheckCircle2 },
  todo: { label: 'To Do', colorClass: 'text-zinc-600 dark:text-zinc-400', Icon: Clock },
  in_progress: { label: 'In Progress', colorClass: 'text-orange-700 dark:text-orange-400', Icon: Clock },
  review: { label: 'Review', colorClass: 'text-amber-700 dark:text-amber-400', Icon: AlertCircle },
  done: { label: 'Done', colorClass: 'text-emerald-700 dark:text-emerald-400', Icon: CheckCircle2 },
  locked: { label: 'Locked', colorClass: 'text-red-700 dark:text-red-400', Icon: Lock },
  mfa_on: { label: 'TOTP Enabled', colorClass: 'text-emerald-700 dark:text-emerald-400', Icon: ShieldCheck },
  mfa_off: { label: 'MFA Disabled', colorClass: 'text-amber-700 dark:text-amber-400', Icon: AlertCircle },
  info: { label: 'Info', colorClass: 'text-zinc-600 dark:text-zinc-400', Icon: CheckCircle2 },
  normal: { label: 'Normal', colorClass: 'text-orange-700 dark:text-orange-400', Icon: CheckCircle2 },
  high: { label: 'High', colorClass: 'text-amber-700 dark:text-amber-400', Icon: AlertCircle },
  warning: { label: 'Warning', colorClass: 'text-amber-700 dark:text-amber-400', Icon: AlertCircle },
  critical: { label: 'Critical', colorClass: 'text-red-700 dark:text-red-400', Icon: AlertCircle },
};

export function StatusText({ status }: { status: string }) {
  const cfg = STATUS_MAP[status] ?? {
    label: status.replace(/_/g, ' '),
    colorClass: 'text-zinc-700 dark:text-zinc-300',
    Icon: Clock,
  };
  const { Icon } = cfg;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap ${cfg.colorClass}`}>
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>{cfg.label}</span>
    </span>
  );
}
