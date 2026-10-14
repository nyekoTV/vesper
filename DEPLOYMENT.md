# Déploiement Vesper

État : paquet préparé ; aucune instance distante créée ou publiée.

## Railway

Le dossier de service est `outputs/vesper` (ou la racine si ce dossier est envoyé seul). Le Dockerfile n’installe aucune dépendance : le serveur utilise Node et les ressources navigateur sont déjà fournies.

1. Relier un compte Railway et choisir un projet et son budget.
2. Déployer le dossier Vesper avec le Dockerfile et `railway.json`.
3. Ajouter un volume persistant monté sur `/data`. Utiliser une seule instance : présence, événements et signalisation vocale sont en mémoire.
4. Générer un domaine HTTPS Railway, puis configurer ces variables côté hébergeur :

| Variable | Valeur |
|---|---|
| `ORIGIN` | Origine HTTPS exacte, par exemple `https://nom.up.railway.app`, sans slash final |
| `DATA_FILE` | `/data/vesper.sqlite` |
| `RESEND_API_KEY` | Secret du service d’envoi, stocké côté hébergeur |
| `MAIL_FROM` | Expéditeur validé chez Resend |
| `ICE_SERVERS` | Tableau JSON STUN/TURN, selon le relais retenu |

Le port est fourni par l’hébergeur. Le démarrage de production exige HTTPS, le volume Railway et la configuration mail. Le contrôle de disponibilité interroge `/api/config`.

Le compte Resend et un expéditeur autorisé sont nécessaires pour l’inscription vérifiée. Le vocal entre réseaux peut nécessiter un relais TURN ; il faudra le configurer puis vérifier un appel entre deux appareils sur des réseaux distincts. Ne pas publier de mots de passe TURN permanents partagés à grande échelle : cette version transmet la configuration ICE aux utilisateurs connectés.

## Conservation des comptes locaux

Ne pas transférer le dossier `data/` dans Git, l’image Docker ou l’archive source. La base locale et sa clé `vesper.sqlite.mfa-key` doivent être transférées par un canal privé vers le volume du service, après une sauvegarde cohérente et avant son démarrage. Les fichiers WAL/SHM exigent une sauvegarde SQLite correcte ou un arrêt propre avant copie. La base contient les comptes et le rôle admin exact de nyeko ; une instance vide ne récupère pas ces accès automatiquement. Révoquer les anciennes sessions lors de la migration.

Le domaine d’authentification stocké dans la base doit être conservé. L’adresse déclarée par nyeko doit être vérifiée via le service mail en ligne. Aucun mot de passe ne doit être réinitialisé ou demandé dans la conversation.

Le code admin existant reste haché dans la base migrée. Laisser `ADMIN_PANEL_CODE` absent pour préserver les changements effectués depuis le panneau. Une réinstallation vide nécessite un provisionnement admin par identifiant exact et un nouveau code privé.

## Vérifications après publication

Ouvrir le domaine HTTPS, vérifier inscription et réception du mail, connexion, A2F, messages entre deux comptes, SSE, admin, redémarrage avec persistance et appel vocal. Activer des sauvegardes privées du volume incluant la base et la clé MFA.

## Sources officielles

- Dockerfile Railway : https://docs.railway.com/builds/dockerfiles
- Configuration : https://docs.railway.com/config-as-code/reference
- Volumes : https://docs.railway.com/volumes

La construction Docker n’a pas été exécutée localement : Docker Desktop est installé, mais son moteur ne fonctionne pas actuellement.
