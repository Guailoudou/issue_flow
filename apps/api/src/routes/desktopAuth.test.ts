import { describe, expect, it } from "vitest";
import { FixedWindowLimiter } from "./desktopAuth";

describe("FixedWindowLimiter", () => {
  it("enforces a fixed window and releases the key after its TTL", () => {
    let now = 1000;
    const limiter = new FixedWindowLimiter(10, () => now);

    expect(limiter.take("client", 2, 100)).toBe(true);
    expect(limiter.take("client", 2, 100)).toBe(true);
    expect(limiter.take("client", 2, 100)).toBe(false);

    now = 1100;
    expect(limiter.take("client", 2, 100)).toBe(true);
  });

  it("keeps attacker-controlled keys within a hard memory bound", () => {
    let now = 1000;
    const limiter = new FixedWindowLimiter(3, () => now);

    for (let index = 0; index < 100; index += 1) {
      expect(limiter.take(`attacker-${index}`, 1, 100)).toBe(true);
      expect(limiter.size).toBeLessThanOrEqual(3);
    }

    now = 1200;
    expect(limiter.take("legitimate-client", 1, 100)).toBe(true);
    expect(limiter.size).toBe(1);
  });

  it("keeps an exhausted IP quota independent from high-cardinality pairing IDs", () => {
    const ipLimiter = new FixedWindowLimiter(2, () => 1000);
    const pairingIdLimiter = new FixedWindowLimiter(2, () => 1000);

    expect(ipLimiter.take("pairing-exchange-ip:198.51.100.10", 2, 100)).toBe(true);
    expect(ipLimiter.take("pairing-exchange-ip:198.51.100.10", 2, 100)).toBe(true);
    expect(ipLimiter.take("pairing-exchange-ip:198.51.100.10", 2, 100)).toBe(false);

    for (let index = 0; index < 100; index += 1) {
      expect(pairingIdLimiter.take(`pairing-${index}`, 1, 100)).toBe(true);
    }

    expect(ipLimiter.take("pairing-exchange-ip:198.51.100.10", 2, 100)).toBe(false);
  });
});
