import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import Home from "@/app/page";

describe("Home page", () => {
  afterEach(cleanup);

  it("renders the FaultLine heading", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "FaultLine"
    );
  });

  it("renders inside a main element", () => {
    render(<Home />);
    expect(screen.getByRole("main")).toBeInTheDocument();
  });
});
