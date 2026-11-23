import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { selectedServiceDuration, selectedServicePrice, serviceTree, type ServiceAddOnKey, type ServiceBranch, type ServiceLeaf, type ServiceNode } from "@/data/serviceTree";
import type { BookingCopy, Language } from "./copy";

type ServiceTreeProps = {
  language: Language;
  copy: BookingCopy;
  selectedIds: string[];
  selectedAddOns: Record<string, ServiceAddOnKey>;
  onToggleService: (serviceId: string) => void;
  onToggleAddOn: (serviceId: string) => void;
  disabled?: boolean;
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

const ROOT_CATEGORY_ORDER = ["hands", "feet", "variable-add-ons", "waxing"];

function rootRank(id: string) {
  const index = ROOT_CATEGORY_ORDER.indexOf(id);
  return index === -1 ? ROOT_CATEGORY_ORDER.length : index;
}

const orderedServiceTree = serviceTree
  .map((node, index) => ({ node, index }))
  .sort((a, b) => rootRank(a.node.id) - rootRank(b.node.id) || a.index - b.index)
  .map(({ node }) => node);

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

export function ServiceTree({ language, copy, selectedIds, selectedAddOns, onToggleService, onToggleAddOn, disabled = false }: ServiceTreeProps) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string[]>([]);
  const tree = useMemo(() => visibleNodes(orderedServiceTree, query, language), [query, language]);
  const selected = new Set(selectedIds);

  function toggleBranch(id: string, depth: number) {
    setExpanded((current) => {
      if (current.includes(id)) return current.filter((openId) => openId !== id);
      // Opening a main category closes the previously open one (and its sub-branches).
      return depth === 0 ? [id] : [...current, id];
    });
  }

  function renderNode(node: ServiceNode, depth: number): ReactNode {
    if (node.type === "service") {
      const checked = selected.has(node.id);
      const selectedAddOn = selectedAddOns[node.id];
      const addOnSelected = node.addOn?.key === selectedAddOn;
      const name = language === "en" ? node.nameEn : node.nameFr;
      const addOnLabel = node.addOn ? (language === "en" ? node.addOn.labelEn : node.addOn.labelFr) : "";
      const price = selectedServicePrice(node, selectedAddOn);
      return (
        <div className={`service-leaf${checked ? " is-added" : ""}`} key={node.id} style={{ "--depth": depth } as CSSProperties}>
          <input id={`service-${node.id}`} type="checkbox" checked={checked} onChange={() => onToggleService(node.id)} disabled={disabled} />
          <label className="leaf-name" htmlFor={`service-${node.id}`}>{name}</label>
          <span className="leaf-duration">{selectedServiceDuration(node, selectedAddOn)} min</span>
          <span className="leaf-price">{node.priceLabel && !addOnSelected ? node.priceLabel : formatPrice(price, language)}</span>
          {node.addOn ? (
            <button
              className={`leaf-addon-toggle${addOnSelected ? " is-selected" : ""}`}
              type="button"
              aria-pressed={addOnSelected}
              onClick={() => onToggleAddOn(node.id)}
              disabled={disabled}
            >
              {addOnLabel}
            </button>
          ) : <span className="leaf-addon-spacer" aria-hidden="true" />}
          {checked ? (
            <button
              type="button"
              className="leaf-remove"
              onClick={() => onToggleService(node.id)}
              disabled={disabled}
              aria-label={`${copy.remove}: ${name}`}
            >
              <span className="leaf-remove-label">{copy.remove}</span>
              <span aria-hidden="true">×</span>
            </button>
          ) : (
            <span className="leaf-action" aria-hidden="true">{copy.add}</span>
          )}
        </div>
      );
    }

    const open = query.length > 0 || expanded.includes(node.id);
    const canonicalBranch = findBranch(serviceTree, node.id);
    const branchLeaves = canonicalBranch ? leaves(canonicalBranch) : [];
    const count = branchLeaves.filter((item) => selected.has(item.id)).length;
    const name = language === "en" ? node.nameEn : node.nameFr;
    const note = language === "en" ? node.noteEn : node.noteFr;
    return (
      <div className={`tree-branch-wrap depth-${Math.min(depth, 3)}`} key={node.id}>
        <button
          className={`tree-branch${depth === 0 ? " tree-root" : ""}`}
          type="button"
          style={{ "--depth": depth } as CSSProperties}
          aria-expanded={open}
          onClick={() => toggleBranch(node.id, depth)}
        >
          <span className={`branch-chevron${open ? " is-open" : ""}`} aria-hidden="true">⌄</span>
          <span className="branch-name">{name}</span>
          {depth === 0 && <span className="branch-total">{branchLeaves.length} {copy.servicesUnit}</span>}
          {note && node.id !== "enhancement-new-set" && node.id !== "enhancement-refill" && <span className="branch-note">{note}</span>}
          {count > 0 && <span className="branch-count" aria-label={`${count} ${copy.selectedCount}`}>{count}</span>}
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
          <button type="button" onClick={() => setExpanded([])}>{copy.collapseAll}</button>
        </div>
      </div>
      <div className="service-tree" role="group" aria-label={copy.treeAria}>
        {tree.length ? tree.map((node) => renderNode(node, 0)) : <p className="empty-state">{copy.noSearchResults}</p>}
      </div>
    </div>
  );
}
