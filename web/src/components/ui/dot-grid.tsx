"use client";

// พื้นหลังลายจุด (dot grid) ปรับสีตามธีมได้
export default function DotGrid({
  theme = "light",
  spacing = 22,
  className = "",
}: {
  theme?: "light" | "dark";
  spacing?: number;
  className?: string;
}) {
  return (
    <div
      className={className}
      style={{
        position: "absolute",
        inset: 0,
        backgroundImage: `radial-gradient(circle, ${theme === "light" ? "#d4d4d4" : "#333"} 1px, transparent 1px)`,
        backgroundSize: `${spacing}px ${spacing}px`,
        borderRadius: "inherit",
        pointerEvents: "none",
      }}
    />
  );
}
