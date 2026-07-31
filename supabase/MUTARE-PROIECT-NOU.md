# Mutarea panelului pe un proiect Supabase nou

1. Creează proiectul Supabase și copiază `Project URL`, cheia `publishable/anon` și cheia secretă `service_role`.
2. Rulează `setup-complet-baza-de-date.sql` în SQL Editor.
3. Rulează `migrations/20260729_repair_shift_autoclose_and_names.sql`.
4. Instalează Supabase CLI, autentifică-te și rulează:

   `powershell -ExecutionPolicy Bypass -File supabase/deploy-functions.ps1 -ProjectRef ID_PROIECT`

5. Completează o copie a `edge-secrets.example.env`, apoi aplic-o prin Dashboard sau cu:

   `powershell -ExecutionPolicy Bypass -File supabase/apply-edge-secrets.ps1 -ProjectRef ID_PROIECT -EnvFile CALEA_CATRE_ENV`
6. În configuratorul panelului completează Discord Client ID, Guild ID, rolurile și webhook-urile.
7. Generează `supabase-config.js` și încarcă-l în folderul `js` de pe GitHub.
8. Adaugă URL-ul `.../login.html` în Discord Developer Portal → OAuth2 → Redirects.

Nu încărca niciodată cheia `service_role`, fișierul `.env` completat sau tokenurile Discord în GitHub.
