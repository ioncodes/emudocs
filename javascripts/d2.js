// Renders ```d2 fences in place. The D2 engine is only downloaded on pages that contain a diagram.
const D2_URL = "https://cdn.jsdelivr.net/npm/@terrastruct/d2@0.1.33/dist/browser/index.js";
const FONT_URL = "https://cdn.jsdelivr.net/gh/JetBrains/JetBrainsMono@v2.304/fonts/ttf/JetBrainsMono-";

// Minimal monochrome styles shared by every diagram, one set per site color scheme.
const SCHEMES = {
  default: {
    header: "#E4E4E7",
    body: "#FFFFFF",
    title: "#18181B",
    offset: "#71717A",
    text: "#27272A",
    arrow: "#A1A1AA",
  },
  slate: {
    header: "#3F3F46",
    body: "transparent",
    title: "#F4F4F5",
    offset: "#A1A1AA",
    text: "#E4E4E7",
    arrow: "#71717A",
  },
};

let engine;
let fonts;
let queue = Promise.resolve();
let diagramCount = 0;

function currentScheme() {
  return document.body.getAttribute("data-md-color-scheme") === "slate" ? "slate" : "default";
}

function preamble(colors) {
  return `
vars: {
  d2-config: {
    theme-overrides: {
      B1: "${colors.arrow}"
      B2: "${colors.offset}"
      N2: "${colors.text}"
    }
  }
}
*.style.fill: "${colors.header}"
*.style.stroke: "${colors.body}"
*.style.font-color: "${colors.title}"
(* -> *)[*].style.stroke: "${colors.arrow}"
(* -- *)[*].style.stroke: "${colors.arrow}"
`;
}

async function loadFont(weight) {
  const response = await fetch(`${FONT_URL}${weight}.ttf`);
  // The engine only accepts the font bytes as a plain array.
  return Array.from(new Uint8Array(await response.arrayBuffer()));
}

async function draw(container) {
  engine ??= import(D2_URL).then(({ D2 }) => new D2());
  fonts ??= Promise.all([loadFont("Regular"), loadFont("Bold")]);
  const [d2, [regular, bold]] = await Promise.all([engine, fonts]);
  const scheme = currentScheme();
  if (container.dataset.scheme === scheme) {
    return;
  }

  const result = await d2.compile(preamble(SCHEMES[scheme]) + container.dataset.source, {
    layout: "elk",
    pad: 4,
    fontRegular: regular,
    fontBold: bold,
    fontSemibold: bold,
    fontItalic: regular,
  });
  container.innerHTML = await d2.render(result.diagram, {
    ...result.renderOptions,
    noXMLTag: true,
    salt: container.dataset.salt,
  });
  container.dataset.scheme = scheme;

  // Drop the canvas background so the diagram sits directly on the page.
  container.querySelector("svg svg > rect")?.remove();
  const svg = container.querySelector("svg");
  svg.style.maxWidth = "100%";
  svg.style.height = "auto";
}

// The engine runs in a single worker that handles 1 request at a time.
function schedule(container) {
  queue = queue.then(() => draw(container)).catch((error) => console.error("D2 render failed", error));
}

function renderPage() {
  for (const block of document.querySelectorAll("pre.d2")) {
    const container = document.createElement("div");
    container.className = "d2-diagram";
    container.dataset.source = block.textContent;
    container.dataset.salt = `d2-${diagramCount++}`;
    block.replaceWith(container);
  }
  document.querySelectorAll(".d2-diagram").forEach(schedule);
}

new MutationObserver(() => document.querySelectorAll(".d2-diagram").forEach(schedule)).observe(document.body, {
  attributes: true,
  attributeFilter: ["data-md-color-scheme"],
});

if (window.document$) {
  window.document$.subscribe(renderPage);
} else {
  renderPage();
}
