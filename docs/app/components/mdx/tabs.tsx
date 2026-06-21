import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useState,
} from "react";

/** Design-matched replacement for `fumadocs-ui/components/tabs` (aliased in vite). */
export function Tab({ children }: { value: string; children?: ReactNode }) {
  return <>{children}</>;
}

export function Tabs({
  items,
  children,
}: {
  items: string[];
  children: ReactNode;
}) {
  const [active, setActive] = useState(items[0] ?? "");
  const panels = Children.toArray(children).filter(
    isValidElement,
  ) as ReactElement<{
    value: string;
    children: ReactNode;
  }>[];

  return (
    <div className="tabs">
      <div className="tablist" role="tablist">
        {items.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={item === active}
            className={`tab ${item === active ? "active" : ""}`.trim()}
            onClick={() => setActive(item)}
          >
            {item}
          </button>
        ))}
      </div>
      {panels.map((panel) => (
        <div
          key={panel.props.value}
          role="tabpanel"
          hidden={panel.props.value !== active}
          className={`tabpanel ${panel.props.value === active ? "active" : ""}`.trim()}
        >
          {panel.props.children}
        </div>
      ))}
    </div>
  );
}
