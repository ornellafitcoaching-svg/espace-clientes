// ============================================================================
// devis-upload — range le PDF d'un devis dans le stockage privé « devis »
// (utilisé par Claude pour importer des devis existants ; la coach, elle,
// joint ses PDF directement depuis la fiche cliente).
// POST {devis_id, b64, ext}  · header x-cron-secret obligatoire · Verify JWT = OFF.
// Ne remplace jamais un fichier déjà joint.
// ============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
async function secret(name: string, key: string) {
  const env = Deno.env.get(name);
  if (env) return env;
  const { data } = await supa.rpc("get_private_config", { k: key });
  return (data as string | null) ?? "";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  const CRON = await secret("CRON_SECRET", "cron_secret");
  if (!CRON || req.headers.get("x-cron-secret") !== CRON) return new Response("Forbidden", { status: 403 });
  const { devis_id, b64, ext } = await req.json();
  if (!/^[0-9a-f-]{36}$/.test(String(devis_id)) || !b64) return new Response("bad request", { status: 400 });
  const { data: dv } = await supa.from("devis").select("id,cliente_id,storage_path").eq("id", devis_id).single();
  if (!dv) return new Response("devis introuvable", { status: 404 });
  if (dv.storage_path) return Response.json({ deja: dv.storage_path });
  const e = ["pdf", "jpg", "jpeg", "png"].includes(String(ext)) ? String(ext) : "pdf";
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const path = `${dv.cliente_id}/${dv.id}-${crypto.randomUUID()}.${e}`;
  const up = await supa.storage.from("devis").upload(path, bytes, { contentType: e === "pdf" ? "application/pdf" : `image/${e === "jpg" ? "jpeg" : e}`, upsert: false });
  if (up.error) return Response.json({ erreur: up.error.message }, { status: 500 });
  await supa.from("devis").update({ storage_path: path }).eq("id", dv.id);
  return Response.json({ ok: path, taille: bytes.length });
});
