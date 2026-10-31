import React, { useState } from "react";
import { tr } from "../i18n";
import { Tab, useApp } from "../store";
import { GUIDE_SECTIONS } from "./docs/content";
import { DocBlocks } from "./docs/DocBlocks";

export function GuideView() {
  const [s, setS] = useState(GUIDE_SECTIONS[0].id);
  const { setTab } = useApp();
  const sec = GUIDE_SECTIONS.find((x) => x.id === s) ?? GUIDE_SECTIONS[0];
  const onLink = (target: string) => {
    if (target.startsWith("tab:")) setTab(target.slice(4) as Tab);
  };
  return (
    <div className="guide">
      <div className="row" style={{ marginBottom: 10 }}>
        {GUIDE_SECTIONS.map((x) => (
          <button key={x.id} className={"btn" + (x.id === s ? " on" : "")} onClick={() => setS(x.id)}>
            {tr(x.title)}
          </button>
        ))}
      </div>
      <DocBlocks blocks={sec.blocks} onLink={onLink} />
    </div>
  );
}
