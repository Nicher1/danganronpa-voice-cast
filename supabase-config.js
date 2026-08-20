const castLocalBoard = ["localhost", "127.0.0.1"].includes(location.hostname)
  ? new URLSearchParams(location.search).get("board")
  : null;

window.CAST_SUPABASE_CONFIG = Object.freeze({
  url: "https://srdyjehnvsmscmeuhcvh.supabase.co",
  publishableKey: "sb_publishable_DIRBy6R2DBQEWIFDuFiMcA_z1b97YLn",
  boardSlug: castLocalBoard || "danganronpa-main"
});
