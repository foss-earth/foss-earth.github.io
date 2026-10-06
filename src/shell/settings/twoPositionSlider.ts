export interface TwoPositionSliderOptions {
  label: string;
  options: readonly [
    { label: string; icon?: string },
    { label: string; icon?: string },
  ];
  onInput(index: 0 | 1): void;
}

export interface TwoPositionSliderHandle {
  element: HTMLElement;
  input: HTMLInputElement;
  update(index: 0 | 1, disabled?: boolean): void;
  destroy(): void;
}

/** One native two-stop slider, with its choices drawn inside the track. */
export function createTwoPositionSlider(options: TwoPositionSliderOptions): TwoPositionSliderHandle {
  const element = document.createElement("span");
  element.className = "foss-earth-two-position-slider";
  element.classList.toggle("foss-earth-two-position-slider--text", options.options.some(option => !option.icon));
  const track = document.createElement("span");
  track.className = "foss-earth-two-position-slider__track";
  track.setAttribute("aria-hidden", "true");
  const thumb = document.createElement("span");
  thumb.className = "foss-earth-two-position-slider__thumb";
  thumb.setAttribute("aria-hidden", "true");
  const labels = options.options.map((option, index) => {
    const label = document.createElement("span");
    label.className = "foss-earth-two-position-slider__option";
    label.dataset.option = String(index);
    label.textContent = option.icon ?? option.label;
    label.title = option.label;
    label.setAttribute("aria-hidden", "true");
    return label;
  });
  const input = document.createElement("input");
  input.type = "range";
  input.className = "foss-earth-two-position-slider__input";
  input.min = "0";
  input.max = "1";
  input.step = "1";
  input.setAttribute("aria-label", options.label);
  element.append(track, thumb, ...labels, input);
  const update = (index: 0 | 1, disabled = false): void => {
    input.value = String(index);
    input.disabled = disabled;
    input.setAttribute("aria-valuetext", options.options[index].label);
    element.dataset.position = String(index);
    element.style.setProperty("--slider-position", String(index));
    element.classList.toggle("is-disabled", disabled);
  };
  const onInput = (): void => {
    if (input.disabled) return;
    const index = Number(input.value) >= 0.5 ? 1 : 0;
    update(index);
    options.onInput(index);
  };
  input.addEventListener("input", onInput);
  update(0);
  return {
    element,
    input,
    update,
    destroy() {
      input.removeEventListener("input", onInput);
      element.remove();
    },
  };
}
