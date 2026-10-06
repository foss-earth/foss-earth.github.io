// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTwoPositionSlider } from "./twoPositionSlider";

afterEach(() => document.body.replaceChildren());

describe("two-position slider", () => {
  it("uses one native keyboard-operable range and names its current stop", () => {
    const onInput = vi.fn();
    const slider = createTwoPositionSlider({
      label: "Priorities",
      options: [{ label: "Auto" }, { label: "Custom" }],
      onInput,
    });
    document.body.append(slider.element);
    expect(slider.element.querySelectorAll("input")).toHaveLength(1);
    expect(slider.input.type).toBe("range");
    expect(slider.input.min).toBe("0");
    expect(slider.input.max).toBe("1");
    expect(slider.input.step).toBe("1");
    expect(slider.input.getAttribute("aria-label")).toBe("Priorities");
    expect(slider.input.getAttribute("aria-valuetext")).toBe("Auto");
    slider.input.focus();
    expect(document.activeElement).toBe(slider.input);
    slider.input.value = "1";
    slider.input.dispatchEvent(new Event("input"));
    expect(onInput).toHaveBeenCalledWith(1);
    expect(slider.element.dataset.position).toBe("1");
    expect(slider.input.getAttribute("aria-valuetext")).toBe("Custom");
    slider.update(0);
    expect(slider.element.dataset.position).toBe("0");
    expect(slider.input.value).toBe("0");
    slider.destroy();
  });

  it("blocks a disabled slider and removes input handling when destroyed", () => {
    const onInput = vi.fn();
    const slider = createTwoPositionSlider({
      label: "Theme",
      options: [{ label: "Light", icon: "\u263C" }, { label: "Dark", icon: "\u263E" }],
      onInput,
    });
    slider.update(1, true);
    expect(slider.input.disabled).toBe(true);
    expect(slider.element.classList.contains("is-disabled")).toBe(true);
    slider.input.value = "0";
    slider.input.dispatchEvent(new Event("input"));
    expect(onInput).not.toHaveBeenCalled();
    slider.update(0);
    expect(slider.input.disabled).toBe(false);
    expect(slider.element.classList.contains("is-disabled")).toBe(false);
    slider.destroy();
    slider.input.value = "1";
    slider.input.dispatchEvent(new Event("input"));
    expect(onInput).not.toHaveBeenCalled();
  });
});
