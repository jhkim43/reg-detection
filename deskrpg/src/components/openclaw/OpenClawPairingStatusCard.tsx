"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  Link2,
  PauseCircle,
  TerminalSquare,
} from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";
import { useT } from "@/lib/i18n";

export type OpenClawPairingStatus =
  | "idle"
  | "connected"
  | "pairing-required"
  | "pairing_required"
  | "error";

type NormalizedOpenClawPairingStatus =
  | "idle"
  | "connected"
  | "pairing-required"
  | "error";

export interface OpenClawPairingStatusCardProps {
  status: OpenClawPairingStatus;
  requestId?: string | null;
  error?: string | null;
  title?: string;
  detail?: string | null;
  className?: string;
}

type CopyTarget = "requestId" | "command" | null;

type StatusPresentation = {
  badgeVariant: "default" | "success" | "info" | "danger";
  borderClassName: string;
  icon: typeof PauseCircle;
  statusKey: string;
  descriptionKey: string;
};

const STATUS_PRESENTATION: Record<NormalizedOpenClawPairingStatus, StatusPresentation> = {
  idle: {
    badgeVariant: "default",
    borderClassName: "border-border",
    icon: PauseCircle,
    statusKey: "openclaw.statusCard.status.idle",
    descriptionKey: "openclaw.statusCard.description.idle",
  },
  connected: {
    badgeVariant: "success",
    borderClassName: "border-success/40",
    icon: CheckCircle2,
    statusKey: "openclaw.statusCard.status.connected",
    descriptionKey: "openclaw.statusCard.description.connected",
  },
  "pairing-required": {
    badgeVariant: "info",
    borderClassName: "border-info/40",
    icon: Link2,
    statusKey: "openclaw.statusCard.status.pairingRequired",
    descriptionKey: "openclaw.statusCard.description.pairingRequired",
  },
  error: {
    badgeVariant: "danger",
    borderClassName: "border-danger/40",
    icon: AlertCircle,
    statusKey: "openclaw.statusCard.status.error",
    descriptionKey: "openclaw.statusCard.description.error",
  },
};

export function normalizeOpenClawPairingStatus(
  status: OpenClawPairingStatus,
): NormalizedOpenClawPairingStatus {
  if (status === "pairing_required") {
    return "pairing-required";
  }
  return status;
}

export function buildOpenClawPairingApproveCommand(requestId: string) {
  return `openclaw devices approve ${requestId}`;
}

export default function OpenClawPairingStatusCard({
  status,
  requestId,
  error,
  title,
  detail,
  className = "",
}: OpenClawPairingStatusCardProps) {
  const t = useT();
  const normalizedStatus = normalizeOpenClawPairingStatus(status);
  const presentation = STATUS_PRESENTATION[normalizedStatus];
  const Icon = presentation.icon;
  const trimmedRequestId = requestId?.trim() || "";
  const approveCommand = trimmedRequestId
    ? buildOpenClawPairingApproveCommand(trimmedRequestId)
    : "";
  const [copiedTarget, setCopiedTarget] = useState<CopyTarget>(null);
  const copyResetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current !== null) {
        window.clearTimeout(copyResetTimerRef.current);
      }
    };
  }, []);

  const resetCopiedTargetSoon = () => {
    if (copyResetTimerRef.current !== null) {
      window.clearTimeout(copyResetTimerRef.current);
    }
    copyResetTimerRef.current = window.setTimeout(() => {
      setCopiedTarget(null);
      copyResetTimerRef.current = null;
    }, 1600);
  };

  const handleCopy = async (value: string, target: Exclude<CopyTarget, null>) => {
    if (!value || !navigator.clipboard?.writeText) return;
    await navigator.clipboard.writeText(value);
    setCopiedTarget(target);
    resetCopiedTargetSoon();
  };

  return (
    <Card
      className={[
        "p-4",
        "border",
        "bg-surface/90",
        presentation.borderClassName,
        className,
      ].join(" ")}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant={presentation.badgeVariant} size="md">
                <Icon className="h-3.5 w-3.5" />
                {t(presentation.statusKey)}
              </Badge>
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-text">
                {title ?? t("openclaw.statusCard.title")}
              </h3>
              <p className="text-sm text-text-secondary">
                {detail ?? t(presentation.descriptionKey)}
              </p>
            </div>
          </div>
          {normalizedStatus === "error" && error ? (
            <div className="max-w-xl rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </div>
          ) : null}
        </div>

        {normalizedStatus === "pairing-required" ? (
          <div className="space-y-3 rounded-lg border border-info/30 bg-info/5 p-3">
            <div className="space-y-1">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-dim">
                {t("openclaw.statusCard.requestId")}
              </div>
              <div className="flex items-stretch gap-2">
                <code className="flex-1 break-all rounded-md bg-surface-raised px-3 py-2 font-mono text-xs text-text leading-relaxed">
                  {trimmedRequestId || t("common.unknown")}
                </code>
                <button
                  type="button"
                  disabled={!trimmedRequestId}
                  onClick={() => void handleCopy(trimmedRequestId, "requestId")}
                  title={t("openclaw.statusCard.copyRequestId")}
                  className="shrink-0 w-9 flex items-center justify-center rounded-md bg-surface-raised text-text-secondary hover:brightness-125 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {copiedTarget === "requestId" ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-dim">
                {t("openclaw.statusCard.command")}
              </div>
              <div className="flex items-stretch gap-2">
                <code className="flex-1 break-all rounded-md bg-surface-raised px-3 py-2 font-mono text-xs text-text leading-relaxed">
                  {approveCommand || t("common.unknown")}
                </code>
                <button
                  type="button"
                  disabled={!approveCommand}
                  onClick={() => void handleCopy(approveCommand, "command")}
                  title={t("openclaw.statusCard.copyCommand")}
                  className="shrink-0 w-9 flex items-center justify-center rounded-md bg-surface-raised text-text-secondary hover:brightness-125 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {copiedTarget === "command" ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="flex items-start gap-2 rounded-md border border-border bg-surface px-3 py-2 text-xs text-text-secondary">
              <TerminalSquare className="mt-0.5 h-4 w-4 shrink-0 text-info" />
              <p>{t("openclaw.statusCard.help")}</p>
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
