# Vesper

## Recherche GIF intégrée 0.7.4

Sélecteur GIF : Explorer (tendances, recherche et pagination KLIPY), Favoris locaux par compte/appareil, réactions Vesper séparées. La recherche attend 450 ms après la saisie et ignore les réponses des recherches précédentes. Les liens d’import et fichiers restent accessibles dans une rubrique repliable.

Créer une application **Vesper** dans https://partner.klipy.com/ → API Keys. Dans Railway → vesper → Variables, ajouter **KLIPY_API_KEY**, puis appliquer le déploiement. La clé d’application est transmise aux navigateurs authentifiés : elle sert à une intégration cliente KLIPY et ne doit pas être un jeton d’administration. Le mode Testing est limité à 100 requêtes/heure selon KLIPY ; demander l’accès Production dans son panneau après validation.

Les appels et médias KLIPY viennent directement du navigateur, avec attribution et URLs de diffusion conservées. Les termes et chargements sont visibles par le fournisseur. Les messages chiffrent la référence au GIF ; ses octets restent hébergés par KLIPY. Aucun proxy/cache média KLIPY n’est créé. Les imports de fichiers et liens Tenor/GIPHY conservent leur fonctionnement antérieur.


## GIF 0.7.3

Bouton GIF plus visible et sélecteur avec réactions locales, liens de recherche Tenor/GIPHY et import par lien de page ou URL GIF directe des deux fournisseurs. Pas de clé API nécessaire : la recherche externe s’ouvre chez le fournisseur, puis l’utilisateur colle son lien. Import de fichiers conservé, 512 Ko maximum. Les pages Tenor qui refusent la récupération nécessitent un lien direct ou le fichier.

Le serveur récupère le GIF public sélectionné ; le navigateur chiffre ses octets avant l’envoi dans la conversation. Les destinataires ne contactent pas le fournisseur. Import authentifié, contrôle d’origine, limite de débit, domaines HTTPS autorisés vérifiés à chaque redirection, limite de temps et de taille.


## Présentation et navigation 0.7.2

Croix de fermeture centrée, contrôles du composeur et du vocal alignés, espacements des profils et paramètres harmonisés, retours à la ligne sur petit écran. Une conversation s’ouvre sur ses derniers messages, même en cache ; charger un historique plus ancien conserve la position de lecture. La saisie d’un caractère imprimable depuis la conversation active le champ et conserve ce premier caractère. Les autres champs, fenêtres modales, sélections de texte et raccourcis clavier sont respectés.


## Audio 0.7.1

Paramètres → Audio et vocal : gain du microphone 0–300 %, annulation d’écho, réduction du bruit, niveau automatique et filtre passe-haut de voix à 80 Hz. Les préférences sont locales à cet appareil et s’appliquent pendant l’appel. Écho/bruit/niveau automatique utilisent les capacités du navigateur ; les options non prises en charge sont désactivées. Un compresseur atténue les pointes après amplification. Le flux traité est envoyé aux pairs, sans retour local dans le casque. Le flux brut et les ressources Web Audio sont arrêtés au départ du vocal.

Couper le casque coupe aussi le microphone brut et le flux transmis. La réactivation restaure son état précédent : un micro déjà coupé reste coupé. Réactiver le micro est bloqué tant que le casque est coupé.

Validation : 14 tests audio ciblés réussis ; appel WebRTC réel local avec flux synthétiques traité, 1042 et 998 octets audio reçus. Réglages vérifiés dans le navigateur sans capture de microphone personnel. L’efficacité acoustique réelle des filtres dépend du matériel et du navigateur.


## Messages 0.7

L’indicateur « écrit… » fonctionne dans les salons textuels et conversations privées : signal d’activité limité, sans texte du brouillon, arrêt après pause, envoi, perte de focus ou changement de salon, expiration au plus tard après six secondes. Les comptes invisibles ne publient pas leur activité. Les permissions de salon sont vérifiées côté serveur.

Saisir `@` propose les membres du salon ; cliquer ou utiliser Tab pour compléter. Les mentions exactes sont cliquables et celles du compte courant sont mises en évidence. Aucun envoi à tous les membres via @everyone n’est ajouté.

Le bouton de réaction d’un message propose huit emojis. Chaque compte publie son propre ensemble de réactions chiffré et signé, lié au message. Cliquer à nouveau retire la réaction. Le serveur stocke les enveloppes chiffrées ; les compteurs et noms sont calculés après déchiffrement. Les changements sont reçus en temps réel, sans interrompre les GIF montés. Une nouvelle table SQLite est créée sans modifier les messages existants.

Validation : 54 tests réussis, puis vérification navigateur avec deux comptes fictifs pour la saisie, l’autocomplétion, les mentions et la réception d’une réaction chiffrée. Les limites de fichiers existantes sont conservées.


## Correctif vocal 0.6.1

Cloudflare Realtime TURN : ajouter `CLOUDFLARE_TURN_KEY_ID` et `CLOUDFLARE_TURN_API_TOKEN` dans les variables Railway. Le jeton reste au serveur ; seuls les identifiants temporaires sont envoyés aux participants autorisés qui rejoignent un vocal. Une erreur du fournisseur est affichée avant de rejoindre. Les connexions bloquées sortent de « Connexion… » après 20 secondes, avec un bouton Reconnecter le vocal. Sans relais configuré, les connexions entre certains réseaux restent impossibles.

Dans le shell du conteneur Railway (pas `railway run` sur le PC), exécuter `node scripts/admin-user.mjs grant nyeko`. Seul le compte exact existant est promu ; la commande ne crée aucun utilisateur. Si aucun code admin existe, un code aléatoire est créé et affiché une seule fois dans ce terminal, à conserver en privé. Sinon le code existant est conservé. Se reconnecter ensuite dans Vesper → Paramètres → Administration.


## Nouveautés 0.6 : conversations, vocal, profils et GIF

Les événements de message mettent à jour le message concerné sans vider l’historique, redéclencher le déchiffrement complet, remettre la conversation en bas ou interrompre les GIF déjà affichés. Les messages modifiés et supprimés sont identifiés dans les événements SSE. Les pages d’historique déjà chargées restent en mémoire. Un nouveau point API lit un seul message, avec les mêmes contrôles d’accès que le salon.

Le vocal utilise des serveurs STUN par défaut, traite les signaux par pair dans l’ordre et tente une reconnexion ICE après une interruption. L’interface présente des cartes de participants, une bordure verte quand une voix est détectée, les commandes micro/écoute/raccrochage et un accès aux réglages audio. Paramètres → Audio et vocal permet de choisir une sortie casque/haut-parleurs sur les navigateurs compatibles. Les sons d’interface suivent la sortie choisie lorsque Web Audio le permet aussi ; sinon ils utilisent la sortie système. Aucun nom d’appareil ni autorisation micro n’est inventé.

Pour les réseaux qui bloquent le pair à pair, configurer un relais coturn avec `TURN_URLS` (tableau JSON) et `TURN_SHARED_SECRET`. Le serveur génère alors des identifiants temporaires par utilisateur, valables une heure, et ne transmet jamais le secret partagé. STUN seul ne garantit pas la connexion entre tous les réseaux. Un service TURN extérieur n’est pas inclus ni provisionné par cette version.

Le bouton GIF ouvre dix réactions animées originales, filtrables, servies par Vesper, avec import d’un GIF personnel jusqu’à 512 Ko. Les octets du GIF sont chiffrés dans le message, et le destinataire l’affiche sans contacter un fournisseur externe. L’affichage automatique des GIF reçus peut être désactivé avec Réduire les animations. Il n’y a pas de recherche Giphy/Tenor ni de clé API tierce requise. Les autres pièces jointes gardent leur limite de 48 Ko.

Les mini-profils sont plus compacts : bannière, présence, bio, rôle, message privé et espaces en commun. Modération et empreinte d’identité sont regroupées dans des rubriques repliables. Le profil personnel donne accès au statut, à la personnalisation et aux paramètres. Les boutons ont un retour visuel à l’appui, respectant la réduction des animations.

Validation : 44 tests automatisés passent. Dans le navigateur, un appel entre deux pairs WebRTC réels a reçu des octets audio dans les deux sens avec des sources synthétiques, via la signalisation signée Vesper ; aucun microphone personnel utilisé. Envoi et réception de messages, GIF, stabilité des éléments déjà affichés, profil compact et réglages audio vérifiés sur une base de test distincte. Aucun test TURN extérieur ni appel entre deux réseaux physiques distincts n’a été effectué.

## Connexion GitHub (0.5)

GitHub peut vérifier l’identité et l’adresse e-mail sans Resend. Cliquer « Continuer avec GitHub », autoriser la lecture de l’adresse vérifiée, puis créer ou saisir le mot de passe Vesper qui protège le coffre de chiffrement. L’A2F Vesper reste requise si activée. Un compte lié à GitHub exige ce parcours aux connexions suivantes. Pour lier un compte existant, revenir à l’onglet Connexion après GitHub et utiliser son identifiant et son mot de passe existants ; l’adresse doit correspondre. Aucun rôle admin n’est accordé par le nom ou par GitHub.

Configurer `GITHUB_CLIENT_ID` et `GITHUB_CLIENT_SECRET` côté serveur. Callback exact pour Railway : `https://vesper-production-9796.up.railway.app/api/oauth/github/callback`. Utiliser une application OAuth distincte pour localhost, avec son callback local. Les secrets ne doivent pas être placés dans Git ou le navigateur. Le bouton est masqué si GitHub n’est pas configuré.

Le parcours utilise state lié au navigateur, PKCE S256, cookies HttpOnly et preuves temporaires de dix minutes consommées une seule fois. Le serveur vérifie l’identifiant GitHub stable et une adresse marquée vérifiée par GitHub. Les jetons GitHub ne sont pas stockés dans la base. L’autorisation ne demande pas l’accès aux dépôts. Les comptes locaux et leurs coffres sont conservés. Tests avec fournisseur simulé ; un essai GitHub réel nécessite la configuration de l’application OAuth.

Une mini plateforme de communication indépendante, inspirée de l'organisation de Discord. Version locale fonctionnelle avec un vrai serveur, des comptes et une base SQLite. Ce n'est pas une simple maquette HTML et ce n'est pas un service hébergé.

## Nouveautés 0.4 : sons, paramètres, QR code et administration

Les **paramètres** s'ouvrent avec la roue du profil. Rubriques : Mon profil, Apparence, Sons et notifications, Audio et vocal, Sécurité et A2F. **Échap** et la **croix en haut à droite** ferment la fenêtre. Les secrets et QR codes affichés sont retirés du document lors de sa fermeture.

Les effets sonores couvrent les boutons, menus, sélections, confirmations, erreurs, envois et actions du vocal : rejoindre/quitter, couper/réactiver le micro, couper/réactiver l'écoute et arrivée/départ d'un participant. Ils ont un interrupteur et un volume distincts des notifications. La rubrique Sons propose des boutons de démonstration, sans utiliser le microphone. Les touches de texte ne déclenchent pas de son.

**A2F par QR code** : Paramètres → Sécurité et A2F → Activer l'A2F avec un QR code → confirmer le mot de passe → scanner avec Authenticator → saisir son code à six chiffres → conserver les dix codes de secours. Une clé manuelle reste disponible si le scan est impossible. Le QR est généré localement par une bibliothèque fournie ; aucun secret n'est envoyé à un générateur externe.

**Administration** : le compte nyeko existant reçoit les droits sur l'instance créée pendant cette conversation. Une permission serveur est attribuée à son identifiant existant. Créer un compte avec le nom nyeko sur une nouvelle base ou envoyer un champ is_admin à l'inscription ne donne aucun privilège.

Entrer par Paramètres → Administration. Le déverrouillage exige le **code admin privé**, le **mot de passe du compte** et l'**A2F si activée** ; il expire après 15 minutes et reste propre à la session. Les essais de code sont limités. Le code n'est pas inclus dans ces sources : seul son hachage scrypt avec sel est conservé au serveur. Le panneau permet de le changer et de verrouiller l'accès manuellement.

Fonctions : statistiques, suspension/rétablissement des comptes, révocation des sessions, renommage des communautés et salons, suppression de salons de communauté, révocation des invitations, déconnexion de participants vocaux, suppression de messages chiffrés à partir de leurs métadonnées, fermeture des inscriptions, pause des écritures communautaires, annonce d'accueil et journal des actions. Le compte administrateur est protégé contre la suspension. Aucun contenu de conversation, mot de passe, clé privée ou secret A2F n'est livré dans le tableau de bord. Les copies de messages déjà reçues ne peuvent pas être effacées à distance.

**Validation : 35 tests réussis.** Le QR a été décodé et comparé à l'URI Authenticator exacte. Les transitions vocales et effets ont été vérifiés avec des périphériques simulés ; pas de nouvel appel audio réel entre appareils. Les rubriques, l'image QR, les fermetures Échap/croix et le déverrouillage admin ont été vérifiés dans le navigateur avec un compte distinct de vos données.

## Nouveautés 0.3 : Votre espace et Lumen

**Votre espace** est maintenant l'accueil personnel après connexion : conversations privées récentes, liste des amis, onglet « En ligne », demandes d'amitié et amis connectés dans le panneau de droite. Les conversations restent dans la barre latérale pendant la discussion. Les communautés conservent leurs salons séparés dans la barre des espaces.

Utiliser **Ajouter un ami** avec son identifiant exact. Le destinataire accepte ou refuse la demande dans **Demandes** ; l'expéditeur peut l'annuler. Les amis ne sont pas ajoutés automatiquement à partir des membres d'une communauté ou des anciennes conversations. Retirer un ami conserve l'historique de conversation. Le statut Invisible masque la présence dans la liste des amis en ligne. Les compteurs de messages non lus sont locaux à la session de navigation.

**Lumen** apparaît automatiquement à la création d'un compte. Sa visite en trois étapes explique Vesper, le chiffrement AES-256-GCM, la remise des clés via ECDH/HKDF, les signatures, les empreintes, le coffre et la double authentification. Le guide présente aussi les limites du prototype. C'est un guide local à réponses prédéfinies, sans IA externe et sans accès aux conversations. Une visite terminée est mémorisée pour le compte ; elle peut être relancée depuis **Lumen · Guide Vesper**. Les comptes existants sont conservés sans popup imposée.

**Validation : 23 tests réussis**, avec demandes/acceptations d'amitié, contrôle des accès, présence en ligne, respect du statut Invisible et mémorisation de la visite. Dans le navigateur, deux comptes fictifs ont vérifié l'inscription avec bot, l'acceptation d'une demande, la présence, l'ouverture d'une conversation privée depuis l'accueil et le retour à l'accueil après un envoi. La visite terminée ne réapparaît pas à la reconnexion.

## Nouveautés 0.2 : notifications et sécurité des comptes

- Un son doux est joué pour les nouveaux messages reçus, avec interrupteur, volume et bouton de test dans **♬** ou **Profil → Notifications sonores**. Les messages de l'utilisateur, modifications et suppressions ne sonnent pas ; le statut « Ne pas déranger » coupe les notifications. Les rafales sont limitées et les doublons habituels entre onglets sont écartés. Le navigateur doit autoriser le son après une interaction.
- Une adresse e-mail est obligatoire à la création d'un compte, validée côté serveur, unique et visible uniquement du propriétaire du compte. La confirmation du mot de passe est également demandée. Les comptes existants restent conservés et peuvent ajouter leur adresse dans **Profil → Sécurité du compte**.
- Vérification réelle par code envoyé par e-mail : validité 15 minutes, cinq essais maximum, délai d'une minute entre envois, code à usage unique. L'adresse reste explicitement **non vérifiée** tant que le code correct n'a pas été saisi.
- Double authentification TOTP avec application Authenticator : activation après confirmation du mot de passe et d'un code ; dix codes de secours à usage unique, affichés une seule fois. Les anciens codes TOTP sont refusés et cinq échecs bloquent temporairement les essais. L'activation déconnecte les autres sessions.

**Aucun service mail n'est configuré par défaut.** L'instance locale reste utilisable avec une adresse déclarée non vérifiée ; le bouton d'envoi est indisponible. La double authentification est indépendante du service mail et peut déjà être activée. Dès qu'un service mail est configuré, ou pour une origine distante, la vérification e-mail est obligatoire pour accéder aux conversations.

Pour brancher l'envoi réel, copier `.env.example` en `.env` et renseigner `RESEND_API_KEY` et `MAIL_FROM` avec un expéditeur autorisé par votre service Resend, puis relancer `npm start`. Ne mettez pas de clé API dans le code ou dans le navigateur. `REQUIRE_EMAIL_VERIFICATION=1` force aussi la vérification sur localhost : l'accès restera bloqué si aucun service mail ne fonctionne.

Les secrets Authenticator sont chiffrés au serveur avec une clé séparée : `data/vesper.sqlite.mfa-key`. Conserver ce fichier avec les sauvegardes de la base, et ne pas le partager. Les codes de secours sont enregistrés sous forme de hachages. Cette seconde authentification protège la connexion ; elle ne permet pas de récupérer un mot de passe ou de déchiffrer un coffre sans celui-ci.

**Validation : 20 tests réussis**, dont des vecteurs TOTP de la RFC 6238, le flux réel de notifications SSE, les codes expirés/rejoués, la confidentialité de l'e-mail, la migration des comptes et les codes de secours. L'inscription avec e-mail, le test du son, les préférences et la préparation d'Authenticator ont été vérifiés dans le navigateur sur une base distincte. Les tests mail utilisent un expéditeur simulé : aucun vrai e-mail n'a été envoyé.

## Ouvrir

Si le serveur lancé pendant la création fonctionne encore : **http://localhost:4180**.

Sinon, double-cliquer **Lancer-Vesper.cmd**, ou ouvrir un terminal dans ce dossier et exécuter :

```powershell
npm start
```

Node.js **24.13 ou plus récent** est requis et déjà disponible sur cette machine. Le fonctionnement de l'application utilise les fichiers fournis, sans dépendance à télécharger au démarrage. Le message de Node sur SQLite expérimental est attendu sur certaines versions.

Créer votre compte (identifiant de 3 à 24 lettres/chiffres/underscores, adresse e-mail, mot de passe d'au moins 12 caractères et confirmation), puis créer un espace. Son propriétaire peut générer un code d'invitation, créer des salons et gérer les rôles. Pour tester deux comptes sur cette machine, utiliser deux profils de navigateur ou une fenêtre privée ; les deux adresses localhost et 127.0.0.1 sur le même port fonctionnent également.

## Ce qui fonctionne

- Inscription, connexion, déconnexion, sessions par cookies HttpOnly et contrôle d'origine des écritures.
- Espaces séparés, invitations de 24 heures limitées à 20 nouvelles adhésions, conversations privées à deux.
- Salons textuels et vocaux ; salons privés avec liste d'accès, contrôle côté serveur.
- Rôles personnalisés (nom, couleur, droits), attribution des rôles, retrait de membres ; propriétaire protégé.
- Messages chiffrés côté navigateur et signés, réception en temps réel, stockage persistant, historique paginé.
- Réponses, modification par l'auteur, suppression par l'auteur ou la modération, épinglage par la modération.
- Emojis et petites pièces jointes chiffrées, **48 Ko maximum**.
- Recherche locale dans les messages chargés et déchiffrés : texte, `from:`, `in:`, `mentions:`, `has:file`, `has:link`, `before:`, `after:`, `on:` ; tri, surlignage et retour au message. Les dates utilisent UTC.
- Profils : nom, avatar emoji/symbole, bio, couleur d'accent, bannière et statut ; thème clair/nuit, densité et réduction des animations sur chaque appareil.
- Vocal WebRTC entre pairs, jusqu'à **6 personnes**, contrôle du micro, son, volume, sélection du microphone et déconnexion par la modération. Les signaux sont signés.
- Empreintes d'identité visibles ; une clé déjà vue est mémorisée dans le navigateur et un changement bloque les communications correspondantes.

## Chiffrement : portée exacte

Un message reçoit une clé AES-256-GCM aléatoire. Cette clé est enveloppée séparément pour chaque destinataire avec ECDH P-256 + HKDF ; le message et ses enveloppes sont signés avec ECDSA P-256. Le coffre contenant les clés privées est chiffré par AES-GCM avec une clé issue de PBKDF2-SHA256 (600 000 itérations, sel aléatoire). Les clés privées déverrouillées restent en mémoire.

Le navigateur dérive un secret d'authentification distinct du mot de passe (PBKDF2, 310 000 itérations, domaine propre à ce serveur). Le serveur hache ce secret avec scrypt et un sel aléatoire ; il ne reçoit pas directement le mot de passe utilisé pour le coffre.

La base contient les messages chiffrés et le coffre chiffré, mais les noms, profils, membres, dates, destinataires et autres métadonnées restent visibles du serveur. Les nouveaux membres n'ont pas les clés des messages antérieurs. Retirer un membre empêche les nouveaux envois et l'accès API, sans effacer les copies qu'il possède déjà.

**Ce protocole maison n'a pas été audité. Il ne permet pas d'affirmer que Vesper est plus sécurisé que Discord.** Pas de Double Ratchet, de confidentialité persistante garantie, de vérification indépendante au premier contact ou de récupération de mot de passe. La double authentification est disponible. Une compromission du navigateur ou du JavaScript fourni par le serveur peut compromettre les clés. Consulter [SECURITY.md](SECURITY.md).

## Vérification

```powershell
npm ci --ignore-scripts
npm test
```

L'installation concerne les bibliothèques de développement pour générer/décoder les QR dans les tests. Le générateur de l'application est déjà fourni dans public/vendor/. Pour le régénérer après une mise à jour : `npm run vendor:qr`. Voir THIRD-PARTY-NOTICES.md.

Les tests vérifient le chiffrement et la falsification, l'authentification, les permissions, les invitations, les salons privés, les conversations à deux, les modifications/épinglages, les signaux vocaux signés, la persistance et la révocation des sessions. Les tests API ouvrent uniquement un serveur temporaire sur la boucle locale.

Vérification navigateur effectuée sur une base distincte de vos données : inscription, création/rejointure d'espace, échanges entre deux comptes et réception en temps réel, ancien message indéchiffrable pour un nouveau membre, recherche, personnalisation du profil et affichage du panneau vocal. **Pas de test d'appel audio réel entre microphones ni de test TURN sur Internet.**

## Données et lancement distant

Le paquet Docker et la configuration Railway sont fournis. Voir [DEPLOYMENT.md](DEPLOYMENT.md) pour la publication HTTPS, le volume persistant, les e-mails et la migration des comptes.

La base réelle est `data/vesper.sqlite`, avec ses fichiers SQLite WAL/SHM éventuels et sa clé MFA séparée. Les tests utilisent des bases temporaires séparées. Les messages ne sont pas envoyés à un service tiers. Si l'envoi mail est configuré, l'adresse du destinataire et son code de vérification passent par ce fournisseur. Ne partagez pas le dossier `data/` ; l'archive source fournie l'exclut.

Par défaut le serveur écoute uniquement sur `127.0.0.1:4180`. Deux personnes sur des machines différentes nécessitent un hébergement : proxy HTTPS, nom de domaine et configuration `HOST`, `PORT`, `ORIGIN`. Ne publiez pas directement ce serveur HTTP pour des comptes réels.

Variables optionnelles :

| Variable | Usage |
|---|---|
| `PORT` | Port HTTP local, 4180 par défaut |
| `HOST` | Adresse d'écoute, 127.0.0.1 par défaut |
| `ORIGIN` | Origine exacte du site, http://localhost:4180 par défaut ; HTTPS pour un déploiement |
| `DATA_FILE` | Chemin de la base SQLite |
| `ICE_SERVERS` | Tableau JSON de serveurs STUN/TURN pour WebRTC |
| `RESEND_API_KEY` | Clé API serveur du service d'envoi mail |
| `MAIL_FROM` | Adresse d'expéditeur autorisée |
| `REQUIRE_EMAIL_VERIFICATION` | `1` pour rendre la vérification obligatoire même sur localhost |
| `ADMIN_PANEL_CODE` | Facultatif : code de 16 à 128 caractères ; s'il est présent, il remplace le hachage stocké au démarrage. Laisser vide pour conserver le code actuel. Ne confère pas de rôle admin. |

Le vocal fonctionne sans relais sur certains réseaux locaux. Pour Internet, un service TURN est généralement nécessaire ; fournir des identifiants temporaires et limiter les ressources du relais. Cette version ne comprend pas un service TURN ni un service de supervision.

## Structure

`server.mjs` : HTTP, SQLite, sessions, permissions, SSE et signalisation. `security.mjs` : TOTP, protection des secrets et envoi mail. `public/crypto.mjs` : coffre, chiffrement et signatures. `public/voice.mjs` : audio WebRTC. `public/notifications.mjs` : sons et préférences. `public/app.mjs` : interface et interactions. `public/search.mjs` : recherche locale. `test/` : tests isolés.

## Preuves et sources

- [Guide officiel de recherche Discord](https://support.discord.com/hc/en-us/articles/115000468588-How-to-Use-Search-on-Discord) : organisation de la recherche, filtres, tri et navigation vers le message.
- [Contrat public de recherche Discord](https://github.com/discord/discord-api-docs/blob/main/developers/resources/message.mdx#search-guild-messages) : recherche structurée, pagination et état d'indexation.
- [Web Crypto et dérivation ECDH/HKDF](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey) : primitives utilisées par cette implémentation indépendante.
- [RFC 6238](https://www.rfc-editor.org/info/rfc6238/) : standard TOTP et vecteurs de validation.
- [API officielle Resend](https://resend.com/docs/api-reference/emails/send-email) : envoi des codes de vérification lorsque le service est configuré.

Ces documents ne constituent pas une preuve de décompilation ou d'exécution du client Discord. La recherche Vesper porte sur le contenu déchiffré localement, contrairement à la recherche serveur décrite par l'API Discord.
