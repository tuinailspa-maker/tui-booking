export const PRINT_RETURN_HASH = "#tui-printed";

export function printReturnUrl() {
  const url = new URL(window.location.href);
  url.hash = PRINT_RETURN_HASH;
  return url.toString();
}

export function isPrintReturn() {
  return typeof window !== "undefined" && window.location.hash === PRINT_RETURN_HASH;
}

export function clearPrintReturnHash() {
  const { pathname, search } = window.location;
  window.history.replaceState(window.history.state, "", `${pathname}${search}`);
}

// Opening an app URL scheme through a link click hands off to the app without
// unloading this page, unlike assigning window.location.
export function openAppUrl(href: string) {
  const link = document.createElement("a");
  link.href = href;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
}
