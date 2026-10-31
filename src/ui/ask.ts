// Text input dialog (window.prompt does not exist in the desktop app).
export function askText(message: string, initial = ""): Promise<string | null> {
  return new Promise((resolve) => {
    const bg = document.createElement("div");
    bg.className = "modal-bg";
    const box = document.createElement("form");
    box.className = "modal col";
    box.style.width = "420px";
    const label = document.createElement("div");
    label.textContent = message;
    const input = document.createElement("input");
    input.className = "inp mono";
    input.value = initial;
    const row = document.createElement("div");
    row.className = "row";
    row.style.justifyContent = "flex-end";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn";
    cancel.textContent = "✕";
    const ok = document.createElement("button");
    ok.type = "submit";
    ok.className = "btn primary";
    ok.textContent = "OK";
    row.append(cancel, ok);
    box.append(label, input, row);
    bg.append(box);
    const done = (value: string | null) => {
      bg.remove();
      resolve(value);
    };
    box.onsubmit = (e) => {
      e.preventDefault();
      done(input.value);
    };
    cancel.onclick = () => done(null);
    box.onkeydown = (e) => {
      if (e.key === "Escape") done(null);
    };
    document.body.append(bg);
    input.select();
    input.focus();
  });
}
