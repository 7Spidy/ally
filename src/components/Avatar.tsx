"use client";

import Image from "next/image";
import type { Template } from "@/lib/engine";

/**
 * Small circular avatar for a template. Used in the chat header, the
 * switcher sheet, and home pips. `size` is both width and height in px.
 */
export function Avatar({ template, size, className }: { template: Template; size: number; className?: string }) {
  return (
    <Image
      src={"/" + template.avatar}
      alt=""
      width={size}
      height={size}
      style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
      className={className}
    />
  );
}
