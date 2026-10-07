type Kid = Node | string | number | null | undefined | false;
type Props = Record<string, unknown> | null;

/** Tạo phần tử DOM gọn: h("div", {class: "a", onclick: fn}, "text", child) */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = String(v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v as EventListener);
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k === "html") el.innerHTML = String(v);
    else if (k === "value" || k === "checked" || k === "disabled" || k === "hidden") (el as any)[k] = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids) if (kid !== null && kid !== undefined && kid !== false) el.append(typeof kid === "object" ? kid : String(kid));
  return el;
}

export const clear = (el: Element): void => {
  while (el.firstChild) el.removeChild(el.firstChild);
};

export function store(key: string): { get(): string | null; set(v: string): void } {
  return {
    get: () => {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set: (v) => {
      try {
        localStorage.setItem(key, v);
      } catch {
        /* bỏ qua */
      }
    },
  };
}
