import { describe, expect, it } from "vitest";
import {
  getNextPracticeCode,
  PracticeCodeOverflowError
} from "../../../src/domain/practices/practiceCode.ts";

describe("practice code allocator sequence", () => {
  it("starts at AA001", () => {
    expect(getNextPracticeCode(null)).toBe("AA001");
  });

  it("moves from AA999 to AB001", () => {
    expect(getNextPracticeCode("AA998")).toBe("AA999");
    expect(getNextPracticeCode("AA999")).toBe("AB001");
  });

  it("fails safely after ZZ999", () => {
    expect(() => getNextPracticeCode("ZZ999")).toThrow(PracticeCodeOverflowError);
  });
});
