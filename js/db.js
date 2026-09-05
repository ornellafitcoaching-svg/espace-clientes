// ============================================================================
// db.js — accès aux données (helpers CRUD génériques + requêtes ciblées).
// Toute la sécurité est côté serveur (RLS) : ces helpers ne renvoient que ce
// que l'utilisateur a le droit de voir.
// ============================================================================
window.DB = {
  // ---- Générique ----------------------------------------------------------
  async list(table, clienteId, order = { col: "date", asc: false }) {
    let q = window.sb.from(table).select("*");
    if (clienteId) q = q.eq("cliente_id", clienteId);
    q = q.order(order.col, { ascending: order.asc });
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },
  async insert(table, row) {
    const { data, error } = await window.sb.from(table).insert(row).select().single();
    if (error) throw error;
    return data;
  },
  async update(table, id, patch) {
    const { data, error } = await window.sb.from(table).update(patch).eq("id", id).select().single();
    if (error) throw error;
    return data;
  },
  async remove(table, id) {
    const { error } = await window.sb.from(table).delete().eq("id", id);
    if (error) throw error;
  },

  // ---- Clientes -----------------------------------------------------------
  async clientes() {
    const { data, error } = await window.sb
      .from("clientes")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  },
  async cliente(id) {
    const { data, error } = await window.sb.from("clientes").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
  },
  async createCliente(row) {
    return this.insert("clientes", row);
  },

  // ---- Accompagnement (1 par cliente) : upsert -----------------------------
  async accompagnement(clienteId) {
    const { data } = await window.sb
      .from("accompagnements")
      .select("*")
      .eq("cliente_id", clienteId)
      .maybeSingle();
    return data || null;
  },
  async saveAccompagnement(clienteId, patch) {
    const existing = await this.accompagnement(clienteId);
    if (existing) return this.update("accompagnements", existing.id, patch);
    return this.insert("accompagnements", { cliente_id: clienteId, ...patch });
  },

  // ---- Programmes : dernier de chaque type --------------------------------
  async programmes(clienteId) {
    return this.list("programmes", clienteId, { col: "created_at", asc: false });
  },

  // ---- Timeline (vue SQL) --------------------------------------------------
  async timeline(clienteId) {
    const { data, error } = await window.sb
      .from("timeline")
      .select("*")
      .eq("cliente_id", clienteId)
      .order("date", { ascending: false });
    if (error) throw error;
    return data || [];
  },

  // ---- Bundle : tout le dossier d'une cliente en 1 aller-retour groupé -----
  async dossier(clienteId) {
    const [cliente, accompagnement, seances, bilans, bilans_demarrage, mensurations, objectifs, programmes, photos, notes, paiements] =
      await Promise.all([
        this.cliente(clienteId),
        this.accompagnement(clienteId),
        this.list("seances", clienteId, { col: "date", asc: false }),
        this.list("bilans", clienteId, { col: "date", asc: false }),
        // Résilient : si la table n'existe pas encore (migration 12 non exécutée),
        // on renvoie [] au lieu de faire échouer tout le dossier.
        this.list("bilans_demarrage", clienteId, { col: "date", asc: false }).catch(() => []),
        this.list("mensurations", clienteId, { col: "date", asc: true }),
        this.list("objectifs", clienteId, { col: "date_creation", asc: false }),
        this.list("programmes", clienteId, { col: "created_at", asc: false }),
        this.list("photos", clienteId, { col: "date", asc: false }),
        this.list("notes_privees", clienteId, { col: "date", asc: false }),
        this.list("paiements", clienteId, { col: "date", asc: false }),
      ]);
    return { cliente, accompagnement, seances, bilans, bilans_demarrage, mensurations, objectifs, programmes, photos, notes, paiements };
  },

  async deleteCliente(clienteId) {
    // les tables liées ont ON DELETE CASCADE → tout le dossier part avec.
    return this.remove("clientes", clienteId);
  },
};
