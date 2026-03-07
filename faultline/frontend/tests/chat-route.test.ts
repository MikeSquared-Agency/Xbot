import { describe, it, expect } from "vitest";
import { POST } from "@/app/api/chat/route";

describe("Chat API route", () => {
  it("returns 501 not implemented", async () => {
    const response = await POST();
    expect(response.status).toBe(501);
    const body = await response.json();
    expect(body.message).toBe("not implemented");
  });
});
