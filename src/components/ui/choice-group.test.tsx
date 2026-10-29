import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { ChoiceGroup } from "@/components/ui/choice-group";

function Lengths() {
  const [value, setValue] = useState(15);
  return (
    <ChoiceGroup
      label="Délka"
      value={value}
      onChange={setValue}
      choices={[15, 20, 30].map((s) => ({ value: s, label: `${s} s` }))}
    />
  );
}

describe("ChoiceGroup", () => {
  it("is one radio group with one tab stop, on the chosen option", () => {
    render(<Lengths />);
    expect(screen.getByRole("radiogroup", { name: "Délka" })).toBeInTheDocument();
    const [a, b, c] = screen.getAllByRole("radio");
    expect(a).toHaveAttribute("aria-checked", "true");
    expect(a).toHaveAttribute("tabindex", "0");
    expect(b).toHaveAttribute("tabindex", "-1");
    expect(c).toHaveAttribute("tabindex", "-1");
  });

  it("moves the choice and the focus with the arrow keys, wrapping round, and Home/End", () => {
    render(<Lengths />);
    const radios = () => screen.getAllByRole("radio");
    fireEvent.keyDown(radios()[0]!, { key: "ArrowRight" });
    expect(radios()[1]).toHaveAttribute("aria-checked", "true");
    expect(radios()[1]).toHaveFocus();
    fireEvent.keyDown(radios()[1]!, { key: "ArrowLeft" });
    fireEvent.keyDown(radios()[0]!, { key: "ArrowLeft" });
    expect(radios()[2]).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(radios()[2]!, { key: "Home" });
    expect(radios()[0]).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(radios()[0]!, { key: "End" });
    expect(radios()[2]).toHaveFocus();
  });

  it("chooses on click", () => {
    render(<Lengths />);
    fireEvent.click(screen.getByRole("radio", { name: "20 s" }));
    expect(screen.getByRole("radio", { name: "20 s" })).toHaveAttribute("aria-checked", "true");
  });
});
