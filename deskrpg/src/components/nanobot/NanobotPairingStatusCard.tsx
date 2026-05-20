"use client";

// seed-v9 AC-016 T-021: nanobot 게이트웨이 페어링 상태 UI 카드 (4상태).
//
// 결정 D2=b (duplicate): OpenClawPairingStatusCard와 별도 모듈로 분리 — contract phase
// (phase 7)에서 openclaw 컴포넌트 삭제 시 nanobot 측 영향 없도록.
//
// 4상태: idle / connected / pairing_required / error (PairingState의 connecting/reconnecting은
// normalizeForUi로 축약됨 — pairing-manager.ts 참조).

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, CheckCircle2, Copy, Link2, PauseCircle } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";
import { normalizeForUi, type PairingState } from "@/lib/pairing-manager";

export interface NanobotPairingStatusCardProps {
  /** PairingManager의 전체 상태 (connecting/reconnecting 포함). UI는 normalizeForUi로 4상태 축약. */
  status: PairingState;
  /** 페어링 요청 ID (PAIRING_REQUIRED 상태에서 사용자 승인용). */
  requestId?: string | null;
  /** error 상태에서 표시할 에러 메시지. */
  error?: string | null;
  /** 카드 제목 (default: "Nanobot Pairing"). */
  title?: string;
  /** 추가 설명 (예: gateway URL). */
  detail?: string | null;
  className?: string;
}

type UiStatus = "idle" | "connected" | "pairing_required" | "error";
type CopyTarget = "requestId" | "command" | null;

type StatusPresentation = {
  badgeVariant: "default" | "success" | "info" | "danger";
  borderClassName: string;
  icon: typeof PauseCircle;
  label: string;
  description: string;
};

const STATUS_PRESENTATION: Record<UiStatus, StatusPresentation> = {
  idle: {
    badgeVariant: "default",
    borderClassName: "border-border",
    icon: PauseCircle,
    label: "유휴",
    description: "Nanobot 게이트웨이와 연결되지 않았습니다. PAIRING_MODE=auto이면 자동 시도, manual이면 Pair 버튼을 눌러주세요.",
  },
  connected: {
    badgeVariant: "success",
    borderClassName: "border-success/40",
    icon: CheckCircle2,
    label: "연결됨",
    description: "Nanobot 게이트웨이에 페어링되어 정상 동작 중입니다.",
  },
  pairing_required: {
    badgeVariant: "info",
    borderClassName: "border-info/40",
    icon: Link2,
    label: "페어링 필요",
    description: "Nanobot 디바이스 승인이 필요합니다. 아래 승인 명령을 실행하거나 관리자에게 요청하세요.",
  },
  error: {
    badgeVariant: "danger",
    borderClassName: "border-danger/40",
    icon: AlertCircle,
    label: "오류",
    description: "Nanobot 게이트웨이 연결에 실패했습니다.",
  },
};

export function buildNanobotPairingApproveCommand(requestId: string): string {
  return `nanobot devices approve ${requestId}`;
}

export default function NanobotPairingStatusCard({
  status,
  requestId,
  error,
  title = "Nanobot Pairing",
  detail,
  className = "",
}: NanobotPairingStatusCardProps) {
  const uiStatus = normalizeForUi(status);
  const presentation = STATUS_PRESENTATION[uiStatus];
  const Icon = presentation.icon;
  const trimmedRequestId = requestId?.trim() || "";
  const approveCommand = trimmedRequestId ? buildNanobotPairingApproveCommand(trimmedRequestId) : "";

  const [copiedTarget, setCopiedTarget] = useState<CopyTarget>(null);
  const copyResetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current !== null) {
        window.clearTimeout(copyResetTimerRef.current);
      }
    };
  }, []);

  const resetCopiedSoon = () => {
    if (copyResetTimerRef.current !== null) {
      window.clearTimeout(copyResetTimerRef.current);
    }
    copyResetTimerRef.current = window.setTimeout(() => {
      setCopiedTarget(null);
      copyResetTimerRef.current = null;
    }, 1600);
  };

  const copyToClipboard = async (text: string, target: CopyTarget) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedTarget(target);
      resetCopiedSoon();
    } catch {
      // clipboard 권한 거부 — silent
    }
  };

  return (
    <Card className={`${presentation.borderClassName} ${className}`}>
      <div className="flex items-start gap-3 p-4">
        <Icon className="h-5 w-5 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold">{title}</h3>
            <Badge variant={presentation.badgeVariant}>{presentation.label}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">{presentation.description}</p>
          {detail && <p className="text-xs text-muted-foreground">{detail}</p>}

          {uiStatus === "pairing_required" && trimmedRequestId && (
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">요청 ID:</span>
                <code className="text-xs bg-muted px-2 py-1 rounded">{trimmedRequestId}</code>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(trimmedRequestId, "requestId")}
                  aria-label="요청 ID 복사"
                >
                  {copiedTarget === "requestId" ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </Button>
              </div>
              {approveCommand && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">승인 명령:</span>
                  <code className="text-xs bg-muted px-2 py-1 rounded flex-1 truncate">
                    {approveCommand}
                  </code>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copyToClipboard(approveCommand, "command")}
                    aria-label="명령 복사"
                  >
                    {copiedTarget === "command" ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </Button>
                </div>
              )}
            </div>
          )}

          {uiStatus === "error" && error && (
            <p className="text-xs text-danger mt-2 break-words">{error}</p>
          )}
        </div>
      </div>
    </Card>
  );
}
