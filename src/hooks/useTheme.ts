import { useEffect, useState } from "react";

type Theme = "light" | "dark";

export function useTheme() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const saved = (localStorage.getItem("ghost-theme") as Theme | null) ?? "light";
    apply(saved);
    setTheme(saved);
  }, []);

  function apply(t: Theme) {
    document.documentElement.classList.toggle("dark", t === "dark");
  }

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    apply(next);
    localStorage.setItem("ghost-theme", next);
  }

  return { theme, toggle };
}
