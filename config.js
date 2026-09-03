// ProCards - Team A — Config
// Fill these in once you create your Team A Supabase project (separate from the main
// ProCards Commission CRM). Never put the main CRM's keys here — this app should only
// ever talk to the main system through the one-way push endpoint below.

const CONFIG = {
  // Team A's OWN Supabase project (separate database)
  SUPABASE_URL: "https://hkxuubrdirkqqqfozbzz.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_FW8GF6I53712GH5HFcwg-Q_q3uIq4z_",

  // Shared PIN to open this admin CRM
  APP_PIN: "2026",

  // One-way push endpoint on the MAIN Commission CRM's Supabase project.
  // This must be a narrow Edge Function that ONLY accepts new approval rows —
  // it cannot read PINs, commission rates, or agent records. See push-to-main.md
  // for the Edge Function code to deploy on the MAIN project.
  MAIN_CRM_PUSH_URL: "https://YOUR-MAIN-PROJECT.supabase.co/functions/v1/receive-approval",
  MAIN_CRM_PUSH_KEY: "YOUR-SCOPED-PUSH-KEY",

  // Email sending for agent turn-in summaries (Tab 1) — EmailJS free tier works well
  // for a static GitHub Pages site with no backend server.
  EMAILJS_SERVICE_ID: "service_qxp1mzs",
  EMAILJS_TEMPLATE_ID: "template_9od5afk",
  EMAILJS_PUBLIC_KEY: "94RIhk1TOPr_iKYlA",
};
