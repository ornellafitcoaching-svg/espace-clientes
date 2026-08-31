# Espace Clientes — Ornella Fit Coaching

Plateforme privée « dossier client vivant ». **Étape 1 = espace coach** et
**Étape 2 = espace cliente** : toutes deux terminées et testées. Front HTML statique
+ Supabase (base de données + auth + photos).

---

## 🗂 Ce qu'il y a dans le dossier
```
index.html        → route selon le rôle (coach → coach.html, cliente → mon-espace.html)
login.html        → connexion coach (email + mot de passe)
coach.html        → dashboard « Mes clientes »
cliente.html      → fiche cliente (résumé + actions rapides + sections + Accès cliente)
espace.html       → connexion CLIENTE par code d'accès
mon-espace.html   → espace cliente en LECTURE SEULE (accueil perso + 9 écrans)
css/app.css       → design (charte du site)
js/…              → config, supabase, auth, données, calculs, interface
sql/schema.sql               → base + sécurité (à coller en 1er)
sql/migration_01_*.sql       → paiements, mensurations complètes, santé (2e)
sql/migration_02_*.sql       → vues sûres cliente (santé/prix jamais lisibles) (3e)
CNAME             → sous-domaine espace.ornellafitcoaching.com
```

**Flux cliente :** depuis une fiche → *Créer l'accès cliente* génère un code + un compte
Supabase. La cliente ouvre `espace.html`, saisit son code, et consulte son suivi
(`mon-espace.html`) en lecture seule. Le code fait office d'identifiant + mot de passe
(insensible à la casse).

---

## ✅ Mise en route (à faire une seule fois, ~15 min)

### 1) Créer le projet Supabase (gratuit)
1. Va sur **https://supabase.com** → *Start your project* → connecte-toi (GitHub ou email).
2. *New project* : nom `ornella-espace`, choisis un mot de passe de base (garde-le),
   région **Europe (eu-west / Paris)**. Attends ~2 min que le projet se crée.

### 2) Créer les tables + la sécurité
1. Menu de gauche → **SQL Editor** → *New query*.
2. Exécute **dans l'ordre** (copier / coller / Run pour chacun) :
   `sql/schema.sql`, puis `sql/migration_01_paiements_sante.sql`, puis
   `sql/migration_02_cliente_safe_view.sql`, puis `sql/migration_03_nutrition_details.sql`.
3. Tu dois voir « Success » à chaque fois. (Tables, sécurité RLS, stockage photos, et
   vues sûres qui garantissent que la cliente ne lit jamais santé / prix / notes / paiements.)

### 3) Créer TON compte coach
1. Menu → **Authentication** → **Users** → *Add user* → *Create new user*.
   - Email = ton email, mot de passe au choix, **coche « Auto Confirm User »**.
2. Reviens dans **SQL Editor**, nouvelle requête, colle (avec TON email) :
   ```sql
   update public.profiles set role = 'coach' where email = 'TON_EMAIL_ICI';
   ```
   Clique **Run**.

### 4) Brancher le site à Supabase
1. Menu → **Project Settings** → **Data API** (ou **API Keys**). Note :
   - **Project URL** (ex. `https://abcd1234.supabase.co`)
   - **anon public key** (longue chaîne qui commence par `eyJ…`)
2. Ouvre `js/config.js` et remplace les deux valeurs `REMPLACER…` par les tiennes.
   > La clé `anon` est **publique par nature** : toute la sécurité est côté serveur (RLS).
   > Aucune donnée n'est accessible sans être connectée avec les bons droits.
3. Toujours dans `js/config.js`, renseigne **`WHATSAPP_NUMBER`** (format international
   sans `+`, ex. `33612345678`) pour activer le bouton « Contacter Ornella » dans l'espace
   cliente. Laisser vide masque simplement le bouton.

### 5) Désactiver la confirmation email (indispensable pour les accès clientes)
Menu → **Authentication** → **Sign In / Providers** → section **« User Signups »** →
toggle **« Confirm email » sur OFF** (gris) → **Save changes**.
Laisse **« Allow new users to sign up » ON**. (Les comptes clientes utilisent un email
technique `codeclient@ornellafitcoaching.com` : aucun mail n'est envoyé, c'est juste un
identifiant. Voir `js/config.js` → `CLIENTE_EMAIL_DOMAIN`.)

---

## ▶️ Tester en local
Ouvre simplement `login.html` dans ton navigateur (double-clic), connecte-toi avec ton
compte coach. Tu arrives sur le dashboard. Crée une cliente test, remplis via les
boutons d'actions rapides, vérifie que les calculs et la timeline s'affichent.

---

## 🚀 Mettre en ligne (sous-domaine espace.ornellafitcoaching.com)
1. Crée un **nouveau repo GitHub** (séparé du site), pousse ce dossier dedans.
2. Repo → **Settings → Pages** : Source = branche `main`, dossier `/root`. Enregistre.
3. Le fichier `CNAME` est déjà présent → GitHub Pages servira le sous-domaine.
4. Chez ton registrar DNS (là où est géré ornellafitcoaching.com), ajoute un
   enregistrement **CNAME** : `espace` → `TON-COMPTE.github.io`.
5. Attends la propagation (quelques minutes à quelques heures), puis vérifie
   `https://espace.ornellafitcoaching.com`.

> ⚠️ Je peux t'aider pour les étapes GitHub/DNS au moment voulu.

---

## 🔐 Sécurité — l'essentiel en clair
- Chaque table est protégée par **Row Level Security** : la coach voit tout ; une cliente
  (Étape 2) ne pourra voir **que son propre dossier**, jamais celui d'une autre — même en
  bidouillant le code, c'est le serveur qui refuse.
- Côté cliente, tout passe par des **vues sûres** (`ma_fiche`, `mon_accompagnement`) :
  **notes privées, paiements, santé/allergies, coordonnées, prix et code d'accès ne sont
  JAMAIS lisibles** — même en bidouillant le code. Vérifié en conditions réelles.
- Les **photos** sont dans un stockage **privé** ; une cliente ne peut voir que celles
  marquées « visible cliente », et seulement les siennes.
- **Code d'accès cliente (Étape 2)** : il fonctionne comme un mot de passe. Si une cliente
  le partage, la personne voit son dossier. Les codes sont longs et non-devinables, et tu
  pourras les régénérer. Transmets-les par un canal privé (WhatsApp/email direct).

---

## 🧭 Étape 2 — espace cliente (terminée)
Login par code d'accès (`espace.html`), page d'accueil personnalisée et consultation en
lecture seule (`mon-espace.html`) : accueil, séances, mensurations, évolution, bilans,
photos, nutrition, programmes, objectifs. Création/copie/régénération du code depuis la
fiche coach (section « Accès cliente »). Isolation garantie côté serveur (RLS + vues sûres).
