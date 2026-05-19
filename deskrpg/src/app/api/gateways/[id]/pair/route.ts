// seed-v9 AC-016 T-022 — POST /api/gateways/:id/pair
//
// PairingManager.attemptGatewayPairing 호출 + DB 페어링 상태 갱신 + state 응답.
// 강제 실패(invalid token, HTTP 401/403) → 409 + errorCode=PAIRING_REQUIRED.
// happy path → 200 + state=connected + deviceId.

import { NextRequest, NextResponse } from "next/server";

import {
  decryptGatewayToken,
  getAccessibleGatewayResource,
  persistGatewayValidationState,
} from "@/lib/gateway-resources";
import { getUserId } from "@/lib/internal-rpc";
import { attemptGatewayPairing } from "@/lib/pairing-manager";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = getUserId(req);
  if (!userId) {
    return NextResponse.json(
      { ok: false, errorCode: "unauthorized", error: "unauthorized" },
      { status: 401 },
    );
  }
  const { id } = await params;

  const accessible = await getAccessibleGatewayResource(userId, id);
  if (!accessible) {
    return NextResponse.json(
      { ok: false, errorCode: "gateway_not_found", error: "Gateway not found" },
      { status: 404 },
    );
  }

  const token = decryptGatewayToken(accessible.resource.tokenEncrypted);
  const result = await attemptGatewayPairing({
    baseUrl: accessible.resource.baseUrl,
    token,
    identityKey: accessible.resource.baseUrl,
  });

  if (result.state === "connected") {
    await persistGatewayValidationState(id, {
      status: "valid",
      pairedDeviceId: result.deviceId,
    });
    return NextResponse.json(
      {
        ok: true,
        state: "connected",
        deviceId: result.deviceId,
        messageCode: "gateway_paired",
      },
      { status: 200 },
    );
  }

  if (result.state === "pairing_required") {
    await persistGatewayValidationState(id, {
      status: "pairing_required",
      error: result.error,
      pairedDeviceId: result.deviceId,
    });
    return NextResponse.json(
      {
        ok: false,
        state: "pairing_required",
        errorCode: "PAIRING_REQUIRED",
        error: result.error,
        deviceId: result.deviceId,
        instructions: result.instructions,
        pairingRequired: true,
      },
      { status: 409 },
    );
  }

  await persistGatewayValidationState(id, {
    status: "error",
    error: result.error,
  });
  return NextResponse.json(
    {
      ok: false,
      state: "error",
      errorCode: result.errorCode ?? "gateway_error",
      error: result.error,
      deviceId: result.deviceId,
    },
    { status: result.httpStatus },
  );
}
