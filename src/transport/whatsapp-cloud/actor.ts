export type CloudActor = "client" | "lawyer";

export interface CloudActorResolution {
  actor: CloudActor;
  operatorConfigured: boolean;
  senderRef: string;
}

const e164Pattern = /^\+[1-9]\d{7,14}$/;

const toSuffixRef = (value: string | null): string =>
  value ? `suffix:${value.slice(-4)}` : "unavailable";

export const normalizeE164ToComparablePhone = (value: string): string | null => {
  const trimmed = value.trim();

  if (!e164Pattern.test(trimmed)) {
    return null;
  }

  return trimmed.slice(1);
};

export const normalizeCloudWaIdToComparablePhone = (value: string): string | null => {
  const digits = value.replace(/\D/g, "");

  return digits.length > 0 ? digits : null;
};

export const resolveCloudActor = ({
  cloudWaId,
  lawyerPhoneE164
}: {
  cloudWaId: string;
  lawyerPhoneE164?: string | undefined;
}): CloudActorResolution => {
  const senderPhone = normalizeCloudWaIdToComparablePhone(cloudWaId);
  const operatorPhone =
    typeof lawyerPhoneE164 === "string"
      ? normalizeE164ToComparablePhone(lawyerPhoneE164)
      : null;
  const operatorConfigured = Boolean(operatorPhone);

  return {
    actor:
      senderPhone !== null && operatorPhone !== null && senderPhone === operatorPhone
        ? "lawyer"
        : "client",
    operatorConfigured,
    senderRef: toSuffixRef(senderPhone)
  };
};
