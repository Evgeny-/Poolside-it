document.addEventListener("DOMContentLoaded", () => {
  wireFakeForms();
  wireDynamicPage();
  wireAmbiguousControls();
});

function wireFakeForms() {
  document.querySelectorAll("form[data-fake-submit]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const target = document.querySelector(form.dataset.statusTarget || "#status");
      if (target) {
        target.textContent = form.dataset.successText || "Saved.";
      }
    });
  });
}

function wireDynamicPage() {
  const revealButton = document.querySelector("[data-reveal-panel]");
  const revealPanel = document.querySelector("#revealedPanel");
  const addRowButton = document.querySelector("[data-add-row]");
  const list = document.querySelector("#dynamicList");

  if (revealButton && revealPanel) {
    revealButton.addEventListener("click", () => {
      revealPanel.classList.remove("hidden");
      revealPanel.querySelector("input")?.focus();
    });
  }

  if (addRowButton && list) {
    addRowButton.addEventListener("click", () => {
      const rowNumber = list.children.length + 1;
      const row = document.createElement("div");
      row.className = "dynamic-row";

      const input = document.createElement("input");
      input.placeholder = `Dynamic item ${rowNumber}`;
      input.setAttribute("aria-label", `Dynamic item ${rowNumber}`);

      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Remove";
      button.addEventListener("click", () => row.remove());

      row.append(input, button);
      list.append(row);
      input.focus();
    });
  }
}

function wireAmbiguousControls() {
  document.querySelectorAll("[data-onclick-action]").forEach((element) => {
    element.onclick = () => {
      const status = document.querySelector("#status");
      if (status) {
        status.textContent = element.dataset.onclickAction;
      }
    };
  });
}
