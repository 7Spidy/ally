import type { MetadataRoute } from "next";

/** The web app manifest, served at /manifest.webmanifest. Colours match the app's --surf. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ally",
    short_name: "Ally",
    start_url: "/",
    display: "standalone",
    background_color: "#151220",
    theme_color: "#151220",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
