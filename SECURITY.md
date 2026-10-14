# Sécurité et limites — Vesper 0.4

Vesper est un prototype de communication à serveur unique. Il n'est pas validé pour des communications sensibles ou une exposition publique sans travail supplémentaire.

## Protections mises en œuvre

- Identités ECDH et ECDSA P-256 distinctes et immuables dans cette version.
- AES-256-GCM : IV aléatoires de 96 bits ; données associées liant les messages à leur identifiant, salon, auteur et destinataire.
- Clé AES fraîche et clé ECDH éphémère fraîche pour chaque message ou modification ; enveloppe dédiée à chaque utilisateur autorisé.
- Signature ECDSA du message complet, vérifiée dans le navigateur et au serveur. Envoi refusé si la liste de destinataires change entre la lecture du périmètre et l'envoi.
- Signalisation WebRTC signée : salon, émetteur, destinataire, SDP/ICE et identifiant aléatoire de signal. Les clients vérifient la signature et écartent les signaux déjà reçus.
- Authentification séparée du coffre ; scrypt côté serveur (N=32768, r=8, p=1), sel par compte, comparaison constante.
- Sessions aléatoires 256 bits ; seul leur hachage est enregistré. Expiration à sept jours, cookies HttpOnly/SameSite=Strict et Secure si ORIGIN est HTTPS.
- Contrôle d'origine, JSON obligatoire sur les écritures, limites de taille et de fréquence ; permissions et accès aux salons appliqués côté serveur.
- Politique CSP, affichage des textes utilisateur sans HTML interprété et téléchargement des pièces jointes comme fichiers, pas comme HTML rendu.
- Empreintes de clés mémorisées à la première utilisation. Un changement détecté bloque le déchiffrement ou l'envoi correspondant.
- Adresse e-mail obligatoire, unique et privée. Les comptes existants sans adresse ne sont pas supprimés. Vérification par code à durée limitée et cinq essais maximum ; code protégé par HMAC avec une clé séparée de la base. L'envoi utilise un service externe configuré uniquement au serveur.
- Double authentification TOTP RFC 6238, secrets chiffrés avec une clé fichier distincte de la base, protection contre le rejeu et blocage temporaire des essais. Dix codes de secours aléatoires de 80 bits, stockés sous forme de hachages et consommés atomiquement. Activation, désactivation et changement d'adresse exigent une confirmation du mot de passe ; la désactivation et le changement d'adresse exigent aussi le second facteur s'il est actif.
- Sans service mail, l'adresse déclarée n'est jamais affichée comme vérifiée. L'exception d'accès sans vérification concerne uniquement la démonstration locale ; les origines distantes imposent la vérification. `REQUIRE_EMAIL_VERIFICATION=1` l'impose également en local.
- Seul le destinataire peut accepter une demande d'amitié ; seuls ses deux participants peuvent la supprimer. Les amis ne donnent pas accès aux salons privés. Le statut Invisible masque leur présence dans l'accueil. Le guide Lumen fonctionne entièrement dans le navigateur avec un texte prédéfini : il n'est pas un compte serveur et ne reçoit pas les messages privés.
- Administration : permission serveur explicite par compte, code stocké par scrypt avec sel, confirmation du mot de passe et second facteur si actif. Élévation limitée à quinze minutes et liée à une session, contrôles sur chaque route, limitation des essais et journal sans secrets. La rotation du code verrouille les élévations existantes. Les comptes administrateurs ne peuvent pas être suspendus depuis le panneau.
- La suspension révoque les sessions et exclut le compte des enveloppes de nouveaux messages. Le tableau admin expose les métadonnées nécessaires à la gestion globale, y compris noms des salons, auteurs et dates, mais pas les corps chiffrés, clés, hachages de mots de passe, e-mails des autres comptes ou secrets MFA.
- Le QR d'activation A2F est généré localement et contient une clé secrète : ne pas partager son image. La fermeture du dialogue retire le QR et les champs secrets de son document. La clé manuelle reste une alternative au scan.

## Ce que cela ne garantit pas

- Aucun audit cryptographique, protocole standard de messagerie ratcheting ni garantie de confidentialité persistante. Compromettre une clé de destinataire peut exposer ses anciens messages enregistrés.
- Le premier contact dépend des clés distribuées par le serveur. Comparer les empreintes par une voie indépendante pour vérifier l'identité. Un serveur malveillant peut fournir du JavaScript malveillant ; le chiffrement navigateur ne résout pas cette menace.
- Les métadonnées, profils et listes de membres ne sont pas chiffrés ; l'horodatage serveur et les décisions de modération ne sont pas signés.
- Les connexions WebRTC peuvent révéler les adresses IP entre participants. Le navigateur chiffre le média par DTLS-SRTP ; les flux ne passent pas par un mixeur serveur dans cette version. Un relais TURN externe a ses propres risques, coûts et politiques.
- Pas de récupération du mot de passe, changement de mot de passe/clés, audit des modérateurs, sauvegarde automatique, antivirus, protection distribuée contre les abus ou garantie de disponibilité. Une migration additive préserve les comptes lors de l'ajout de l'e-mail et de la MFA ; il n'y a pas de framework général de migrations. Perdre la clé MFA serveur impose d'utiliser les codes de secours pour récupérer l'accès et reconfigurer le second facteur. Un accès à tout le dossier serveur peut exposer cette clé : le chiffrement des secrets n'est pas une protection contre la compromission complète de l'hôte.
- Les anciens membres peuvent conserver les clés et copies déjà reçues. Rééditer un ancien message le chiffre pour les destinataires actuels : ceux-ci pourront donc lire sa version rééditée.
- Le client conserve les messages déchiffrés uniquement en mémoire et les empreintes dans le stockage local. Le serveur conserve tous les messages chiffrés, jusqu'à leur suppression explicite. L'épinglage et la recherche de l'interface concernent l'historique chargé.

## Avant un hébergement réel

Faire auditer/remplacer le protocole de chiffrement par une implémentation éprouvée, définir un modèle de menace, installer HTTPS avec une origine exacte, configurer l'envoi mail, activer la MFA et définir une stratégie de récupération, tester les accès et la rotation des clés, gérer les migrations/sauvegardes et quotas, utiliser TURN avec identifiants éphémères, puis tester de vrais appels sur des réseaux différents. Ne pas annoncer « plus sûr que Discord » sur la base de ce prototype.
