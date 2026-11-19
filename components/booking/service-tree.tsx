import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { selectedServicePrice, serviceTree, type ServiceAddOnKey, type ServiceBranch, type ServiceLeaf, type ServiceNode } from "@/data/serviceTree";
import type { BookingCopy, Language } from "./copy";

type ServiceTreeProps = {
  language: Language;
  copy: BookingCopy;
  selectedIds: string[];
  selectedAddOns: Record<string, ServiceAddOnKey>;
  onToggleService: (serviceId: string) => void;
  onToggleAddOn: (serviceId: string) => void;
};

function visibleNodes(nodes: ServiceNode[], query: string, language: Language): ServiceNode[] {
  if (!query) return nodes;
  const normalized = query.trim().toLocaleLowerCase(language === "en" ? "en-CA" : "fr-CA");
  return nodes.flatMap((node) => {
    const name = node.type === "service" ? (language === "en" ? node.nameEn : node.nameFr) : (language === "en" ? node.nameEn : node.nameFr);
    const note = node.type === "branch" ? `${node.noteEn ?? ""} ${node.noteFr ?? ""}` : "";
    if (`${name} ${note}`.toLocaleLowerCase(language === "en" ? "en-CA" : "fr-CA").includes(normalized)) return [node];
    if (node.type === "branch") {
      const children = visibleNodes(node.children, query, language);
      if (children.length) return [{ ...node, children }];
    }
    return [];
  });
}

function allBranchIds(nodes: ServiceNode[]): string[] {
  return nodes.flatMap((node) => node.type === "branch" ? [node.id, ...allBranchIds(node.children)] : []);
}

function leaves(node: ServiceNode): ServiceLeaf[] {
  return node.type === "service" ? [node] : node.children.flatMap(leaves);
}

function findBranch(nodes: ServiceNode[], id: string): ServiceBranch | undefined {
  for (const node of nodes) {
    if (node.type !== "branch") continue;
    if (node.id === id) return node;
    const nested = findBranch(node.children, id);
    if (nested) return nested;
  }
  return undefined;
}

function formatPrice(price: number, language: Language) {
  const formatted = new Intl.NumberFormat(language === "en" ? "en-CA" : "fr-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(price);
  return formatted;
}

export function ServiceTree({ language, copy, selectedIds, selectedAddOns, onToggleService, onToggleAddOn }: ServiceTreeProps) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string[]>(["hands", "feet", "waxing", "variable-add-ons"]);
  const tree = useMemo(() => visibleNodes(
    // Keep the canonical category order from the source data.
    serviceTree,
    query,
    language,
  ), [query, language]);
  const allIds = useMemo(() => allBranchIds(serviceTree), []);
  const selected = new Set(selectedIds);

  function toggleBranch(id: string) {
    setExpanded((current) => current.includes(id) ? current.filter((openId) => openId !== id) : [...current, id]);
  }

  function renderNode(node: ServiceNode, depth: number): ReactNode {
    if (node.type === "service") {
      const checked = selected.has(node.id);
      const selectedAddOn = selectedAddOns[node.id];
      const addOnSelected = node.addOn?.key === selectedAddOn;
      const name = language === "en" ? node.nameEn : node.nameFr;
      const addOnName = node.addOn ? (language === "en" ? node.addOn.nameEn : node.addOn.nameFr) : "";
      const addOnPrice = node.addOn ? formatPrice(node.addOn.priceCad, language) : "";
      const price = selectedServicePrice(node, selectedAddOn);
      return (
        <div className={`service-leaf${checked ? " is-added" : ""}`} key={node.id} style={{ "--depth": depth } as CSSProperties}>
          <input id={`service-${node.id}`} type="checkbox" checked={checked} onChange={() => onToggleService(node.id)} />
          <label className="leaf-name" htmlFor={`service-${node.id}`}>{name}</label>
          <span className="leaf-duration">{node.durationMinutes} min</span>
          <span className="leaf-price">{node.priceLabel && !addOnSelected ? node.priceLabel : formatPrice(price, language)}</span>
          {node.addOn ? (
            <button
              className={`leaf-addon-toggle${addOnSelected ? " is-selected" : ""}`}
              type="button"
              aria-pressed={addOnSelected}
              onClick={() => onToggleAddOn(node.id)}
            >
              {addOnName} (+{addOnPrice})
            </button>
          ) : <span className="leaf-addon-spacer" aria-hidden="true" />}
          <span className="leaf-action" aria-hidden="true">{checked ? copy.added : copy.add}</span>
        </div>
      );
    }

    const open = query.length > 0 || expanded.includes(node.id);
    const canonicalBranch = findBranch(serviceTree, node.id);
    const count = (canonicalBranch ? leaves(canonicalBranch) : []).filter((item) => selected.has(item.id)).length;
    const name = language === "en" ? node.nameEn : node.nameFr;
    const note = language === "en" ? node.noteEn : node.noteFr;
    return (
      <div className={`tree-branch-wrap depth-${Math.min(depth, 3)}`} key={node.id}>
        <button
          className={`tree-branch${depth === 0 ? " tree-root" : ""}`}
          type="button"
          style={{ "--depth": depth } as CSSProperties}
          aria-expanded={open}
          onClick={() => toggleBranch(node.id)}
        >
          <span className={`branch-chevron${open ? " is-open" : ""}`} aria-hidden="true">⌄</span>
          <span className="branch-name">{name}</span>
          {note && node.id !== "enhancement-new-set" && node.id !== "enhancement-refill" && <span className="branch-note">{note}</span>}
          {count > 0 && <span className="branch-count">{count}</span>}
        </button>
        <div className={`tree-children${open ? " is-open" : ""}`} aria-hidden={!open} inert={!open}>
          <div className="tree-inner">
            {node.children.map((child) => renderNode(child, depth + 1))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="service-tree-shell">
      <div className="tree-toolbar">
        <label className="service-search">
          <span className="search-icon" aria-hidden="true">⌕</span>
          <span className="sr-only">{copy.searchServices}</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.searchServices} type="search" />
          {query && <button type="button" className="clear-search" onClick={() => setQuery("")} aria-label={copy.clearSearch}>×</button>}
        </label>
        <div className="tree-controls">
          <button type="button" onClick={() => setExpanded(allIds)}>{copy.expandAll}</button>
          <span aria-hidden="true">·</span>
          <button type="button" onClick={() => setExpanded([])}>{copy.collapseAll}</button>
        </div>
      </div>
      <div className="service-tree" role="group" aria-label={copy.treeAria}>
        {tree.length ? tree.map((node) => renderNode(node, 0)) : <p className="empty-state">{copy.noSearchResults}</p>}
      </div>
    </div>
  );
}
