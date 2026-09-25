import { createExternalLinkIcon } from "./externalLinkIcon";

export interface Choice {
  id: string;
  label: string;
  /** A page crediting this choice, opened by the external-link icon at the end of its pill while it is checked. */
  creditUrl?: string;
}

/**
 * A heading and a paragraph grid of pill-shaped radio buttons. Every radio
 * takes `name`, so two groups with the same name make one choice.
 */
export function createChoiceGroup(name: string, heading: string, choices: readonly Choice[]): HTMLElement {
  const group = document.createElement("div");
  group.className = "foss-earth-choices";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", heading);
  const title = document.createElement("div");
  title.className = "foss-earth-choices__heading";
  title.textContent = heading;
  group.append(title);
  for (const choice of choices) {
    const label = document.createElement("label");
    label.className = "foss-earth-choice";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = name;
    input.value = choice.id;
    const text = document.createElement("span");
    text.textContent = choice.label;
    label.append(input, text);
    // A link inside a label opens without checking the radio.
    if (choice.creditUrl) {
      const credit = document.createElement("a");
      credit.className = "foss-earth-choice__credit";
      credit.href = choice.creditUrl;
      credit.target = "_blank";
      credit.rel = "noopener noreferrer";
      credit.title = `${choice.label}. Opens its attribution page.`;
      credit.setAttribute("aria-label", `${choice.label} attribution, opens in a new tab`);
      credit.hidden = true;
      credit.append(createExternalLinkIcon());
      label.append(credit);
    }
    group.append(label);
  }
  return group;
}

export function createChoiceNote(text: string): HTMLParagraphElement {
  const note = document.createElement("p");
  note.className = "foss-earth-choices__note";
  note.textContent = text;
  return note;
}

/**
 * Checks the radio for `id`, or clears the choice when `id` matches none. Only
 * the checked pill shows its credit link.
 */
export function checkChoice(root: ParentNode, name: string, id: string | null): void {
  for (const input of root.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${name}"]`)) {
    input.checked = input.value === id;
    const credit = input.parentElement?.querySelector<HTMLElement>(".foss-earth-choice__credit");
    if (credit) credit.hidden = !input.checked;
  }
}
