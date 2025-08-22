"use client";
import { useEffect, useState } from "react";

export default function ImageToggle() {
  const [on, setOn] = useState<boolean>(true);

  useEffect(() => {
    const v = localStorage.getItem("ffa_show_images");
    if (v !== null) setOn(v === "1");
  }, []);

  useEffect(() => {
    localStorage.setItem("ffa_show_images", on ? "1" : "0");
    const ev = new CustomEvent("ffa:showImages", { detail: on });
    window.dispatchEvent(ev);
  }, [on]);

  return (
    <label className="inline-flex items-center gap-2 cursor-pointer text-sm">
      <span>Images</span>
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => setOn(e.target.checked)}
        className="accent-emerald-700"
      />
    </label>
  );
}
