const WHITESPACE = /\s+/g;

export const sanitizeInboundBody = (value: string): string =>
  value.trim().replace(WHITESPACE, " ");
