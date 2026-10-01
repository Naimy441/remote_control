import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Remote",
    short_name: "Remote",
    description: "Control this Mac from your phone.",
    start_url: "/",
    display: "standalone",
    background_color: "#0e0f12",
    theme_color: "#0e0f12",
  };
}
