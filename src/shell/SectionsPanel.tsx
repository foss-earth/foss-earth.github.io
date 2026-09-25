import { useState, type ReactNode } from "react";
import { AdoptedElement } from "./AdoptedElement";
import { loadPanelSectionsOpen, savePanelSectionsOpen } from "./panelSectionsOpen";

/**
 * One collapsible group in a tab such as Settings or Controls. A host built on
 * imperative DOM hands over the `element` it already wired; a React host
 * supplies `render`. Section ids are shared across tabs, so keep them unique.
 */
export interface PanelSection {
  id: string;
  title: string;
  /** Open until the user closes it. Sections start closed otherwise. */
  defaultOpen?: boolean;
  element?: HTMLElement;
  render?: () => ReactNode;
}

export function SectionsPanel({ sections }: { sections: readonly PanelSection[] }) {
  const [chosen, setChosen] = useState(loadPanelSectionsOpen);
  const isOpen = (section: PanelSection): boolean => chosen[section.id] ?? section.defaultOpen ?? false;
  const toggle = (section: PanelSection, open: boolean): void => {
    setChosen((current) => {
      if ((current[section.id] ?? section.defaultOpen ?? false) === open) return current;
      const next = { ...current, [section.id]: open };
      savePanelSectionsOpen(next);
      return next;
    });
  };
  return (
    <div className="foss-earth-panel-sections">
      {sections.map((section) => (
        <details
          key={section.id}
          className="foss-earth-panel-section"
          data-section={section.id}
          open={isOpen(section)}
          onToggle={(event) => toggle(section, event.currentTarget.open)}
        >
          <summary className="foss-earth-panel-section__title">{section.title}</summary>
          {section.element
            ? <AdoptedElement element={section.element} className="foss-earth-panel-section__body" />
            : <div className="foss-earth-panel-section__body">{section.render?.()}</div>}
        </details>
      ))}
    </div>
  );
}
